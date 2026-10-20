// Thin wrapper around youtubei.js (InnerTube) - no API key required.
import { Innertube, YTNodes } from 'youtubei.js';
import { parseDuration } from './text.js';

// One InnerTube client per interface language. With hl=ar YouTube serves Arabic-localized (often
// machine-translated and truncated) titles for English videos, so every source is listed in its own
// content language and keeps its original titles.
const CLIENT_LOCATIONS = { ar: 'AE', en: 'US', fr: 'FR', de: 'DE', es: 'ES' };
const clients = new Map();
const defaultFactory = (lang) => Innertube.create({ lang, location: CLIENT_LOCATIONS[lang] || 'US', retrieve_player: false });
let clientFactory = defaultFactory;

function normalizeLang(lang) {
  const l = String(lang || 'ar').toLowerCase().slice(0, 2);
  return /^[a-z]{2}$/.test(l) ? l : 'ar';
}

/** Interface language used to list a source: its content language (e.g. French) or its section language. */
export function clientLangFor(src) {
  return normalizeLang(src?.contentLang || src?.lang);
}

export function getClient(lang = 'ar') {
  const l = normalizeLang(lang);
  if (!clients.has(l)) {
    const p = Promise.resolve().then(() => clientFactory(l));
    p.catch(() => clients.delete(l)); // a failed session start is retried on the next call
    clients.set(l, p);
  }
  return clients.get(l);
}

/** Tests swap the client factory (e.g. replaying recorded InnerTube responses); null restores the default. */
export function setClientFactory(fn) {
  clientFactory = fn || defaultFactory;
  clients.clear();
}

export async function withRetry(fn, { tries = 3, baseDelay = 800, retryIf = () => true } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (!retryIf(e) || i === tries - 1) break;
      await new Promise((r) => setTimeout(r, baseDelay * (i + 1) * (1 + Math.random())));
    }
  }
  throw lastErr;
}

/** "34 videos", "١٢ فيديو", "1,234 vidéos" → number; null when the text carries no count. */
export function parseCount(text) {
  if (text == null) return null;
  const s = String(text)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const m = s.match(/\d[\d,.\s  ٬]*/);
  if (m) return Number(m[0].replace(/\D/g, ''));
  if (/واحد|^\s*(one|un|une)\b/i.test(s)) return 1; // "فيديو واحد", "one video"
  if (/فيديوهان|فيديوان/.test(s)) return 2;
  return null;
}

// YouTube answers a deleted, private or never-existing playlist with an ERROR alert instead of contents.
const isGoneAlert = (e) => e?.info?.type === 'Alert' && e.info.alert_type === 'ERROR';

export async function pool(items, worker, concurrency = 4, onProgress) {
  const q = [...items];
  const results = [];
  let done = 0;
  async function run() {
    while (q.length) {
      const item = q.shift();
      try { results.push(await worker(item)); } catch (e) { results.push({ error: e.message, item }); }
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

const CHANNEL_ID_RE = /^UC[\w-]{22}$/;
const PLAYLIST_ID_RE = /^(PL|UU|FL|LL|OL|RD)[\w-]+$/;

// Known channels → parsing profile. Unknown channels fall back to heuristics on title/handle.
const KNOWN_PROFILES = {
  'UCjP-MiAEn9DPvUHNyGEs7Wg': { profile: 'creator', lang: 'en', short: 'hochelaga', brands: ['hochelaga'] },
  UCLiTe0aOHShx7hXGyqZ9UIw: { profile: 'natgeo', lang: 'ar', short: 'ناشونال جيوغرافيك' },
  UCKjzHGaZFF8J4nWfMbImUWg: { profile: 'asharq', lang: 'ar', short: 'الشرق ديسكفري وايلدلايف' },
  UCJdfy_z2iMsODx70_c2HHxQ: { profile: 'asharq', lang: 'ar', short: 'الشرق ديسكفري' },
  UCET6sWl4Xcu: { profile: 'dw', lang: 'ar', short: 'دي دبليو' },
  'UCET6sWl4Xcu-U8Ka9PJPrwA': { profile: 'dw', lang: 'ar', short: 'دي دبليو' },
  UC0LSnqrwqtMwl2YwfUpO66g: { profile: 'aljazeera', lang: 'ar', short: 'الجزيرة الوثائقية' },
  // Arabic shows (the Daheeh's channels; text.js parseArShow) and documentary-film channels (parseArFilms),
  // as sources.json configures them (2026-10-19); their title filters and showGroup live there. World
  // Odyssey (UCUETY-zVLykpUQlVweNaLsg) was dropped again: it disables embedding on every upload.
  'UC-4KnPMmZzwAzW7SbVATUZQ': { profile: 'ar-show', lang: 'ar', short: 'AJ+ كبريت', brands: ['AJ+ كبريت', 'AJ+', 'كبريت'], maxUploads: 3000 },
  UCtJmfVv0a52Bu7BnJJtZXKw: { profile: 'ar-show', lang: 'ar', short: 'نيو ميديا', brands: ['New Media Academy Life', 'New Media Academy', 'نيو ميديا'], maxUploads: 3000 },
  'UC4CqD-RfKw-eE8xSFByMIHw': { profile: 'ar-show', lang: 'ar', short: 'متحف المستقبل', brands: ['Museum of The Future', 'متحف المستقبل', 'Museum of The Future متحف المستقبل'] },
  UCZrs1_RojgqE0zKN9evvfJw: { profile: 'ar-films', lang: 'ar', short: 'Discovery Travel', brands: ['Discovery Travel'], maxUploads: 1500 },
  UCKo9YhpBHN7FzOSFleKZvLg: { profile: 'ar-films', lang: 'ar', short: 'آفاق', brands: ['آفاق World Docs', 'آفاق', 'World Docs'], maxUploads: 1500 },
  UCSNjn6j2NvWYSSB7xrAJaXg: { profile: 'ar-films', lang: 'ar', short: 'أسرار خفية', brands: ['أسرار خفية - مصعب', 'أسرار خفية'], maxUploads: 1500 },
  UCcxFARHBsl_Ufy0WwnekavA: { profile: 'ar-films', lang: 'ar', short: 'الغرب الوثائقية', brands: ['الغرب الوثائقية', 'WestDocs'], maxUploads: 1500 },
  'UC4tNC0SDwlGrx1SpTz-gJGA': { profile: 'ar-films', lang: 'ar', short: 'Hayah', brands: ['Hayah Documentary', 'Hayah Documentry', 'حياة الوثائقية'], maxUploads: 1500 },
  // English
  UCpVm7bg6pXKo1Pr6k5kxG9A: { profile: 'natgeo-en', lang: 'en', short: 'National Geographic', brands: ['National Geographic', 'Nat Geo'] },
  UCW39zufHfsuGgpLviKh297Q: { profile: 'dw-en', lang: 'en', short: 'DW Documentary', brands: ['DW Documentary', 'DW'] },
  UCODHrzPMGbNv67e84WDZhQQ: { profile: 'creator', lang: 'en', short: 'fern', brands: ['fern'] },
  UCii9ezsUa_mBiSdw0PtSOaw: { profile: 'creator', lang: 'en', short: 'Hoog', brands: ['Hoog'] },
  'UCYwVxWpjeKFWwu8TML-Te9A': { profile: 'creator', lang: 'en', short: 'JCS', brands: ['JCS', 'JCS - Criminal Psychology'] },
  UC3ScyryU9Oy9Wse3a8OAmYQ: { profile: 'frontline', lang: 'en', short: 'FRONTLINE', brands: ['FRONTLINE', 'FRONTLINE PBS', 'FRONTLINE/World', 'PBS'] },
  UC9MAhZQQd9egwWCxrwSIsJQ: { profile: 'history', lang: 'en', short: 'HISTORY', brands: ['HISTORY', 'History'] },
  'UCsgPO6cNV0wBG-Og3bUZoFA': { profile: 'freedoc', lang: 'en', short: 'Free Documentary', brands: ['Free Documentary History', 'Free Documentary - History', 'FD History', 'Free Documentary'] },
  UCsXVk37bltHxD1rDPwtNM8Q: { profile: 'creator', lang: 'en', short: 'Kurzgesagt', brands: ['Kurzgesagt', 'Kurzgesagt – In a Nutshell'] },
  'UCZaT_X_mc0BI-djXOlfhqWQ': { profile: 'generic-en', lang: 'en', short: 'VICE News', brands: ['VICE News', 'VICE'] },
  'UCHnyfMqiRRG1u-2MsSQLbXA': { profile: 'creator', lang: 'en', short: 'Veritasium', brands: ['Veritasium'] },
  'UCct9aR7HC79Cv2g-9oDOTLw': { profile: 'creator', lang: 'en', short: 'ReligionForBreakfast', brands: ['ReligionForBreakfast', 'Religion For Breakfast'] },
};

export function detectProfile(id, title = '', url = '') {
  if (KNOWN_PROFILES[id]) return KNOWN_PROFILES[id];
  const t = `${title} ${url}`.toLowerCase();
  const arabic = /[؀-ۿ]/.test(title);
  if (/nat ?geo|ناشونال|national geographic/.test(t)) return arabic || /abudhabi|أبوظبي/.test(t) ? { profile: 'natgeo', lang: 'ar', short: title } : { profile: 'natgeo-en', lang: 'en', short: title, brands: [title] };
  if (/asharq|الشرق/.test(t)) return { profile: 'asharq', lang: 'ar', short: title };
  if (/\bdw\b|dwdoc|دي دبليو|deutsche welle/.test(t)) return arabic || /arab|عرب/.test(t) ? { profile: 'dw', lang: 'ar', short: title } : { profile: 'dw-en', lang: 'en', short: title, brands: [title] };
  if (/jazeera|الجزيرة/.test(t)) return arabic ? { profile: 'aljazeera', lang: 'ar', short: title } : { profile: 'generic-en', lang: 'en', short: title, brands: [title] };
  if (/frontline/.test(t)) return { profile: 'frontline', lang: 'en', short: title, brands: [title] };
  if (/history/.test(t) && !arabic) return { profile: /free ?documentary/.test(t) ? 'freedoc' : 'history', lang: 'en', short: title, brands: [title] };
  if (/free ?documentary/.test(t)) return { profile: 'freedoc', lang: 'en', short: title, brands: [title] };
  if (arabic) return { profile: 'generic', lang: 'ar', short: title };
  return { profile: 'generic-en', lang: 'en', short: title, brands: [title] };
}

/** Resolve a user-supplied URL/handle/id into a source descriptor. */
export async function resolveSource(input) {
  const yt = await getClient();
  const s = String(input).trim();
  if (PLAYLIST_ID_RE.test(s)) return await describePlaylist(s);
  if (CHANNEL_ID_RE.test(s)) return await describeChannel(s);
  let url = s;
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    const list = u.searchParams.get('list');
    if (list) return await describePlaylist(list);
    // Drop tab suffixes like /videos or /playlists so the channel resolves.
    u.pathname = u.pathname.replace(/\/(videos|playlists|featured|shorts|streams|about|community)\/?$/i, '');
    url = u.toString();
  } catch { url = `https://www.youtube.com/${s.startsWith('@') ? s : '@' + s}`; }
  let r = await yt.resolveURL(url);
  // Legacy custom URLs resolve to a redirect first ("/VICENews"); follow it once.
  if (!r?.payload?.browseId && r?.payload?.url) r = await yt.resolveURL(r.payload.url).catch(() => r);
  const browseId = r?.payload?.browseId;
  if (browseId?.startsWith('VL')) return await describePlaylist(browseId.slice(2));
  if (browseId && CHANNEL_ID_RE.test(browseId)) return await describeChannel(browseId);
  // Last resort: search channels by the handle/name.
  const name = s.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
  const found = await yt.search(name, { type: 'channel' }).catch(() => null);
  const hit = found?.results?.find((c) => CHANNEL_ID_RE.test(c.author?.id || c.id || '') && (c.author?.name || c.title?.text || '').toLowerCase().replace(/\s/g, '') === name.toLowerCase());
  if (hit) return await describeChannel(hit.author?.id || hit.id);
  throw new Error('تعذّر التعرّف على هذا الرابط. أدخل رابط قناة أو قائمة تشغيل على يوتيوب.');
}

async function describeChannel(id) {
  const yt = await getClient();
  const ch = await yt.getChannel(id);
  const title = ch.metadata?.title || id;
  const url = ch.metadata?.url || `https://www.youtube.com/channel/${id}`;
  const det = detectProfile(id, title, url);
  return { type: 'channel', id, title, url, profile: det.profile, lang: det.lang, short: det.short || title, brands: det.brands || [title], scanUploads: true, maxUploads: det.maxUploads || (/^dw/.test(det.profile) || det.profile === 'creator' ? 1500 : 400) };
}
async function describePlaylist(id) {
  const yt = await getClient();
  const pl = await yt.getPlaylist(id);
  const title = pl.info?.title || id;
  const author = pl.info?.author?.name || '';
  const det = detectProfile(pl.info?.author?.id || '', author || title, '');
  return { type: 'playlist', id, title, url: `https://www.youtube.com/playlist?list=${id}`, profile: det.profile, lang: det.lang, short: author || title };
}

const RELATIVE_RE = /قبل|خلال|منذ|\bago\b|il y a|\bvor\b|\bhace\b|streamed|premiered/i;

// Channel tabs and playlists are served as LockupView nodes (youtubei.js >= 16 exposes them in
// `videos`); older renderers (GridVideo, PlaylistVideo) are still mapped for safety.
export function mapVideoItem(v) {
  const id = v.content_id || v.id;
  const title = v.metadata?.title?.text ?? v.title?.text ?? v.title ?? '';
  const durationText = v.content_image?.overlays?.[0]?.badges?.[0]?.text ?? v.duration?.text ?? '';
  // Metadata parts look like [author?, co-author?, views, age]; author parts vary (collaborations),
  // so the age is found by its wording and the view count is the numeric part right before it.
  const parts = (v.metadata?.metadata?.metadata_rows || []).flatMap((r) => (r.metadata_parts || []).map((p) => p.text?.text?.trim()).filter(Boolean));
  const ageAt = parts.findLastIndex((p) => RELATIVE_RE.test(p));
  const viewsPart = ageAt > 0 && /[\d٠-٩]/.test(parts[ageAt - 1]) ? parts[ageAt - 1] : parts.find((p) => /views|مشاهد|vues/i.test(p));
  return {
    id,
    title: String(title),
    durationSec: parseDuration(durationText),
    durationText,
    views: viewsPart || v.view_count?.text || null,
    relative: (ageAt >= 0 ? parts[ageAt] : null) || v.published?.text || null,
    thumb: v.content_image?.image?.[0]?.url ?? v.thumbnails?.[0]?.url ?? null,
  };
}
const validVideo = (v) => v.id && /^[\w-]{11}$/.test(v.id);

export function mapPlaylistItem(p) {
  const id = p.content_id || p.id;
  const title = p.metadata?.title?.text ?? p.title?.text ?? p.title ?? '';
  const thumb = p.content_image?.primary_thumbnail?.image?.[0]?.url ?? p.thumbnails?.[0]?.url ?? null;
  const countText = p.content_image?.primary_thumbnail?.overlays?.[0]?.badges?.[0]?.text ?? p.video_count?.text ?? '';
  const coverVideo = p.renderer_context?.command_context?.on_tap?.payload?.videoId ?? (thumb?.match(/\/vi\/([\w-]{11})\//)?.[1] ?? null);
  return { id, title: String(title), thumb, countText, count: parseCount(countText), signature: `${countText}|${coverVideo}` };
}

// Feeds stop when two pages in a row parse to nothing: a layout the parser does not understand
// would otherwise walk every continuation and still return no videos.
const MAX_EMPTY_PAGES = 2;

// youtubei.js keeps PLAYLIST/ALBUM/PODCAST/SHOW lockups only; channels also file series as COURSE lockups.
function playlistNodes(page) {
  const courses = page.memo?.getType?.(YTNodes.LockupView)?.filter((l) => l.content_type === 'COURSE') || [];
  return [...page.playlists, ...courses];
}

/**
 * All playlists of a channel with a cheap change signature (count badge + cover video id). The array
 * carries `complete`: true when the walk read the tab to its last page, false when it stopped early
 * (page guard, unreadable pages) or the channel shows no playlists tab. A complete listing can still
 * omit playlists (what YouTube lists depends on the requesting region), so absence is never proof
 * that a playlist is gone.
 */
export async function listChannelPlaylists(channelId, { lang } = {}) {
  const yt = await getClient(lang);
  const ch = await withRetry(() => yt.getChannel(channelId));
  if (!ch.has_playlists) return Object.assign([], { complete: false });
  let page = await withRetry(() => ch.getPlaylists());
  const all = playlistNodes(page);
  let guard = 0;
  let empty = all.length ? 0 : 1;
  while (page.has_continuation && guard++ < 80 && empty < MAX_EMPTY_PAGES) {
    page = await withRetry(() => page.getContinuation());
    const items = playlistNodes(page);
    all.push(...items);
    empty = items.length ? 0 : empty + 1;
  }
  const seen = new Set();
  const list = all
    .map(mapPlaylistItem)
    .filter((p) => p.id && p.title && !seen.has(p.id) && seen.add(p.id));
  return Object.assign(list, { complete: !page.has_continuation });
}

/**
 * The channel's uploads tab (newest first). Stops early when it meets a video id in `knownIds`
 * (incremental refresh), after `max` videos, or after pages that parse to nothing.
 * `parsed` is the number of video items understood (0 means the listing is empty or unreadable).
 */
export async function listChannelUploads(channelId, { max = 400, knownIds = null, lang } = {}) {
  const yt = await getClient(lang);
  const ch = await withRetry(() => yt.getChannel(channelId));
  if (!ch.has_videos) return { videos: [], complete: true, parsed: 0 };
  let page = await withRetry(() => ch.getVideos());
  const out = [];
  const ids = new Set();
  let guard = 0;
  let hitKnown = false;
  let empty = 0;
  const take = (items) => {
    let n = 0;
    for (const v of items.map(mapVideoItem).filter(validVideo)) {
      n++;
      if (knownIds && knownIds.has(v.id)) hitKnown = true;
      if (!ids.has(v.id)) { ids.add(v.id); out.push(v); }
    }
    empty = n ? 0 : empty + 1;
  };
  take(page.videos);
  while (!hitKnown && out.length < max && page.has_continuation && guard++ < 200 && empty < MAX_EMPTY_PAGES) {
    page = await withRetry(() => page.getContinuation());
    take(page.videos);
  }
  return { videos: out, complete: !page.has_continuation, parsed: out.length };
}

/**
 * Playlist contents: every video with its duration (from the badge) and relative age.
 * `expectedCount` is the playlist's own video count ("34 videos"), used to spot truncated results.
 * A deleted or private playlist throws an error with code 'PLAYLIST_GONE'.
 */
export async function getPlaylistVideos(playlistId, { lang } = {}) {
  const yt = await getClient(lang);
  let page;
  try {
    page = await withRetry(() => yt.getPlaylist(playlistId), { retryIf: (e) => !isGoneAlert(e) });
  } catch (e) {
    if (isGoneAlert(e)) throw Object.assign(new Error(`playlist ${playlistId} is gone: ${e.message}`), { code: 'PLAYLIST_GONE' });
    throw e;
  }
  const info = page.info || {};
  const videos = [...page.videos];
  let guard = 0;
  let empty = videos.length ? 0 : 1;
  while (page.has_continuation && guard++ < 100 && empty < MAX_EMPTY_PAGES) {
    page = await withRetry(() => page.getContinuation());
    videos.push(...page.videos);
    empty = page.videos.length ? 0 : empty + 1;
  }
  return {
    id: playlistId,
    title: info.title ?? '',
    description: info.description ?? null,
    thumb: info.thumbnails?.[0]?.url ?? null,
    lastUpdated: info.last_updated ?? null,
    expectedCount: parseCount(info.total_items),
    videos: videos.map(mapVideoItem).filter(validVideo),
  };
}

const runsText = (t) => (typeof t === 'string' ? t : t?.simpleText ?? t?.content ?? (t?.runs || []).map((r) => r.text).join('')) || '';

/** The reason and sub-reason a /player playabilityStatus gives, as one line ('' when it gives none). */
export function playabilityText(ps) {
  const es = ps?.errorScreen;
  const parts = [ps?.reason, runsText(es?.playerErrorMessageRenderer?.reason), runsText(es?.playerErrorMessageRenderer?.subreason),
    runsText(es?.playerInterstitialRenderer?.content?.interstitialViewModel?.description)];
  return [...new Set(parts.map((p) => String(p || '').trim()).filter(Boolean))].join(' - ');
}

// Answers about the requester, not the video: bot and age checks, "try again later", "the page needs to be
// reloaded" (a session problem), country or region limits. They never count as the video being gone.
const REQUESTER_RE = /try again|later|reload|\bbot\b|robot|confirm|country|region|لاحق|إعادة تحميل|روبوت|تأكيد|بلد|دولة|منطقة/i;
const REMOVED_RE = /removed|deleted|terminated|no longer available|تمت إزالة|حذف|لم يعد متاح/i;

/**
 * Whether /player says the video itself is gone: status ERROR (removed or never existed), LOGIN_REQUIRED
 * with a "private" reason, or UNPLAYABLE with a removal reason. Checked only when the answer carries no
 * videoDetails; bot checks, rate limits and geo restrictions are not proof that a video is gone.
 */
export function isUnavailablePlayability(ps) {
  if (!ps) return false;
  const text = playabilityText(ps);
  if (REQUESTER_RE.test(text)) return false;
  if (ps.status === 'ERROR') return true;
  if (ps.status === 'LOGIN_REQUIRED') return /private|خاص|priv[ée]/i.test(text);
  return ps.status === 'UNPLAYABLE' && REMOVED_RE.test(text);
}

/**
 * A details answer (or stored record) that carries no data: the getBasicInfo fallback without a
 * duration, or neither a title nor a duration. A "gone" answer is not a stub.
 */
export function isDetailStub(d) {
  if (!d || d.gone) return false;
  return (d.fallback === true && !d.durationSec) || (!d.title && !d.durationSec);
}

/** oEmbed answer for a public video: true (embeddable), false (401: embedding disabled), undefined (anything else). */
export async function oembedEmbeddable(videoId) {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    return res.status === 200 ? true : res.status === 401 ? false : undefined;
  } catch { return undefined; }
}

// Embedding: playableInEmbed when /player gives it (only on playable answers); otherwise the microformat's
// embed block, whose absence is confirmed with oEmbed. undefined when nothing tells.
async function embeddableOf(videoId, ps, mf, oembed) {
  if (ps?.playableInEmbed === false) return false;
  if (ps?.playableInEmbed === true || mf?.embed) return true;
  if (!mf) return undefined;
  return oembed(videoId);
}

/**
 * Per-video details via the raw player endpoint: description, publish date, exact duration, and
 * `embeddable` when known. A video YouTube reports as removed or private resolves to
 * { id, gone: true, status, reason } (one check: the scheduler confirms it on a later run before it
 * marks the video unavailable). When /player gives no videoDetails otherwise, getBasicInfo is tried
 * (fallback: true); a fallback without a duration is a stub (isDetailStub). Network errors throw.
 */
export async function getVideoDetails(videoId, { lang, oembed = oembedEmbeddable } = {}) {
  const yt = await getClient(lang);
  try {
    const r = await withRetry(() => yt.actions.execute('/player', { videoId, client: 'WEB', parse: false }), { tries: 2 });
    const d = r?.data ?? r;
    const vd = d?.videoDetails;
    const mf = d?.microformat?.playerMicroformatRenderer;
    const ps = d?.playabilityStatus;
    if (!vd && isUnavailablePlayability(ps)) {
      return { id: videoId, gone: true, status: ps.status, reason: playabilityText(ps) || null, fetchedAt: new Date().toISOString() };
    }
    if (!vd) throw new Error(`no videoDetails (${[ps?.status, playabilityText(ps)].filter(Boolean).join(': ') || 'no playability status'})`);
    const embeddable = await embeddableOf(videoId, ps, mf, oembed);
    return {
      id: videoId,
      title: vd.title ?? '',
      description: vd.shortDescription ?? '',
      durationSec: parseInt(vd.lengthSeconds ?? '0', 10) || 0,
      viewCount: parseInt(vd.viewCount ?? '0', 10) || 0,
      publishedAt: mf?.publishDate ?? mf?.uploadDate ?? null,
      category: mf?.category ?? null,
      keywords: vd.keywords ?? [],
      isPrivate: !!vd.isPrivate,
      isLive: !!vd.isLive,
      isLiveContent: !!vd.isLiveContent,
      playable: ps?.status === 'OK',
      ...(embeddable === undefined ? {} : { embeddable }),
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    const bi = await withRetry(() => yt.getBasicInfo(videoId), { tries: 2 });
    const b = bi.basic_info;
    return {
      id: videoId,
      title: b.title ?? '',
      description: b.short_description ?? '',
      durationSec: b.duration ?? 0,
      viewCount: b.view_count ?? 0,
      publishedAt: null,
      category: b.category ?? null,
      keywords: b.keywords ?? [],
      isPrivate: !!b.is_private,
      isLive: !!b.is_live,
      isLiveContent: !!b.is_live_content,
      playable: bi.playability_status?.status === 'OK',
      ...(b.embed ? { embeddable: true } : {}),
      fetchedAt: new Date().toISOString(),
      fallback: true,
      playerError: String(e?.message || e).slice(0, 200), // why /player gave nothing (shows in the poll and refresh logs)
    };
  }
}

/**
 * Lightweight "what did the channel upload lately" feed (15 newest uploads, keyless RSS). Entries are
 * { id, title, published, short }; `short` is true for Shorts (their link is /shorts/<id>).
 */
export async function fetchChannelFeed(channelId, { lang } = {}) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
    headers: { 'accept-language': normalizeLang(lang) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  return parseChannelFeed(await res.text());
}

export function parseChannelFeed(xml) {
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml))) {
    const e = m[1];
    const id = e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1];
    const title = e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
    const published = e.match(/<published>([^<]+)<\/published>/)?.[1] ?? null;
    const link = e.match(/<link rel="alternate" href="([^"]+)"/)?.[1] ?? '';
    if (id) entries.push({ id, title: decodeXml(title), published, short: /\/shorts\//.test(link) });
  }
  return entries;
}

function decodeXml(s) {
  // &amp; last, so "&amp;lt;" stays "&lt;" instead of being decoded twice.
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
