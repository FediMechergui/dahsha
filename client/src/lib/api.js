import { DOCUMENTARIES, PRODUCT } from './product.js';
import { matchesSearch } from '../../../shared/search.js';
import { mergeLiveShow, needsLiveTitle, versionedUrl } from './catalog-helpers.js';
// Flixer API client. Supports both live API mode and static JSON fallback mode.
export const STATIC = import.meta.env.VITE_STATIC === '1';
export const DATA_BASE = (import.meta.env.VITE_DATA_BASE || '').replace(/\/$/, '');
const defaultBase = '';
export const API_BASE = (import.meta.env.VITE_API_BASE || defaultBase).replace(/\/$/, '');

// Reads the body chunk by chunk when the runtime streams, so a slow but moving download is not
// aborted; runtimes without streams (some native HTTP bridges) fall back to res.text().
async function readText(res, onChunk) {
  if (!onChunk || !res.body?.getReader || typeof TextDecoder === 'undefined') return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk();
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join('');
}

/**
 * timeout: hard cap for the whole request. stall: abort only when no bytes arrived for this long
 * (used for the multi-megabyte catalogue so slow networks can still finish).
 */
async function req(url, { timeout = 30000, stall = 0, ...opts } = {}) {
  const headers = opts.body ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : (opts.headers || {});
  const controller = new AbortController();
  let stallTimer;
  const hardTimer = setTimeout(() => controller.abort(), timeout);
  const arm = stall ? () => { clearTimeout(stallTimer); stallTimer = setTimeout(() => controller.abort(), stall); } : null;
  arm?.();
  let res, text;
  try {
    res = await fetch(url, { ...opts, headers, signal: controller.signal });
    arm?.();
    text = await readText(res, arm);
  } catch (e) {
    if (controller.signal.aborted) { const err = new Error('Request timed out'); err.status = 0; err.timeout = true; throw err; }
    throw e;
  } finally { clearTimeout(hardTimer); clearTimeout(stallTimer); }
  let body = {};
  let isJson = false;
  try { body = JSON.parse(text); isJson = true; } catch { body = {}; }
  if (!res.ok || !isJson) {
    const err = new Error(body.error || (isJson ? `HTTP ${res.status}` : 'not found'));
    err.status = !isJson && res.ok ? 404 : res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// A static build answers home, listing and search from the exported catalogue and never calls the
// serverless API for them: Vercel blocked the Hobby team for function CPU on 2026-10-21. Only
// provider titles and playback (api.show for provider-backed titles, api.stream) still go live.
const live = (url) => (STATIC ? Promise.reject(new Error('static build')) : req(url));

export const api = {
  static: STATIC,

  // Movies & TV Series endpoints
  home: () => live(`${API_BASE}/api/home`).catch(() => api.catalog().then((c) => ({
    featured: c.shows?.[0] || null,
    trendingMovies: (c.shows || []).filter((s) => s.kind === 'film').slice(0, 16),
    trendingSeries: (c.shows || []).filter((s) => s.kind === 'series').slice(0, 16),
    rails: [
      { id: 'movies', title: 'Trending Movies', titleAr: 'الأفلام الرائجة', items: (c.shows || []).filter((s) => s.kind === 'film').slice(0, 14) },
      { id: 'series', title: 'TV Series', titleAr: 'المسلسلات التلفزيونية', items: (c.shows || []).filter((s) => s.kind === 'series').slice(0, 14) },
    ],
  }))),

  movies: ({ page = 1, perPage = 24, genre, year, search } = {}) => {
    const p = new URLSearchParams({ page: String(page), perPage: String(perPage) });
    if (genre) p.set('category', genre);
    if (year) p.set('year', String(year));
    if (search) p.set('q', search);
    return live(`${API_BASE}/api/movies?${p.toString()}`).catch(() => api.catalog().then((c) => {
      let items = (c.shows || []).filter((s) => s.kind === 'film');
      if (genre) items = items.filter((s) => s.tags?.includes(genre.toLowerCase()));
      if (year) items = items.filter((s) => s.year === Number(year));
      if (search) items = items.filter(s => s.title.toLowerCase().includes(search.toLowerCase()));
      return { items: items.slice((page - 1) * perPage, page * perPage), total: items.length, page };
    }));
  },

  series: ({ page = 1, perPage = 24, genre, year, search } = {}) => {
    const p = new URLSearchParams({ page: String(page), perPage: String(perPage) });
    if (genre) p.set('category', genre);
    if (year) p.set('year', String(year));
    if (search) p.set('q', search);
    return live(`${API_BASE}/api/series?${p.toString()}`).catch(() => api.catalog().then((c) => {
      let items = (c.shows || []).filter((s) => s.kind === 'series');
      if (genre) items = items.filter((s) => s.tags?.includes(genre.toLowerCase()));
      if (year) items = items.filter((s) => s.year === Number(year));
      if (search) items = items.filter(s => s.title.toLowerCase().includes(search.toLowerCase()));
      return { items: items.slice((page - 1) * perPage, page * perPage), total: items.length, page };
    }));
  },

  search: (q) => live(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`).catch(() => api.catalog().then((c) => {
    const items = (c.shows || []).filter((s) => matchesSearch(s.title,q));
    return { items };
  })),

  discover: ({ kind = 'film', page = 1, genre, year, latest = false } = {}) => {
    const params = new URLSearchParams({kind,page:String(page)});
    if (genre) params.set('genre',genre); if (year) params.set('year',String(year));
    if (latest) params.set('latest','true');
    if (STATIC) return Promise.resolve({ items: [], page, static: true });
    return req(`${API_BASE}/api/discover?${params}`);
  },

  genres: () => live(`${API_BASE}/api/genres`).catch(() => ({ genres: [] })),

  title: (id) => api.show(id),
  // Static mode: the deployment's shows/<id>.json (versioned by generatedAt) is the record; the live
  // title API only layers provider data on top of it, and only for provider-backed titles.
  show: (id, { source, sources = [], version } = {}) => {
    source ||= new URLSearchParams(window.location.search).get('source');
    const params = new URLSearchParams({ id });
    for (const url of [...new Set([source, ...sources].filter(Boolean))]) params.append('source',url);
    const live = () => req(`${API_BASE}/api/title?${params}`);
    if (!STATIC) return live();
    return req(versionedUrl(`${DATA_BASE}/data/shows/${encodeURIComponent(encodeURIComponent(id))}.json`, version))
      .then(show => needsLiveTitle(id, show) ? live().then(fresh => mergeLiveShow(show, fresh), () => show) : show, () => live());
  },
  stream: (id, { showId, source, sources = [] } = {}) => {
    const params = new URLSearchParams({ id });
    if (showId) params.set('showId', showId);
    for (const url of [...new Set([source,...sources].filter(Boolean))]) params.append('source',url);
    return req(`${API_BASE}/api/stream?${params}`);
  },

  // version: the deployment's status.json generatedAt, so a new deploy never reuses the old cached
  // file and an unchanged deploy is reused from cache on cold starts. Time bucket only as fallback.
  catalog: async (lang = 'ar', { version } = {}) => {
    const catalog = await req(STATIC
      ? versionedUrl(`${DATA_BASE}/data/catalog${DOCUMENTARIES ? `.${lang}` : ''}.json`, version || `t${Math.floor(Date.now() / 600000)}`)
      : `${API_BASE}/api/catalog${DOCUMENTARIES ? `?lang=${lang}` : ''}`, { timeout: 10 * 60e3, stall: 45e3 });
    if (catalog.product !== PRODUCT) throw new Error(`Expected ${PRODUCT} catalogue; received ${catalog.product || 'unlabelled data'}. Re-export this app's data.`);
    return catalog;
  },
  status: () => (STATIC
    ? req(`${DATA_BASE}/data/status.json?t=${Date.now()}`, { cache: 'no-store', timeout: 15000 })
    : req(`${API_BASE}/api/status`)),
  sources: () => STATIC ? api.catalog().then(c => ({ sources: c.sources || [] })) : req(`${API_BASE}/api/sources`),
  addSource: url => req(`${API_BASE}/api/sources`, { method: 'POST', body: JSON.stringify({ url }) }),
  removeSource: id => req(`${API_BASE}/api/sources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  refresh: full => req(`${API_BASE}/api/refresh${full ? '?full=1' : ''}`, { method: 'POST' }),
};
