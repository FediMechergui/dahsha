// Poster / synopsis enrichment, matched by title, from (in order):
//   1. TMDB      (needs TMDB_API_KEY; backdrop + portrait poster + overview, ar/en)
//   2. TVmaze    (no key; English series: portrait poster + summary)
//   3. Wikipedia (no key; ar / en / fr: page image + extract)
// Results are cached in server/data/artwork.json. YouTube thumbnails remain the fallback.
import { readJson, writeJson } from './store.js';
import { normalizeArabic, similarity } from './text.js';

const KEY = process.env.TMDB_API_KEY || '';
const IMG = 'https://image.tmdb.org/t/p';
const MAX_PER_RUN = Number(process.env.ARTWORK_MAX_PER_RUN || 600);
const RETRY_DAYS = 30; // re-check misses after a month
const UA = 'Dahsha/1.0 (https://dahsha.vercel.app; documentary catalogue)';

export const artworkEnabled = () => process.env.ARTWORK !== '0';

let cache = null;
function load() { if (!cache) cache = readJson('artwork.json', {}); return cache; }
function save() { writeJson('artwork.json', cache); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA, ...headers } });
  if (res.status === 429) { await sleep(3000); return getJson(url, headers); }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

const clean = (t = '') => String(t)
  .replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ')          // "(Full Episode)", "(2/3)"
  .replace(/\s*[|:–—-]\s*(season|الموسم)\s*\d+.*$/i, '')
  .replace(/\.\.+/g, ' ')
  .replace(/\s+/g, ' ').trim();
const year = (iso) => (iso ? new Date(iso).getFullYear() : null);
const stripHtml = (s = '') => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const DOC_WORDS = /وثائقي|مسلسل|برنامج|سلسلة|فيلم|documentary|series|television|tv|film|show|programme|program|émission|série|documentaire/i;

// ---- TMDB ------------------------------------------------------------------------------------
async function tmdb(path, params) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  const headers = {};
  if (KEY.startsWith('eyJ')) headers.authorization = `Bearer ${KEY}`; else url.searchParams.set('api_key', KEY);
  return getJson(url.toString(), headers);
}
async function fromTmdb(show, title) {
  if (!KEY) return null;
  const lang = show.lang === 'en' ? 'en-US' : 'ar';
  const kinds = show.kind === 'film' ? ['movie', 'tv'] : ['tv', 'movie'];
  const candidates = [];
  for (const kind of kinds) {
    for (const q of [...new Set([title, ...(show.altTitles || []).map(clean)].filter(Boolean))].slice(0, 3)) {
      const r = await tmdb(`/search/${kind}`, { query: q, language: lang, include_adult: 'false' }).catch(() => null);
      for (const hit of (r?.results || []).slice(0, 5)) {
        const name = hit.name || hit.title || '';
        const orig = hit.original_name || hit.original_title || '';
        const score = Math.max(similarity(q, name), similarity(q, orig));
        const y = year(hit.first_air_date || hit.release_date), yShow = year(show.firstAt);
        candidates.push({ kind, hit, score: score + (y && yShow && Math.abs(y - yShow) <= 2 ? 0.05 : 0) + (hit.genre_ids?.includes(99) ? 0.05 : 0) });
      }
      if (candidates.some((c) => c.score >= 0.95)) break;
    }
    if (candidates.some((c) => c.score >= 0.9)) break;
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score < 0.82) return null;
  const h = best.hit;
  return {
    source: 'tmdb', tmdbId: h.id, kind: best.kind, score: Math.round(best.score * 100) / 100, name: h.name || h.title,
    poster: h.poster_path ? `${IMG}/w500${h.poster_path}` : null,
    backdrop: h.backdrop_path ? `${IMG}/w1280${h.backdrop_path}` : null,
    overview: h.overview && h.overview.length > 40 ? h.overview : null, overviewLang: lang.slice(0, 2),
  };
}

// ---- TVmaze (English series) -------------------------------------------------------------------
async function fromTvmaze(show, title) {
  if (show.lang !== 'en' || show.kind !== 'series') return null;
  const r = await getJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(title)}`).catch(() => null);
  const best = (r || []).map((x) => ({ s: x.show, score: similarity(title, x.show?.name || '') + (x.show?.type === 'Documentary' || (x.show?.genres || []).includes('Nature') ? 0.05 : 0) })).sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 0.86 || !best.s) return null;
  const s = best.s;
  const summary = stripHtml(s.summary || '');
  return {
    source: 'tvmaze', tvmazeId: s.id, score: Math.round(best.score * 100) / 100, name: s.name,
    poster: s.image?.original || s.image?.medium || null, backdrop: null,
    overview: summary.length > 40 ? summary : null, overviewLang: 'en',
  };
}

// ---- Wikipedia (ar / en / fr) ------------------------------------------------------------------
async function fromWikipedia(show, title) {
  const langs = show.contentLang === 'fr' ? ['fr', 'en'] : show.lang === 'en' ? ['en'] : ['ar', 'en'];
  for (const wl of langs) {
    const q = `${title}${wl === 'ar' ? ' وثائقي' : ' documentary'}`;
    const r = await getJson(`https://${wl}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=4&format=json`).catch(() => null);
    for (const hit of r?.query?.search || []) {
      const pageTitle = hit.title;
      const score = similarity(title, pageTitle.replace(/\s*\(.*?\)\s*$/, ''));
      if (score < 0.8) continue;
      const sum = await getJson(`https://${wl}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`).catch(() => null);
      if (!sum || sum.type === 'disambiguation') continue;
      const text = `${sum.description || ''} ${sum.extract || ''}`;
      if (!DOC_WORDS.test(text)) continue; // same name, unrelated topic
      const overviewLang = wl === 'ar' ? 'ar' : 'en';
      const usable = (show.lang === 'en' ? overviewLang === 'en' : overviewLang === 'ar') && (sum.extract || '').length > 60;
      return {
        source: 'wikipedia', wiki: `${wl}:${pageTitle}`, score: Math.round(score * 100) / 100, name: pageTitle,
        poster: sum.originalimage?.source || sum.thumbnail?.source || null, backdrop: null,
        overview: usable ? sum.extract : null, overviewLang,
      };
    }
    await sleep(100);
  }
  return null;
}

// ---- Wikidata bridge (Arabic dub title → English programme name → TVmaze) ----------------------
async function fromWikidata(show, title) {
  if (show.lang !== 'ar' || show.kind !== 'series') return null;
  const r = await getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(title)}&language=ar&uselang=en&type=item&limit=5&format=json`).catch(() => null);
  const hit = (r?.search || []).find((h) => /television|tv series|documentary|programme|program|series/i.test(h.description || ''));
  if (!hit?.label || /[؀-ۿ]/.test(hit.label)) return null;
  const en = await fromTvmaze({ ...show, lang: 'en' }, hit.label);
  if (!en) return null;
  return { ...en, source: 'wikidata+tvmaze', via: hit.label, overview: null, overviewLang: 'en' };
}

async function lookup(show) {
  const title = clean(show.title);
  if (!title || normalizeArabic(title).length < 3) return null;
  for (const provider of [fromTmdb, fromTvmaze, fromWikidata, fromWikipedia]) {
    const hit = await provider(show, title).catch(() => null);
    if (hit && (hit.poster || hit.backdrop || hit.overview)) return hit;
  }
  return null;
}

/**
 * Enrich shows that have no artwork yet (bounded per run; films are looked up after series).
 * Returns the cache map so the catalogue builder can apply it on the next rebuild.
 */
export async function enrichArtwork(shows, { log = console.log } = {}) {
  if (!artworkEnabled()) return load();
  const art = load();
  const now = Date.now();
  const pending = shows
    .filter((s) => {
      const a = art[s.id];
      if (!a) return true;
      if (a.source) return false;
      return now - new Date(a.checkedAt || 0).getTime() > RETRY_DAYS * 864e5;
    })
    .sort((a, b) => (b.kind === 'series') - (a.kind === 'series') || (b.episodeCount || 0) - (a.episodeCount || 0))
    .slice(0, MAX_PER_RUN);
  if (!pending.length) return art;
  let found = 0;
  for (const s of pending) {
    try {
      const hit = await lookup(s);
      art[s.id] = { ...(hit || {}), checkedAt: new Date().toISOString() };
      if (hit) found++;
    } catch (e) { log(`[artwork] ${s.title}: ${e.message}`); }
    await sleep(150);
  }
  save();
  log(`[artwork] looked up ${pending.length} shows, matched ${found} (total matched ${Object.values(art).filter((a) => a.source).length})`);
  return art;
}

export function getArtwork() { return load(); }
