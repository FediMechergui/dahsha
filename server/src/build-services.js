// Builds data/services.json: logos for the streaming services and networks that Flixer's series
// air or stream on (TVmaze data in the index), resolved on Wikidata (logo P154), with a Commons
// file search as fallback. Counts are recomputed live in the app; this file only carries logos.
//   node server/src/build-services.js [dataDir] [--top 60]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const topIdx = argv.indexOf('--top');
const TOP = topIdx >= 0 ? Number(argv[topIdx + 1]) : 60;
const dataDir = path.resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--top') || path.join(__dirname, '../../client/public/data'));
const UA = 'Flixer/1.4 (https://github.com/FediMechergui/flixer; catalogue build)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (res.status === 429 || res.status === 503) { await sleep(2500 * i); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { if (i === tries) return null; await sleep(1200 * i); }
  }
  return null;
}
const filePath = (f) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(f).replace(/^File:/, '').replace(/ /g, '_'))}?width=320`;
const HINTS = /streaming|video on demand|subscription|television (network|channel|station)|broadcaster|cable|channel|network|web television|online video platform|public service/i;

async function logoFor(name) {
  const d = await getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&limit=10`);
  const list = (d && d.search) || [];
  const pick = list.find((s) => s.description && HINTS.test(s.description)) || null;
  if (pick) {
    const e = await getJson(`https://www.wikidata.org/wiki/Special:EntityData/${pick.id}.json`);
    const ent = e && e.entities && e.entities[pick.id];
    const claim = ent && ent.claims && ent.claims.P154 && ent.claims.P154[0] && ent.claims.P154[0].mainsnak.datavalue;
    if (claim) return { logo: filePath(claim.value), qid: pick.id, via: 'wikidata' };
  }
  const words = name.toLowerCase().replace(/[^a-z0-9+ ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
  const c = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srlimit=10&format=json&srsearch=${encodeURIComponent(name + ' logo')}`);
  const hit = ((c && c.query && c.query.search) || []).map((x) => x.title).find((t) => /logo/i.test(t) && /\.(svg|png)$/i.test(t) && words.every((w) => t.toLowerCase().includes(w)));
  return hit ? { logo: filePath(hit), qid: pick ? pick.id : null, via: 'commons' } : { logo: null, qid: pick ? pick.id : null, via: null };
}

async function run() {
  const t0 = Date.now();
  const cat = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8'));
  const counts = new Map();
  cat.shows.forEach((s) => { if (s.kind === 'series' && s.tvm && s.tvm.svc) counts.set(s.tvm.svc, (counts.get(s.tvm.svc) || 0) + 1); });
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, TOP);
  const out = [];
  for (const [name, count] of top) {
    const r = await logoFor(name);
    out.push({ name, count, logo: r.logo, qid: r.qid });
    console.log(`[services] ${name} (${count}) ${r.logo ? '· logo via ' + r.via : '· no logo'}`);
    await sleep(300);
  }
  fs.writeFileSync(path.join(dataDir, 'services.json'), JSON.stringify({ generatedAt: new Date().toISOString(), services: out }));
  console.log(`[services] wrote ${out.length} services, ${out.filter((s) => s.logo).length} with logos, in ${Math.round((Date.now() - t0) / 1000)}s`);
}

run().catch((e) => { console.error('[services] failed:', e); process.exit(1); });
