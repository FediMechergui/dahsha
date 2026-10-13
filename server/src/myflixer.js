// Comprehensive Myflixer Scraper & Streaming Engine for Movies and TV Series.
// Supports all genres, full catalog paging, search, trending, episode resolution, and all 7 streaming players.
import path from 'node:path';

const BASE = 'https://myflixerz.day';
const API = `${BASE}/wp-json/wp/v2`;

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function decodeXml(s = '') {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8230;/g, '…')
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&apos;/g, "'");
}

function plain(html = '') {
  return decodeXml(String(html).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function posterFor(postId) {
  return `${BASE}/wp-content/uploads/posters/${postId}_medium.jpg`;
}

export function fullPosterFor(postId) {
  return `${BASE}/wp-content/uploads/posters/${postId}.jpg`;
}

// All major Myflixer genres
export const GENRES = [
  { id: 39, name: 'Action', slug: 'action' },
  { id: 42, name: 'Adventure', slug: 'adventure' },
  { id: 97, name: 'Animation', slug: 'animation' },
  { id: 2343589, name: 'Biography', slug: 'biography' },
  { id: 46, name: 'Comedy', slug: 'comedy' },
  { id: 160, name: 'Crime', slug: 'crime' },
  { id: 212, name: 'Documentary', slug: 'documentary' },
  { id: 56, name: 'Drama', slug: 'drama' },
  { id: 99, name: 'Family', slug: 'family' },
  { id: 48, name: 'Fantasy', slug: 'fantasy' },
  { id: 236, name: 'History', slug: 'history' },
  { id: 237, name: 'Horror', slug: 'horror' },
  { id: 238, name: 'Music', slug: 'music' },
  { id: 40, name: 'Mystery', slug: 'mystery' },
  { id: 130, name: 'Romance', slug: 'romance' },
  { id: 2716699, name: 'Sci-Fi', slug: 'sci-fi' },
  { id: 2340416, name: 'Sport', slug: 'sport' },
  { id: 45, name: 'Thriller', slug: 'thriller' },
  { id: 150, name: 'War', slug: 'war' },
  { id: 220, name: 'Western', slug: 'western' },
];

export const GENRE_ID_TO_NAME = Object.fromEntries(GENRES.map((g) => [g.id, g.name]));
export const GENRE_SLUG_TO_ID = Object.fromEntries(GENRES.map((g) => [g.slug, g.id]));

let yearCache = null;

/**
 * Load release-year taxonomy.
 */
export async function loadYearTerms() {
  if (yearCache) return yearCache;
  const map = new Map();
  try {
    for (let page = 1; page <= 8; page++) {
      const res = await fetch(`${API}/release-year?per_page=100&page=${page}&_fields=id,name`, {
        headers: { 'User-Agent': DESKTOP_UA },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) break;
      const rows = await res.json();
      if (!Array.isArray(rows) || !rows.length) break;
      for (const r of rows) {
        if (/^\d{4}$/.test(r.name)) map.set(r.id, r.name);
      }
      if (rows.length < 100) break;
    }
  } catch (e) {
    console.warn('[myflixer] release-year lookup error:', e.message);
  }
  yearCache = map;
  return map;
}

/**
 * Parse an API post row (movie or series) into standard Dahsha/Flixer item.
 */
function formatItem(row, yearsMap, kind = 'movie') {
  const isMovie = kind === 'movie';
  const year = (row['release-year'] || []).map((id) => yearsMap?.get(id)).find(Boolean);
  const genres = (row.categories || []).map((id) => GENRE_ID_TO_NAME[id]).filter(Boolean);
  const title = plain(row.title?.rendered || row.title);
  const synopsis = plain(row.content?.rendered || row.excerpt?.rendered || row.synopsis || '');
  const slug = row.slug;
  const id = isMovie ? `mf:m:${slug}` : `mf:s:${slug}`;
  const poster = posterFor(row.id);
  const backdrop = fullPosterFor(row.id);

  return {
    id,
    wpId: row.id,
    slug,
    kind: isMovie ? 'film' : 'series',
    type: kind,
    title,
    synopsis,
    year: year ? Number(year) : null,
    genres: genres.length ? genres : ['Cinema'],
    tags: genres.map((g) => g.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
    poster: {
      default: poster,
      custom: poster,
      sd: poster,
      hq: backdrop,
      backdrop,
    },
    portrait: poster,
    publishedAt: row.date || row.date_gmt || null,
    sourceUrl: isMovie ? `${BASE}/${slug}/` : `${BASE}/series/${slug}/`,
    episodeCount: isMovie ? 1 : (row.episodeCount || 1),
    seasons: isMovie ? [1] : (row.seasons || [1]),
    episodes: isMovie ? [{
      id,
      title,
      slug,
      season: 1,
      number: 1,
      sourceUrl: `${BASE}/${slug}/`,
      thumbs: { default: poster, custom: poster },
    }] : [],
  };
}

/**
 * Fetch movies list with optional pagination, genre, year, search.
 */
export async function fetchMovies({ page = 1, perPage = 24, category, year, sort = 'modified', order = 'desc', search } = {}) {
  const years = await loadYearTerms();
  const params = new URLSearchParams({
    per_page: String(perPage),
    page: String(page),
    orderby: sort,
    order: order,
    _fields: 'id,slug,title,date,date_gmt,categories,release-year,excerpt,content',
  });

  if (category) {
    const catId = typeof category === 'number' ? category : GENRE_SLUG_TO_ID[category.toLowerCase()];
    if (catId) params.set('categories', String(catId));
  }
  if (search) params.set('search', search);

  const url = `${API}/posts?${params.toString()}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': DESKTOP_UA }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { items: [], total: 0, totalPages: 0, page };
    const total = Number(res.headers.get('x-wp-total') || 0);
    const totalPages = Number(res.headers.get('x-wp-totalpages') || 1);
    const rows = await res.json();
    const items = (Array.isArray(rows) ? rows : []).map((r) => formatItem(r, years, 'movie'));
    return { items, total, totalPages, page };
  } catch (err) {
    console.warn('[myflixer] fetchMovies error:', err.message);
    return { items: [], total: 0, totalPages: 0, page };
  }
}

/**
 * Fetch TV series list with optional pagination, genre, year, search.
 */
export async function fetchSeries({ page = 1, perPage = 24, category, year, sort = 'modified', order = 'desc', search } = {}) {
  const years = await loadYearTerms();
  const params = new URLSearchParams({
    per_page: String(perPage),
    page: String(page),
    orderby: sort,
    order: order,
    _fields: 'id,slug,title,date,date_gmt,categories,release-year,excerpt,content',
  });

  if (category) {
    const catId = typeof category === 'number' ? category : GENRE_SLUG_TO_ID[category.toLowerCase()];
    if (catId) params.set('categories', String(catId));
  }
  if (search) params.set('search', search);

  const url = `${API}/tvshows?${params.toString()}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': DESKTOP_UA }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { items: [], total: 0, totalPages: 0, page };
    const total = Number(res.headers.get('x-wp-total') || 0);
    const totalPages = Number(res.headers.get('x-wp-totalpages') || 1);
    const rows = await res.json();
    const items = (Array.isArray(rows) ? rows : []).map((r) => formatItem(r, years, 'series'));
    return { items, total, totalPages, page };
  } catch (err) {
    console.warn('[myflixer] fetchSeries error:', err.message);
    return { items: [], total: 0, totalPages: 0, page };
  }
}

/**
 * Search across both Movies and TV Series simultaneously.
 */
export async function searchContent(query, { perPage = 20 } = {}) {
  if (!query || !query.trim()) return [];
  const years = await loadYearTerms();
  const q = encodeURIComponent(query.trim());

  const [moviesRes, seriesRes] = await Promise.all([
    fetch(`${API}/posts?search=${q}&per_page=${perPage}&_fields=id,slug,title,date,categories,release-year,excerpt`, {
      headers: { 'User-Agent': DESKTOP_UA },
      signal: AbortSignal.timeout(10000),
    }).then((r) => r.ok ? r.json() : []).catch(() => []),
    fetch(`${API}/tvshows?search=${q}&per_page=${perPage}&_fields=id,slug,title,date,categories,release-year,excerpt`, {
      headers: { 'User-Agent': DESKTOP_UA },
      signal: AbortSignal.timeout(10000),
    }).then((r) => r.ok ? r.json() : []).catch(() => []),
  ]);

  const movies = (Array.isArray(moviesRes) ? moviesRes : []).map((r) => formatItem(r, years, 'movie'));
  const series = (Array.isArray(seriesRes) ? seriesRes : []).map((r) => formatItem(r, years, 'series'));

  return [...movies, ...series];
}

/**
 * Parse all seasons & episodes for a TV series from its page.
 */
export async function fetchSeriesEpisodes(slug) {
  const url = `${BASE}/series/${slug}/`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DESKTOP_UA, Referer: BASE },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const doc = await res.text();
    const out = [];
    const seen = new Set();
    const re = /"title":"((?:[^"\\]|\\.)*)","permalink":"((?:[^"\\]|\\.)*)","season":(\d+),"episode":(\d+)/g;
    let m;
    while ((m = re.exec(doc)) !== null) {
      const permalink = m[2].replace(/\\\//g, '/');
      const epSlug = /\/episodes\/([^/]+)\/?$/.exec(permalink)?.[1];
      if (!epSlug || seen.has(epSlug)) continue;
      seen.add(epSlug);
      let title = m[1];
      try { title = JSON.parse(`"${m[1]}"`); } catch {}
      const season = Number(m[3]);
      const episode = Number(m[4]);
      out.push({
        id: `mf:e:${epSlug}`,
        slug: epSlug,
        title: plain(title).replace(/^.*?\bS\d{1,3}\s*E\d{1,4}\b\s*[-–—:]?\s*/i, '').trim() || `Episode ${episode}`,
        season,
        number: episode,
        episode,
        sourceUrl: `${BASE}/episodes/${epSlug}/`,
      });
    }
    return out;
  } catch (err) {
    console.warn(`[myflixer] fetchSeriesEpisodes error for ${slug}:`, err.message);
    return [];
  }
}

/**
 * Get full title details (Movie or TV series, with all seasons and episodes).
 */
export async function getTitleDetails(rawId) {
  const id = decodeURIComponent(rawId);
  const isSeries = id.startsWith('mf:s:') || (!id.startsWith('mf:m:') && !id.startsWith('mf:e:') && false);
  const isMovie = id.startsWith('mf:m:') || (!isSeries && !id.startsWith('mf:e:'));
  const slug = id.replace(/^mf:[mse]:/, '');
  const years = await loadYearTerms();

  // Try fetching as movie or series
  let item = null;
  if (isSeries) {
    const res = await fetch(`${API}/tvshows?slug=${slug}&_fields=id,slug,title,date,categories,release-year,content,excerpt`, {
      headers: { 'User-Agent': DESKTOP_UA },
    });
    const rows = await res.json().catch(() => []);
    if (rows?.[0]) item = formatItem(rows[0], years, 'series');
  } else {
    const res = await fetch(`${API}/posts?slug=${slug}&_fields=id,slug,title,date,categories,release-year,content,excerpt`, {
      headers: { 'User-Agent': DESKTOP_UA },
    });
    const rows = await res.json().catch(() => []);
    if (rows?.[0]) item = formatItem(rows[0], years, 'movie');
  }

  // If not found as specified, try the opposite
  if (!item) {
    const fallbackRes = await fetch(`${API}/${isSeries ? 'posts' : 'tvshows'}?slug=${slug}&_fields=id,slug,title,date,categories,release-year,content,excerpt`, {
      headers: { 'User-Agent': DESKTOP_UA },
    });
    const fbRows = await fallbackRes.json().catch(() => []);
    if (fbRows?.[0]) item = formatItem(fbRows[0], years, isSeries ? 'movie' : 'series');
  }

  if (!item) return null;

  // If series, populate episodes
  if (item.kind === 'series') {
    const episodes = await fetchSeriesEpisodes(slug);
    if (episodes.length > 0) {
      item.episodes = episodes.map((ep) => ({
        ...ep,
        thumbs: { default: item.poster.default, custom: item.poster.default },
      }));
      item.episodeCount = episodes.length;
      const seasonsSet = [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b);
      item.seasons = seasonsSet.length ? seasonsSet : [1];
    }
  }

  return item;
}

/**
 * Fetch home page content: trending movies, trending series, and top genre rails.
 */
let homeCache = null;
let homeCacheTime = 0;
export async function fetchHomeContent() {
  const now = Date.now();
  if (homeCache && now - homeCacheTime < 300000) { // 5-min cache
    return homeCache;
  }

  const [trendingMovies, trendingSeries, action, scifi, comedy, horror] = await Promise.all([
    fetchMovies({ page: 1, perPage: 16, sort: 'modified' }),
    fetchSeries({ page: 1, perPage: 16, sort: 'modified' }),
    fetchMovies({ page: 1, perPage: 12, category: 'action' }),
    fetchMovies({ page: 1, perPage: 12, category: 'sci-fi' }),
    fetchMovies({ page: 1, perPage: 12, category: 'comedy' }),
    fetchMovies({ page: 1, perPage: 12, category: 'horror' }),
  ]);

  const featured = trendingMovies.items[0] || trendingSeries.items[0] || null;

  homeCache = {
    featured,
    trendingMovies: trendingMovies.items,
    trendingSeries: trendingSeries.items,
    rails: [
      { id: 'trending-movies', title: 'Trending Movies', titleAr: 'الأفلام الأكثر رواجاً', items: trendingMovies.items },
      { id: 'trending-series', title: 'Popular TV Series', titleAr: 'المسلسلات التلفزيونية الشائعة', items: trendingSeries.items },
      { id: 'action', title: 'Action & Adventure', titleAr: 'أفلام الحركة والمغامرة', items: action.items },
      { id: 'scifi', title: 'Sci-Fi & Fantasy', titleAr: 'الخيال العلمي والفانتازيا', items: scifi.items },
      { id: 'comedy', title: 'Comedy', titleAr: 'أفلام الكوميديا', items: comedy.items },
      { id: 'horror', title: 'Horror & Thriller', titleAr: 'الرعب والإثارة', items: horror.items },
    ],
  };
  homeCacheTime = now;
  return homeCache;
}

/**
 * Fetch a multi-genre catalog snapshot for static export.
 */
export async function fetchFullCatalog({ pagesPerGenre = 2 } = {}) {
  const years = await loadYearTerms();
  const allShows = [];
  const seenSlugs = new Set();

  console.log('[myflixer] fetching full movies & series catalog...');

  // 1. Fetch top pages of movies & series generally
  for (let p = 1; p <= 6; p++) {
    const [m, s] = await Promise.all([
      fetchMovies({ page: p, perPage: 50, sort: 'modified' }),
      fetchSeries({ page: p, perPage: 50, sort: 'modified' }),
    ]);
    for (const item of [...m.items, ...s.items]) {
      if (!seenSlugs.has(item.slug)) {
        seenSlugs.add(item.slug);
        allShows.push(item);
      }
    }
  }

  // 2. Fetch specific top genres
  const topGenreSlugs = ['action', 'comedy', 'drama', 'sci-fi', 'horror', 'thriller', 'animation', 'crime', 'romance', 'adventure'];
  for (const g of topGenreSlugs) {
    const res = await fetchMovies({ page: 1, perPage: 30, category: g });
    for (const item of res.items) {
      if (!seenSlugs.has(item.slug)) {
        seenSlugs.add(item.slug);
        allShows.push(item);
      }
    }
  }

  console.log(`[myflixer] catalog populated with ${allShows.length} titles.`);

  // Resolve episodes for top 100 TV series concurrently
  const seriesItems = allShows.filter((s) => s.kind === 'series').slice(0, 80);
  console.log(`[myflixer] resolving episodes for ${seriesItems.length} series...`);
  await Promise.all(seriesItems.map(async (s) => {
    try {
      const eps = await fetchSeriesEpisodes(s.slug);
      if (eps.length) {
        s.episodes = eps.map((ep) => ({ ...ep, thumbs: { default: s.poster.default, custom: s.poster.default } }));
        s.episodeCount = eps.length;
        s.seasons = [...new Set(eps.map((e) => e.season))].sort((a, b) => a - b);
      }
    } catch {}
  }));

  const tags = GENRES.map((g) => ({
    id: g.slug,
    label: g.name,
    labelEn: g.name,
    count: allShows.filter((s) => s.tags?.includes(g.slug)).length,
  }));

  return {
    shows: allShows,
    tags,
    generatedAt: new Date().toISOString(),
  };
}

// -------------------------------------------------------------------------------------------------
// STREAMING & PLAYER INTEGRATION (ALL 7 PLAYERS + PROXY)
// -------------------------------------------------------------------------------------------------

export function rewriteM3u8(content, baseUrl, proxyPrefix) {
  const lines = content.split('\n');
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      if (trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
          const full = uri.startsWith('http') ? uri : new URL(uri, baseUrl).href;
          return `URI="${proxyPrefix}?proxy=1&url=${encodeURIComponent(full)}"`;
        });
      }
      return line;
    }
    const full = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
    return `${proxyPrefix}?proxy=1&url=${encodeURIComponent(full)}`;
  });
  return rewritten.join('\n');
}

export async function handleStreamProxy(targetUrl, req, res, proxyPrefix = '/api/stream') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (!targetUrl || !targetUrl.startsWith('http')) {
    return res.status(400).send('Invalid target URL');
  }

  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'localhost';
  const proto = req?.headers?.['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  const baseOrigin = `${proto}://${host}`;
  const effectivePrefix = proxyPrefix.startsWith('http') ? proxyPrefix : `${baseOrigin}${proxyPrefix}`;

  const upstreamHeaders = {
    'User-Agent': DESKTOP_UA,
    Referer: 'https://sv2.nontongo.stream/',
    Origin: 'https://sv2.nontongo.stream',
  };
  if (req?.headers?.range) {
    upstreamHeaders.Range = req.headers.range;
  }

  try {
    const upstream = await fetch(targetUrl, { headers: upstreamHeaders });
    const cType = upstream.headers.get('content-type') || '';
    const status = upstream.status;

    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!upstream.ok) {
      res.status(status);
      if (cType) res.setHeader('Content-Type', cType);
      const errText = await upstream.text().catch(() => 'Upstream stream error');
      return res.send(errText);
    }

    if (cType.includes('mpegurl') || targetUrl.includes('.m3u8') || targetUrl.includes('file.m3u8')) {
      const text = await upstream.text();
      const rewritten = rewriteM3u8(text, targetUrl, effectivePrefix);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.status(200).send(rewritten);
    }

    res.status(status);
    if (cType) res.setHeader('Content-Type', cType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    const contentLen = upstream.headers.get('content-length');
    if (contentLen) res.setHeader('Content-Length', contentLen);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    const acceptRanges = upstream.headers.get('accept-ranges');
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

    if (!upstream.body) return res.end();

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    return res.end();
  } catch (err) {
    return res.status(500).send(err.message || 'Stream proxy error');
  }
}

export async function handleEmbedPlayer(id, req, res, proxyPrefix = '/api/stream') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', 'frame-ancestors *');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'localhost';
  const proto = req?.headers?.['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  const baseOrigin = `${proto}://${host}`;
  const effectivePrefix = proxyPrefix.startsWith('http') ? proxyPrefix : `${baseOrigin}${proxyPrefix}`;

  try {
    const data = await resolveMyflixerStream(id, effectivePrefix);
    const serversJson = JSON.stringify(data.servers || []);
    const title = id.replace(/^mf:[me]:/, '').replace(/-/g, ' ');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: #000; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .wrap { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
    .srv-bar { position: absolute; top: 10px; right: 10px; z-index: 50; display: flex; gap: 4px; background: rgba(10,11,13,0.85); backdrop-filter: blur(10px); padding: 4px 8px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.15); max-width: calc(100% - 20px); overflow-x: auto; scrollbar-width: none; }
    .srv-bar::-webkit-scrollbar { display: none; }
    .srv-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 3px 9px; border-radius: 12px; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
    .srv-btn.active { background: #38d7dd; color: #000; border-color: #38d7dd; box-shadow: 0 0 8px rgba(56,215,221,0.5); }
    .msg { color: #fff; text-align: center; font-size: 14px; opacity: 0.8; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js"></script>
</head>
<body>
  <div class="wrap">
    <div class="srv-bar" id="srvBar"></div>
    <div id="content" style="width:100%;height:100%;"></div>
  </div>
  <script>
    (function() {
      var servers = ${serversJson};
      var srvBar = document.getElementById('srvBar');
      var content = document.getElementById('content');
      var hls = null;
      var p2Idx = -1;
      for (var i = 0; i < servers.length; i++) {
        if (servers[i].name && servers[i].name.toLowerCase().indexOf('player 2') !== -1) {
          p2Idx = i;
          break;
        }
      }
      var currentIdx = p2Idx !== -1 ? p2Idx : 0;

      if (!servers.length) {
        document.body.innerHTML = '<div class="msg">No playback stream found</div>';
        return;
      }

      function renderBar() {
        if (servers.length <= 1) { srvBar.style.display = 'none'; return; }
        srvBar.innerHTML = '';
        servers.forEach(function(s, idx) {
          var btn = document.createElement('button');
          btn.className = 'srv-btn' + (idx === currentIdx ? ' active' : '');
          btn.textContent = s.name || ('Player ' + (idx + 1));
          btn.onclick = function() { loadStream(idx); };
          srvBar.appendChild(btn);
        });
      }

      function loadStream(idx) {
        currentIdx = idx;
        renderBar();
        var s = servers[idx];
        if (!s) return;

        if (hls) { hls.destroy(); hls = null; }

        if (s.type === 'embed' || (!s.streamUrl && (s.embedUrl || s.rawEmbedUrl))) {
          var embedSrc = s.embedUrl || s.rawEmbedUrl;
          content.innerHTML = '<iframe src="' + embedSrc + '" style="width:100%;height:100%;border:none;" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe>';
          return;
        }

        content.innerHTML = '<video id="player" controls playsinline preload="auto" style="width:100%;height:100%;object-fit:contain;background:#000;"></video>';
        var v = document.getElementById('player');

        if (v.canPlayType('application/vnd.apple.mpegurl')) {
          v.src = s.streamUrl;
          v.play().catch(function() {});
        } else if (window.Hls && Hls.isSupported()) {
          hls = new Hls({ enableWorker: true, lowLatencyMode: true });
          hls.loadSource(s.streamUrl);
          hls.attachMedia(v);
          hls.on(Hls.Events.MANIFEST_PARSED, function() { v.play().catch(function() {}); });
          hls.on(Hls.Events.ERROR, function(e, data) {
            if (data.fatal && currentIdx + 1 < servers.length) {
              console.warn('[embed] failing over to next server');
              loadStream(currentIdx + 1);
            }
          });
        } else {
          v.src = s.streamUrl;
          v.play().catch(function() {});
        }
      }

      loadStream(currentIdx);
    })();
  </script>
</body>
</html>`;
    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).send(`<div style="color:#fff;background:#000;padding:20px;font-family:sans-serif;">Embed resolution failed: ${err.message}</div>`);
  }
}

/**
 * Resolve playback streams and player embed for an episode or film.
 * Extracts all 7 player providers from Myflixer.
 */
export async function resolveMyflixerStream(id, proxyPrefix = '/api/stream') {
  const isMovie = id.startsWith('mf:m:');
  const slug = id.replace(/^mf:[mse]:/, '');
  const url = isMovie ? `${BASE}/${slug}/` : `${BASE}/episodes/${slug}/`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': DESKTOP_UA, Referer: BASE } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.text();

    // Extract all player tabs (Player 1, Player 2, Player 3, Player 4, Player 5, Player 6, Player 7)
    const tabs = [];
    const reTab = /<button[^>]*class="[^"]*player-tab-btn[^"]*"[^>]*data-player-url="([^"]+)"[^>]*>([\s\S]*?)<\/button>/gi;
    let mTab;
    while ((mTab = reTab.exec(doc)) !== null) {
      const pUrl = mTab[1].trim().replace(/&#038;/g, '&');
      const pName = mTab[2].replace(/<[^>]+>/g, '').trim() || `Player ${tabs.length + 1}`;
      if (pUrl && !tabs.some((t) => t.url === pUrl)) {
        tabs.push({ id: tabs.length + 1, name: pName, url: pUrl });
      }
    }

    const tag = /<iframe\b[^>]*id="main-player"[^>]*>/i.exec(doc)?.[0];
    const playerUrl = tag ? (/\bdata-src="([^"]+)"/i.exec(tag)?.[1] ?? /\bsrc="([^"]+)"/i.exec(tag)?.[1]) : (tabs[0]?.url || null);

    let hlsStreams = [];
    if (playerUrl && playerUrl.includes('soap/')) {
      try {
        const outer = await fetch(playerUrl, { headers: { 'User-Agent': DESKTOP_UA, Referer: url } });
        const outerText = await outer.text();
        const cfgMatch = /const cfg\s*=\s*(\{[\s\S]*?\});/.exec(outerText);
        if (cfgMatch) {
          const cfg = JSON.parse(cfgMatch[1]);
          const template = cfg?.servers?.map((s) => (cfg.type === 'tv' ? s.tv_url : s.movie_url)).find(Boolean);
          if (cfg?.tmdbId && template) {
            const inner = template
              .replace('{tmdb_id}', String(cfg.tmdbId))
              .replace('{season}', String(cfg.season ?? 1))
              .replace('{episode}', String(cfg.episode ?? 1));
            const innerRes = await fetch(inner, { headers: { 'User-Agent': DESKTOP_UA, Referer: playerUrl } });
            const innerDoc = await innerRes.text();
            const listed = JSON.parse(/const sources\s*=\s*(\[[\s\S]*?\]);/.exec(innerDoc)?.[1] ?? '[]');
            hlsStreams = listed.filter((s) => typeof s.file === 'string' && /^https:\/\//.test(s.file)).map((s) => ({
              uri: s.file.replace(/#.*$/, ''),
              mimeType: 'application/x-mpegURL',
              quality: s.html || 'HLS Stream',
              headers: { 'User-Agent': DESKTOP_UA, Referer: `${/^https?:\/\/[^/]+/.exec(inner)?.[0] ?? ''}/` },
            }));
          }
        }
      } catch (err) {
        console.warn('[myflixer] hls stream extract skipped:', err.message);
      }
    }

    const servers = [];

    // 1. Direct HLS servers from Player 1 (Soap2Day)
    if (hlsStreams.length > 0) {
      hlsStreams.forEach((s, idx) => {
        servers.push({
          id: `hls_${idx}`,
          name: `${s.quality || `Server ${idx + 1}`} (HLS)`,
          type: 'hls',
          streamUrl: `${proxyPrefix}?proxy=1&url=${encodeURIComponent(s.uri)}`,
          rawStreamUrl: s.uri,
        });
      });
    }

    // 2. All player providers from Myflixer (Player 1, Player 2, Player 3, Player 4, Player 5, Player 6, Player 7)
    tabs.forEach((tab) => {
      const isSoapHls = hlsStreams.length > 0 && tab.name.toLowerCase().includes('player 1') && tab.url.includes('soap/');
      if (!isSoapHls) {
        servers.push({
          id: `tab_${tab.id}`,
          name: tab.name, // "Player 2", "Player 3", etc.
          type: 'embed',
          embedUrl: tab.url,
          rawEmbedUrl: tab.url,
        });
      }
    });

    if (!servers.length && playerUrl) {
      servers.push({
        id: 'p1',
        name: 'Player 1',
        type: 'embed',
        embedUrl: playerUrl,
        rawEmbedUrl: playerUrl,
      });
    }

    const primaryHls = servers.find((s) => s.type === 'hls')?.streamUrl || null;
    const primaryEmbed = servers.find((s) => s.type === 'embed')?.embedUrl || playerUrl || url;
    const embedUrl = `${proxyPrefix}?embed=1&id=${encodeURIComponent(id)}`;

    return {
      id,
      sourceUrl: url,
      embedUrl,
      rawEmbedUrl: primaryEmbed,
      streamUrl: primaryHls,
      rawStreamUrl: hlsStreams[0]?.uri || null,
      servers,
      streams: hlsStreams.map((s, idx) => ({
        ...s,
        id: idx,
        name: s.quality || `Server ${idx + 1}`,
        proxyUri: `${proxyPrefix}?proxy=1&url=${encodeURIComponent(s.uri)}`,
      })),
    };
  } catch (e) {
    console.warn(`[myflixer] resolveMyflixerStream error for ${id}:`, e.message);
    return {
      id,
      sourceUrl: url,
      embedUrl: `${proxyPrefix}?embed=1&id=${encodeURIComponent(id)}`,
      rawEmbedUrl: url,
      streamUrl: null,
      rawStreamUrl: null,
      servers: [],
      streams: [],
      error: e.message,
    };
  }
}
