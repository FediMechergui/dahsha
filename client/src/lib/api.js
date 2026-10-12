// API client. Two modes:
//  - server mode (default in dev): talks to the Express API (/api/...)
//  - static mode (VITE_STATIC=1, used on Vercel and in the mobile app): reads pre-exported JSON files
//    from VITE_DATA_BASE (defaults to the site origin) under /data/.
export const STATIC = import.meta.env.VITE_STATIC === '1';
export const DATA_BASE = (import.meta.env.VITE_DATA_BASE || '').replace(/\/$/, '');
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

async function req(url, opts) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const notAvailable = () => Promise.reject(Object.assign(new Error('static'), { status: 405, body: {} }));

export const api = STATIC ? {
  static: true,
  // One file per language section; the client only loads the section it displays.
  catalog: (lang = 'ar') => req(`${DATA_BASE}/data/catalog.${lang}.json?v=${Math.floor(Date.now() / 600000)}`),
  status: () => req(`${DATA_BASE}/data/status.json?v=${Math.floor(Date.now() / 600000)}`),
  show: (id) => req(`${DATA_BASE}/data/shows/${encodeURIComponent(id)}.json`),
  refresh: notAvailable,
  sources: () => req(`${DATA_BASE}/data/sources.json`),
  addSource: notAvailable,
  removeSource: notAvailable,
  overrideShow: notAvailable,
} : {
  static: false,
  catalog: (lang = 'ar') => req(`${API_BASE}/api/catalog?lang=${lang}`),
  status: () => req(`${API_BASE}/api/status`),
  show: (id) => req(`${API_BASE}/api/shows/${encodeURIComponent(id)}`),
  refresh: (full = false) => req(`${API_BASE}/api/refresh${full ? '?full=1' : ''}`, { method: 'POST' }),
  sources: () => req(`${API_BASE}/api/sources`),
  addSource: (url) => req(`${API_BASE}/api/sources`, { method: 'POST', body: JSON.stringify({ url }) }),
  removeSource: (id) => req(`${API_BASE}/api/sources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  overrideShow: (id, patch) => req(`${API_BASE}/api/overrides/shows/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) }),
};
