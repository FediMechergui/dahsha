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

// C3: "latest/new" means latestAt and nothing else; a missing latestAt is never new.
const stamp = (s) => (typeof s?.latestAt === 'string' ? s.latestAt : '');
export function byRecency(a, b) {
  const x = stamp(a), y = stamp(b);
  return x < y ? 1 : x > y ? -1 : 0;
}
export const hasRecency = (show) => Number.isFinite(Date.parse(show?.latestAt || ''));

/** Newest episodes across shows, at most `perShow` per show so one series cannot fill the row. */
export function recentEpisodesOf(shows, { perShow = 2, limit = 40 } = {}) {
  const list = [];
  for (const show of shows || []) for (const episode of show.episodes || []) if (typeof episode.publishedAt === 'string' && episode.publishedAt) list.push({ show, episode });
  list.sort((a, b) => (a.episode.publishedAt < b.episode.publishedAt ? 1 : a.episode.publishedAt > b.episode.publishedAt ? -1 : 0));
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
    if (s.latestAt && (!d.latestAt || s.latestAt > d.latestAt)) d.latestAt = s.latestAt;
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
  for (const s of next.shows) for (const e of s.episodes || []) if (!known.has(e.id)) out.push({ show: s, episode: e });
  return out.sort((a, b) => ((a.episode.publishedAt || '') < (b.episode.publishedAt || '') ? 1 : -1));
}

/** Live rows only belong to the section of their own language (language-neutral rows go everywhere). */
export const rowFitsSection = (row, sectionLang) => !row?.lang || !sectionLang || row.lang === sectionLang;
