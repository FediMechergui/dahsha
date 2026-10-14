// Enriches the Flixer index with TVmaze data for series (keyless API): popularity weight, rating,
// network / web channel (streaming service), portrait image, status and the TVmaze id.
//   node server/src/enrich-tvmaze.js [catalog.json] [--out file]
// Walks TVmaze's full show index (~85k shows, 240 per page) once and matches by title + year.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const file = path.resolve(args.find((a) => !a.startsWith('--') && a !== opt('--out')) || path.join(__dirname, '../../client/public/data-flixer/catalog.json'));
const out = path.resolve(opt('--out') || file);

const key = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(the|a|an)\s+/, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

async function fetchPage(p) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`https://api.tvmaze.com/shows?page=${p}`, { signal: AbortSignal.timeout(15000) });
      if (res.status === 404) return null;
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 2500 * attempt)); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { if (attempt === 4) { console.warn(`[tvmaze] page ${p}: ${e.message}`); return []; } await new Promise((r) => setTimeout(r, 1000 * attempt)); }
  }
  return [];
}

async function run() {
  const t0 = Date.now();
  const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
  const series = cat.shows.filter((s) => s.kind === 'series');
  console.log(`[tvmaze] ${series.length} series to match`);

  // name -> candidates
  const index = new Map();
  let pages = 0, shows = 0;
  for (let p = 0; ; p++) {
    const rows = await fetchPage(p);
    if (rows === null) break;
    pages += 1;
    for (const s of rows) {
      shows += 1;
      const rec = { id: s.id, name: s.name, year: +String(s.premiered || '').slice(0, 4) || 0, w: s.weight || 0, r: (s.rating && s.rating.average) || 0, svc: (s.webChannel && s.webChannel.name) || (s.network && s.network.name) || null, img: s.image && s.image.medium ? s.image.medium : null, st: s.status || null, genres: s.genres || [], country: (s.network && s.network.country && s.network.country.code) || (s.webChannel && s.webChannel.country && s.webChannel.country.code) || null };
      const k = key(s.name);
      if (!k) continue;
      const arr = index.get(k); if (arr) arr.push(rec); else index.set(k, [rec]);
    }
    if (p % 50 === 0) console.log(`[tvmaze] page ${p}: ${shows} shows indexed`);
    await new Promise((r) => setTimeout(r, 120)); // stay well under TVmaze's rate limit
  }
  console.log(`[tvmaze] walked ${pages} pages, ${shows} shows`);

  let matched = 0;
  for (const s of series) {
    const cands = index.get(key(s.title));
    if (!cands || !cands.length) continue;
    const y = +s.year || 0;
    let hit = y ? cands.find((c) => c.year === y) || cands.find((c) => Math.abs(c.year - y) <= 1) : null;
    if (!hit && (cands.length === 1 || !y)) hit = cands.slice().sort((a, b) => b.w - a.w)[0];
    if (!hit) continue;
    s.tvm = { id: hit.id, w: hit.w, r: hit.r, svc: hit.svc, img: hit.img, st: hit.st, g: hit.genres, c: hit.country };
    matched += 1;
  }
  cat.tvmazeAt = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify(cat));
  const svc = new Map();
  series.forEach((s) => { if (s.tvm && s.tvm.svc) svc.set(s.tvm.svc, (svc.get(s.tvm.svc) || 0) + 1); });
  console.log(`[tvmaze] matched ${matched}/${series.length} series in ${Math.round((Date.now() - t0) / 1000)}s -> ${path.relative(process.cwd(), out)}`);
  console.log('[tvmaze] top services:', [...svc].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n} (${c})`).join(', '));
}

run().catch((e) => { console.error('[tvmaze] failed:', e); process.exit(1); });
