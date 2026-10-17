// Poster / synopsis enrichment, matched by title (or by a provider's own TMDB id), from (in order):
//   1. TMDB      (needs TMDB_API_KEY; backdrop + portrait poster + overview, ar/en)
//   2. TVmaze    (no key; English-titled series: portrait poster + summary)
//   3. Wikidata  (no key; Arabic dub title -> English programme name -> TVmaze)
//   4. Wikipedia (no key; ar / en / fr: page image + extract)
// Every cached entry carries `confidence`: 'exact' only for the same normalised title, the same kind
// (film/series), a documentary-type programme and a compatible year; anything looser is 'fuzzy' and is
// never handed to the catalogue. Results are cached in server/data/artwork.json. Show ids or image URLs
// listed in server/data/artwork-rejects.json are never used. YouTube thumbnails remain the fallback.
import { readJson, writeJson } from './store.js';
import * as text from './text.js';

const { normalizeArabic, similarity, hasArabic } = text;

const IMG = 'https://image.tmdb.org/t/p';
const MAX_PER_RUN = Number(process.env.ARTWORK_MAX_PER_RUN || 600);
const MAX_MINUTES = Number(process.env.ARTWORK_MAX_MINUTES || 30);
const TIMEOUT_MS = Number(process.env.ARTWORK_TIMEOUT_MS || 10000);
const MAX_429_RETRIES = 3;
const HOST_FAILURE_LIMIT = 5; // consecutive failures before a host is skipped for the rest of the run
const RULES_VERSION = 2; // bump when the matching rules change so cached matches are looked up again
const RECHECK_DAYS = { exact: 90, miss: 30, incomplete: 3 };
const SAVE_EVERY = 25;
const UA = 'Dahsha/1.0 (https://dahsha.vercel.app; documentary catalogue)';
const DAY = 864e5;

export const artworkEnabled = () => process.env.ARTWORK !== '0';
const envTmdbKey = () => process.env.TMDB_API_KEY || '';

let cache = null;
function load() { if (!cache) cache = readJson('artwork.json', {}); return cache; }
function save() { if (cache) writeJson('artwork.json', cache); }
/** Drop the in-memory cache so the next call re-reads artwork.json (tests, snapshot restores). */
export function resetArtworkCache() { cache = null; lastRun = null; }

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- text helpers ----------------------------------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const codePoint = (n) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');
// text.js owns the shared decoder (decodeEntities); this fallback only covers an older text.js.
const decode = (s = '') => (typeof text.decodeEntities === 'function' ? text.decodeEntities(String(s)) : String(s)
  .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ENTITIES[n]));

const clean = (t = '') => decode(t)
  .replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ')          // "(Full Episode)", "(2/3)"
  .replace(/\s*[|:–—-]\s*(season|الموسم)\s*\d+.*$/i, '')
  .replace(/\.\.+/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** Comparison key for "the same title": entities, accents, Arabic letter variants, punctuation and a leading "the". */
export const titleKey = (t = '') => normalizeArabic(decode(t).normalize('NFKD').replace(/\p{M}/gu, '').replace(/&/g, ' and ')).replace(/^the /, '');

const toLatinDigits = (s = '') => String(s).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
const yearOf = (v) => {
  const m = /(\d{4})/.exec(toLatinDigits(v ?? ''));
  const y = m ? Number(m[1]) : NaN;
  return y >= 1880 && y <= 2100 ? y : null;
};
const yearIn = (s = '') => { const m = /\b(18[89]\d|19\d\d|20\d\d)\b/.exec(toLatinDigits(s)); return m ? Number(m[1]) : null; };
const stripHtml = (s = '') => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const round = (n) => Math.round(n * 100) / 100;

const DOC_WORDS = /وثائقي|مسلسل|برنامج|سلسلة|فيلم|documentary|series|television|tv|film|show|programme|program|émission|série|documentaire/i;
const FILM_WORDS = /فيلم|فلم|\bfilms?\b|\bmovie\b|long[- ]métrage/i;
const SERIES_WORDS = /مسلسل|سلسلة|برنامج|\bseries\b|\bserial\b|\btelevision\b|\btv\b|\bprogramme\b|\bprogram\b|\bdocuseries\b|\bminiseries\b|émission|\bsérie\b/i;
// Wikidata descriptions of programmes Dahsha never carries (the Lion Guard / The Affair class of mistakes).
const NOT_DOCUMENTARY = /animated|animation|cartoon|\banime\b|\bdrama\b|sitcom|\bsoap\b|telenovela|\bcomedy\b/i;
const TVMAZE_DOC_TYPES = new Set(['Documentary', 'Reality', 'News']);
const TVMAZE_REJECT_TYPES = new Set(['Scripted', 'Animation', 'Variety']);
const TMDB_DOC_GENRES = new Set([99, 10763, 10764]); // Documentary, News, Reality

/** 'film' | 'series' | null from a page title disambiguator or description. */
function kindFromText(s = '') {
  const film = FILM_WORDS.test(s), series = SERIES_WORDS.test(s);
  return film && !series ? 'film' : series && !film ? 'series' : null;
}

const isProviderRow = (s) => /^(fm|hd):/.test(s.id || '') || s.channelId === 'fmovies' || s.channelId === 'hdtoday';
// Provider rows are exported in the English section whatever their raw lang field says.
const sectionLang = (s) => (isProviderRow(s) || s.lang === 'en' ? 'en' : 'ar');
const YOUTUBE_ID = /^[\w-]{11}$/;

/**
 * Confidence of a candidate match: 'exact', 'fuzzy', or null when it must be rejected.
 * exact = same normalised title AND same kind AND documentary-type AND a compatible year: within 1 of the
 * show's own year, or (YouTube/Myflixer shows without a year) premiered no later than the first upload.
 */
export function matchConfidence(show, { query, names = [], kind = null, year = null, typeOk = false } = {}) {
  const first = yearOf(show.firstAt);
  if (year && first && first < year - 1) return null; // uploaded before this programme premiered
  const target = titleKey(query || show.title);
  const sameTitle = !!target && names.some((n) => n && titleKey(n) === target);
  const showYear = Number(show.year) || null;
  const yearOk = !year || (showYear ? Math.abs(showYear - year) <= 1 : first ? year <= first : true);
  return sameTitle && kind === show.kind && typeOk && yearOk ? 'exact' : 'fuzzy';
}

// ---- images ------------------------------------------------------------------------------------------
/** host + original file name, so thumbnail sizes and variants of one image compare equal. */
export function imageKey(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    let file = parts.pop() || '';
    if (/^\d+px-/.test(file) && parts.includes('thumb')) file = parts.pop() || file;
    return `${u.host}/${decodeURIComponent(file)}`.toLowerCase();
  } catch { return String(url || '').toLowerCase(); }
}

const IMAGE_JUNK = /(^|[\W_])(logos?|icons?|wordmark|emblem|seal|flag|map|coat[\W_]of[\W_]arms|signature)([\W_]|$)|شعار|خريطة/i;
const POSTER_FILE = /poster|ملصق|affiche|title[\W_]?card|cover|غلاف|dvd/i;

/**
 * A Wikipedia page image is usable as programme artwork only when it is not tiny, not an SVG/logo, and
 * is a local (non-free) upload. Programme posters are copyrighted, so a Commons lead image on a
 * programme page is almost always a painting, a photo of a person or place, or a logo.
 */
export function usableWikiImage(img) {
  const url = img?.source;
  if (!url) return null;
  const file = imageKey(url).split('/').pop();
  if (/\.svg$|\.svg\.png$/i.test(file)) return null;
  if (IMAGE_JUNK.test(file)) return null;
  const px = /\/(\d+)px-[^/]*$/.exec(url);
  if ((img.width && img.width < 200) || (img.height && img.height < 200) || (px && Number(px[1]) < 200)) return null;
  if (/\/wikipedia\/commons\//.test(url) && !POSTER_FILE.test(file)) return null;
  return url;
}

// ---- reject list -------------------------------------------------------------------------------------
/** server/data/artwork-rejects.json: ["s_abc", "https://…/poster.jpg"] or { shows: [...], images: [...] }. */
function loadRejects() {
  const raw = readJson('artwork-rejects.json', []);
  const list = Array.isArray(raw) ? raw : [...(raw?.shows || []), ...(raw?.ids || []), ...(raw?.images || []), ...(raw?.urls || [])];
  const ids = new Set(), images = new Set();
  for (const v of list) {
    if (typeof v !== 'string' || !v.trim()) continue;
    if (/^https?:\/\//i.test(v.trim())) images.add(imageKey(v.trim())); else ids.add(v.trim());
  }
  return { ids, images };
}
function withoutRejected(entry, rejects) {
  if (!entry) return entry;
  const out = { ...entry };
  for (const f of ['poster', 'backdrop']) if (out[f] && rejects.images.has(imageKey(out[f]))) out[f] = null;
  return out;
}
const hasPayload = (a) => !!(a && (a.poster || a.backdrop || a.overview));

function usableView(art, rejects) {
  const out = {};
  for (const [id, entry] of Object.entries(art)) {
    if (!entry?.source || entry.confidence !== 'exact' || rejects.ids.has(id)) continue;
    const kept = withoutRejected(entry, rejects);
    if (hasPayload(kept)) out[id] = kept;
  }
  return out;
}

// ---- HTTP --------------------------------------------------------------------------------------------
function retryDelay(res, attempt) {
  const header = res.headers?.get?.('retry-after');
  let ms = NaN;
  if (header != null && header !== '') ms = /^\d+(\.\d+)?$/.test(header.trim()) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  if (!Number.isFinite(ms) || ms < 0) ms = 2000 * 2 ** attempt;
  return Math.min(30000, Math.max(500, ms));
}

// Release an unread body so the connection is not held open.
const discard = (res) => { try { res.body?.cancel?.()?.catch?.(() => {}); } catch { /* already consumed */ } };

/** Per-run JSON client: timeout on every request, at most 3 retries on 429, and a per-host breaker. */
function createClient({ fetchImpl, sleep, timeoutMs, log }) {
  const failures = new Map();
  const disabled = new Set();
  const client = { errors: 0, disabled, hostErrors: new Map() };
  const count = (host) => { client.errors++; client.hostErrors.set(host, (client.hostErrors.get(host) || 0) + 1); };
  const fail = (host, reason) => {
    count(host);
    const n = (failures.get(host) || 0) + 1;
    failures.set(host, n);
    if (n >= HOST_FAILURE_LIMIT && !disabled.has(host)) {
      disabled.add(host);
      log(`[artwork] ${host}: ${n} failures in a row (last: ${reason}); skipping it for the rest of this run`);
    }
    return new Error(`${host} ${reason}`);
  };
  client.getJson = async (url, headers = {}) => {
    const host = new URL(url).host;
    if (disabled.has(host)) { count(host); throw new Error(`${host} skipped`); }
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        throw fail(host, e?.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms` : e?.message || 'network error');
      }
      if (res.status === 429 && attempt < MAX_429_RETRIES) { discard(res); await sleep(retryDelay(res, attempt)); continue; }
      if (res.status === 404) { discard(res); failures.set(host, 0); return null; }
      if (!res.ok) { discard(res); throw fail(host, `HTTP ${res.status}`); }
      try {
        const body = await res.json();
        failures.set(host, 0);
        return body;
      } catch (e) { throw fail(host, e?.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms` : 'invalid JSON'); }
    }
  };
  return client;
}

/** Highest-scoring candidate; two different programmes with the same exact title are only fuzzy. */
function pickBest(candidates, threshold) {
  const exactIds = new Set(candidates.filter((c) => c.confidence === 'exact').map((c) => c.id));
  const pool = candidates
    .map((c) => (c.confidence === 'exact' && exactIds.size > 1 ? { ...c, confidence: 'fuzzy' } : c))
    .filter((c) => c.confidence === 'exact' || c.score >= threshold)
    .sort((a, b) => (b.confidence === 'exact') - (a.confidence === 'exact') || b.score - a.score);
  return pool[0] || null;
}

// ---- TMDB --------------------------------------------------------------------------------------------
const TMDB_HOST = 'api.themoviedb.org';
async function tmdb(ctx, path, params) {
  const url = new URL(`https://${TMDB_HOST}/3${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  const headers = {};
  if (ctx.key.startsWith('eyJ')) headers.authorization = `Bearer ${ctx.key}`; else url.searchParams.set('api_key', ctx.key);
  return ctx.getJson(url.toString(), headers);
}
const tmdbEntry = (h, kind, lang, extra) => ({
  source: 'tmdb', tmdbId: h.id, kind, name: h.name || h.title,
  poster: h.poster_path ? `${IMG}/w500${h.poster_path}` : null,
  backdrop: h.backdrop_path ? `${IMG}/w1280${h.backdrop_path}` : null,
  overview: h.overview && h.overview.length > 40 ? decode(h.overview) : null, overviewLang: lang.slice(0, 2),
  ...extra,
});

/** TMDB id published by the provider itself (fmovies ids are TMDB ids); never one we matched ourselves. */
function providerTmdbId(show) {
  if (/^fm:[ms]:/.test(show.id || '')) return Number(show.tmdbId) || Number(/^fm:[ms]:(\d+)/.exec(show.id)?.[1]) || null;
  return Number((show.offerings || []).find((o) => o?.provider === 'fmovies' && o.tmdbId)?.tmdbId) || null;
}

async function fromTmdbId(ctx, show) {
  const id = ctx.key ? providerTmdbId(show) : null;
  if (!id) return null;
  const kind = show.kind === 'film' ? 'movie' : 'tv';
  const lang = sectionLang(show) === 'en' ? 'en-US' : 'ar';
  const h = await tmdb(ctx, `/${kind}/${id}`, { language: lang });
  if (!h?.id) return null;
  return tmdbEntry(h, kind, lang, { score: 1, confidence: 'exact', via: 'provider-id' });
}

async function fromTmdb(ctx, show, queries) {
  if (!ctx.key) return null;
  const lang = sectionLang(show) === 'en' ? 'en-US' : 'ar';
  const kinds = show.kind === 'film' ? ['movie', 'tv'] : ['tv', 'movie'];
  const candidates = [];
  const done = () => candidates.some((c) => c.confidence === 'exact');
  for (const kind of kinds) {
    for (const q of queries.slice(0, 3)) {
      const r = await tmdb(ctx, `/search/${kind}`, { query: q, language: lang, include_adult: 'false' }).catch(() => null);
      for (const hit of (r?.results || []).slice(0, 5)) {
        const name = hit.name || hit.title || '';
        const orig = hit.original_name || hit.original_title || '';
        const hitYear = yearOf(hit.first_air_date || hit.release_date);
        const genres = hit.genre_ids || [];
        const confidence = matchConfidence(show, { query: q, names: [name, orig], kind: kind === 'movie' ? 'film' : 'series', year: hitYear, typeOk: genres.some((g) => TMDB_DOC_GENRES.has(g)) });
        if (!confidence) continue;
        const showYear = Number(show.year) || yearOf(show.firstAt);
        const score = Math.max(similarity(q, name), similarity(q, orig)) + (hitYear && showYear && Math.abs(hitYear - showYear) <= 2 ? 0.05 : 0) + (genres.includes(99) ? 0.05 : 0);
        candidates.push({ id: `${kind}:${hit.id}`, kind, hit, confidence, score });
      }
      if (done()) break;
    }
    if (done()) break;
  }
  const best = pickBest(candidates, 0.82);
  return best ? tmdbEntry(best.hit, best.kind, lang, { score: round(best.score), confidence: best.confidence }) : null;
}

// ---- TVmaze (English-titled series) ------------------------------------------------------------------
async function fromTvmaze(ctx, show, query) {
  if (show.kind !== 'series' || !query || hasArabic(query)) return null;
  const r = await ctx.getJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
  const candidates = [];
  for (const row of Array.isArray(r) ? r : []) {
    const s = row?.show;
    if (!s?.name || TVMAZE_REJECT_TYPES.has(s.type)) continue; // dramas, cartoons, variety shows
    const confidence = matchConfidence(show, { query, names: [s.name], kind: 'series', year: yearOf(s.premiered), typeOk: TVMAZE_DOC_TYPES.has(s.type) });
    if (!confidence) continue;
    const score = similarity(query, s.name) + (s.type === 'Documentary' || (s.genres || []).includes('Nature') ? 0.05 : 0);
    candidates.push({ id: s.id, s, confidence, score });
  }
  const best = pickBest(candidates, 0.86);
  if (!best) return null;
  const s = best.s;
  const summary = decode(stripHtml(s.summary || ''));
  return {
    source: 'tvmaze', tvmazeId: s.id, score: round(best.score), name: s.name, confidence: best.confidence,
    tvmazeType: s.type || null, premiered: s.premiered || null,
    poster: s.image?.original || s.image?.medium || null, backdrop: null,
    overview: summary.length > 40 ? summary : null, overviewLang: 'en',
  };
}

// ---- Wikidata bridge (Arabic dub title -> English programme name -> TVmaze) --------------------------
async function fromWikidata(ctx, show, query) {
  if (show.kind !== 'series' || !hasArabic(query)) return null;
  const r = await ctx.getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=ar&uselang=en&type=item&limit=5&format=json`);
  const items = (r?.search || []).filter((h) => {
    const d = h.description || '';
    return h.label && !hasArabic(h.label) && /television|tv series|documentary|programme|program|series/i.test(d)
      && !NOT_DOCUMENTARY.test(d) && kindFromText(d) !== 'film';
  });
  for (const item of items.slice(0, 2)) {
    const en = await fromTvmaze(ctx, show, item.label);
    if (!en) continue;
    // Exact only when the Arabic label/alias Wikidata matched is the show's own title.
    const labelExact = !!item.match?.text && titleKey(item.match.text) === titleKey(query);
    return { ...en, source: 'wikidata+tvmaze', via: item.label, wikidataId: item.id, overview: null, overviewLang: 'en', confidence: en.confidence === 'exact' && labelExact ? 'exact' : 'fuzzy' };
  }
  return null;
}

// ---- Wikipedia (ar / en / fr) ------------------------------------------------------------------------
async function fromWikipedia(ctx, show, query) {
  const langs = show.contentLang === 'fr' ? ['fr', 'en'] : sectionLang(show) === 'en' ? ['en'] : ['ar', 'en'];
  let fuzzy = null;
  for (const wl of langs) {
    const q = `${query}${wl === 'ar' ? ' وثائقي' : ' documentary'}`;
    const r = await ctx.getJson(`https://${wl}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=4&format=json`).catch(() => null);
    for (const hit of r?.query?.search || []) {
      const pageTitle = hit.title || '';
      const base = pageTitle.replace(/\s*\(.*?\)\s*$/, '');
      const disambiguator = /\(([^)]*)\)\s*$/.exec(pageTitle)?.[1] || '';
      const score = similarity(query, base);
      if (score < 0.8) continue;
      const sum = await ctx.getJson(`https://${wl}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`).catch(() => null);
      if (!sum || sum.type === 'disambiguation') continue;
      const description = sum.description || '';
      const lead = String(sum.extract || '').split(/(?<=[.!؟?])\s/)[0] || '';
      if (!DOC_WORDS.test(description || lead)) continue; // same name, unrelated topic (a platform, a person, a place)
      const kind = kindFromText(disambiguator) || kindFromText(description) || kindFromText(lead);
      if (kind && kind !== show.kind) continue; // e.g. a 1925 film page for a 70-episode series
      const confidence = matchConfidence(show, { query, names: [base], kind, year: yearIn(disambiguator) || yearIn(description), typeOk: kind === show.kind });
      if (!confidence) continue;
      const overviewLang = wl === 'ar' ? 'ar' : 'en';
      const usable = (sectionLang(show) === 'en' ? overviewLang === 'en' : overviewLang === 'ar') && (sum.extract || '').length > 60;
      const entry = {
        source: 'wikipedia', wiki: `${wl}:${pageTitle}`, score: round(score), name: pageTitle, confidence,
        poster: usableWikiImage(sum.originalimage) || usableWikiImage(sum.thumbnail), backdrop: null,
        overview: usable ? sum.extract : null, overviewLang,
      };
      if (!hasPayload(entry)) continue;
      if (confidence === 'exact') return entry;
      fuzzy = fuzzy || entry;
    }
    await ctx.sleep(100);
  }
  return fuzzy;
}

// ---- lookup ------------------------------------------------------------------------------------------
/** The show's title, curated overrides aliases that point at it, then alternative titles. */
function queryTitles(show, aliases = {}) {
  const primary = clean(show.title);
  const targets = new Set([normalizeArabic(show.title || ''), normalizeArabic(primary)]);
  const fromAliases = Object.entries(aliases || {}).filter(([, to]) => targets.has(normalizeArabic(to))).map(([from]) => clean(from));
  const channelNames = new Set([show.channel?.title, show.channel?.short].filter(Boolean).map((t) => normalizeArabic(t)));
  const alt = (show.altTitles || []).map(clean).filter((t) => !channelNames.has(normalizeArabic(t)));
  return [...new Set([primary, ...fromAliases, ...alt].filter((t) => t && normalizeArabic(t).length >= 3))].slice(0, 4);
}

async function lookup(ctx, show) {
  const queries = queryTitles(show, ctx.aliases);
  if (!queries.length) return null;
  const latin = queries.filter((q) => !hasArabic(q)).slice(0, 2);
  const arabic = queries.filter((q) => hasArabic(q)).slice(0, 1);
  const steps = [
    () => fromTmdbId(ctx, show),
    () => fromTmdb(ctx, show, queries),
    ...latin.map((q) => () => fromTvmaze(ctx, show, q)),
    ...arabic.map((q) => () => fromWikidata(ctx, show, q)),
    () => fromWikipedia(ctx, show, queries[0]),
  ];
  let fuzzy = null;
  for (const step of steps) {
    const hit = withoutRejected(await step().catch(() => null), ctx.rejects);
    if (!hasPayload(hit)) continue;
    if (hit.confidence === 'exact') return hit;
    fuzzy = fuzzy || hit; // kept for diagnostics; only exact entries reach the catalogue
  }
  return fuzzy;
}

// ---- queue -------------------------------------------------------------------------------------------
const realSynopsis = (s) => !!String(s.synopsis || '').trim() && s.synopsisGenerated !== true;
const providerCover = (s) => (isProviderRow(s)
  ? !!(s.portrait || s.poster?.custom)
  : !!s.portrait && !!s.posterVideoId && !YOUTUBE_ID.test(s.posterVideoId));
/** A provider cover is never replaced, so with a real synopsis there is nothing left to add. */
const canUseArtwork = (s) => !(providerCover(s) && realSynopsis(s));
const freshness = (s) => Date.parse(s.latestAt || s.firstSeenAt || s.providerUpdatedAt || s.firstAt || '') || 0;

/** 0 never looked up, 1 looked up under older rules or before TMDB was available, 2 due again, null not due. */
function dueTier(entry, { now, key }) {
  if (!entry) return 0;
  // A lookup that hit failing sources keeps its old entry; wait a day so it cannot crowd every run.
  if (entry.attemptedAt && now - (Date.parse(entry.attemptedAt) || 0) < DAY) return null;
  const age = now - (Date.parse(entry.checkedAt || '') || 0);
  if (entry.source && entry.v !== RULES_VERSION) return 1;
  if (key && !entry.tmdbChecked && age > DAY) return 1;
  const days = entry.confidence === 'exact' ? RECHECK_DAYS.exact : entry.incomplete ? RECHECK_DAYS.incomplete : RECHECK_DAYS.miss;
  return age > days * DAY ? 2 : null;
}

let lastRun = null;
/** Counters of the last enrichArtwork run (changed = shows whose usable artwork changed). */
export function artworkRunSummary() { return lastRun; }
/** Sources the chain can use in this environment, for status reporting. */
export function artworkSources() { return [...(envTmdbKey() ? ['tmdb'] : []), 'tvmaze', 'wikidata', 'wikipedia']; }

/**
 * Look up artwork for shows that have none yet or are due a re-check: never-checked titles first, newest
 * first, at most ARTWORK_MAX_PER_RUN per run and ARTWORK_MAX_MINUTES of wall time. Matches are re-checked
 * after 90 days, misses and fuzzy matches after 30 (3 when a source failed during the lookup).
 * Returns the usable (exact, not rejected) artwork map the catalogue builder applies.
 */
export async function enrichArtwork(shows, {
  log = console.log, fetch: fetchImpl = globalThis.fetch, sleep = realSleep, tmdbKey = envTmdbKey(),
  maxPerRun = MAX_PER_RUN, maxMinutes = MAX_MINUTES, timeoutMs = TIMEOUT_MS, aliases,
} = {}) {
  if (!artworkEnabled()) return getArtwork();
  const started = Date.now();
  if (!tmdbKey) {
    const msg = 'TMDB_API_KEY is not set: TMDB artwork lookups are disabled for this run (no backdrops or TMDB overviews); continuing with TVmaze, Wikidata and Wikipedia';
    log(process.env.GITHUB_ACTIONS === 'true' ? `::warning::${msg}` : `[artwork] warning: ${msg}`);
  }
  const art = load();
  const rejects = loadRejects();
  const client = createClient({ fetchImpl, sleep, timeoutMs, log });
  const ctx = { key: tmdbKey, getJson: client.getJson, sleep, rejects, aliases: aliases ?? readJson('overrides.json', {})?.aliases ?? {} };

  const seen = new Set();
  const queue = [];
  for (const s of shows || []) {
    if (!s?.id || seen.has(s.id)) continue;
    seen.add(s.id);
    if (rejects.ids.has(s.id) || !canUseArtwork(s) || !queryTitles(s, ctx.aliases).length) continue;
    const tier = dueTier(art[s.id], { now: started, key: tmdbKey });
    if (tier != null) queue.push({ s, tier });
  }
  queue.sort((a, b) => a.tier - b.tier || freshness(b.s) - freshness(a.s) || (b.s.episodeCount || 0) - (a.s.episodeCount || 0));
  const batch = queue.slice(0, Math.max(0, maxPerRun));
  const run = { due: queue.length, looked: 0, matched: 0, exact: 0, changed: 0, incomplete: 0, timedOut: false, tmdb: !!tmdbKey };
  lastRun = run;
  if (!batch.length) return getArtwork();

  const deadline = started + maxMinutes * 60e3;
  const usable = (e) => JSON.stringify(e?.source && e.confidence === 'exact' ? withoutRejected(e, rejects) : null);
  for (const { s } of batch) {
    if (Date.now() > deadline) { run.timedOut = true; log(`[artwork] stopping after ${maxMinutes} min; the rest waits for the next run`); break; }
    const errorsBefore = client.errors;
    const tmdbErrorsBefore = client.hostErrors.get(TMDB_HOST) || 0;
    let hit = null;
    try { hit = await lookup(ctx, s); } catch (e) { log(`[artwork] ${s.title}: ${e.message}`); }
    const incomplete = client.errors > errorsBefore;
    const before = usable(art[s.id]);
    const now = new Date().toISOString();
    const stamp = { checkedAt: now, v: RULES_VERSION, tmdbChecked: !!tmdbKey && (client.hostErrors.get(TMDB_HOST) || 0) === tmdbErrorsBefore };
    if (hit) art[s.id] = { ...hit, ...stamp };
    else if (incomplete && art[s.id]?.source) art[s.id] = { ...art[s.id], attemptedAt: now }; // a source failed: keep the old match
    else art[s.id] = { ...stamp, ...(incomplete ? { incomplete: true } : {}) };
    run.looked++;
    if (hit) run.matched++;
    if (hit?.confidence === 'exact') run.exact++;
    if (incomplete) run.incomplete++;
    if (usable(art[s.id]) !== before) run.changed++;
    if (run.looked % SAVE_EVERY === 0) save();
    await sleep(150);
  }
  save();
  const view = getArtwork();
  log(`[artwork] looked up ${run.looked} of ${run.due} due shows, matched ${run.matched} (${run.exact} exact, ${run.changed} changed${run.incomplete ? `, ${run.incomplete} incomplete` : ''}); ${Object.keys(view).length} shows have exact artwork; sources: ${tmdbKey ? 'tmdb, ' : ''}tvmaze, wikidata, wikipedia`);
  return view;
}

/** Usable artwork keyed by show id: exact matches only, minus rejected shows and rejected images. */
export function getArtwork() { return usableView(load(), loadRejects()); }

/**
 * Apply an exact artwork entry to a provider-only row (fmovies/hdtoday): fills an empty synopsis and a
 * missing portrait, never replaces the provider's own cover.
 */
export function applyProviderArtwork(row, entry) {
  if (!row || !entry?.source || entry.confidence !== 'exact') return row;
  const out = { ...row };
  if (!String(row.synopsis || '').trim() && entry.overview && entry.overviewLang === 'en') { out.synopsis = entry.overview; out.synopsisSource = entry.source; }
  if (!row.portrait && entry.poster) out.portrait = entry.poster;
  if (!row.poster && (entry.poster || entry.backdrop)) out.poster = { custom: entry.poster || entry.backdrop };
  return out;
}
