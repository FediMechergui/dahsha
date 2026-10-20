// Pure catalogue helpers shared by the hooks and pages (no import.meta / DOM, so node tests import them).
import { isPortraitUrl } from './text.js';

export const WEB_PROVIDERS = ['myflixer', 'fmovies', 'hdtoday'];
const PROVIDER_ID = /^(mf|fm|hd):/;

/** Myflixer/FMovies/HDToday rows (web providers) as opposed to YouTube channel shows. */
export function isWebProviderShow(show) {
  if (!show) return false;
  return WEB_PROVIDERS.includes(show.channelId || show.channel?.id) || PROVIDER_ID.test(show.id || '');
}
export const resourceOf = (show) => (isWebProviderShow(show) ? 'web' : 'channels');
export const PROVIDER_NAMES = { myflixer: 'Myflixer', fmovies: 'FMovies', hdtoday: 'HDToday' };

// ── recency (C3 + provider contract 6) ─────────────────────────────────────────────────────────
// A card is as recent as the newer of latestAt (YouTube and Myflixer dates) and updatedAt, the
// build's show-level date: a genuine FMovies/HDToday discovery or a newly listed provider episode.
// updatedAt is only written where it differs from latestAt, and neither is trusted beyond the
// catalogue's build time (clock-skewed source dates). A title with neither (the bulk-imported
// provider cards, catalogues older than the field) is undated: never "latest" and never "new".
const timeOf = (v) => (typeof v === 'string' && v ? Date.parse(v) : NaN);
/** The newest valid ISO string of `values` (as given), or `cap` when that is earlier; null when none is valid. */
function newest(values, cap) {
  let best = null, at = NaN;
  for (const v of values) { const t = timeOf(v); if (Number.isFinite(t) && (best === null || t > at)) { best = v; at = t; } }
  if (best === null) return null;
  const limit = timeOf(cap);
  return Number.isFinite(limit) && at > limit ? cap : best;
}
/** Recency of a show computed from its fields, capped at `cap` (the catalogue's generatedAt) when given. */
export const showRecency = (show, cap = null) => newest([show?.latestAt, show?.updatedAt], cap);
/** The recency normalizeCatalog stored on the show (recentAt), else computed from its fields. */
export const recencyOf = (show) => (show && typeof show === 'object' && 'recentAt' in show ? show.recentAt || null : showRecency(show));
export function byRecency(a, b) {
  const x = recencyOf(a) || '', y = recencyOf(b) || '';
  return x < y ? 1 : x > y ? -1 : 0;
}
export const hasRecency = (show) => !!recencyOf(show);
/**
 * Episode recency: the later of its publish date and the date a provider first listed it (addedAt,
 * exported only for real Myflixer/provider discoveries). Without addedAt (every YouTube episode) the
 * publishedAt string is used as is, which keeps the 60k-episode "latest episodes" pass cheap.
 */
export function episodeRecency(episode) {
  if (episode?.addedAt == null) return typeof episode?.publishedAt === 'string' && episode.publishedAt ? episode.publishedAt : null;
  return newest([episode.publishedAt, episode.addedAt]);
}
/** 'fmovies' / 'hdtoday' when the card is recent because it was newly listed there (discoveredAt). */
export function discoveredOn(show) {
  const at = timeOf(show?.discoveredAt);
  if (!Number.isFinite(at) || timeOf(recencyOf(show)) !== at) return null;
  return /^fm:/.test(show.id || '') ? 'fmovies' : /^hd:/.test(show.id || '') ? 'hdtoday' : null;
}

/** Newest episodes across shows, at most `perShow` per show so one series cannot fill the row. */
export function recentEpisodesOf(shows, { perShow = 2, limit = 40 } = {}) {
  const dated = [];
  for (const show of shows || []) for (const episode of show.episodes || []) { const at = episodeRecency(episode); if (at) dated.push({ at, item: { show, episode } }); }
  dated.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const list = dated.map((x) => x.item);
  const counts = new Map();
  const out = [];
  for (const item of list) {
    const n = counts.get(item.show.id) || 0;
    if (n >= perShow) continue;
    counts.set(item.show.id, n + 1);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

const finite = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/**
 * C2 fallback: channels (notably the web providers) may arrive without counts or a language.
 * Missing counts are derived from the shows of this section; channels with no lang that have no
 * shows here are dropped, so neither UI language prints "undefined" rows.
 */
export function withChannelStats(channels, shows, lang) {
  const derived = new Map();
  for (const s of shows || []) {
    const id = s.channel?.id || s.channelId;
    if (!id) continue;
    let d = derived.get(id);
    if (!d) derived.set(id, d = { shows: 0, series: 0, films: 0, episodes: 0, latestAt: null });
    d.shows += 1;
    if (s.kind === 'film') d.films += 1; else if (s.kind === 'series') d.series += 1;
    d.episodes += finite(s.episodeCount) || 0;
    const at = recencyOf(s);
    if (at && (!d.latestAt || at > d.latestAt)) d.latestAt = at;
  }
  const out = [];
  for (const c of channels || []) {
    if (c.lang && lang && c.lang !== lang) continue;
    const d = derived.get(c.id) || { shows: 0, series: 0, films: 0, episodes: 0, latestAt: null };
    if (!c.lang && !d.shows) continue;
    out.push({
      ...c,
      shows: finite(c.shows) ?? d.shows, series: finite(c.series) ?? d.series, films: finite(c.films) ?? d.films,
      episodes: finite(c.episodes) ?? d.episodes, latestAt: c.latestAt || d.latestAt,
      provider: c.profile === 'provider' || WEB_PROVIDERS.includes(c.id),
    });
  }
  return out;
}

const empty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
/** Copy of `base` with its missing (null/empty) fields taken from `extra`. */
export function fillMissing(base, extra) {
  if (!base) return extra || null;
  if (!extra) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) if (empty(out[k]) && !empty(v)) out[k] = v;
  return out;
}

const offeringKey = (o) => `${o?.provider || ''}:${o?.id || ''}`;
function unionOfferings(a = [], b = []) {
  const map = new Map();
  for (const o of [...(a || []), ...(b || [])]) if (o?.id && !map.has(offeringKey(o))) map.set(offeringKey(o), o);
  return [...map.values()];
}
const episodeKeys = (e) => [e.id, ...(e.offerings || []).map((o) => o.id)].filter(Boolean);
const seKey = (e) => (Number.isInteger(e?.season) && Number.isInteger(e?.number) ? `${e.season}x${e.number}` : null);

/** Base episodes keep their order and fields; extra contributes offerings, missing fields and new episodes. */
export function mergeEpisodes(base = [], extra = []) {
  const out = (base || []).map((e) => ({ ...e }));
  const byKey = new Map();
  const bySE = new Map();
  out.forEach((e, i) => { for (const k of episodeKeys(e)) byKey.set(k, i); const se = seKey(e); if (se && !bySE.has(se)) bySE.set(se, i); });
  for (const e of extra || []) {
    let i = episodeKeys(e).map((k) => byKey.get(k)).find((x) => x != null);
    if (i == null && seKey(e)) i = bySE.get(seKey(e));
    if (i == null) {
      out.push({ ...e });
      i = out.length - 1;
    } else {
      out[i] = { ...fillMissing(out[i], e), offerings: unionOfferings(out[i].offerings, e.offerings) };
    }
    for (const k of episodeKeys(out[i])) byKey.set(k, i);
    const se = seKey(out[i]);
    if (se && !bySE.has(se)) bySE.set(se, i);
  }
  return out;
}

const PROTECTED = ['id', 'title', 'synopsis', 'altTitles', 'poster', 'posterVideoId', 'posterId', 'portrait', 'channel', 'channelId', 'lang', 'kind', 'tags', 'primaryTag'];
/**
 * The static shows/<id>.json record is authoritative; the live /api/title response only adds
 * provider data (offerings, versions, providerErrors, episode offerings and new episodes). It never
 * shortens the synopsis, drops alt titles or replaces artwork with the lean blurb record.
 */
export function mergeLiveShow(base, live) {
  if (!base) return live || null;
  if (!live || typeof live !== 'object') return base;
  const merged = fillMissing(base, live);
  for (const k of PROTECTED) if (!empty(base[k])) merged[k] = base[k];
  if ((live.synopsis || '').length > (base.synopsis || '').length && base.synopsisGenerated && live.synopsisGenerated === false) merged.synopsis = live.synopsis;
  merged.altTitles = [...new Set([...(base.altTitles || []), ...(live.altTitles || [])].filter(Boolean))];
  merged.offerings = unionOfferings(base.offerings, live.offerings);
  if (Array.isArray(live.versions) && live.versions.length) {
    const seen = new Set((base.versions || []).map((v) => v.id));
    merged.versions = [...(base.versions || []), ...live.versions.filter((v) => v?.id && !seen.has(v.id))];
  }
  if (Array.isArray(live.providerErrors)) merged.providerErrors = live.providerErrors;
  merged.episodes = mergeEpisodes(base.episodes, live.episodes);
  merged.episodeCount = Math.max(finite(base.episodeCount) || 0, merged.episodes.length);
  const seasons = new Set([...(base.seasons || []), ...merged.episodes.map((e) => e.season).filter(Number.isInteger)]);
  merged.seasons = [...seasons].sort((a, b) => a - b);
  return merged;
}

// ── seasons ────────────────────────────────────────────────────────────────────────────────────
/** An episode's labelled group (seasonLabel: a programme's era on one channel, "AJ+ كبريت 2017–2020"), or null. */
export const seasonLabelOf = (e) => (typeof e?.seasonLabel === 'string' && e.seasonLabel.trim() ? e.seasonLabel.trim() : null);
/**
 * The episode groups of a show page: numbered seasons (ascending) and labelled groups (episode
 * seasonLabel, e.g. a programme's era on one channel: "AJ+ كبريت 2017–2020") where the episode list
 * (catalogue order) first reaches them, then the episodes with neither ({ other: true }). Each group is
 * { key, season, label, other, episodes }. [] when there are fewer than two seasons and labelled groups
 * together: the page then lists the episodes as one list.
 */
export function seasonGroups(show) {
  const groups = new Map();
  const other = [];
  for (const e of show?.episodes || []) {
    const label = seasonLabelOf(e);
    const season = label ? null : Number.isInteger(e?.season) ? e.season : null;
    if (label == null && season == null) { other.push(e); continue; }
    const key = label != null ? `label:${label}` : `season:${season}`;
    if (!groups.has(key)) groups.set(key, { key, season, label, other: false, episodes: [] });
    groups.get(key).episodes.push(e);
  }
  if (groups.size < 2) return [];
  const list = [...groups.values()];
  // Numbered seasons keep ascending order in the slots they hold (live provider episodes may arrive
  // after the catalogue's); labelled groups keep their place.
  const numbered = list.filter((g) => g.label == null).sort((a, b) => a.season - b.season);
  const ordered = list.map((g) => (g.label == null ? numbered.shift() : g));
  return other.length ? [...ordered, { key: 'other', season: null, label: null, other: true, episodes: other }] : ordered;
}

/** Only provider-backed titles gain anything from the live title API; YouTube records are complete. */
export function needsLiveTitle(id, base) {
  if (!base || PROVIDER_ID.test(id || '') || isWebProviderShow(base)) return true;
  return (base.offerings || []).some((o) => o?.provider && o.provider !== 'youtube');
}

/** Landscape artwork for heroes/backdrops: drop a portrait custom poster when YouTube sizes exist. */
export function landscapeArt(poster) {
  if (!poster || typeof poster !== 'object') return poster || null;
  if (!isPortraitUrl(poster.custom)) return poster;
  const { custom, ...rest } = poster;
  return Object.values(rest).some((v) => typeof v === 'string' && v) ? rest : poster;
}
export function portraitArt(show) {
  if (typeof show?.portrait === 'string' && show.portrait) return show.portrait;
  return isPortraitUrl(show?.poster?.custom) ? show.poster.custom : null;
}
export const hasLandscapeArt = (show) => {
  const art = landscapeArt(show?.poster);
  return !!art && !isPortraitUrl(art.custom) && Object.values(art).some((v) => typeof v === 'string' && v);
};

// ── C1: show id aliases ────────────────────────────────────────────────────────────────────────
/** Final id an aliased show id points to (follows chains, ignores cycles); null when not aliased. */
export function resolveAlias(id, aliases) {
  if (!id || !aliases || typeof aliases !== 'object' || !Object.prototype.hasOwnProperty.call(aliases, id)) return null;
  const seen = new Set([id]);
  let current = id;
  while (Object.prototype.hasOwnProperty.call(aliases, current)) {
    const next = aliases[current];
    if (typeof next !== 'string' || !next || seen.has(next)) break;
    seen.add(next);
    current = next;
  }
  return current === id ? null : current;
}

/** Rewrites stored favourites and progress entries from old to new show ids. */
export function migrateStoredIds({ progress = {}, favorites = [] } = {}, aliases = {}) {
  let changed = false;
  const nextFavorites = [];
  for (const id of Array.isArray(favorites) ? favorites : []) {
    const target = resolveAlias(id, aliases) || id;
    if (target !== id) changed = true;
    if (!nextFavorites.includes(target)) nextFavorites.push(target); else changed = true;
  }
  const nextProgress = {};
  for (const [epId, entry] of Object.entries(progress && typeof progress === 'object' ? progress : {})) {
    const target = entry && resolveAlias(entry.showId, aliases);
    if (target) { changed = true; nextProgress[epId] = { ...entry, showId: target }; } else nextProgress[epId] = entry;
  }
  return { progress: nextProgress, favorites: nextFavorites, changed };
}

/** Short stable fingerprint of an alias map, to run the storage migration once per map. */
export function aliasSignature(aliases) {
  const entries = Object.entries(aliases || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let h = 5381;
  for (const [k, v] of entries) for (const ch of `${k}>${v};`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `${entries.length}:${h.toString(36)}`;
}

/** Union of the idAliases of every loaded section. */
export function mergeAliases(sections) {
  const out = {};
  for (const s of sections || []) if (s?.idAliases && typeof s.idAliases === 'object') Object.assign(out, s.idAliases);
  return out;
}

/**
 * The alias map the app acts on: the union of the loaded sections' idAliases without any key that
 * is a live card (or a card's offering) in one of them. Each section is (re)loaded on its own, so
 * the loaded sections can come from different deploys, and a renamed id can come back in a later
 * build (show-ids.js then swaps the alias): the union may then rename an id that is live where the
 * user sees it. Such an id is neither redirected (App.jsx) nor rewritten in the stored favourites
 * and progress (migrateShowIds); once every section is on the same deploy the full map applies.
 */
export function liveAliases(sections) {
  const merged = mergeAliases(sections);
  const keys = Object.keys(merged);
  if (!keys.length) return merged;
  const live = new Set();
  for (const s of sections || []) for (const show of s?.shows || []) {
    if (show?.id) live.add(show.id);
    for (const o of show?.offerings || []) if (o?.id) live.add(o.id);
  }
  const out = {};
  for (const k of keys) if (!live.has(k)) out[k] = merged[k];
  return out;
}

// ── favourites of grouped cards ────────────────────────────────────────────────────────────────
/**
 * The card My List shows for a stored favourite id: a card's own id first, then the ids of its
 * offerings and versions (former provider cards now grouped into it), the first card listing one wins.
 */
export function favoriteCardIndex(shows) {
  const map = new Map();
  for (const s of shows || []) if (s?.id) map.set(s.id, s);
  for (const s of shows || []) for (const x of [...(s?.offerings || []), ...(s?.versions || [])]) if (x?.id && !map.has(x.id)) map.set(x.id, s);
  return map;
}

/**
 * Every id a favourite of `show` may be stored under: its own id, then the ids of its offerings and
 * versions (of the record and of `rows`, e.g. its catalogue row) that `cardOf` resolves to this card
 * or to no card. An id that is a card of its own, or that My List lists under another card, is left
 * out: it is that card's favourite.
 */
export function favoriteIdsOf(show, { rows = [], cardOf = () => null } = {}) {
  if (!show?.id) return [];
  const ids = [show.id];
  for (const row of [show, ...(rows || [])]) for (const x of [...(row?.offerings || []), ...(row?.versions || [])]) {
    if (!x?.id || ids.includes(x.id)) continue;
    const card = cardOf(x.id);
    if (!card || card.id === show.id) ids.push(x.id);
  }
  return ids;
}

/** The favourites after toggling a card: adds `showId`, or removes every id the card may be stored under. */
export function toggleFavorite(favorites, showId, ids = [showId]) {
  const list = Array.isArray(favorites) ? favorites : [];
  const keys = new Set([showId, ...(ids || [])]);
  return list.some((x) => keys.has(x)) ? list.filter((x) => !keys.has(x)) : [showId, ...list];
}

// ── provider freshness (provider contract 6, providerSync) ────────────────────────────────────
/** The crawled providers providerSync reports on (Myflixer is refreshed with the YouTube sources). */
export const SYNCED_PROVIDERS = ['fmovies', 'hdtoday'];
const STALE_MS = 24 * 3600e3;
const isoOrNull = (v) => (Number.isFinite(timeOf(v)) ? v : null);
/**
 * Freshness of one crawled provider for the Sources page, or null when providerSync says nothing
 * about it. Current catalogues carry providerSync.providers[id] (last success, last new title,
 * last error, failed scans in a row); stale = failing and no success for over 24 h (the CI warning
 * rule). Older catalogues only have the shared lastRefreshAt (stamped even when a provider failed)
 * and errors[id]: those come back as { legacy: true, lastSyncAt, lastError }.
 */
export function providerFreshness(sync, id, now = Date.now()) {
  if (!sync || typeof sync !== 'object' || !id) return null;
  const errors = sync.errors && typeof sync.errors === 'object' ? sync.errors : {};
  const p = sync.providers && typeof sync.providers === 'object' ? sync.providers[id] : null;
  if (p && typeof p === 'object') {
    const lastSuccessAt = isoOrNull(p.lastSuccessAt);
    const lastError = (typeof p.lastError === 'string' && p.lastError) || null;
    const failures = Number.isInteger(p.consecutiveFailures) && p.consecutiveFailures > 0 ? p.consecutiveFailures : lastError ? 1 : 0;
    return {
      legacy: false, ok: !lastError, lastSuccessAt, lastNewRecordAt: isoOrNull(p.lastNewRecordAt), lastAttemptAt: isoOrNull(p.lastAttemptAt),
      lastError, consecutiveFailures: failures,
      stale: !!lastError && (!lastSuccessAt || now - timeOf(lastSuccessAt) > STALE_MS),
    };
  }
  if (!SYNCED_PROVIDERS.includes(id) && !errors[id]) return null;
  const lastError = (typeof errors[id] === 'string' && errors[id]) || null;
  return { legacy: true, ok: !lastError, lastSyncAt: isoOrNull(sync.lastRefreshAt), lastError };
}

// ── updates ────────────────────────────────────────────────────────────────────────────────────
export function versionedUrl(url, version) {
  if (!version) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}

/**
 * Reload when status.json announces another deployment than the loaded section, but at most once
 * per announced version every `retryMs`, so a stale cached catalogue cannot cause a reload loop.
 */
export function shouldReload({ statusVersion, sectionVersion, attempt, now = Date.now(), retryMs = 5 * 60e3 } = {}) {
  if (!statusVersion || !sectionVersion || statusVersion === sectionVersion) return false;
  if (attempt?.version === statusVersion && now - (attempt.at || 0) < retryMs) return false;
  return true;
}

/** Episodes present in the next section but not in the previous one, newest first. */
export function newEpisodesBetween(prev, next) {
  if (!prev?.shows || !next?.shows) return [];
  const known = new Set();
  for (const s of prev.shows) for (const e of s.episodes || []) known.add(e.id);
  const out = [];
  for (const s of next.shows) for (const e of s.episodes || []) if (!known.has(e.id)) out.push({ show: s, episode: e, at: episodeRecency(e) || '' });
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).map(({ show, episode }) => ({ show, episode }));
}

/** Live rows only belong to the section of their own language (language-neutral rows go everywhere). */
export const rowFitsSection = (row, sectionLang) => !row?.lang || !sectionLang || row.lang === sectionLang;
