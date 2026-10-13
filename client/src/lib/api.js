// Flixer API client. Supports both live API mode and static JSON fallback mode.
export const STATIC = import.meta.env.VITE_STATIC === '1';
export const DATA_BASE = (import.meta.env.VITE_DATA_BASE || '').replace(/\/$/, '');
const isMobileApp = import.meta.env.VITE_MOBILE === '1' || (typeof window !== 'undefined' && (
  window.location.protocol === 'capacitor:' ||
  (window.location.hostname === 'localhost' && (window.Capacitor || !window.location.port)) ||
  window.location.origin.startsWith('file:')
));
const defaultBase = '';
export const API_BASE = (import.meta.env.VITE_API_BASE || defaultBase).replace(/\/$/, '');

async function req(url, opts = {}) {
  const headers = opts.body ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : (opts.headers || {});
  const res = await fetch(url, { ...opts, headers });
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
      return { items: items.slice((page - 1) * perPage, page * perPage), total: items.length, page };
    }));
  },

  search: (q) => req(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`).catch(() => api.catalog().then((c) => {
    const norm = (q || '').toLowerCase();
    const items = (c.shows || []).filter((s) => s.title.toLowerCase().includes(norm));
    return { items };
  })),

  genres: () => req(`${API_BASE}/api/genres`).catch(() => ({ genres: [] })),

  title: (id) => req(`${API_BASE}/api/title/${encodeURIComponent(id)}`).catch(() => req(`${DATA_BASE || API_BASE}/data/shows/${encodeURIComponent(id)}.json`)),

  show: (id) => req(`${API_BASE}/api/title/${encodeURIComponent(id)}`).catch(() => req(`${DATA_BASE || API_BASE}/data/shows/${encodeURIComponent(id)}.json`)),

  stream: (id) => req(`${API_BASE}/api/stream?id=${encodeURIComponent(id)}`),

  catalog: (lang = 'en') => {
    if (STATIC && DATA_BASE) {
      return req(`${DATA_BASE}/data/catalog.json?v=${Math.floor(Date.now() / 600000)}`);
    }
    const catUrl = API_BASE ? `${API_BASE}/api/catalog` : `/data/catalog.json?v=${Math.floor(Date.now() / 600000)}`;
    return req(catUrl).catch(() => req(`/data/catalog.json?v=${Math.floor(Date.now() / 600000)}`));
  },

  status: () => req(`${API_BASE}/api/status`).catch(() => ({ ok: true, static: true })),
};
