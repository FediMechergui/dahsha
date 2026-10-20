import { mergeCachedProviders, refreshProviders, saveMergeReport } from './provider-sync.js';
// Orchestrates refreshes: lists playlists + uploads per channel, detects changes, fetches details,
// rebuilds the catalogue and emits events that the HTTP layer forwards to browsers over SSE.
import { EventEmitter } from 'node:events';
import { readJson, writeJson, DEFAULT_SOURCES, DEFAULT_OVERRIDES } from './store.js';
import {
  listChannelPlaylists, listChannelUploads, getPlaylistVideos, getVideoDetails, fetchChannelFeed, pool, resolveSource, detectProfile, clientLangFor, isDetailStub,
} from './youtube.js';
import { buildCatalog, diffCatalog } from './catalog.js';
import { enrichArtwork, getArtwork, artworkEnabled } from './artwork.js';
import { fetchMyflixerCatalog, siteDate } from './documentaries.js';
import { hasArabic, cleanTitle, cleanSynopsis, relativeToMs } from './text.js';
import { playlistWanted, uploadWanted, rowWanted, isShortsPlaylist, takesUploads } from './source-filters.js';
import { showIdState } from './show-ids.js';

const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES || 15);
const FEED_MINUTES = Number(process.env.FEED_MINUTES || 3);
const uploadsKey = (channelId) => `UPLOADS:${channelId}`;
const sourceName = (src) => `${src?.short || src?.title || src?.id || 'unknown source'} (${src?.id || '?'})`;

// Interface language a cached UPLOADS:* listing was made in. Records written before per-language
// clients carry no listedLang and were listed with the Arabic client; a record only the RSS poll
// has written (listedLang null) has never been walked.
const listedLangOf = (rec) => (rec.listedLang === undefined ? 'ar' : rec.listedLang);

/**
 * The original title of a cached hl=ar listing row of a non-Arabic source: YouTube localised the
 * listing title into Arabic, while /player details keep the original. Same rule as buildCatalog;
 * null when the row keeps its title (Arabic sources, non-YouTube ids, mixed-script originals).
 */
export function originalTitle(v, src, details) {
  const lang = src?.contentLang || src?.lang || 'ar';
  const original = details?.[v.id]?.title;
  return lang !== 'ar' && /^[\w-]{11}$/.test(v.id || '') && hasArabic(v.title) && original && !hasArabic(original) ? original : null;
}

// pool() turns a failed item into { error, item } and carries on; report those instead of dropping them.
function logFailures(label, results, describe, limit = 20) {
  const failed = results.filter((r) => r && r.error !== undefined && r.item !== undefined);
  for (const r of failed.slice(0, limit)) console.warn(`${label} ${describe(r.item)}: ${r.error}`);
  if (failed.length > limit) console.warn(`${label} ... ${failed.length - limit} more failures (${failed.length} of ${results.length})`);
  return failed.length;
}

function logCapped(lines, limit = 30, more = (n) => `[catalogue] ... ${n} more playlist notes`) {
  for (const l of lines.slice(0, limit)) console.warn(l);
  if (lines.length > limit) console.warn(more(lines.length - limit));
}

/**
 * A warning that GitHub Actions shows as an annotation on the run (a ::warning command on stdout, at a
 * line start: the CLI's progress output can leave the cursor mid-line); a plain warning line elsewhere.
 */
export function ciWarning(title, msg, prefix = '[catalogue]') {
  if (process.env.GITHUB_ACTIONS !== 'true') { console.warn(`${prefix} warning: ${msg}`); return; }
  const data = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`\n::warning title=${data(title).replace(/:/g, '%3A').replace(/,/g, '%2C')}::${data(msg)}`);
}

// ---- cache safety ---------------------------------------------------------------------------
// A fetch never replaces a cached list it would empty or shrink badly, a fetch that is stored keeps
// the cached rows it did not return (mergePlaylistRows), and a playlist one channel listing omits is
// kept: what YouTube lists (and shows inside a playlist) depends on the requesting region, and CI runs
// from US runners. Playlist records may carry, besides the fetched fields:
//   retryAfter / retries / retrySignature  backoff after an empty or short result (or a failed probe);
//                                          retrySignature is the listing signature that was tried
//   missingSince  first refresh whose complete channel listing omitted the playlist
//   confirmedAt   last time a fetch by id answered for a playlist the listing omits
//   seeded        restored from playlist-seeds.json; goneSince: first of the "gone" answers for an
//                 unlisted seeded playlist whose rows are still kept; gone: emptied after a second one
const HOUR = 3600e3, DAY = 24 * HOUR;
const MISSING_DAYS = 30; // unlisted and unanswered for this long: deleted
const UNLISTED_RECHECK = DAY; // an unlisted playlist that answered is fetched again after a day
const SEEDED_GONE_GAP = DAY; // a seeded playlist is emptied by a second "gone" answer at least this long after the first
const KEEP_RATIO = 0.7; // a result below 70% of the cached list is not trusted, unless the badge agrees
const PARTIAL_RATIO = 0.5; // a result below half its badge count is partial
const backoffMs = (retries) => Math.min(12 * HOUR * 2 ** Math.max(0, retries - 1), 7 * DAY);

/**
 * How a fetched playlist relates to its cached copy:
 * - 'keep': empty, or far below the cached list without the badge (expectedCount) explaining it, or
 *   partial and shorter than the cache: keep the cached videos and signature and retry later;
 * - 'retry': nothing better is cached, but the result is empty or partial: store it with signature
 *   null and a backoff, so it is fetched again;
 * - 'ok': store it.
 * A stored result keeps the cached rows it did not return (mergePlaylistRows).
 */
export function judgePlaylist(data, cached, badge = null) {
  const n = data?.videos?.length || 0;
  const c = cached?.videos?.length || 0;
  const expected = data?.expectedCount ?? badge ?? null;
  if (!n) return c ? 'keep' : expected === 0 ? 'ok' : 'retry';
  const badgeAgrees = expected != null && n >= expected * KEEP_RATIO;
  if (c && n < c * KEEP_RATIO && !badgeAgrees) return 'keep';
  if (expected != null && n < expected * PARTIAL_RATIO) return n < c ? 'keep' : 'retry';
  return 'ok';
}

/**
 * The rows to store for a fetched playlist judged 'ok' or 'retry': the fetched rows plus the cached
 * rows the fetch did not return, each in its cached place (after the cached row before it that the
 * fetch did return). What YouTube shows inside a playlist depends on the requesting region (CI runs
 * from US runners), so a missing row alone does not mean it left the playlist: seeded rows and rows
 * fetched from a vantage point that sees more cannot be fetched again by CI. A missing row is dropped
 * only when
 * - the fetch is complete: it returned at least as many videos as the playlist's own count (expected),
 *   so the count confirms the shrink (reason 'complete'); or
 * - details mark the video unavailable or private (reason 'unavailable').
 * Returns { videos, kept, dropped, reason } (reason is null when nothing was dropped).
 */
export function mergePlaylistRows(fetched, cached, { expected = null, details = {} } = {}) {
  const got = new Set(fetched.map((v) => v.id));
  const missing = [], seen = new Set();
  for (const v of cached?.videos || []) if (v?.id && !got.has(v.id) && !seen.has(v.id)) { seen.add(v.id); missing.push(v); }
  if (!missing.length) return { videos: fetched, kept: 0, dropped: 0, reason: null };
  if (expected > 0 && fetched.length >= expected) return { videos: fetched, kept: 0, dropped: missing.length, reason: 'complete' };
  const gone = (v) => details?.[v.id]?.unavailable === true || details?.[v.id]?.isPrivate === true;
  const keep = new Set(missing.filter((v) => !gone(v)).map((v) => v.id));
  const dropped = missing.length - keep.size;
  if (!keep.size) return { videos: fetched, kept: 0, dropped, reason: 'unavailable' };
  // Kept rows follow the nearest cached row before them that the fetch returned; rows before any of
  // those lead the list.
  const lead = [], after = new Map();
  let anchor = null;
  for (const v of cached.videos) {
    if (!v?.id) continue;
    if (got.has(v.id)) { anchor = v.id; continue; }
    if (!keep.has(v.id)) continue;
    keep.delete(v.id); // a duplicate cached entry is kept once
    if (anchor == null) lead.push(v);
    else { if (!after.has(anchor)) after.set(anchor, []); after.get(anchor).push(v); }
  }
  const videos = [...lead];
  for (const v of fetched) {
    videos.push(v);
    const tail = after.get(v.id);
    if (tail) { videos.push(...tail); after.delete(v.id); }
  }
  return { videos, kept: videos.length - fetched.length, dropped, reason: dropped ? 'unavailable' : null };
}

/**
 * Whether an uploads row is worth keeping past the listing depth: a known duration of at least
 * minEpisodeSeconds (details or the listing badge) and nothing saying it cannot be shown.
 */
export function worthyUpload(v, details, minSec = 420) {
  const d = details?.[v.id];
  if (d?.unavailable === true || d?.isPrivate === true || d?.embeddable === false) return false;
  return Math.max(d?.durationSec || 0, v.durationSec || 0) >= minSec;
}

/** maxUploads limits how deep the uploads tab is listed; past it only rows that are not worthy are trimmed. */
export function retainUploads(rows, cap, details, minSec = 420) {
  return rows.filter((v, i) => i < cap || worthyUpload(v, details, minSec));
}

// A seeded playlist row is rebuilt from cached details (the seed keeps only video ids).
function seedRow(id, details) {
  const d = details?.[id];
  if (!d?.title || d.unavailable === true) return null;
  return { id, title: d.title, durationSec: d.durationSec || 0, seeded: true };
}

// ---- video details --------------------------------------------------------------------------
// Each refresh fetches the details of new videos, retries stored stubs (getBasicInfo fallbacks
// without a duration, empty records) and re-checks a rolling share of the listed videos. Details
// records may carry, besides the fetched fields:
//   checkedAt          last request for the id, whatever came back (orders the retry and re-check queues)
//   unavailableChecks  consecutive checks in which YouTube said the video is removed or private
//   unavailableSince   the first of those checks; unavailableReason: what YouTube said
//   unavailable: true  from UNAVAILABLE_CHECKS such checks on (contract 1: buildCatalog skips it); a
//                      check that gets data again removes all four fields
//   embeddable         false when embedding is disabled (contract 1: buildCatalog skips it), true when it embeds
// Network errors, timeouts, bot checks and geo restrictions never count as a check that the video is gone.
const UNAVAILABLE_CHECKS = 2;
const CONFIRM_GAP = HOUR; // a confirming check, and a stub retry, comes at least an hour after the last request
const BLOCK_GUARD = { floor: 10, ratio: 0.2 }; // more "gone" (or "not embeddable") answers in one pass look like a block
const UNAVAILABLE_FIELDS = ['unavailable', 'unavailableChecks', 'unavailableSince', 'unavailableReason'];
const isYouTubeId = (id) => /^[\w-]{11}$/.test(id || '');
const lastRequest = (d) => Date.parse(d?.checkedAt || d?.fetchedAt || '') || 0;
const awaitingConfirmation = (d) => (d.unavailableChecks > 0 && d.unavailable !== true) || (d.unavailable === true && !d.unavailableChecks);

/** A non-negative whole number from the environment, else the default (an empty or bad value is ignored). */
export function envCount(name, fallback) {
  const raw = process.env[name];
  const n = Number(raw);
  return raw != null && String(raw).trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * Merges a details answer into the stored record (prev may be missing). Returns { record, change, ... }:
 * - a "gone" answer counts one more consecutive check; from UNAVAILABLE_CHECKS on the record is
 *   unavailable ('reported' first, then 'confirmed', then 'still-unavailable'). Its data is kept.
 * - a stub answer never replaces data: it replaces only a missing record or another stub ('stub').
 * - data clears any unavailability marks ('new', 'filled' for a former stub, 'updated', 'cleared' for an
 *   unconfirmed report, 'restored' for an unavailable video that plays again). A getBasicInfo fallback over
 *   /player data refreshes title, description, duration and views and keeps the rest (publish date, category).
 * Flags: edited (title or description changed), dated (a publish date where there was none), embedOff/embedOn.
 */
export function mergeDetails(prev, res, nowIso = new Date().toISOString()) {
  if (res?.gone) {
    const checks = (prev?.unavailableChecks || (prev?.unavailable === true ? 1 : 0)) + 1;
    const record = {
      ...(prev || { id: res.id }), unavailableChecks: checks,
      unavailableSince: prev?.unavailableSince || (prev?.unavailable === true ? prev.fetchedAt : null) || nowIso,
      unavailableReason: [res.status, res.reason].filter(Boolean).join(': ') || null, checkedAt: nowIso,
    };
    if (checks >= UNAVAILABLE_CHECKS) record.unavailable = true;
    const change = checks < UNAVAILABLE_CHECKS ? 'reported' : prev?.unavailable === true && prev?.unavailableChecks ? 'still-unavailable' : 'confirmed';
    return { record, change };
  }
  if (isDetailStub(res)) {
    const replace = !prev || (isDetailStub(prev) && !prev.unavailableChecks && prev.unavailable !== true);
    return { record: replace ? { ...res, checkedAt: nowIso } : { ...prev, checkedAt: nowIso }, change: 'stub' };
  }
  const clean = prev ? Object.fromEntries(Object.entries(prev).filter(([k]) => !UNAVAILABLE_FIELDS.includes(k))) : null;
  const hadData = !!clean && !isDetailStub(clean);
  let record;
  if (res.fallback && hadData && !clean.fallback) {
    record = {
      ...clean, title: res.title || clean.title, description: res.description || clean.description,
      durationSec: res.durationSec || clean.durationSec, viewCount: res.viewCount || clean.viewCount, checkedAt: nowIso,
    };
  } else {
    record = { ...res, publishedAt: res.publishedAt || clean?.publishedAt || null, checkedAt: nowIso };
  }
  if (res.embeddable !== undefined) record.embeddable = res.embeddable;
  else if (clean?.embeddable !== undefined) record.embeddable = clean.embeddable;
  const change = prev?.unavailable === true ? 'restored' : prev?.unavailableChecks ? 'cleared' : !prev ? 'new' : hadData ? 'updated' : 'filled';
  return {
    record, change,
    edited: hadData && (clean.title !== record.title || (clean.description || '') !== (record.description || '')),
    dated: !!prev && !prev.publishedAt && !!record.publishedAt,
    embedOff: record.embeddable === false && prev?.embeddable !== false,
    embedOn: prev?.embeddable === false && record.embeddable === true,
  };
}

/**
 * When a listed row was published, in ms, or null: its publish time (RSS rows), else its age text
 * ("قبل 3 أيام", "3 weeks ago") counted back from when it was listed (the row's listedAt, else the
 * playlist's fetchedAt, else now).
 */
export function listedRowTime(v, pl = null, now = Date.now()) {
  const published = Date.parse(v?.published || '');
  if (Number.isFinite(published)) return published;
  const age = v?.relative ? relativeToMs(v.relative) : null;
  if (age == null) return null;
  const anchor = Date.parse(v.listedAt || pl?.fetchedAt || '');
  return (Number.isFinite(anchor) ? anchor : now) - age;
}

/**
 * The details work of one refresh, from what is listed and stored:
 * - fresh: listed videos without details, long rows first and the newest first among them (rows of
 *   unknown age after the dated ones, in listing order), up to newLimit; the rest wait for the next
 *   refresh (a channel added with thousands of uploads is fetched over several runs);
 * - stubs: stored stubs, up to stubLimit (long rows first, then the longest-waiting), each at most once an hour;
 * - recheck: up to recheckLimit listed YouTube videos with data, in this order: reports of a removed or
 *   private video awaiting confirmation (an hour after the report), weak records (getBasicInfo fallbacks,
 *   no publish date, or no duration and not live; at most daily), then the rest, oldest request first, once its last
 *   request is recheckDays old.
 * Rows of Shorts lists and rows the source's title filters reject are never planned (rowWanted).
 * Each job is { id, kind, lang, src, durationSec, posted }; waiting counts the jobs left for later runs.
 */
export function planDetails({ playlists, details, sources, now = Date.now(), minSec = 420, newLimit = Infinity, stubLimit = 300, recheckLimit = 300, recheckDays = 7 }) {
  const srcById = new Map((sources || []).map((s) => [s.id, s]));
  const listed = new Map();
  for (const pl of Object.values(playlists || {})) {
    const src = srcById.get(pl.sourceId);
    // Rows the source's title filters reject (source-filters.js) never become episodes: no details for them.
    for (const v of pl.videos || []) {
      if (v?.id && !listed.has(v.id) && rowWanted(src, pl, v, details)) listed.set(v.id, { id: v.id, lang: clientLangFor(src), src, durationSec: v.durationSec || 0, posted: listedRowTime(v, pl, now) });
    }
  }
  const long = (j) => (j.durationSec >= minSec ? 1 : 0);
  const newest = (a, b) => (a.posted == null ? (b.posted == null ? 0 : 1) : b.posted == null ? -1 : b.posted - a.posted);
  const fresh = [], stubs = [], tiers = [[], [], []];
  for (const job of listed.values()) {
    if (job.id.startsWith('mf:')) continue;
    const d = details?.[job.id];
    if (!d) { fresh.push({ ...job, kind: 'new' }); continue; }
    if (!isYouTubeId(job.id)) continue;
    const age = now - lastRequest(d);
    if (awaitingConfirmation(d)) { if (age >= CONFIRM_GAP) tiers[0].push({ ...job, kind: 'recheck', at: lastRequest(d) }); continue; }
    if (d.unavailable !== true && isDetailStub(d)) { if (age >= CONFIRM_GAP) stubs.push({ ...job, kind: 'stub', at: lastRequest(d) }); continue; }
    // A live stream has no duration while it runs: that alone does not make it weak.
    const weak = d.unavailable !== true && (d.fallback === true || !d.publishedAt || (!d.durationSec && d.isLive !== true));
    if (age >= (weak ? DAY : recheckDays * DAY)) tiers[weak ? 1 : 2].push({ ...job, kind: 'recheck', at: lastRequest(d) });
  }
  const oldest = (a, b) => a.at - b.at;
  return {
    fresh: fresh.sort((a, b) => long(b) - long(a) || newest(a, b)).slice(0, newLimit),
    stubs: stubs.sort((a, b) => long(b) - long(a) || oldest(a, b)).slice(0, stubLimit),
    recheck: tiers.flatMap((t) => t.sort(oldest)).slice(0, recheckLimit),
    waiting: { fresh: Math.max(0, fresh.length - newLimit), stubs: stubs.length, recheck: tiers.reduce((n, t) => n + t.length, 0) },
  };
}

// ---- Myflixer -------------------------------------------------------------------------------
// MYFLIXER:<source id> holds the documentary films and series episodes of the WordPress API
// (documentaries.js), stored display-ready: titles through cleanTitle (episode titles without the
// repeated "Show – Season N Episode N:" prefix), synopses through cleanSynopsis, dates in UTC
// (siteDate) and no invented runtime or views: an unknown duration is 0 (contract 4). Episode rows also
// carry seriesId (mf:s:<slug>) and, when it is a real discovery date, addedAt (contract 4).
const MYFLIXER_CACHE = 3 * HOUR; // a younger playlist is not fetched again (unless full)
// A listing that leaves out more than this share of the cached series (or of the cached films) looks cut
// short: the fetch is refused and the cached playlist stays. A drop still seen after MYFLIXER_DROP_REFUSALS
// refusals in a row and MYFLIXER_DROP_HOLD since the first (two 6-hourly CI runs) is accepted as removals;
// a full refresh accepts it at once.
const MYFLIXER_LISTING_DROP = 0.1;
const MYFLIXER_DROP_REFUSALS = 2;
const MYFLIXER_DROP_HOLD = 10 * HOUR;
// Episode pages failing for more than this share of the listed series is reported; their cached episodes are kept.
const MYFLIXER_PAGE_FAILURES = 0.1;
const MYFLIXER_INVENTED = { 'mf:m:': 5400, 'mf:e:': 3000 }; // the runtimes older code made up (Myflixer gives none)
const MYFLIXER_FORM = 1; // a playlist record already in this stored form carries form: MYFLIXER_FORM (not healed again)
const EP_MARKER = /^.*?\b(?:season\s*\d+\s*,?\s*episode\s*\d+|S\d+\s*E\d+)\b\s*[:\-–—|]?\s*/i;
const myflixerUrl = (slug) => `https://myflixerz.day/episodes/${slug}/`;
const knownSec = (sec) => (Number(sec) > 0 ? Number(sec) : 0);

/** An episode title without what season and number already say ("Show – Season 1 Episode 2: Name" → "Name"); "Episode N" when nothing else is left. */
export function myflixerEpisodeTitle(title, showTitle = '', episode = null) {
  let t = (cleanTitle(title || '') || '').replace(EP_MARKER, '').trim();
  const show = cleanTitle(showTitle || '') || '';
  if (show && t.length > show.length + 2 && t.toLowerCase().startsWith(show.toLowerCase())) {
    const rest = t.slice(show.length).match(/^\s*[-–—:|]\s*(\S.+)$/);
    if (rest) t = rest[1].trim();
  }
  return t || (episode != null ? `Episode ${episode}` : '');
}

function myflixerFilm(f, nowIso) {
  const title = cleanTitle(f.title) || f.title || '';
  const durationSec = knownSec(f.durationSec);
  return {
    video: {
      id: f.id, title, showTitle: title, episodeTitle: 'Full film',
      parsed: { showTitle: title, episodeTitle: 'Full film', kind: 'film', number: null, season: null },
      durationSec, durationText: '', views: null, thumb: f.thumb, tags: f.tags, sourceUrl: f.sourceUrl, embedUrl: f.sourceUrl,
    },
    detail: {
      id: f.id, title, description: cleanSynopsis(f.synopsis), durationSec, viewCount: null, publishedAt: siteDate(f.publishedAt),
      sourceUrl: f.sourceUrl, embedUrl: f.sourceUrl, thumb: f.thumb, playable: true, fetchedAt: nowIso,
    },
  };
}

function myflixerEpisode(s, showTitle, ep, nowIso) {
  const id = `mf:e:${ep.slug}`, url = myflixerUrl(ep.slug);
  const title = myflixerEpisodeTitle(ep.title, showTitle, ep.episode);
  const durationSec = knownSec(ep.durationSec);
  return {
    video: {
      id, title: `${showTitle} - S${ep.season}E${ep.episode}: ${title}`, showTitle, episodeTitle: title,
      parsed: { showTitle, episodeTitle: title, kind: 'series', number: ep.episode, season: ep.season },
      durationSec, durationText: '', views: null, thumb: s.thumb, tags: s.tags, sourceUrl: url, embedUrl: url, seriesId: s.id,
    },
    detail: {
      id, title, description: cleanSynopsis(s.synopsis), durationSec, viewCount: null, publishedAt: siteDate(s.publishedAt),
      sourceUrl: url, embedUrl: url, thumb: s.thumb, playable: true, fetchedAt: nowIso,
    },
  };
}

/**
 * A cached MYFLIXER row and its details record brought to the stored form above (rows written by
 * older code have raw entities, "Season N Episode N" prefixes, invented runtimes and offset-less
 * site-local dates). Returns the same objects when nothing changes; idempotent.
 */
export function healMyflixerRow(v, d) {
  const invented = MYFLIXER_INVENTED[String(v?.id).slice(0, 5)];
  if (!invented) return { video: v, detail: d };
  const sec = (n) => (knownSec(n) === invented ? 0 : knownSec(n));
  let video;
  if (v.id.startsWith('mf:e:')) {
    const showTitle = cleanTitle(v.showTitle || v.parsed?.showTitle || '') || v.showTitle || '';
    const number = v.parsed?.number ?? null, season = v.parsed?.season ?? null;
    const episodeTitle = myflixerEpisodeTitle(v.parsed?.episodeTitle ?? v.episodeTitle ?? '', showTitle, number) || v.episodeTitle || '';
    video = {
      ...v, title: number != null ? `${showTitle} - S${season}E${number}: ${episodeTitle}` : cleanTitle(v.title) || v.title, showTitle, episodeTitle,
      parsed: { ...v.parsed, showTitle, episodeTitle }, durationSec: sec(v.durationSec), durationText: sec(v.durationSec) ? v.durationText : '', views: null,
    };
  } else {
    const title = cleanTitle(v.title) || v.title;
    video = { ...v, title, showTitle: title, parsed: { ...v.parsed, showTitle: title }, durationSec: sec(v.durationSec), durationText: sec(v.durationSec) ? v.durationText : '', views: null };
  }
  const detail = d && {
    ...d, title: video.id.startsWith('mf:e:') ? video.episodeTitle : video.title, description: cleanSynopsis(d.description),
    durationSec: sec(d.durationSec), viewCount: null, publishedAt: siteDate(d.publishedAt),
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return { video: same(video, v) ? v : video, detail: same(detail, d) ? d : detail };
}

// Fill in fields that older sources.json files did not have.
function normalizeSource(s) {
  if (s.type === 'myflixer') {
    return {
      scanUploads: false,
      maxUploads: 0,
      profile: 'myflixer',
      lang: 'en',
      short: s.short || 'Myflixer',
      brands: s.brands || ['Myflixer'],
      ...s,
    };
  }
  const det = detectProfile(s.id, s.title, s.url);
  return {
    scanUploads: s.type === 'channel',
    maxUploads: det.maxUploads || (det.profile === 'dw' ? 1500 : 400),
    ...s,
    profile: s.profile || det.profile,
    lang: s.lang || det.lang,
    short: s.short || det.short || s.title,
    brands: s.brands || det.brands || [s.title],
  };
}

export class Catalogue extends EventEmitter {
  constructor() {
    super();
    this.sources = readJson('sources.json', DEFAULT_SOURCES).sources.map(normalizeSource);
    this.overrides = { ...DEFAULT_OVERRIDES, ...readJson('overrides.json', DEFAULT_OVERRIDES) };
    this.playlists = readJson('playlists.json', {});
    this.details = readJson('details.json', {});
    this.seen = readJson('seen.json', {});
    this.catalog = readJson('catalog.json', null);
    if (this.catalog) this.catalog = mergeCachedProviders(this.catalog, 'dahsha').catalog;
    // Without catalog.json (missing or unreadable), show ids start from the id state the last rebuild
    // kept beside it (show-ids.json; show-ids.js showIdState) instead of from scratch.
    this.idState = this.catalog ? null : readJson('show-ids.json', null);
    this.status = { refreshing: false, stage: 'idle', progress: null, lastRefreshAt: this.catalog?.generatedAt || null, lastError: null, nextRefreshAt: null };
    this.feedSeen = new Set();
    this._timers = [];
  }

  // ---- lifecycle -------------------------------------------------------------------------
  async start() {
    if (!this.catalog) {
      console.log('[catalogue] no catalogue on disk - building for the first time (this takes a few minutes)');
      this.refresh({ full: true }).catch((e) => console.error('[catalogue] initial build failed', e));
    } else {
      console.log(`[catalogue] loaded ${this.catalog.stats.shows} shows / ${this.catalog.stats.episodes} episodes from disk`);
      this.refresh().catch(() => {});
    }
    this._timers.push(setInterval(() => this.refresh().catch(() => {}), REFRESH_MINUTES * 60e3));
    this._timers.push(setInterval(() => this.fastPoll().catch(() => {}), FEED_MINUTES * 60e3));
    this._scheduleNext();
  }

  stop() { this._timers.forEach(clearInterval); }

  _scheduleNext() { this.status.nextRefreshAt = new Date(Date.now() + REFRESH_MINUTES * 60e3).toISOString(); }

  _setStatus(patch) {
    Object.assign(this.status, patch);
    this.emit('status', this.status);
  }

  // ---- sources ---------------------------------------------------------------------------
  async addSource(input) {
    const src = await resolveSource(input);
    if (this.sources.some((s) => s.id === src.id)) throw new Error('هذا المصدر موجود بالفعل');
    this.sources.push(normalizeSource({ ...src, addedAt: new Date().toISOString() }));
    writeJson('sources.json', { sources: this.sources });
    this.refresh().catch(() => {});
    return src;
  }

  removeSource(id) {
    const before = this.sources.length;
    this.sources = this.sources.filter((s) => s.id !== id);
    if (this.sources.length === before) throw new Error('المصدر غير موجود');
    writeJson('sources.json', { sources: this.sources });
    for (const [pid, pl] of Object.entries(this.playlists)) if (pl.sourceId === id) delete this.playlists[pid];
    writeJson('playlists.json', this.playlists);
    this.rebuild();
  }

  /**
   * Seeds (playlist-seeds.json) put back cached data that CI runs lost. A seeded playlist missing
   * from the cache comes back as a placeholder (signature null, so it is fetched; its seeded rows are
   * rebuilt from cached details, kept if the fetch comes back empty or far shorter, and kept by
   * mergePlaylistRows when a stored fetch does not return them), and a seeded upload missing from its
   * channel's uploads list is appended to it. Seeds of sources that are not configured are skipped, and
   * so are uploads the uploads merge would trim again (worthyUpload: unavailable, private, not
   * embeddable or shorter than minEpisodeSeconds), so seeding and trimming follow one rule.
   */
  applySeeds(seeds = readJson('playlist-seeds.json', null), { minSec = this.overrides?.minEpisodeSeconds ?? 420 } = {}) {
    const configured = new Set(this.sources.map((s) => s.id));
    let playlists = 0, uploads = 0;
    for (const s of seeds?.playlists || []) {
      if (!s?.id || !configured.has(s.sourceId) || this.playlists[s.id]) continue;
      // A seeded video is an id (its row is rebuilt from details) or a { id, title, durationSec } row.
      const videos = (s.videos || []).map((v) => (typeof v === 'string' ? seedRow(v, this.details) : v?.id ? { ...v, seeded: true } : null)).filter(Boolean);
      this.playlists[s.id] = { id: s.id, title: s.title || '', sourceId: s.sourceId, signature: null, seeded: true, videos };
      playlists++;
    }
    for (const s of seeds?.uploads || []) {
      if (!s?.id || !configured.has(s.sourceId) || !worthyUpload(s, this.details, minSec)) continue;
      const key = uploadsKey(s.sourceId);
      // A record the seed creates has never been walked (listedLang null): the refresh lists the whole tab.
      const rec = this.playlists[key] || { id: key, title: '__uploads__', isUploads: true, sourceId: s.sourceId, signature: null, listedLang: null, videos: [] };
      if (rec.videos.some((v) => v.id === s.id)) continue;
      this.playlists[key] = { ...rec, videos: [...rec.videos, { id: s.id, title: s.title || '', published: s.published ?? null, durationSec: s.durationSec || 0, seeded: true }] };
      uploads++;
    }
    if (playlists || uploads) console.log(`[catalogue] seeds: ${playlists} playlists and ${uploads} uploads restored from playlist-seeds.json`);
    return { playlists, uploads };
  }

  // ---- refresh ---------------------------------------------------------------------------
  /**
   * Rebuild the catalogue from cached data only (no network). The previous catalogue (catalog.json
   * as loaded by the constructor, then each rebuild's result) and the committed id aliases keep show
   * ids stable across title changes.
   */
  rebuild({ build = buildCatalog } = {}) {
    this.overrides = { ...DEFAULT_OVERRIDES, ...readJson('overrides.json', DEFAULT_OVERRIDES) };
    const built = build({
      playlists: this.playlists, details: this.details, seen: this.seen, overrides: this.overrides, sources: this.sources, artwork: getArtwork(),
      previous: this.catalog || this.idState, idSeed: readJson('show-id-aliases.json', {}),
    });
    const merged = mergeCachedProviders(built, 'dahsha');
    const next = merged.catalog; saveMergeReport('dahsha', merged.report);
    const diff = diffCatalog(this.catalog, next);
    this.catalog = next;
    writeJson('catalog.json', next);
    writeJson('show-ids.json', showIdState(next));
    this.idState = null;
    this.emit('update', { diff, generatedAt: next.generatedAt, stats: next.stats });
    return diff;
  }

  /**
   * Posters/synopses from TMDB (with key), TVmaze and Wikipedia for shows that have none yet. A
   * catalogue that carries idAliases is handed over whole, so artwork of renamed shows moves to their
   * live id and entries of shows that are gone are pruned; without the map only the show list is.
   */
  async enrich({ enrichArtwork: enrichImpl = enrichArtwork } = {}) {
    if (!artworkEnabled() || !this.catalog) return;
    // Any change to the usable artwork (new matches, re-keyed or downgraded entries) is rebuilt in.
    const usable = () => JSON.stringify(getArtwork());
    const before = usable();
    await enrichImpl(this.catalog.idAliases ? this.catalog : this.catalog.shows);
    if (usable() !== before) this.rebuild();
  }

  /**
   * Details pass of a refresh (see planDetails): up to DETAILS_NEW_PER_RUN new videos (default 4000, the
   * newest first; the rest are fetched by the next refreshes, so a channel added with thousands of
   * uploads does not run the CI job past its time limit), then up to DETAILS_STUB_RETRY_PER_RUN stored
   * stubs, then a rolling re-check of DETAILS_RECHECK_PER_RUN listed videos (refreshes description,
   * views and publish date; records unavailable and embeddable). Failed requests change nothing but
   * checkedAt (a new video stays without details and is queued again). When more than BLOCK_GUARD of a
   * pass's answers say "gone" (or newly "embedding disabled"), none of them counts: that looks like
   * YouTube blocking the runner, not like videos disappearing.
   */
  async refreshDetails({
    minSec = this.overrides.minEpisodeSeconds ?? 420, now = Date.now(), fetchDetails = getVideoDetails,
    newLimit = envCount('DETAILS_NEW_PER_RUN', 4000), stubLimit = envCount('DETAILS_STUB_RETRY_PER_RUN', 300), recheckLimit = envCount('DETAILS_RECHECK_PER_RUN', 300),
    recheckDays = envCount('DETAILS_RECHECK_MIN_DAYS', 7),
  } = {}) {
    const nowIso = new Date(now).toISOString();
    const plan = planDetails({ playlists: this.playlists, details: this.details, sources: this.sources, now, minSec, newLimit, stubLimit, recheckLimit, recheckDays });
    const jobs = [...plan.fresh, ...plan.stubs, ...plan.recheck];
    const report = {
      new: plan.fresh.length, stubs: plan.stubs.length, rechecked: plan.recheck.length, jobs: jobs.length, waiting: plan.waiting,
      filled: 0, noData: 0, updated: 0, edited: 0, dated: 0, reported: 0, confirmed: 0, cleared: 0, restored: 0,
      embedOff: 0, embedOn: 0, failed: 0, goneIgnored: 0, embedIgnored: 0,
    };
    if (!jobs.length) return report;
    const notes = [];
    const label = (job) => `[details] ${job.id} of ${sourceName(job.src)}`;
    const embedOffs = []; // newly not embeddable: applied, and taken back below if there are too many at once
    const noDataWhy = new Map(); // why answers came back without data (what /player said), for the log
    const apply = (job, res) => {
      const prev = this.details[job.id];
      const m = mergeDetails(prev, res, nowIso);
      this.details[job.id] = m.record;
      const counter = { stub: 'noData', filled: 'filled', updated: 'updated', reported: 'reported', confirmed: 'confirmed', cleared: 'cleared', restored: 'restored' }[m.change];
      if (counter) report[counter]++;
      if (m.change === 'stub') { const why = res?.playerError || (res?.fallback ? 'getBasicInfo fallback' : 'empty answer'); noDataWhy.set(why, (noDataWhy.get(why) || 0) + 1); }
      if (m.edited) report.edited++;
      if (m.dated) report.dated++;
      if (m.embedOff) embedOffs.push({ job, before: prev?.embeddable });
      if (m.embedOn) report.embedOn++;
      if (m.change === 'reported') notes.push(`${label(job)}: YouTube says ${m.record.unavailableReason || 'unavailable'}; checked again before it is marked`);
      if (m.change === 'confirmed') notes.push(`${label(job)}: unavailable (${m.record.unavailableReason || 'no reason given'}), reported since ${m.record.unavailableSince}`);
      if (m.change === 'restored') notes.push(`${label(job)}: plays again; unavailable mark removed`);
    };
    this._setStatus({ stage: 'details', progress: { done: 0, total: jobs.length } });
    const gone = [];
    let since = 0;
    const results = await pool(jobs, async (job) => {
      const res = await fetchDetails(job.id, { lang: job.lang });
      if (res?.gone) gone.push({ job, res }); else apply(job, res);
      if (++since % 50 === 0) writeJson('details.json', this.details);
      return job.kind;
    }, 4, (d, total) => this._setStatus({ progress: { done: d, total } }));
    const failed = results.filter((r) => r && r.error !== undefined && r.item);
    for (const { item } of failed) if (this.details[item.id]) this.details[item.id] = { ...this.details[item.id], checkedAt: nowIso };
    report.failed = failed.length;
    // Failed new ids stay without details and are queued again on the next refresh.
    logFailures('[catalogue] details', results, (job) => `${job.id} (${job.kind})`, 10);
    const answered = jobs.length - failed.length;
    if (gone.length > Math.max(BLOCK_GUARD.floor, answered * BLOCK_GUARD.ratio)) {
      report.goneIgnored = gone.length;
      for (const { job } of gone) if (this.details[job.id]) this.details[job.id] = { ...this.details[job.id], checkedAt: nowIso };
      console.warn(`[details] ${gone.length} of ${answered} answers say the video is removed or private; that looks like a block, so none is counted`);
    } else for (const { job, res } of gone) apply(job, res);
    // The same for "embedding disabled": many at once is more likely an oEmbed answer for the runner.
    if (embedOffs.length > Math.max(BLOCK_GUARD.floor, answered * BLOCK_GUARD.ratio)) {
      report.embedIgnored = embedOffs.length;
      for (const { job, before } of embedOffs) {
        const rec = { ...this.details[job.id] };
        if (before === undefined) delete rec.embeddable; else rec.embeddable = before;
        this.details[job.id] = rec;
      }
      console.warn(`[details] ${embedOffs.length} of ${answered} answers say embedding is disabled; that looks like a block, so none is recorded`);
    } else {
      report.embedOff = embedOffs.length;
      for (const { job } of embedOffs) notes.push(`${label(job)}: embedding disabled; not playable in Dahsha`);
    }
    writeJson('details.json', this.details);
    logCapped(notes, 30, (n) => `[details] ... ${n} more notes`);
    if (noDataWhy.size) console.warn(`[details] answers without data: ${[...noDataWhy].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([why, n]) => `${n} x ${why}`).join('; ')}`);
    const r = report;
    console.log(`[details] ${r.new} new${r.waiting.fresh ? ` (${r.waiting.fresh} more waiting for the next refreshes)` : ''}, ${r.stubs} stubs retried (${r.filled} filled; ${r.waiting.stubs - r.stubs} more waiting), `
      + `${r.rechecked} re-checked (${r.updated} updated, ${r.edited} edited, ${r.dated} publish dates filled; ${r.waiting.recheck - r.rechecked} more due); `
      + `unavailable: ${r.reported} reported, ${r.confirmed} confirmed, ${r.restored} playing again, ${r.cleared} reports cleared`
      + `${r.goneIgnored ? ` (${r.goneIgnored} reports ignored)` : ''}; embedding disabled: ${r.embedOff} new${r.embedIgnored ? ` (${r.embedIgnored} ignored)` : ''}, ${r.embedOn} lifted; `
      + `${r.noData} answers without data, ${r.failed} failed`);
    return report;
  }

  /**
   * Cached rows of the playlist (and their details) brought to the stored form (healMyflixerRow), once,
   * so the normalisation does not wait for a successful fetch. Returns the number of rows changed.
   */
  healMyflixer(key) {
    const rec = this.playlists[key];
    if (!rec?.videos?.length || rec.form === MYFLIXER_FORM) return 0;
    let changed = 0;
    const videos = rec.videos.map((v) => {
      const before = this.details[v.id];
      const h = healMyflixerRow(v, before);
      if (h.detail !== before) this.details[v.id] = h.detail;
      if (h.video !== v || h.detail !== before) changed++;
      return h.video;
    });
    this.playlists[key] = { ...rec, videos, form: MYFLIXER_FORM };
    return changed;
  }

  /**
   * The Myflixer pseudo-playlist MYFLIXER:<source id>, fetched again once it is MYFLIXER_CACHE old (or
   * on a full refresh). A series whose episodes come back empty keeps its cached episode rows and details
   * (found by seriesId, or by poster for rows stored before seriesId) and counts as failed; more than
   * MYFLIXER_PAGE_FAILURES of the listed series failing is reported as a warning (ciWarning).
   * Series and films the listing no longer names are removals. When the listing leaves out more than
   * MYFLIXER_LISTING_DROP of the cached series or of the cached films it looks cut short: the fetch is
   * refused (it throws with code MYFLIXER_LISTING_DROP; the cached rows stay and the record counts the
   * refusals in dropRefusals, since dropSince) until it has been refused MYFLIXER_DROP_REFUSALS times in a
   * row over at least MYFLIXER_DROP_HOLD; the next fetch that still shows such a drop accepts it, with a
   * warning. A fetch without one clears the count; a full refresh accepts the drop at once. One
   * '[myflixer]' summary line per fetch, plus capped notes on the series without episodes.
   * addedAt (contract 4): an episode first seen after the earliest-seen episode of its series, i.e. added
   * to a series already listed. The import of a whole series (or of the whole catalogue) is not "new".
   */
  async refreshMyflixer(src, { full = false, now = Date.now(), fetchMyflixer = fetchMyflixerCatalog } = {}) {
    const key = `MYFLIXER:${src.id}`;
    const nowIso = new Date(now).toISOString();
    const healed = this.healMyflixer(key);
    if (healed) console.log(`[myflixer] ${sourceName(src)}: ${healed} cached rows brought to the stored form (titles, synopses, dates, no invented runtimes)`);
    const cached = this.playlists[key];
    if (!full && cached?.videos?.length && now - (Date.parse(cached.fetchedAt || '') || 0) < MYFLIXER_CACHE) return { skipped: true, healed };
    const { films, series } = await fetchMyflixer(src, { maxPages: src.maxPages || 60 });
    if (!films.length && !series.length) throw new Error('Refusing to replace documentary cache with empty data');

    const rows = [], records = new Map();
    const add = ({ video, detail }) => { rows.push(video); if (detail) records.set(video.id, detail); };
    for (const f of films) add(myflixerFilm(f, nowIso));
    // Cached episode rows per series: by seriesId, and by poster (posterFor(wpId): titles collide, posters do not).
    const cachedEpisodes = (cached?.videos || []).filter((v) => String(v.id).startsWith('mf:e:'));
    const bySeries = new Map(), byPoster = new Map();
    const push = (map, k, v) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
    for (const v of cachedEpisodes) { push(bySeries, v.seriesId, v); push(byPoster, v.thumb, v); }
    // A cached series is the group of its episode rows: by seriesId, or by poster for rows stored before it.
    const groupOf = (v) => v.seriesId || `poster:${v.thumb || v.showTitle || ''}`;
    const cachedSeries = new Set(cachedEpisodes.map(groupOf));
    const listedSeries = new Set(); // cached series this listing still names (whether or not their episodes came back)
    let withEpisodes = 0, failedCached = 0, reused = 0, failedEmpty = 0;
    const notes = [];
    for (const s of series) {
      const showTitle = cleanTitle(s.title) || s.title || '';
      const kept = bySeries.get(s.id) || byPoster.get(s.thumb) || [];
      for (const v of kept) listedSeries.add(groupOf(v));
      if (s.episodes?.length) {
        withEpisodes++;
        for (const ep of s.episodes) add(myflixerEpisode(s, showTitle, ep, nowIso));
        continue;
      }
      const why = s.episodesError ? ` (${s.episodesError})` : '';
      if (kept.length) {
        failedCached++; reused += kept.length;
        for (const v of kept) add(healMyflixerRow({ ...v, seriesId: s.id }, this.details[v.id]));
      } else failedEmpty++;
      notes.push(`[myflixer] series ${s.slug || s.id} "${showTitle}": no episodes returned${why}; ${kept.length ? `${kept.length} cached episodes kept` : 'nothing cached'}`);
    }
    const episodes = rows.length - films.length;
    console.log(`[myflixer] ${sourceName(src)}: ${films.length} films, ${series.length} series, ${withEpisodes} series with episodes, ${episodes} episodes; `
      + `series without episodes: ${failedCached} failed with a cache (${reused} cached episodes kept), ${failedEmpty} failed without a cache`);
    logCapped(notes, 10, (n) => `[myflixer] ... ${n} more series without episodes`);
    const failed = failedCached + failedEmpty;
    if (series.length && failed > series.length * MYFLIXER_PAGE_FAILURES) {
      ciWarning('Myflixer episode pages failing', `${sourceName(src)}: no episodes came back for ${failed} of ${series.length} listed series `
        + `(${failedCached} kept their ${reused} cached episodes, ${failedEmpty} had none cached)`, '[myflixer]');
    }

    // Removals: cached series and films the listing no longer names. Only these count against the cache
    // (a series whose episode page failed is still listed, and kept its cached rows above).
    const cachedFilms = (cached?.videos || []).filter((v) => String(v.id).startsWith('mf:m:')).map((v) => v.id);
    const listedFilms = new Set(films.map((f) => f.id));
    const delistedFilms = new Set(cachedFilms.filter((id) => !listedFilms.has(id))).size;
    const cachedFilmCount = new Set(cachedFilms).size;
    const delistedSeries = cachedSeries.size - listedSeries.size;
    const cut = (gone, of) => of > 0 && gone > of * MYFLIXER_LISTING_DROP;
    const drop = cut(delistedSeries, cachedSeries.size) || cut(delistedFilms, cachedFilmCount);
    let dropAccepted = false;
    if (drop) {
      const what = `the listing leaves out ${delistedSeries} of ${cachedSeries.size} cached series and ${delistedFilms} of ${cachedFilmCount} cached films `
        + `(more than ${Math.round(MYFLIXER_LISTING_DROP * 100)} percent of either)`;
      const refusals = cached.dropRefusals || 0;
      const since = Date.parse(cached.dropSince || '') || now;
      if (!full && (refusals < MYFLIXER_DROP_REFUSALS || now - since < MYFLIXER_DROP_HOLD)) {
        // The cached rows stay; only the refusal count changes (written with playlists.json by refresh()).
        this.playlists[key] = { ...cached, dropRefusals: refusals + 1, dropSince: new Date(since).toISOString() };
        throw Object.assign(new Error(`${sourceName(src)}: ${what}; cached documentary playlist kept (refusal ${refusals + 1} in a row since `
          + `${new Date(since).toISOString()}: a fetch that still shows such a drop after ${MYFLIXER_DROP_REFUSALS} refusals and `
          + `${MYFLIXER_DROP_HOLD / HOUR} hours accepts it as removals, and so does a full refresh, cli.js rebuild)`), { code: 'MYFLIXER_LISTING_DROP' });
      }
      dropAccepted = true;
      ciWarning('Myflixer listing shrank', `${sourceName(src)}: ${what}; accepted as removals `
        + `(${full ? 'full refresh' : `after ${refusals} refusals in a row since ${cached.dropSince}`})`, '[myflixer]');
    } else if (delistedSeries || delistedFilms) {
      console.log(`[myflixer] ${sourceName(src)}: ${delistedSeries} cached series and ${delistedFilms} cached films are no longer listed; removed`);
    }

    const firstSeen = (id) => this.seen[id] || nowIso;
    const earliest = new Map();
    for (const v of rows) {
      if (!v.seriesId) continue;
      const t = Date.parse(firstSeen(v.id));
      if (!(earliest.get(v.seriesId) <= t)) earliest.set(v.seriesId, t);
    }
    let added = 0;
    const videos = rows.map((v) => {
      if (!v.seriesId) return v;
      const { addedAt, ...row } = v;
      if (!(Date.parse(firstSeen(v.id)) > earliest.get(v.seriesId))) return row;
      added++;
      return { ...row, addedAt: new Date(Date.parse(firstSeen(v.id))).toISOString() };
    });
    for (const [id, d] of records) this.details[id] = d;
    for (const v of videos) this.seen[v.id] ||= nowIso;
    this.playlists[key] = { id: key, title: src.title, sourceId: src.id, signature: `${videos.length}`, videos, fetchedAt: nowIso, form: MYFLIXER_FORM };
    if (added) console.log(`[myflixer] ${sourceName(src)}: ${added} episodes added to series already listed (addedAt)`);
    return { films: films.length, series: series.length, withEpisodes, episodes, failedCached, reused, failedEmpty, added, healed, delistedSeries, delistedFilms, dropAccepted };
  }

  async refresh({ full = false, fetchDetails = getVideoDetails, fetchMyflixer = fetchMyflixerCatalog } = {}) {
    if (this.status.refreshing) return null;
    this._setStatus({ refreshing: true, stage: 'listing', progress: null, lastError: null });
    const t0 = Date.now();
    try {
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const minSec = this.overrides.minEpisodeSeconds ?? 420;
      const seeded = this.applySeeds();
      const toFetch = [];
      const uploadJobs = [];
      const myflixerJobs = [];
      // Playlist bookkeeping of this run; notes are the per-playlist lines behind the counts.
      // held / heldRows / droppedRows: stored fetches that left out cached rows (mergePlaylistRows).
      // filtered: listed playlists the source's playlistsInclude / playlistsExclude rejects (not fetched);
      // shorts: listed Shorts lists (isShortsPlaylist), never fetched for any channel;
      // unwanted: cached records of such left-out playlists, listed or not, dropped (dropUnwanted).
      // goneReported: unlisted seeded playlists answering "gone" for the first time (rows kept);
      // seededEmptied / seededEmptiedRows: those emptied by a second answer a day later or more.
      const report = { kept: 0, retry: 0, backoff: 0, stale: 0, probed: 0, missing: 0, gone: 0, expired: 0, held: 0, heldRows: 0, droppedRows: 0, filtered: 0, shorts: 0, unwanted: 0, goneReported: 0, seededEmptied: 0, seededEmptiedRows: 0 };
      const notes = [];
      const iso = (ms) => new Date(ms).toISOString();
      // A cached record the catalogue leaves out (a Shorts list, or one the source's filters reject) is
      // neither fetched nor kept: it is dropped, and fetched again should the filters take it back. A
      // seeded one stays: its rows cannot be fetched back (applySeeds would only put it back).
      const dropUnwanted = (src, rec) => {
        if (!rec || rec.seeded) return;
        delete this.playlists[rec.id];
        report.unwanted++;
        notes.push(`[catalogue] playlist ${rec.id} "${rec.title}" of ${sourceName(src)}: left out of the catalogue; cached record dropped`);
      };
      const backoff = (rec, signature) => {
        const retries = (rec?.retries || 0) + 1;
        return { retries, retryAfter: iso(now + backoffMs(retries)), retrySignature: signature ?? null };
      };
      // Backing off: not before retryAfter, unless the listing now shows another signature than the one tried.
      const due = (rec, signature) => !rec?.retryAfter || Date.parse(rec.retryAfter) <= now
        || (signature !== undefined && signature !== (rec.retrySignature ?? null));
      for (const src of this.sources) {
        if (src.type === 'channel') {
          const lang = clientLangFor(src);
          const listed = await listChannelPlaylists(src.id, { lang }).catch((e) => { console.warn(`[catalogue] playlists of ${src.title}: ${e.message}`); return null; });
          if (listed?.length) {
            const listedIds = new Set(listed.map((p) => p.id));
            if (src.playlistsInclude?.length && !listed.some((p) => playlistWanted(src, p))) {
              ciWarning('Playlist filter matches nothing', `${sourceName(src)}: playlistsInclude matches none of the ${listed.length} listed playlists; check its patterns in sources.json`);
            }
            for (const [pid, pl] of Object.entries(this.playlists)) {
              if (pl.sourceId !== src.id || pl.isUploads || listedIds.has(pid)) continue;
              if (!playlistWanted(src, pl)) { dropUnwanted(src, pl); continue; }
              // Not in this listing. Listings depend on the requesting region, so absence alone never
              // deletes: the playlist is fetched by id (with backoff) and deleted when YouTube says it is
              // gone, or after MISSING_DAYS without a listing or an answer (seeded playlists excepted).
              if (listed.complete === true && !pl.missingSince) { pl.missingSince = nowIso; report.missing++; }
              const since = Math.max(Date.parse(pl.missingSince || '') || 0, Date.parse(pl.confirmedAt || '') || 0);
              if (pl.missingSince && !pl.seeded && now - since >= MISSING_DAYS * DAY) {
                delete this.playlists[pid];
                report.expired++;
                notes.push(`[catalogue] playlist ${pid} "${pl.title}" of ${sourceName(src)}: unlisted and unanswered since ${iso(since)}; deleted`);
                continue;
              }
              if (full || due(pl)) { toFetch.push({ id: pid, title: pl.title, signature: pl.signature ?? null, sourceId: src.id, unlisted: true }); report.probed++; } else report.backoff++;
            }
            for (const p of listed) {
              if (isShortsPlaylist(p.title)) { report.shorts++; dropUnwanted(src, this.playlists[p.id]); continue; }
              if (!playlistWanted(src, p)) { report.filtered++; dropUnwanted(src, this.playlists[p.id]); continue; }
              const cached = this.playlists[p.id];
              if (cached && (cached.missingSince || cached.confirmedAt || cached.goneSince)) { delete cached.missingSince; delete cached.confirmedAt; delete cached.goneSince; }
              // A playlist without listedLang is not refetched for it: its signature (count text in the
              // client's language) already changed, and forced a refetch, when per-language clients came.
              const otherLang = cached?.listedLang && cached.listedLang !== lang;
              // Cached empty although its badge counts videos (stored by a broken parser, or emptied
              // during an outage): its signature is treated as invalid, so it is fetched again.
              const stale = !!cached && !cached.videos?.length && p.count > 0;
              if (!(full || !cached || cached.signature !== p.signature || otherLang || stale)) continue;
              if (!full && !due(cached, p.signature)) { report.backoff++; continue; }
              if (stale && cached.signature === p.signature) report.stale++;
              toFetch.push({ ...p, sourceId: src.id });
            }
          }
          if (src.scanUploads) uploadJobs.push(src);
        } else if (src.type === 'playlist') {
          const cached = this.playlists[src.id];
          if (full || due(cached, null)) toFetch.push({ id: src.id, title: src.title, signature: null, sourceId: src.id });
          else report.backoff++;
        } else if (src.type === 'myflixer') {
          myflixerJobs.push(src);
        }
      }

      this._setStatus({ stage: 'playlists', progress: { done: 0, total: toFetch.length + uploadJobs.length + myflixerJobs.length } });
      let done = 0;
      const tick = () => this._setStatus({ progress: { done: ++done, total: toFetch.length + uploadJobs.length + myflixerJobs.length } });
      const sourceOf = (id) => this.sources.find((s) => s.id === id);
      const playlistResults = await pool(toFetch, async (p) => {
        const src = sourceOf(p.sourceId);
        const lang = clientLangFor(src);
        const cached = this.playlists[p.id];
        const label = `[catalogue] playlist ${p.id} "${p.title}" of ${sourceName(src)}`;
        let data;
        try {
          data = await getPlaylistVideos(p.id, { lang });
        } catch (e) {
          if (e.code === 'PLAYLIST_GONE' && p.unlisted && cached) {
            // A seeded playlist holds rows CI cannot fetch back (US runners do not see them), so one
            // "gone" answer is only reported: its rows stay (goneSince) and it is asked again a day later
            // at the earliest. A second "gone" answer from SEEDED_GONE_GAP on empties it; the empty
            // placeholder stays, so its seed does not bring the deleted list back.
            const firstGone = Date.parse(cached.goneSince || '') || 0;
            const rows = cached.videos?.length || 0;
            if (cached.seeded && rows && (!firstGone || now - firstGone < SEEDED_GONE_GAP)) {
              const since = firstGone ? cached.goneSince : nowIso;
              const retry = backoff(cached, null);
              const recheck = Date.parse(since) + SEEDED_GONE_GAP;
              if (Date.parse(retry.retryAfter) < recheck) retry.retryAfter = iso(recheck);
              this.playlists[p.id] = { ...cached, goneSince: since, ...retry };
              report.goneReported++;
              notes.push(`${label}: not listed and gone (${e.message}); ${rows} seeded rows kept until a second answer after ${retry.retryAfter}`);
              tick();
              return 'gone-reported';
            }
            // Unlisted and gone: the confirmation a deletion needs (the second for a seeded playlist).
            if (cached.seeded) {
              this.playlists[p.id] = { id: p.id, title: cached.title, sourceId: p.sourceId, signature: null, seeded: true, videos: [], gone: nowIso, ...backoff(cached, null) };
              if (rows) { report.seededEmptied++; report.seededEmptiedRows += rows; }
            } else delete this.playlists[p.id];
            report.gone++;
            notes.push(`${label}: not listed and gone (${e.message}); ${!cached.seeded ? 'deleted' : rows ? `seeded placeholder emptied (${rows} rows, gone since ${cached.goneSince})` : 'seeded placeholder stays empty'}`);
            tick();
            return 'gone';
          }
          // Probes back off; a listed playlist keeps its old signature, so the next refresh retries it.
          if (cached && (p.unlisted || e.code === 'PLAYLIST_GONE')) this.playlists[p.id] = { ...cached, ...backoff(cached, p.signature) };
          throw e;
        }
        const verdict = judgePlaylist(data, cached, p.count ?? null);
        const n = data.videos.length;
        const was = cached?.videos?.length || 0;
        const badge = data.expectedCount ?? p.count ?? '?';
        const unlisted = p.unlisted ? { missingSince: cached?.missingSince, confirmedAt: nowIso } : {};
        if (verdict === 'keep') {
          const retry = backoff(cached, p.signature);
          // It answered, so an earlier "gone" answer does not count any more.
          const answered = { ...cached, ...unlisted, ...retry };
          delete answered.goneSince;
          this.playlists[p.id] = answered;
          report.kept++;
          notes.push(`${label}: ${n} videos returned for ${was} cached (badge ${badge}); cached list kept, retry after ${retry.retryAfter}`);
        } else {
          const retry = verdict === 'retry' ? backoff(cached, p.signature) : p.unlisted ? { retryAfter: iso(now + UNLISTED_RECHECK) } : {};
          // Cached rows this fetch did not return stay unless the playlist's count or details confirm they went.
          const merged = mergePlaylistRows(data.videos, cached, { expected: data.expectedCount ?? p.count ?? null, details: this.details });
          this.playlists[p.id] = {
            ...data, videos: merged.videos, title: data.title || p.title, signature: verdict === 'retry' ? null : p.signature, sourceId: p.sourceId, listedLang: lang, fetchedAt: nowIso,
            ...(cached?.seeded ? { seeded: true } : {}), ...unlisted, ...retry,
          };
          const parts = [];
          if (merged.kept) { report.held++; report.heldRows += merged.kept; parts.push(`${merged.kept} cached videos it did not return kept`); }
          if (merged.dropped) {
            report.droppedRows += merged.dropped;
            parts.push(`${merged.dropped} cached videos it did not return dropped (${merged.reason === 'complete' ? 'the playlist count confirms the shrink' : 'unavailable or private'})`);
          }
          if (verdict === 'retry') { report.retry++; parts.push(`stored for now, fetched again after ${retry.retryAfter}`); }
          if (parts.length) notes.push(`${label}: ${n} videos returned${was ? ` for ${was} cached` : ''} (badge ${badge}); ${parts.join('; ')}`);
        }
        tick();
        return verdict;
      }, 4);
      logFailures('[catalogue] playlist', playlistResults, (p) => `${p.id} "${p.title}" of ${sourceName(sourceOf(p.sourceId))}`);
      logCapped(notes);
      const playlistRecords = Object.values(this.playlists).filter((pl) => !pl.isUploads && !String(pl.id).startsWith('MYFLIXER:'));
      const emptyWithBadge = playlistRecords.filter((pl) => !pl.videos?.length && pl.expectedCount > 0);
      console.log(`[catalogue] playlists: ${playlistRecords.length} cached, ${toFetch.length} fetched (${report.probed} unlisted probed)${report.shorts ? `, ${report.shorts} Shorts lists skipped` : ''}${report.filtered ? `, ${report.filtered} left out by sources.json filters` : ''}${report.unwanted ? `, ${report.unwanted} cached records of left-out playlists dropped` : ''}, `
        + `${report.kept} kept their cached list, ${report.retry} to fetch again, ${report.backoff} backing off, ${report.stale} stale empty refetched, `
        + `${report.missing} newly unlisted, ${report.gone + report.expired} deleted (${report.gone} gone, ${report.expired} expired)`
        + `${report.goneReported ? `, ${report.goneReported} seeded reported gone (rows kept until a second answer)` : ''}; `
        + `${emptyWithBadge.length} empty although their badge counts videos; `
        + `cached videos a stored fetch did not return: ${report.heldRows} kept (${report.held} playlists), ${report.droppedRows} dropped`);
      // Seeded rows cannot be fetched back by CI: emptying them is shown on the run (an annotation in CI).
      if (report.seededEmptied) {
        ciWarning('Seeded playlists emptied', `${report.seededEmptied} seeded playlists (${report.seededEmptiedRows} rows) answered "gone" twice at least a day apart and were emptied; `
          + 'their rows cannot be fetched back from CI (delete the placeholder in playlists.json to seed them again)');
      }
      if (report.goneReported) {
        ciWarning('Seeded playlists reported gone', `${report.goneReported} unlisted seeded playlists answered "gone"; their rows are kept until a second "gone" answer at least a day after the first`);
      }
      // Uploads tab: incremental (stop at the first already-known video) unless a full refresh, or
      // unless the cached listing was made in another interface language (its titles are that
      // language's localisations): then the tab is walked once more without known ids, and cached
      // rows that are not listed again are kept, as in any incremental refresh.
      let relisted = 0;
      const uploadResults = await pool(uploadJobs, async (src) => {
        const key = uploadsKey(src.id);
        const cached = this.playlists[key];
        const lang = clientLangFor(src);
        const max = src.maxUploads || 400;
        const relist = !full && !!cached && listedLangOf(cached) !== lang;
        const knownIds = !full && !relist && cached ? new Set(cached.videos.map((v) => v.id)) : null;
        const { videos, complete } = await listChannelUploads(src.id, { max, knownIds, lang });
        if (relist) relisted++;
        const mode = `${lang}${full ? ', full' : relist ? `, relist from ${listedLangOf(cached) || 'feed'}` : ''}`;
        const restore = (v) => { const title = originalTitle(v, src, this.details); return title ? { ...v, title } : v; };
        if (!videos.length && cached?.videos?.length) {
          const kept = cached.videos.map(restore);
          const healed = kept.filter((v, i) => v !== cached.videos[i]).length;
          if (healed) this.playlists[key] = { ...cached, videos: kept };
          console.warn(`[uploads] ${sourceName(src)} ${mode}: listing returned no videos; ${cached.videos.length} cached kept${healed ? `, ${healed} titles restored from details` : ''}`);
          tick();
          return 0;
        }
        const before = new Set((cached?.videos || []).map((v) => v.id));
        const listed = new Set(videos.map((v) => v.id));
        const merged = new Map();
        // A row dated only by its age text ("3 years ago") carries the time it was listed, so the
        // catalogue counts the age from the listing, not from the day the video was first seen.
        for (const v of videos) merged.set(v.id, v.relative && !v.published ? { ...v, listedAt: nowIso } : v);
        // Cached rows that were not listed again are kept; a full refresh keeps only the worthy ones
        // (episodes deeper than the listing would otherwise be lost).
        if (cached) for (const v of cached.videos) if (!merged.has(v.id) && (!full || worthyUpload(v, this.details, minSec))) merged.set(v.id, v);
        // maxUploads bounds the listing depth; past it only short, unknown or unavailable rows are trimmed.
        const kept = retainUploads([...merged.values()], Math.max(max, videos.length), this.details, minSec);
        const trimmed = merged.size - kept.length;
        let healed = 0;
        const rows = kept.map((v) => { if (listed.has(v.id)) return v; const r = restore(v); if (r !== v) healed++; return r; });
        // A relist that stopped early (pages it could not read) is repeated on the next refresh.
        const walked = !relist || complete || videos.length >= max;
        this.playlists[key] = {
          id: key, title: '__uploads__', isUploads: true, sourceId: src.id, signature: null,
          videos: rows, listedLang: walked ? lang : cached.listedLang, fetchedAt: new Date().toISOString(),
        };
        const added = videos.filter((v) => !before.has(v.id)).length;
        const filtered = rows.filter((v) => !uploadWanted(src, v, this.details)).length;
        console.log(`[uploads] ${sourceName(src)} ${mode}: ${added} new, ${videos.length} listed, ${rows.length - videos.length} cached, ${rows.length} total`
          + `${filtered ? ` (${filtered} left out by the uploads filters of sources.json)` : ''}`
          + `${trimmed ? `, ${trimmed} short or unavailable rows trimmed past ${max}` : ''}`
          + `${healed ? `, ${healed} titles restored from details` : ''}${walked ? '' : '; walk stopped early, relisting again next refresh'}`);
        tick();
        return videos.length;
      }, 2);
      logFailures('[uploads]', uploadResults, sourceName);
      if (uploadJobs.length && !uploadResults.some(count => typeof count === 'number' && count > 0)) {
        throw Object.assign(new Error('Every YouTube upload listing was empty or failed; cached data retained'), { code: 'INGESTION_EMPTY' });
      }

      // Myflixer documentary catalogue (WordPress REST API; see refreshMyflixer)
      let myflixerDetails = false; // details changed (fetched or healed) that must reach details.json
      for (const src of myflixerJobs) {
        try {
          const r = await this.refreshMyflixer(src, { full, now, fetchMyflixer });
          myflixerDetails ||= !r.skipped || r.healed > 0;
        } catch (err) {
          myflixerDetails = true; // the cached rows may have been healed before the fetch failed
          // A refused drop is shown on the run (an annotation in CI), not only in the log.
          if (err.code === 'MYFLIXER_LISTING_DROP') ciWarning('Myflixer fetch refused', `myflixer fetch refused: ${err.message}`);
          else console.warn(`[catalogue] myflixer fetch error: ${err.message}`);
        }
        tick();
      }
      if (toFetch.length || uploadJobs.length || myflixerJobs.length || seeded.playlists || seeded.uploads || report.missing || report.expired) writeJson('playlists.json', this.playlists);

      // Details: videos we have not seen yet (full episodes first so the catalogue grows fastest), then
      // stored stubs and a rolling re-check (refreshDetails).
      const seenIso = new Date().toISOString();
      for (const pl of Object.values(this.playlists)) for (const v of pl.videos || []) if (!this.seen[v.id]) this.seen[v.id] = seenIso;
      const details = await this.refreshDetails({ minSec, fetchDetails });
      // refreshDetails writes details.json only when it had work; Myflixer details must not wait for that.
      if (myflixerDetails && !details.jobs) writeJson('details.json', this.details);
      writeJson('seen.json', this.seen);

      if (process.env.SKIP_PROVIDER_SYNC !== '1') await refreshProviders({ product: 'dahsha' }).catch(e => console.warn('[providers]', e.message));
      this._setStatus({ stage: 'building', progress: null });
      const diff = this.rebuild();
      await this.enrich().catch((e) => console.warn('[artwork]', e.message));
      const ms = Date.now() - t0;
      console.log(`[catalogue] refresh done in ${(ms / 1000).toFixed(1)}s - playlists fetched ${toFetch.length}${report.kept ? ` (${report.kept} kept cached)` : ''}, uploads scanned ${uploadJobs.length}${relisted ? ` (${relisted} relisted)` : ''}, details ${details.new}${details.stubs || details.rechecked ? ` (+${details.stubs} stubs retried, ${details.rechecked} re-checked)` : ''}, new episodes ${diff.newEpisodes.length}, new shows ${diff.newShows.length}`);
      this._scheduleNext();
      this._setStatus({ refreshing: false, stage: 'idle', progress: null, lastRefreshAt: new Date().toISOString() });
      return diff;
    } catch (e) {
      console.error('[catalogue] refresh failed:', e);
      this._scheduleNext();
      this._setStatus({ refreshing: false, stage: 'idle', progress: null, lastError: e.message });
      throw e;
    }
  }

  /**
   * Cheap RSS poll: new uploads of a channel go straight into its uploads list. Shorts (a /shorts/
   * link) and videos known to be shorter than minEpisodeSeconds (or unavailable) are skipped: they
   * never become episodes. Their details are kept, so a known clip costs no request on the next poll.
   * An answer without data (a getBasicInfo fallback without a duration; /player often has nothing in
   * the first hour after publication) or a "gone" answer is neither stored nor added: the id stays
   * unknown and is asked again on the next poll. A listed feed entry whose details are missing, a stub
   * or without a duration is asked again too, so it becomes an episode as soon as YouTube answers.
   * A channel with scanUploads: false is taken through its playlists only (takesUploads): its feed is
   * not read, and the refresh picks up its playlists' new rows when their signatures change.
   */
  async fastPoll({ fetchFeed = fetchChannelFeed, fetchDetails = getVideoDetails } = {}) {
    if (this.status.refreshing) return;
    const minSec = this.overrides.minEpisodeSeconds ?? 420;
    const isClip = (d, durationSec = d?.durationSec) => d?.unavailable === true || (durationSec > 0 && durationSec < minSec);
    const known = new Set(Object.values(this.playlists).flatMap((p) => (p.videos || []).map((v) => v.id)));
    const additions = [];
    const handled = new Set();
    let feedVideos = 0, feeds = 0, feedErrors = 0, skipped = 0, filtered = 0, unknown = 0, again = 0, playlistOnly = 0;
    for (const src of this.sources) {
      if (src.type !== 'channel') continue;
      if (!takesUploads(src)) { playlistOnly++; continue; }
      feeds++;
      try {
        const feed = await fetchFeed(src.id, { lang: clientLangFor(src) });
        feedVideos += feed.length;
        for (const e of feed) {
          if (handled.has(e.id)) continue;
          handled.add(e.id);
          const d = this.details[e.id];
          if (known.has(e.id)) {
            if (e.short || d?.unavailable === true || (d && !isDetailStub(d) && d.durationSec > 0)) continue;
            // A listed row the uploads filters reject gets no details from the refresh: not from the poll either.
            if (!uploadWanted(src, e, this.details)) { filtered++; continue; }
            additions.push({ video: e, src, listed: true });
            again++;
            continue;
          }
          if (e.short || isClip(d)) { skipped++; continue; }
          // Left out by the source's uploads filters: never an episode, so no details request.
          if (!uploadWanted(src, e, this.details)) { filtered++; continue; }
          additions.push({ video: e, src });
          unknown++;
        }
      } catch (e) {
        // A single feed hiccup is not fatal (every feed failing is INGESTION_EMPTY below), but it is reported.
        feedErrors++;
        console.warn(`[poll] feed of ${sourceName(src)}: ${e.message}`);
      }
    }
    console.log(`[poll] ${feeds - feedErrors}/${feeds} feeds read${playlistOnly ? ` (${playlistOnly} playlist-only channel${playlistOnly === 1 ? '' : 's'} not polled)` : ''}, ${feedVideos} entries, ${unknown} unknown`
      + `${skipped ? `, ${skipped} shorts or clips skipped` : ''}${filtered ? `, ${filtered} left out by sources.json uploads filters` : ''}`
      + `${again ? `, ${again} listed without a duration asked again` : ''}`);
    if (feeds && !feedVideos) throw Object.assign(new Error('Every YouTube feed was empty or failed; cached data retained'), { code: 'INGESTION_EMPTY' });
    if (!additions.length) return { newShows: [], newEpisodes: [] };
    const fetched = await pool(additions, async ({ video, src, listed }) => {
      const detail = await fetchDetails(video.id, { lang: clientLangFor(src) });
      return { video, src, listed, detail };
    }, 4);
    const nowIso = new Date().toISOString();
    let added = 0, clips = 0, healed = 0, stored = 0, failed = 0;
    const unusable = [];
    const fresh = new Map(); // uploads key -> { src, rows in feed order }
    for (const row of fetched) {
      if (row.error) { failed++; console.warn(`[poll] details ${row.item?.video?.id} of ${sourceName(row.item?.src)}: ${row.error}`); continue; }
      const { video, src, listed, detail } = row;
      const label = `[poll] details ${video.id} of ${sourceName(src)}`;
      if (detail?.gone) { unusable.push(`${label}: YouTube says ${[detail.status, detail.reason].filter(Boolean).join(': ')}; not added, asked again on the next poll`); continue; }
      if (isDetailStub(detail)) {
        unusable.push(`${label}: no duration${detail?.title ? '' : ' or title'} (${detail?.playerError || (detail?.fallback ? 'getBasicInfo fallback' : 'empty answer')}); not stored, asked again on the next poll`);
        continue;
      }
      const { short, ...entry } = video;
      const durationSec = detail.durationSec || video.durationSec || 0;
      this.details[video.id] = mergeDetails(this.details[video.id], { ...detail, publishedAt: detail.publishedAt || video.published || null }, nowIso).record;
      stored++;
      if (listed) { if (durationSec > 0) healed++; continue; }
      if (isClip(detail, durationSec)) { clips++; continue; }
      const key = uploadsKey(src.id);
      if (!fresh.has(key)) fresh.set(key, { src, rows: [] });
      fresh.get(key).rows.push({ ...entry, durationSec });
      this.seen[video.id] ||= nowIso;
      added++;
    }
    for (const [key, { src, rows }] of fresh) {
      // A record only the poll has written has never been walked: the next refresh lists the whole tab.
      const cached = this.playlists[key] || { id: key, title: '__uploads__', isUploads: true, sourceId: src.id, listedLang: null, videos: [] };
      const videos = retainUploads([...rows, ...cached.videos], src.maxUploads || 400, this.details, minSec);
      this.playlists[key] = { ...cached, videos, fetchedAt: nowIso };
    }
    logCapped(unusable, 20, (n) => `[poll] ... ${n} more videos without usable details`);
    if (clips) console.log(`[poll] ${clips} new videos are clips or unavailable; not added`);
    console.log(`[poll] details: ${added} added, ${healed} listed videos got their duration, ${clips} clips, ${unusable.length} without usable details, ${failed} failed`);
    if (!added && !healed) {
      // Only when every request failed is the poll itself broken; answers without data are retried quietly.
      if (failed === fetched.length) throw new Error('No new feed videos could be fetched; retry on next poll');
      if (stored) writeJson('details.json', this.details);
      return { newShows: [], newEpisodes: [] };
    }
    if (added) writeJson('playlists.json', this.playlists);
    writeJson('details.json', this.details);
    writeJson('seen.json', this.seen);
    return this.rebuild();
  }

  // ---- read API --------------------------------------------------------------------------
  getCatalog() { return this.catalog; }
  getShow(id) { return this.catalog?.shows.find((s) => s.id === id) || null; }
  getStatus() {
    return { ...this.status, refreshMinutes: REFRESH_MINUTES, feedMinutes: FEED_MINUTES, stats: this.catalog?.stats || null, generatedAt: this.catalog?.generatedAt || null };
  }
}
