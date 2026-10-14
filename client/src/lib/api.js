import { DOCUMENTARIES, PRODUCT } from './product.js';
import { matchesSearch } from '../../../shared/search.js';
// Flixer API client. Supports both live API mode and static JSON fallback mode.
export const STATIC = import.meta.env.VITE_STATIC === '1';
export const DATA_BASE = (import.meta.env.VITE_DATA_BASE || '').replace(/\/$/, '');
const defaultBase = '';
export const API_BASE = (import.meta.env.VITE_API_BASE || defaultBase).replace(/\/$/, '');

async function req(url, opts = {}) {
  const headers = opts.body ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : (opts.headers || {});
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), ...opts, headers });
  const text = await res.text();
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

export const api = {
  static: STATIC,

  // Movies & TV Series endpoints
  home: () => req(`${API_BASE}/api/home`).catch(() => api.catalog().then((c) => ({
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
    return req(`${API_BASE}/api/movies?${p.toString()}`).catch(() => api.catalog().then((c) => {
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
    return req(`${API_BASE}/api/series?${p.toString()}`).catch(() => api.catalog().then((c) => {
      let items = (c.shows || []).filter((s) => s.kind === 'series');
      if (genre) items = items.filter((s) => s.tags?.includes(genre.toLowerCase()));
      if (year) items = items.filter((s) => s.year === Number(year));
      if (search) items = items.filter(s => s.title.toLowerCase().includes(search.toLowerCase()));
      return { items: items.slice((page - 1) * perPage, page * perPage), total: items.length, page };
    }));
  },

  search: (q) => req(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`).catch(() => api.catalog().then((c) => {
    const items = (c.shows || []).filter((s) => matchesSearch(s.title,q));
    return { items };
  })),

  discover: ({ kind = 'film', page = 1, genre, year } = {}) => {
    const params = new URLSearchParams({kind,page:String(page)});
    if (genre) params.set('genre',genre); if (year) params.set('year',String(year));
    return req(`${API_BASE}/api/discover?${params}`);
  },

  genres: () => req(`${API_BASE}/api/genres`).catch(() => ({ genres: [] })),

  title: (id) => api.show(id),
  show: (id, { source, sources = [] } = {}) => {
    source ||= new URLSearchParams(window.location.search).get('source');
    const params = new URLSearchParams({ id });
    for (const url of [...new Set([source, ...sources].filter(Boolean))]) params.append('source',url);
    const live = () => req(`${API_BASE}/api/title?${params}`);
    if (!STATIC) return live();
    return req(`${DATA_BASE}/data/shows/${encodeURIComponent(encodeURIComponent(id))}.json`)
      .then(show => live().catch(() => show)).catch(() => live());
  },
  stream: (id, { showId, source, sources = [] } = {}) => {
    const params = new URLSearchParams({ id });
    if (showId) params.set('showId', showId);
    for (const url of [...new Set([source,...sources].filter(Boolean))]) params.append('source',url);
    return req(`${API_BASE}/api/stream?${params}`);
  },

  catalog: async (lang = 'ar') => {
    const catalog = await req(STATIC
      ? `${DATA_BASE}/data/catalog${DOCUMENTARIES ? `.${lang}` : ''}.json?v=${Math.floor(Date.now() / 600000)}`
      : `${API_BASE}/api/catalog${DOCUMENTARIES ? `?lang=${lang}` : ''}`);
    if (catalog.product !== PRODUCT) throw new Error(`Expected ${PRODUCT} catalogue; received ${catalog.product || 'unlabelled data'}. Re-export this app's data.`);
    return catalog;
  },
  status: () => req(STATIC ? `${DATA_BASE}/data/status.json?v=${Math.floor(Date.now() / 600000)}` : `${API_BASE}/api/status`),
  sources: () => STATIC ? api.catalog().then(c => ({ sources: c.sources || [] })) : req(`${API_BASE}/api/sources`),
  addSource: url => req(`${API_BASE}/api/sources`, { method: 'POST', body: JSON.stringify({ url }) }),
  removeSource: id => req(`${API_BASE}/api/sources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  refresh: full => req(`${API_BASE}/api/refresh${full ? '?full=1' : ''}`, { method: 'POST' }),
};
