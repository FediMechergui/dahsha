// Poster / backdrop / synopsis enrichment from TMDB (https://www.themoviedb.org), matched by title.
// Needs TMDB_API_KEY (free, v3 key or v4 read token). Without it nothing happens and YouTube
// thumbnails remain the artwork. Results are cached in server/data/artwork.json.
import { readJson, writeJson } from './store.js';
import { normalizeArabic, similarity } from './text.js';

const KEY = process.env.TMDB_API_KEY || '';
const IMG = 'https://image.tmdb.org/t/p';
const MAX_PER_RUN = Number(process.env.TMDB_MAX_PER_RUN || 400);
const RETRY_DAYS = 30; // re-check misses after a month

export const artworkEnabled = () => !!KEY;

let cache = null;
function load() { if (!cache) cache = readJson('artwork.json', {}); return cache; }
function save() { writeJson('artwork.json', cache); }

async function tmdb(path, params) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  if (KEY.startsWith('eyJ')) headers.authorization = `Bearer ${KEY}`; else url.searchParams.set('api_key', KEY);
  const res = await fetch(url, { headers });
  if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000)); return tmdb(path, params); }
  if (!res.ok) throw new Error(`tmdb ${res.status}`);
  return res.json();
}

const clean = (t = '') => String(t)
  .replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ')          // "(Full Episode)", "(2/3)"
  .replace(/\s*[|:–—-]\s*(season|الموسم)\s*\d+.*$/i, '')
  .replace(/\.\.+/g, ' ')
  .replace(/\s+/g, ' ').trim();

const year = (iso) => (iso ? new Date(iso).getFullYear() : null);

/** Best TMDB hit for a show: search tv for series, movie for films, both languages. */
async function lookup(show) {
  const title = clean(show.title);
  if (!title || normalizeArabic(title).length < 3) return null;
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
        const y = year(hit.first_air_date || hit.release_date);
        const yShow = year(show.firstAt);
        const yearBonus = y && yShow && Math.abs(y - yShow) <= 2 ? 0.05 : 0;
        candidates.push({ kind, hit, score: score + yearBonus + (hit.genre_ids?.includes(99) ? 0.05 : 0) });
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
    tmdbId: h.id,
    kind: best.kind,
    score: Math.round(best.score * 100) / 100,
    name: h.name || h.title,
    poster: h.poster_path ? `${IMG}/w500${h.poster_path}` : null,
    backdrop: h.backdrop_path ? `${IMG}/w1280${h.backdrop_path}` : null,
    overview: h.overview && h.overview.length > 40 ? h.overview : null,
    overviewLang: lang.slice(0, 2),
  };
}

/**
 * Enrich shows that have no artwork yet (bounded per run). Mutates nothing; returns the map so the
 * catalogue builder can apply it on the next rebuild.
 */
export async function enrichArtwork(shows, { log = console.log } = {}) {
  if (!KEY) return load();
  const art = load();
  const now = Date.now();
  const pending = shows.filter((s) => {
    const a = art[s.id];
    if (!a) return true;
    if (a.tmdbId) return false;
    return now - new Date(a.checkedAt || 0).getTime() > RETRY_DAYS * 864e5;
  }).slice(0, MAX_PER_RUN);
  if (!pending.length) return art;
  let found = 0;
  for (const s of pending) {
    try {
      const hit = await lookup(s);
      art[s.id] = { ...(hit || {}), checkedAt: new Date().toISOString() };
      if (hit) found++;
    } catch (e) { log(`[artwork] ${s.title}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 120)); // ~8 req/s, under TMDB's limit
  }
  save();
  log(`[artwork] looked up ${pending.length} shows, matched ${found} (total matched ${Object.values(art).filter((a) => a.tmdbId).length})`);
  return art;
}

export function getArtwork() { return load(); }
