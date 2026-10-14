// Exports the complete Flixer catalogue index for the static client and the APK.
//   node server/src/export-index.js [outDir] [--episodes N] [--concurrency 4]
// Walks every page of the movie and series lists (through the existing fetchMovies/fetchSeries)
// and writes a lean index: no synopsis and no per-title files, because the client fetches details
// and episodes live when a title is opened. Episodes are pre-resolved for the N newest series so
// they work offline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCatalog } from './export-catalog.js';
import { fetchMovies, fetchSeries, fetchSeriesEpisodes, GENRES } from './myflixer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : def; };
const outDir = path.resolve(args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) || path.join(__dirname, '../../client/public/data-flixer'));
const EPISODES_FOR = opt('--episodes', 300);
const CONCURRENCY = opt('--concurrency', 4);
const PER_PAGE = 100;

async function pool(items, fn, n) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { throw e; } }
  }));
  return out;
}

function lean(s) {
  const o = { id: s.id, wpId: s.wpId, slug: s.slug, kind: s.kind, title: s.title, year: s.year, tags: s.tags, publishedAt: s.publishedAt };
  if (s.kind === 'series' && s.episodes?.length > 0) { o.episodes = s.episodes.map((e) => ({ id: e.id, slug: e.slug, title: e.title, season: e.season, number: e.number })); o.episodeCount = s.episodes.length; }
  return o;
}

async function walk(kind, fetchPage) {
  const first = await fetchPage(1);
  const totalPages = first.totalPages || 1;
  console.log(`[index] ${kind}: ${first.total} titles over ${totalPages} pages`);
  const rest = await pool(Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2), async (page) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await fetchPage(page);
      if (r.items.length || r.totalPages === 0) return r.items;
      await new Promise((res) => setTimeout(res, 800 * attempt));
    }
    throw new Error(`[index] ${kind} page ${page}: incomplete export`);
  }, CONCURRENCY);
  let done = 0;
  const all = [...first.items];
  for (const items of rest) { all.push(...(items || [])); if (++done % 50 === 0) console.log(`[index] ${kind}: ${done + 1}/${totalPages} pages`); }
  return all;
}

async function run() {
  const t0 = Date.now();
  const movies = await walk('movies', (page) => fetchMovies({ page, perPage: PER_PAGE, sort: 'modified' }));
  const series = await walk('series', (page) => fetchSeries({ page, perPage: PER_PAGE, sort: 'modified' }));

  const seen = new Set();
  const shows = [...movies, ...series].filter((s) => s && !seen.has(s.id) && seen.add(s.id));

  const newestSeries = shows.filter((s) => s.kind === 'series').sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))).slice(0, EPISODES_FOR);
  console.log(`[index] resolving episodes for the ${newestSeries.length} newest series...`);
  let resolved = 0;
  await pool(newestSeries, async (s) => {
    const eps = await fetchSeriesEpisodes(s.slug);
    if (eps.length) { s.episodes = eps; resolved += 1; }
  }, 8);
  console.log(`[index] episodes resolved for ${resolved} series`);

  const tags = GENRES.map((g) => ({ id: g.slug, label: g.name, labelEn: g.name, count: shows.filter((s) => s.tags?.includes(g.slug)).length }));
  const payload = { product: 'flixer', generatedAt: new Date().toISOString(), lite: true, shows: shows.map(lean), tags, channels: [{ id: 'myflixer', title: 'Flixer Cinema', name: 'Flixer Cinema' }] };

  writeCatalog(outDir, payload, 'flixer');
  const mb = (fs.statSync(path.join(outDir, 'catalog.json')).size / 1048576).toFixed(1);
  console.log(`[index] wrote ${shows.length} titles (${movies.length} films, ${series.length} series) to ${outDir} — ${mb} MB in ${Math.round((Date.now() - t0) / 1000)}s`);
}

run().catch((err) => { console.error('[index] failed:', err); process.exit(1); });
