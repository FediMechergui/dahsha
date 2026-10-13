const BASE = 'https://myflixerz.day';
const API = `${BASE}/wp-json/wp/v2`;
export const DOCUMENTARY_CAT = 212;

function decodeXml(s = '') {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&apos;/g, "'");
}

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Comprehensive Category IDs -> Dahsha topics
export const CATEGORY_TAG_MAP = {
  236: 'history',            // History
  150: 'history',            // War
  220: 'history',            // Western
  2924983: 'politics',       // War & Politics
  241303: 'politics',        // News
  160: 'crime',              // Crime
  40: 'crime',               // Mystery
  45: 'crime',               // Thriller
  237: 'crime',              // Horror
  2343589: 'people-culture', // Biography
  238: 'people-culture',     // Music
  252374: 'people-culture',  // Musical
  46: 'people-culture',      // Comedy
  56: 'people-culture',      // Drama
  99: 'people-culture',      // Family
  130: 'people-culture',     // Romance
  97: 'people-culture',      // Animation
  2347584: 'people-culture', // Reality-TV
  2613490: 'people-culture', // Short
  2652335: 'people-culture', // Game-Show
  2647311: 'people-culture', // Talk-Show
  2340416: 'survival',       // Sport
  42: 'survival',            // Adventure
  2716699: 'science-space',  // Sci-Fi
  2924281: 'science-space',  // Science Fiction
  241300: 'science-space',   // Sci-Fi & Fantasy
  48: 'science-space',       // Fantasy
  212: 'documentary',        // Documentary
};

function plain(html = '') {
  return decodeXml(String(html).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function posterFor(postId) {
  return `${BASE}/wp-content/uploads/posters/${postId}_medium.jpg`;
}

let yearCache = null;

async function pool(items, fn, concurrency = 10) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i], i);
      } catch {
        results[i] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Fetch and cache the release-year taxonomy.
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
    console.warn('[myflixer] release-year lookup warning:', e.message);
  }
  yearCache = map;
  return map;
}

/**
 * Parse episodes from a TV show / docuseries page.
 */
export async function fetchSeriesEpisodes(slug) {
  const url = `${BASE}/series/${slug}/`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DESKTOP_UA, Referer: BASE },
      signal: AbortSignal.timeout(6000),
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
      out.push({
        slug: epSlug,
        title: plain(title).replace(/^.*?\bS\d{1,3}\s*E\d{1,4}\b\s*[-–—:]?\s*/i, '').trim(),
        season: Number(m[3]),
        episode: Number(m[4]),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Fetch documentary posts (films) and tvshows (docuseries) from WordPress REST API.
 */
export async function fetchMyflixerCatalog(source, { maxPages = 60 } = {}) {
  const years = await loadYearTerms();
  const films = [];
  const series = [];

  const LIST_FIELDS = 'id,slug,title,modified,date_gmt,categories,release-year,excerpt';

  // 1. Documentary Films (posts) - batched 6 pages concurrently
  console.log('[myflixer] paging documentary films (posts)...');
  for (let first = 1; first <= maxPages; first += 6) {
    const pages = Array.from({ length: Math.min(6, maxPages - first + 1) }, (_, i) => first + i);
    const outcomes = await Promise.all(pages.map(async (page) => {
      try {
        const res = await fetch(
          `${API}/posts?categories=${DOCUMENTARY_CAT}&per_page=100&page=${page}&orderby=modified&order=desc&_fields=${LIST_FIELDS}`,
          { headers: { 'User-Agent': DESKTOP_UA }, signal: AbortSignal.timeout(12000) }
        );
        if (!res.ok) return { ok: false, page, status: res.status };
        const rows = await res.json();
        return { ok: true, rows, page };
      } catch (e) {
        return { ok: false, page, err: e.message };
      }
    }));

    let ended = false;
    for (const out of outcomes) {
      if (!out.ok) { ended = true; break; }
      for (const row of out.rows) {
        const year = (row['release-year'] || []).map((id) => years.get(id)).find(Boolean);
        const tags = (row.categories || []).map((id) => CATEGORY_TAG_MAP[id]).filter(Boolean);
        const id = `mf:m:${row.slug}`;
        const title = plain(row.title?.rendered);
        const synopsis = plain(row.excerpt?.rendered);
        const thumb = posterFor(row.id);
        const publishedAt = row.date_gmt ? `${row.date_gmt}Z` : (row.modified || null);

        films.push({
          id,
          slug: row.slug,
          kind: 'film',
          title,
          synopsis,
          thumb,
          year: year ? Number(year) : null,
          durationSec: 5400, // 90 min default film length
          views: 75000,
          publishedAt,
          tags: tags.length ? tags : ['documentary'],
          sourceUrl: `${BASE}/${row.slug}/`,
        });
      }
      if (out.rows.length < 100) ended = true;
    }
    if (ended) break;
  }
  console.log(`[myflixer] fetched ${films.length} documentary films.`);

  // 2. Documentary Series (tvshows) - all pages
  console.log('[myflixer] paging documentary series (tvshows)...');
  const seriesRows = [];
  for (let page = 1; page <= Math.min(maxPages, 20); page++) {
    try {
      const res = await fetch(
        `${API}/tvshows?categories=${DOCUMENTARY_CAT}&per_page=100&page=${page}&orderby=modified&order=desc&_fields=${LIST_FIELDS}`,
        { headers: { 'User-Agent': DESKTOP_UA }, signal: AbortSignal.timeout(12000) }
      );
      if (!res.ok) break;
      const rows = await res.json();
      if (!Array.isArray(rows) || !rows.length) break;
      seriesRows.push(...rows);
      if (rows.length < 100) break;
    } catch (e) {
      console.warn(`[myflixer] series page ${page} error:`, e.message);
      break;
    }
  }
  console.log(`[myflixer] found ${seriesRows.length} docuseries rows. Resolving episodes with concurrency...`);

  // Concurrent episode resolution (12 workers)
  const resolvedSeries = await pool(seriesRows, async (row, idx) => {
    if (idx > 0 && idx % 100 === 0) console.log(`[myflixer] resolved episodes for ${idx}/${seriesRows.length} series...`);
    const year = (row['release-year'] || []).map((id) => years.get(id)).find(Boolean);
    const tags = (row.categories || []).map((id) => CATEGORY_TAG_MAP[id]).filter(Boolean);
    const id = `mf:s:${row.slug}`;
    const title = plain(row.title?.rendered);
    const synopsis = plain(row.excerpt?.rendered);
    const thumb = posterFor(row.id);
    const publishedAt = row.date_gmt ? `${row.date_gmt}Z` : (row.modified || null);

    const episodes = await fetchSeriesEpisodes(row.slug);
    return {
      id,
      slug: row.slug,
      kind: 'series',
      title,
      synopsis,
      thumb,
      year: year ? Number(year) : null,
      publishedAt,
      tags: tags.length ? tags : ['documentary'],
      sourceUrl: `${BASE}/series/${row.slug}/`,
      episodes: episodes.length ? episodes : [{ slug: row.slug, title: 'Full Series', season: 1, episode: 1 }],
    };
  }, 12);

  for (const s of resolvedSeries) {
    if (s) series.push(s);
  }
  console.log(`[myflixer] fetched ${series.length} docuseries.`);

  return { films, series };
}

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
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!targetUrl || !targetUrl.startsWith('http')) {
    return res.status(400).send('Invalid url parameter');
  }

  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'dahsha.vercel.app';
  const proto = req?.headers?.['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  const baseOrigin = `${proto}://${host}`;
  const effectivePrefix = proxyPrefix.startsWith('http') ? proxyPrefix : `${baseOrigin}${proxyPrefix}`;

  const upstreamHeaders = {
    'User-Agent': DESKTOP_UA,
    Referer: 'https://sv4.nontongo.day/',
    Origin: 'https://sv4.nontongo.day',
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

    if (!upstream.body) {
      return res.end();
    }

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

  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'dahsha.vercel.app';
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
    video { width: 100%; height: 100%; object-fit: contain; background: #000; }
    .srv-bar { position: absolute; top: 12px; right: 12px; display: flex; gap: 8px; z-index: 10; background: rgba(0,0,0,0.65); padding: 4px 8px; border-radius: 20px; backdrop-filter: blur(8px); }
    .srv-btn { background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 3px 10px; font-size: 11px; border-radius: 12px; cursor: pointer; transition: all 0.2s; font-weight: 600; }
    .srv-btn.active { background: #06b6d4; border-color: #06b6d4; color: #000; }
    .msg { color: #f87171; text-align: center; padding: 20px; font-size: 14px; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.11/dist/hls.min.js"></script>
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
      // Avoid duplicate Player 1 if already present as direct HLS
      const isSoapHls = hlsStreams.length > 0 && tab.name.toLowerCase().includes('player 1') && tab.url.includes('soap/');
      if (!isSoapHls) {
        servers.push({
          id: `tab_${tab.id}`,
          name: tab.name, // e.g. "Player 2", "Player 3", etc.
          type: 'embed',
          embedUrl: tab.url,
          rawEmbedUrl: tab.url,
        });
      }
    });

    // Fallback if no tabs found
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
    console.warn(`[myflixer] resolveMyflixerStream error for ${id}:`, e.message, e.cause || '');
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
