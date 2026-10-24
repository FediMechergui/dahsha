// Poster / synopsis enrichment, matched by title (or by a provider's own TMDB id), from (in order):
//   1. TMDB      (needs TMDB_API_KEY; backdrop + portrait poster + overview, ar/en)
//   2. TVmaze    (no key; English-titled series: portrait poster + summary)
//   3. Wikidata  (no key; Arabic dub title -> English programme name -> TVmaze)
//   4. Wikipedia (no key; ar / en / fr: page image + extract)
// Every cached entry carries `confidence`: 'exact' only for the same normalised title, the same kind
// (film/series), a documentary-type programme, a compatible year, no same-title namesake, and (for a
// channel that uploads its own programmes) no other broadcaster named; anything looser is 'fuzzy' and is
// never handed to the catalogue. Results are cached in server/data/artwork.json, which is pruned to live
// show ids (versions and matched provider rows included) and catalogue id aliases on save. Show ids or image URLs listed in
// server/data/artwork-rejects.json are never used. YouTube thumbnails remain the fallback.
import { readJson, writeJson } from './store.js';
import * as text from './text.js';

const { normalizeArabic, similarity, hasArabic } = text;

const IMG = 'https://image.tmdb.org/t/p';
const DEFAULT_MAX_PER_RUN = 600;
const DEFAULT_MAX_MINUTES = 30;
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_429_RETRIES = 3;
const HOST_FAILURE_LIMIT = 5; // consecutive failures before a host is skipped for the rest of the run
const RULES_VERSION = 3; // bump when the matching rules change so cached matches are looked up again
// Since v2 the rules only got stricter (bar a longer Wikipedia lead when a page has no description): a v2+ miss or
// fuzzy entry cannot turn exact, so a bump re-checks exact ones only; misses come back on their 7/30/90-day schedule.
const STRICT_SINCE = 2;
const RECHECK_DAYS = { exact: 90, incomplete: 3 };
const MISS_RETRY_DAYS = [7, 30, 90]; // after the 1st, 2nd and 3rd+ lookup in a row without an exact match
const LEGACY_MISSES = 2; // misses cached before they were counted keep the old 30-day cadence
const RETRY_JITTER = 0.5; // up to +50% of the interval, fixed per show id, so one batch never comes back as one wave
const PRUNE_MAX_SHARE = 0.2; // a save never drops more than this share of artwork.json (a partial show list)…
const PRUNE_MIN = 20; // …unless only a handful of keys are involved
const SAVE_EVERY = 25;
const UA = 'Dahsha/1.0 (https://dahsha.netlify.app; documentary catalogue)';
const DAY = 864e5;
export const ARTWORK_RULES_VERSION = RULES_VERSION;

export const artworkEnabled = () => process.env.ARTWORK !== '0';
const envTmdbKey = () => process.env.TMDB_API_KEY || '';

/** A non-negative whole number from an option or, failing that, the environment; junk ("1,500", "abc") warns and falls back. */
function limitOf(value, envName, fallback, log) {
  const raw = value ?? process.env[envName];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  log?.(`[artwork] warning: ${value != null ? 'limit' : envName} ${JSON.stringify(String(raw))} is not a number; using ${fallback}`);
  return fallback;
}

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
const sameTitle = (a, b) => { const k = titleKey(a); return !!k && k === titleKey(b); };

const toLatinDigits = (s = '') => String(s).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
const yearOf = (v) => {
  const m = /(\d{4})/.exec(toLatinDigits(v ?? ''));
  const y = m ? Number(m[1]) : NaN;
  return y >= 1880 && y <= 2100 ? y : null;
};
const yearIn = (s = '') => { const m = /\b(18[89]\d|19\d\d|20\d\d)\b/.exec(toLatinDigits(s)); return m ? Number(m[1]) : null; };
const stripHtml = (s = '') => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const round = (n) => Math.round(n * 100) / 100;
/** The opening sentence, at least 80 characters of it, so "P.S. Jerusalem is a…" or "Who Killed the Electric Car? is a…" keep their "is a…" part. */
function leadOf(s = '') {
  let out = '';
  for (const part of String(s || '').split(/(?<=[.!؟?])\s/)) { out = out ? `${out} ${part}` : part; if (out.length >= 80) break; }
  return out;
}
const disambiguatorOf = (pageTitle = '') => /\(([^)]*)\)\s*$/.exec(pageTitle)?.[1] || '';

const DOC_WORDS = /وثائقي|مسلسل|برنامج|سلسلة|فيلم|documentary|series|television|tv|film|show|programme|program|émission|série|documentaire/i;
const FILM_WORDS = /فيلم|فلم|\bfilms?\b|\bmovie\b|long[- ]métrage/i;
const SERIES_WORDS = /مسلسل|سلسلة|برنامج|\bseries\b|\bserial\b|\btelevision\b|\btv\b|\bprogramme\b|\bprogram\b|\bdocuseries\b|\bminiseries\b|émission|\bsérie\b/i;
// Wikidata descriptions of programmes Dahsha never carries (the Lion Guard / The Affair class of mistakes).
const NOT_DOCUMENTARY = /animated|animation|cartoon|\banime\b|\bdrama\b|sitcom|\bsoap\b|telenovela|\bcomedy\b/i;
// The same in Arabic Wikipedia descriptions and leads ("مسلسل تلفزيوني تركي", "المسلسل التركي الدرامي").
const NOT_DOCUMENTARY_AR = /دراما|درامي|كوميدي|كوميديا|رسوم متحركة|كرتون|أنمي|انمي|سيتكوم|تمثيلي|(?:^|[\s،,.(«"])(?:ال)?تركي[ةه]?(?=$|[\s،,.)»"])/;
// A Wikipedia page counts as a documentary-type programme only when it says so.
const DOC_TYPE = /وثائقي|documentar|docu-?series|docu-?drama|documentaire|reality (?:television|tv|series|show|competition)|تلفزيون الواقع|\bfactual\b/i;
const notDocumentary = (s = '') => (NOT_DOCUMENTARY.test(s) || NOT_DOCUMENTARY_AR.test(s)) && !DOC_TYPE.test(s);
const TVMAZE_DOC_TYPES = new Set(['Documentary', 'Reality', 'News']);
const TVMAZE_REJECT_TYPES = new Set(['Scripted', 'Animation', 'Variety']);
const TMDB_DOC_GENRES = new Set([99, 10763, 10764]); // Documentary, News, Reality
// A same-title TMDB title counts as a namesake only when it could itself be the programme: documentary, news,
// reality (game shows) or talk. Dramas, cartoons and other fiction are not counted, as TVmaze's Scripted/Animation/
// Variety types and Wikipedia's drama/cartoon pages are not (Home 2009 vs the 1954 drama, Life 2009 vs NBC's Life).
const TMDB_NAMESAKE_GENRES = new Set([...TMDB_DOC_GENRES, 10767]);

/** 'film' | 'series' | null from a page title disambiguator or description. */
function kindFromText(s = '') {
  const film = FILM_WORDS.test(s), series = SERIES_WORDS.test(s);
  return film && !series ? 'film' : series && !film ? 'series' : null;
}

// A provider-only row (artwork applied by provider-sync). An s_ show is built from YouTube/Myflixer playlists and
// gets its artwork in buildCatalog even when a provider row merged into it (the card then carries channelId 'fmovies').
const isProviderRow = (s) => /^(fm|hd):/.test(s.id || '') || (!/^s_/.test(s.id || '') && (s.channelId === 'fmovies' || s.channelId === 'hdtoday'));
const isMyflixer = (s) => s.channel?.id === 'myflixer' || s.channelId === 'myflixer' || /^mf:/.test(s.posterVideoId || '');
// Provider rows are exported in the English section whatever their raw lang field says.
const sectionLang = (s) => (isProviderRow(s) || s.lang === 'en' ? 'en' : 'ar');
const YOUTUBE_ID = /^[\w-]{11}$/;

// ---- broadcasters ----------------------------------------------------------------------------------
// Networks a TVmaze entry or a Wikipedia lead can name ("premiered on the History Channel", "developed for
// Freeform"). Regex fragments; prose is matched case-sensitively, TVmaze network names case-insensitively.
const NETWORKS = {
  vice: ['VICE News', 'VICE TV', 'VICE Media', 'VICE Studios', 'Vice News', 'Vice TV', 'Vice Media', 'Vice Studios', 'Viceland', 'VICELAND', 'VICE'],
  hbo: ['HBO Max', 'HBO Documentary Films', 'HBO'],
  showtime: ['Showtime'],
  discovery: ['Discovery Channel', 'Discovery\\+', 'Discovery Plus', 'Discovery Science', 'Discovery Life', 'Discovery Family', 'Discovery Turbo', 'Discovery Canada', 'Discovery UK', 'Discovery', 'TLC', 'Animal Planet', 'Science Channel', 'Investigation Discovery', 'Travel Channel', 'HGTV', 'Food Network', 'MotorTrend', 'Motor Trend', 'Destination America', 'American Heroes Channel', 'DMAX'],
  natgeo: ['National Geographic Channel', 'National Geographic Wild', 'National Geographic', 'Nat Geo Wild', 'Nat Geo WILD', 'Nat Geo', 'NatGeo'],
  disney: ['Disney\\+', 'Disney Plus', 'Disney Channel', 'Disneynature'],
  history: ['The History Channel', 'History Channel', 'HISTORY', 'History(?! of\\b)', 'H2', 'A&E', 'Lifetime(?! Achievement)', 'FYI'],
  pbs: ['PBS Kids', 'PBS', 'FRONTLINE', 'Frontline', 'NOVA', 'American Experience', 'Independent Lens', 'WGBH', 'GBH'],
  bbc: ['BBC One', 'BBC Two', 'BBC Three', 'BBC Four', 'BBC Earth', 'BBC America', 'BBC Scotland', 'BBC World News', 'BBC iPlayer', 'BBC'],
  netflix: ['Netflix'], amazon: ['Amazon Prime Video', 'Amazon Prime', 'Amazon Studios', 'Prime Video'], apple: ['Apple TV\\+', 'Apple TV Plus'],
  hulu: ['Hulu'], freeform: ['Freeform', 'ABC Family'], abc: ['ABC'], nbc: ['NBC'], cbs: ['CBS'], fox: ['FOX', 'Fox'], cw: ['The CW'],
  peacock: ['Peacock'], paramount: ['Paramount\\+', 'Paramount Network'], mtv: ['MTV'], vh1: ['VH1'], comedycentral: ['Comedy Central'],
  spike: ['Spike TV'], bravo: ['Bravo'], e: ['E!'], oxygen: ['Oxygen'], trutv: ['truTV', 'TruTV'], usa: ['USA Network'], syfy: ['Syfy'],
  tbs: ['TBS'], amc: ['AMC'], fx: ['FX'], starz: ['Starz'], cnn: ['CNN'], cnbc: ['CNBC'], msnbc: ['MSNBC'],
  itv: ['ITV'], channel4: ['Channel 4', 'More4', 'E4'], channel5: ['Channel 5'], sky: ['Sky One', 'Sky Atlantic', 'Sky Documentaries', 'Sky Nature', 'Sky History', 'Sky Arts'],
  cbc: ['CBC'], sbs: ['SBS'], aljazeera: ['Al Jazeera English', 'Al Jazeera'], dw: ['Deutsche Welle', 'DW'], zdf: ['ZDF'], arte: ['ARTE', 'Arte'],
  france: ['France [235]', 'Canal\\+'], viaplay: ['Viaplay'], smithsonian: ['Smithsonian Channel'], curiosity: ['CuriosityStream', 'Curiosity Stream'],
  youtube: ['YouTube Premium', 'YouTube Originals', 'YouTube Red'],
};
// TVmaze network names that are ordinary words in prose.
const TVMAZE_ONLY = { discovery: ['Science'], spike: ['Spike'], tnt: ['TNT'] };
const FAMILY_RES = Object.keys({ ...NETWORKS, ...TVMAZE_ONLY }).map((family) => [family, new RegExp(`^(?:${[...(NETWORKS[family] || []), ...(TVMAZE_ONLY[family] || [])].join('|')})$`, 'i')]);
const nameLength = (fragment) => fragment.replace(/\(\?[!=][^)]*\)/g, '').replace(/\\/g, '').length; // longest name first
const PROSE_NAMES = Object.values(NETWORKS).flat().sort((a, b) => nameLength(b) - nameLength(a)).join('|');
const END = '(?![\\p{L}\\p{N}])';
const PROSE_NETWORK = [
  new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:on|for|by|via|from)\\s+(?:the\\s+)?(${PROSE_NAMES})${END}`, 'gu'),
  new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:[Aa]n?|[Tt]he)\\s+(${PROSE_NAMES})(?:'s)?\\s+(?:original|documentary|docuseries|docu-series|series|miniseries|production|special|programme|program|show)${END}`, 'gu'),
];
/** Network family of a broadcaster name; unknown names are their own family. */
export function networkFamily(name = '') {
  const n = String(name).trim();
  return FAMILY_RES.find(([, re]) => re.test(n))?.[0] || `other:${n.toLowerCase()}`;
}
/** Broadcasters a Wikipedia description or lead names as the programme's network ("aired on BBC Two"). */
export function namedNetworks(s = '') {
  const found = new Set();
  for (const re of PROSE_NETWORK) for (const m of String(s || '').matchAll(re)) found.add(m[1]);
  return [...found];
}

// English channels that upload their own programmes (an acquired title on them is rare) and the families
// their programmes premiere on. Arabic dub channels and aggregators (Al Jazeera, DW, Free Documentary,
// WELT, Curiosity Stream, Myflixer, fmovies/hdtoday) carry other networks' programmes, so they are exempt.
const OWN_CHANNELS = [
  [/^vice\b/i, ['vice', 'hbo', 'showtime']],
  [/^discovery(?: channel)?$/i, ['discovery']],
  [/^history$/i, ['history']],
  [/frontline|^pbs\b/i, ['pbs']],
  [/^(?:national geographic|nat ?geo)\b/i, ['natgeo', 'disney', 'hulu']],
];
function ownNetworks(show) {
  if (!show || sectionLang(show) !== 'en' || isProviderRow(show) || isMyflixer(show)) return null;
  const ch = show.channel || {};
  if ((ch.profile || show.profile) === 'creator') return new Set(['creator']); // a creator's own video: any broadcaster named is someone else's
  const own = OWN_CHANNELS.find(([re]) => [ch.title, ch.short].some((t) => t && re.test(String(t).trim())));
  return own ? new Set(own[1]) : null;
}
/** True when the candidate names broadcasters and none of them is the uploading channel's own (VICE News vs History). */
export function networkConflict(show, names = []) {
  const own = ownNetworks(show);
  if (!own) return false;
  const named = new Set(names.filter((n) => n && String(n).trim()).map(networkFamily));
  return named.size > 0 && ![...named].some((f) => own.has(f));
}
/** The candidate names the uploading channel's own network (a History Channel page for a HISTORY upload). */
const networkMatch = (show, names = []) => { const own = ownNetworks(show); return !!own && names.some((n) => n && own.has(networkFamily(n))); };
/** A dated provider row and a page of the same year (within 1): the same work, whatever genre words it uses. */
const datedMatch = (show, year) => !!(Number(show.year) && year && Math.abs(Number(show.year) - year) <= 1);

/**
 * Confidence of a candidate match: 'exact', 'fuzzy', or null when it must be rejected.
 * exact = same normalised title AND same kind AND documentary-type AND a compatible year: within 1 of the
 * show's own year, or (YouTube/Myflixer shows without a year) premiered no later than the first upload;
 * and, for a channel that uploads its own programmes, no other broadcaster named (`networks`).
 */
export function matchConfidence(show, { query, names = [], kind = null, year = null, typeOk = false, networks = [] } = {}) {
  const first = yearOf(show.firstAt);
  if (year && first && first < year - 1) return null; // uploaded before this programme premiered
  const target = titleKey(query || show.title);
  const same = !!target && names.some((n) => n && titleKey(n) === target);
  const showYear = Number(show.year) || null;
  const yearOk = !year || (showYear ? Math.abs(showYear - year) <= 1 : first ? year <= first : true);
  return same && kind === show.kind && typeOk && yearOk && !networkConflict(show, networks) ? 'exact' : 'fuzzy';
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
const isExact = (a) => !!(a?.source && a.confidence === 'exact');

function usableView(art, rejects) {
  const out = {};
  for (const [id, entry] of Object.entries(art)) {
    if (!isExact(entry) || rejects.ids.has(id)) continue;
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

/**
 * Highest-scoring candidate. Two different programmes with the show's title are only fuzzy, whatever
 * non-fiction type the other one has (BattleBots: the 2000 Reality series and the 2015 Game Show); each
 * source leaves dramas and cartoons out of its candidates or namesakes.
 */
function pickBest(candidates, threshold) {
  const namesakes = new Set(candidates.filter((c) => c.confidence === 'exact' || c.namesake).map((c) => c.id));
  const pool = candidates
    .map((c) => (c.confidence === 'exact' && namesakes.size > 1 ? { ...c, confidence: 'fuzzy', namesakes: namesakes.size } : c))
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

/**
 * Broadcasters a TMDB details record names: its networks (tv) and those of its production companies that are
 * known broadcasters (HBO Documentary Films, VICE Studios); other studios are not networks.
 */
function tmdbNetworks(h) {
  const networks = (h?.networks || []).map((n) => n?.name);
  const companies = (h?.production_companies || []).map((c) => c?.name).filter((n) => n && !networkFamily(n).startsWith('other:'));
  return [...new Set([...networks, ...companies].filter((n) => typeof n === 'string' && n.trim()))];
}

/**
 * The network rule for a TMDB search hit (search results name no broadcaster): for a channel that uploads its
 * own programmes, an exact candidate is confirmed against its details record, and is only fuzzy when that names
 * another broadcaster or cannot be fetched (the failed request also marks the lookup incomplete).
 */
async function checkTmdbNetworks(ctx, show, candidate, lang) {
  candidate.networkChecked = true;
  const h = await tmdb(ctx, `/${candidate.kind}/${candidate.hit.id}`, { language: lang }).catch(() => null);
  if (!h?.id) { candidate.confidence = 'fuzzy'; return; }
  candidate.networks = tmdbNetworks(h);
  if (networkConflict(show, candidate.networks)) candidate.confidence = 'fuzzy';
}

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
  // The provider's id names the provider row's title, which may have merged into another broadcaster's upload.
  const networks = tmdbNetworks(h);
  return tmdbEntry(h, kind, lang, { score: 1, confidence: networkConflict(show, networks) ? 'fuzzy' : 'exact', via: 'provider-id', networks });
}

async function fromTmdb(ctx, show, queries) {
  if (!ctx.key) return null;
  const lang = sectionLang(show) === 'en' ? 'en-US' : 'ar';
  const kinds = show.kind === 'film' ? ['movie', 'tv'] : ['tv', 'movie'];
  const candidates = [];
  const done = () => candidates.some((c) => c.confidence === 'exact');
  const ownChannel = !!ownNetworks(show);
  for (const kind of kinds) {
    for (const q of queries.slice(0, 3)) {
      const r = await tmdb(ctx, `/search/${kind}`, { query: q, language: lang, include_adult: 'false' }).catch(() => null);
      for (const hit of (r?.results || []).slice(0, 5)) {
        const name = hit.name || hit.title || '';
        const orig = hit.original_name || hit.original_title || '';
        const hitYear = yearOf(hit.first_air_date || hit.release_date);
        const genres = hit.genre_ids || [];
        const hitKind = kind === 'movie' ? 'film' : 'series';
        const confidence = matchConfidence(show, { query: q, names: [name, orig], kind: hitKind, year: hitYear, typeOk: genres.some((g) => TMDB_DOC_GENRES.has(g)) });
        if (!confidence) continue;
        const showYear = Number(show.year) || yearOf(show.firstAt);
        const score = Math.max(similarity(q, name), similarity(q, orig)) + (hitYear && showYear && Math.abs(hitYear - showYear) <= 2 ? 0.05 : 0) + (genres.includes(99) ? 0.05 : 0);
        const namesake = hitKind === show.kind && genres.some((g) => TMDB_NAMESAKE_GENRES.has(g)) && (sameTitle(q, name) || sameTitle(q, orig));
        candidates.push({ id: `${kind}:${hit.id}`, kind, hit, confidence, score, namesake });
      }
      if (ownChannel) for (const c of candidates) if (c.confidence === 'exact' && !c.networkChecked) await checkTmdbNetworks(ctx, show, c, lang);
      if (done()) break;
    }
    if (done()) break;
  }
  const best = pickBest(candidates, 0.82);
  return best ? tmdbEntry(best.hit, best.kind, lang, {
    score: round(best.score), confidence: best.confidence,
    ...(best.namesakes ? { namesakes: best.namesakes } : {}), ...(best.networks ? { networks: best.networks } : {}),
  }) : null;
}

// ---- TVmaze (English-titled series) ------------------------------------------------------------------
async function fromTvmaze(ctx, show, query) {
  if (show.kind !== 'series' || !query || hasArabic(query)) return null;
  const r = await ctx.getJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
  const candidates = [];
  for (const row of Array.isArray(r) ? r : []) {
    const s = row?.show;
    if (!s?.name || TVMAZE_REJECT_TYPES.has(s.type)) continue; // dramas, cartoons, variety shows
    const network = s.network?.name || s.webChannel?.name || null;
    const confidence = matchConfidence(show, { query, names: [s.name], kind: 'series', year: yearOf(s.premiered), typeOk: TVMAZE_DOC_TYPES.has(s.type), networks: [network] });
    if (!confidence) continue; // premiered after the first upload: not this programme, not even a namesake
    const score = similarity(query, s.name) + (s.type === 'Documentary' || (s.genres || []).includes('Nature') ? 0.05 : 0);
    candidates.push({ id: s.id, s, network, confidence, score, namesake: sameTitle(query, s.name) });
  }
  const best = pickBest(candidates, 0.86);
  if (!best) return null;
  const s = best.s;
  const summary = decode(stripHtml(s.summary || ''));
  return {
    source: 'tvmaze', tvmazeId: s.id, score: round(best.score), name: s.name, confidence: best.confidence,
    tvmazeType: s.type || null, premiered: s.premiered || null, network: best.network,
    ...(best.namesakes ? { namesakes: best.namesakes } : {}),
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
  let fuzzy = null, namesakes = 0;
  for (const wl of langs) {
    const q = `${query}${wl === 'ar' ? ' وثائقي' : ' documentary'}`;
    const r = await ctx.getJson(`https://${wl}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=4&format=json`).catch(() => null);
    const exact = [];
    for (const hit of r?.query?.search || []) {
      const pageTitle = hit.title || '';
      const base = pageTitle.replace(/\s*\(.*?\)\s*$/, '');
      if (exact.length && !sameTitle(query, base)) continue; // once one page matched, only same-title namesakes matter
      const disambiguator = disambiguatorOf(pageTitle);
      const score = similarity(query, base);
      if (score < 0.8) continue;
      const sum = await ctx.getJson(`https://${wl}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`).catch(() => null);
      if (!sum || sum.type === 'disambiguation') continue;
      const description = sum.description || '';
      const lead = leadOf(sum.extract);
      if (!DOC_WORDS.test(description || lead)) continue; // same name, unrelated topic (a platform, a person, a place)
      const about = `${disambiguator} ${description} ${lead}`;
      const year = yearIn(disambiguator) || yearIn(description);
      const networks = namedNetworks(`${description}. ${sum.extract || ''}`);
      // The uploading channel's own network, or a dated provider row's year: the same work whatever genre words the page uses.
      const vouched = networkMatch(show, networks) || datedMatch(show, year || yearIn(lead));
      if (!vouched && notDocumentary(about)) continue; // a drama, sitcom or cartoon (the Turkish "المسلسل التركي" class)
      const kind = kindFromText(disambiguator) || kindFromText(description) || kindFromText(lead);
      if (kind && kind !== show.kind) continue; // e.g. a 1925 film page for a 70-episode series
      const confidence = matchConfidence(show, { query, names: [base], kind, year, typeOk: vouched || DOC_TYPE.test(about), networks });
      if (!confidence) continue;
      const overviewLang = wl === 'ar' ? 'ar' : 'en';
      const usable = (sectionLang(show) === 'en' ? overviewLang === 'en' : overviewLang === 'ar') && (sum.extract || '').length > 60;
      const entry = {
        source: 'wikipedia', wiki: `${wl}:${pageTitle}`, score: round(score), name: pageTitle, confidence,
        poster: usableWikiImage(sum.originalimage) || usableWikiImage(sum.thumbnail), backdrop: null,
        overview: usable ? sum.extract : null, overviewLang,
      };
      // A same-title page counts as a namesake even when it has nothing to show (no usable image or text).
      if (confidence === 'exact') exact.push(entry); else if (hasPayload(entry)) fuzzy = fuzzy || entry;
    }
    // Two programmes share the title: neither is exact, in this language or the next.
    if (exact.length > 1) namesakes = Math.max(namesakes, exact.length);
    const shown = exact.find(hasPayload);
    if (shown && !namesakes) return shown;
    if (shown) fuzzy = fuzzy || { ...shown, confidence: 'fuzzy', namesakes };
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

// ---- cached matches under newer rules ----------------------------------------------------------------
/**
 * Why a cached exact match fails the current rules, judged only from what the entry records (no
 * request): another broadcaster named by the page or TVmaze, a drama/cartoon page, a film page for a
 * series, a rejected TVmaze type, or a premiere after the first upload. [] when it still passes.
 */
export function staleMatchReasons(entry, show) {
  const reasons = [];
  if (!isExact(entry) || !show) return reasons;
  const wiki = entry.source === 'wikipedia';
  const networks = Array.isArray(entry.networks) ? entry.networks : entry.network ? [entry.network] : wiki ? namedNetworks(entry.overview || '') : [];
  if (networkConflict(show, networks)) reasons.push('network');
  const page = `${disambiguatorOf(entry.name)} ${leadOf(entry.overview)}`;
  const vouched = networkMatch(show, networks) || datedMatch(show, yearIn(page));
  if (wiki && !vouched && notDocumentary(page)) reasons.push('not-documentary');
  const kind = wiki ? kindFromText(disambiguatorOf(entry.name)) : null;
  if (kind && show.kind && kind !== show.kind) reasons.push('kind');
  if (entry.tvmazeType && TVMAZE_REJECT_TYPES.has(entry.tvmazeType)) reasons.push('type');
  const premiered = yearOf(entry.premiered), first = yearOf(show.firstAt);
  if (premiered && first && first < premiered - 1) reasons.push('premiered-after-upload');
  return reasons;
}

// ---- pruning -----------------------------------------------------------------------------------------
/** {oldId: liveId}: alias chains followed to a live show id; aliases that end nowhere live map to null. */
function resolveAliases(idAliases, live) {
  const out = new Map();
  const raw = idAliases && typeof idAliases === 'object' ? idAliases : {};
  for (const from of Object.keys(raw)) {
    let to = raw[from];
    const seen = new Set([from]);
    while (typeof to === 'string' && !live.has(to) && raw[to] && !seen.has(to)) { seen.add(to); to = raw[to]; }
    out.set(from, typeof to === 'string' && live.has(to) ? to : null);
  }
  return out;
}

/**
 * Keep artwork.json to live show ids and catalogue id aliases. A matched entry under an alias moves to
 * its live show when that show has no entry yet (a renamed show keeps its poster); a miss under an alias
 * stays put so the renamed show gets a fresh lookup under its new title (a moved match is re-checked for
 * the new show too: offline at once, online in tier 2). keepMatched (the catalogue's own
 * aliases are unknown) drops only entries without a match. Refuses (returns skipped) when the list would
 * drop more than PRUNE_MAX_SHARE of the keys, which only a partial show list can cause.
 */
export function pruneArtwork(art, { liveIds, idAliases = {}, keepMatched = false } = {}) {
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds || []);
  const aliases = resolveAliases(idAliases, live);
  const keys = Object.keys(art);
  const result = { pruned: 0, rekeyed: 0, moved: [], skipped: false, keys: keys.length };
  if (!live.size) return { ...result, skipped: true };
  const drop = keys.filter((k) => !live.has(k) && !aliases.has(k) && !(keepMatched && art[k]?.source));
  if (drop.length > PRUNE_MIN && drop.length > keys.length * PRUNE_MAX_SHARE) return { ...result, skipped: true, wouldPrune: drop.length };
  for (const k of drop) delete art[k];
  result.pruned = drop.length;
  for (const [from, to] of aliases) {
    if (!to || live.has(from) || !art[from]?.source || art[to]) continue;
    art[to] = { ...art[from], rekeyedFrom: from };
    delete art[from];
    result.rekeyed++;
    result.moved.push(to);
  }
  return result;
}

// ---- queue -------------------------------------------------------------------------------------------
const realSynopsis = (s) => !!String(s.synopsis || '').trim() && s.synopsisGenerated !== true;
const providerCover = (s) => (isProviderRow(s)
  ? !!(s.portrait || s.poster?.custom)
  : !!s.portrait && !!s.posterVideoId && !YOUTUBE_ID.test(s.posterVideoId));
/** A provider cover is never replaced, so with a real synopsis there is nothing left to add. */
const canUseArtwork = (s) => !(providerCover(s) && realSynopsis(s));
const synopsisText = (s) => (typeof text.cleanSynopsis === 'function' ? text.cleanSynopsis(String(s)) : decode(stripHtml(s))).replace(/\s+/g, ' ').trim();
const sameSynopsis = (a, b) => !!a && !!b && synopsisText(a) === synopsisText(b);
/**
 * The row as its source published it, without what artwork.json put there: a synopsis from an entry
 * (applyProviderArtwork records synopsisSource, finalizeShow copies the cleaned overview), and a portrait or
 * card poster that is the entry's poster or backdrop. The catalogue the queue sees already carries the cached
 * artwork, so judged on the row as shown, a cached match would never let its own re-check through.
 */
function ownContent(s, entry) {
  const images = new Set([entry?.poster, entry?.backdrop].filter(Boolean));
  const artSynopsis = !!s.synopsisSource || (!!entry?.source && sameSynopsis(s.synopsis, entry.overview));
  const own = { ...s };
  if (artSynopsis) own.synopsis = '';
  if (images.has(s.portrait)) own.portrait = null;
  if (images.has(s.poster?.custom)) own.poster = null;
  return own;
}
/**
 * A due row is looked up when it could use artwork it does not have yet, or when it shows a field its cached
 * entry supplied (a re-check of that match changes what is shown).
 */
function worthLookup(s, entry) {
  const own = ownContent(s, entry);
  return canUseArtwork(own) || own.synopsis !== s.synopsis || own.portrait !== s.portrait || own.poster !== s.poster;
}
/**
 * Every row the catalogue shows on its own: the shows and the uncertain versions grouped inside a card
 * (show.versions, provider rows the merge applies artwork to by row id), each id once.
 */
function catalogueRows(shows) {
  const seen = new Set();
  const rows = [];
  for (const s of shows || []) {
    for (const row of [s, ...(Array.isArray(s?.versions) ? s.versions : [])]) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}
const freshness = (s) => Date.parse(s.latestAt || s.firstSeenAt || s.providerUpdatedAt || s.firstAt || '') || 0;
/** 0 YouTube shows, 1 Myflixer shows, 2 fmovies/hdtoday rows (artwork only fills their synopsis). */
const queueGroup = (s) => (isProviderRow(s) ? 2 : isMyflixer(s) ? 1 : 0);
const GROUP_NAMES = ['youtube', 'myflixer', 'provider'];

/** FNV-1a of a string as a number in [0, 1): a fixed per-show "random" value. */
function unitHash(s = '') {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) / 2 ** 32;
}
/** Lookups in a row without an exact match; entries cached before the count existed are LEGACY_MISSES. */
const missesOf = (entry) => (!entry || isExact(entry) ? 0
  : entry.misses != null && Number.isFinite(Number(entry.misses)) ? Math.max(0, Math.floor(Number(entry.misses))) : LEGACY_MISSES);

/**
 * Days until a cached entry is looked up again: exact matches after 90, a source failure after 3, and
 * lookups without an exact match after 7, 30, then 90 days in a row; each plus up to half as many days
 * again, fixed per show id, so titles checked in one run come back spread over weeks.
 */
export function recheckDays(entry, id = '') {
  const e = entry || {};
  const base = e.incomplete ? RECHECK_DAYS.incomplete
    : isExact(e) ? RECHECK_DAYS.exact
      : MISS_RETRY_DAYS[Math.min(MISS_RETRY_DAYS.length, Math.max(1, missesOf(e))) - 1];
  return base + Math.floor(unitHash(`${id}#${base}`) * base * RETRY_JITTER);
}

/**
 * The entry was looked up for another title: the show was renamed since, or the entry moved here from an
 * old show id (entries from before `forTitle` was recorded count as renamed only when they moved).
 */
const retitled = (entry, show) => (entry.forTitle != null
  ? titleKey(clean(entry.forTitle)) !== titleKey(clean(show.title))
  : !!entry.rekeyedFrom);

/**
 * 0 a match shown on a YouTube/Myflixer show page that older rules accepted (BattleBots), 1 never looked
 * up, 2 looked up under older rules, for another title, before TMDB was available, or downgraded offline
 * and not yet confirmed online, 3 due again, null not due.
 */
function dueTier(entry, show, { now, key }) {
  if (!entry) return 1;
  // A lookup that hit failing sources keeps its old entry; wait a day so it cannot crowd every run.
  if (entry.attemptedAt && now - (Date.parse(entry.attemptedAt) || 0) < DAY) return null;
  const age = now - (Date.parse(entry.checkedAt || '') || 0);
  const v = Number(entry.v) || 0;
  if (entry.source && v < RULES_VERSION && (entry.confidence === 'exact' || v < STRICT_SINCE)) return isExact(entry) && !isProviderRow(show) ? 0 : 2;
  if (entry.downgraded || retitled(entry, show)) return 2;
  if (key && !entry.tmdbChecked && age > DAY) return 2;
  return age > recheckDays(entry, show.id) * DAY ? 3 : null;
}

/**
 * The lookup queue for `shows` (and the versions grouped in them) against cached `art`: due titles only,
 * by tier (shown matches from older rules, never looked up, older rules, due again), then YouTube before
 * Myflixer before fmovies/hdtoday rows, newest first.
 */
export function artworkQueue(shows, art = {}, { now = Date.now(), key = '', aliases = {}, rejects = { ids: new Set() } } = {}) {
  const queue = [];
  for (const s of catalogueRows(shows)) {
    if (rejects.ids?.has(s.id) || !queryTitles(s, aliases).length) continue;
    const tier = dueTier(art[s.id], s, { now, key });
    // A covered show with a real synopsis of its own has nothing to gain, except a re-check of the match it shows now.
    if (tier != null && (tier === 0 || worthLookup(s, art[s.id]))) queue.push({ s, tier, group: queueGroup(s) });
  }
  return queue.sort((a, b) => a.tier - b.tier || a.group - b.group || freshness(b.s) - freshness(a.s)
    || (b.s.episodeCount || 0) - (a.s.episodeCount || 0) || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0));
}

/** A previous match the current lookup did not find again: its fields kept, demoted to 'fuzzy', bookkeeping of the old lookup dropped. */
function keptAsFuzzy(prev, now) {
  const { downgraded, downgradedAt, rekeyedFrom, attemptedAt, incomplete, misses, ...rest } = prev;
  return { ...rest, confidence: 'fuzzy', notFoundAt: now };
}

let lastRun = null;
/** Counters of the last enrichArtwork run (changed = shows whose usable artwork changed, re-keys and downgrades included). */
export function artworkRunSummary() { return lastRun; }
/** Sources the chain can use in this environment, for status reporting. */
export function artworkSources(key = envTmdbKey()) { return [...(key ? ['tmdb'] : []), 'tvmaze', 'wikidata', 'wikipedia']; }

/**
 * Look up artwork for shows that have none yet or are due a re-check (see artworkQueue), at most
 * ARTWORK_MAX_PER_RUN per run and ARTWORK_MAX_MINUTES of wall time. Takes the catalogue (or its show
 * list); before the lookups it prunes artwork.json to live show ids and id aliases (catalog.idAliases,
 * the idAliases option, or show-id-aliases.json) and downgrades cached matches the current rules reject.
 * Returns the usable (exact, not rejected) artwork map the catalogue builder applies.
 */
export async function enrichArtwork(input, {
  log = console.log, fetch: fetchImpl = globalThis.fetch, sleep = realSleep, tmdbKey = envTmdbKey(),
  maxPerRun, maxMinutes, timeoutMs, aliases, idAliases, prune = true,
} = {}) {
  if (!artworkEnabled()) return getArtwork();
  const shows = Array.isArray(input) ? input : Array.isArray(input?.shows) ? input.shows : [];
  const started = Date.now();
  const cap = limitOf(maxPerRun, 'ARTWORK_MAX_PER_RUN', DEFAULT_MAX_PER_RUN, log);
  const minutes = limitOf(maxMinutes, 'ARTWORK_MAX_MINUTES', DEFAULT_MAX_MINUTES, log);
  const timeout = limitOf(timeoutMs, 'ARTWORK_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, log) || DEFAULT_TIMEOUT_MS;
  if (!tmdbKey) {
    const msg = 'TMDB_API_KEY is not set: TMDB artwork lookups are disabled for this run (no backdrops or TMDB overviews); continuing with TVmaze, Wikidata and Wikipedia';
    // Starts on its own line: the CLI's \r progress output leaves the cursor mid-line, and GitHub only reads ::warning:: at a line start.
    log(process.env.GITHUB_ACTIONS === 'true' ? `\n::warning::${msg}` : `\n[artwork] warning: ${msg}`);
  }
  const art = load();
  const rejects = loadRejects();
  const client = createClient({ fetchImpl, sleep, timeoutMs: timeout, log });
  const ctx = { key: tmdbKey, getJson: client.getJson, sleep, rejects, aliases: aliases ?? readJson('overrides.json', {})?.aliases ?? {} };
  const run = { due: 0, cap, looked: 0, matched: 0, exact: 0, changed: 0, incomplete: 0, timedOut: false, tmdb: !!tmdbKey, sources: artworkSources(tmdbKey), pruned: 0, rekeyed: 0, downgraded: 0, queued: {} };
  lastRun = run;
  const usable = (e) => JSON.stringify(isExact(e) ? withoutRejected(e, rejects) : null);
  let dirty = false;
  const moved = new Set();

  if (prune && shows.length) {
    // The catalogue (its idAliases, absent when there are none) or the option names every renamed show; the
    // committed show-id-aliases.json seed alone may not, so for a bare show list a matched entry is kept rather than lost.
    const known = idAliases ?? (input && !Array.isArray(input) ? input.idAliases || {} : null);
    const aliasMap = { ...readJson('show-id-aliases.json', {}), ...(known || {}) };
    // Uncertain versions grouped inside a card (show.versions) and provider rows matched into one (its offerings) keep
    // their entries: the provider merge applies them by row id, and a matched row's synopsis can fill the card's.
    const liveIds = new Set(shows.flatMap((s) => [
      s?.id,
      ...(Array.isArray(s?.versions) ? s.versions.map((v) => v?.id) : []),
      ...(Array.isArray(s?.offerings) ? s.offerings.map((o) => o?.id) : []),
    ]).filter((id) => typeof id === 'string' && id));
    const p = pruneArtwork(art, { liveIds, idAliases: aliasMap, keepMatched: known == null });
    if (p.skipped && p.wouldPrune) log(`[artwork] not pruning: ${p.wouldPrune} of ${p.keys} cached entries belong to no show in this list (more than ${PRUNE_MAX_SHARE * 100}%: a partial show list?); nothing pruned or moved`);
    run.pruned = p.pruned; run.rekeyed = p.rekeyed; run.changed += p.rekeyed;
    for (const id of p.moved || []) moved.add(id);
    dirty ||= p.pruned > 0 || p.rekeyed > 0;
  }
  // Matches from older rules, and matches that just moved to a renamed show, judged again from what they record.
  const regradedAt = new Date(started).toISOString();
  for (const s of catalogueRows(shows)) {
    const e = art[s.id];
    if (!isExact(e) || ((Number(e.v) || 0) >= RULES_VERSION && !moved.has(s.id))) continue;
    const reasons = staleMatchReasons(e, s);
    if (!reasons.length) continue;
    art[s.id] = { ...e, confidence: 'fuzzy', downgraded: reasons, downgradedAt: regradedAt };
    run.downgraded++; run.changed++; dirty = true;
  }

  const queue = artworkQueue(shows, art, { now: started, key: tmdbKey, aliases: ctx.aliases, rejects });
  const batch = queue.slice(0, cap);
  run.due = queue.length;
  for (const { group } of batch) run.queued[GROUP_NAMES[group]] = (run.queued[GROUP_NAMES[group]] || 0) + 1;
  if (!batch.length) {
    if (dirty) save();
    if (dirty || run.due) log(`[artwork] ${run.due ? `${run.due} due, none looked up (cap ${cap})` : 'nothing due'}; ${run.pruned} stale entries pruned, ${run.rekeyed} moved to renamed shows, ${run.downgraded} matches downgraded`);
    return getArtwork();
  }

  const deadline = started + minutes * 60e3;
  for (const { s } of batch) {
    if (Date.now() > deadline) { run.timedOut = true; log(`[artwork] stopping after ${minutes} min; the rest waits for the next run`); break; }
    const errorsBefore = client.errors;
    const tmdbErrorsBefore = client.hostErrors.get(TMDB_HOST) || 0;
    let hit = null;
    try { hit = await lookup(ctx, s); } catch (e) { log(`[artwork] ${s.title}: ${e.message}`); }
    const incomplete = client.errors > errorsBefore;
    const prev = art[s.id];
    const before = usable(prev);
    const now = new Date().toISOString();
    const stamp = { checkedAt: now, v: RULES_VERSION, forTitle: s.title || '', tmdbChecked: !!tmdbKey && (client.hostErrors.get(TMDB_HOST) || 0) === tmdbErrorsBefore };
    if (isExact(hit)) art[s.id] = { ...hit, ...stamp };
    else if (incomplete && prev?.source) art[s.id] = { ...prev, attemptedAt: now }; // a source failed: keep the old match
    else if (incomplete) art[s.id] = { ...(hit || {}), ...stamp, incomplete: true, misses: missesOf(prev) }; // not counted as a miss
    // No exact match: retry after 7, 30, then 90 days. A match cached before that the lookup no longer finds
    // at all is kept as 'fuzzy' (never displayed): a rules bump that re-checks every match must not empty
    // artwork.json, whose matched count (entries with a source) guards the snapshot save.
    else art[s.id] = { ...(hit || (prev?.source ? keptAsFuzzy(prev, now) : {})), ...stamp, misses: missesOf(prev) + 1 };
    run.looked++;
    if (hit) run.matched++;
    if (isExact(hit)) run.exact++;
    if (incomplete) run.incomplete++;
    if (usable(art[s.id]) !== before) run.changed++;
    if (run.looked % SAVE_EVERY === 0) save();
    await sleep(150);
  }
  save();
  const view = getArtwork();
  const groups = Object.entries(run.queued).map(([g, n]) => `${n} ${g}`).join(', ');
  log(`[artwork] looked up ${run.looked} of ${run.due} due shows (cap ${cap}; ${groups}), matched ${run.matched} (${run.exact} exact, ${run.changed} changed${run.incomplete ? `, ${run.incomplete} incomplete` : ''}${run.downgraded ? `, ${run.downgraded} downgraded by newer rules` : ''}); ${run.pruned} stale entries pruned, ${run.rekeyed} moved to renamed shows; ${Object.keys(view).length} shows have exact artwork; sources: ${run.sources.join(', ')}`);
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
