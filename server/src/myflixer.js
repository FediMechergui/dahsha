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

/**
 * Resolve playback streams and player embed for an episode or film.
 */
export async function resolveMyflixerStream(id) {
  const isMovie = id.startsWith('mf:m:');
  const slug = id.replace(/^mf:[mse]:/, '');
  const url = isMovie ? `${BASE}/${slug}/` : `${BASE}/episodes/${slug}/`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': DESKTOP_UA, Referer: BASE } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.text();

    const tag = /<iframe\b[^>]*id="main-player"[^>]*>/i.exec(doc)?.[0];
    const playerUrl = tag ? (/\bdata-src="([^"]+)"/i.exec(tag)?.[1] ?? /\bsrc="([^"]+)"/i.exec(tag)?.[1]) : null;

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

    return {
      id,
      sourceUrl: url,
      embedUrl: playerUrl || url,
      streamUrl: hlsStreams[0]?.uri || null,
      streams: hlsStreams,
    };
  } catch (e) {
    return {
      id,
      sourceUrl: url,
      embedUrl: url,
      streams: [],
      error: e.message,
    };
  }
}
