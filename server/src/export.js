// Exports the Flixer catalog as static JSON files for Vercel / mobile builds
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFullCatalog } from './myflixer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2] || path.join(__dirname, '../../client/public/data'));

async function run() {
  console.log('[export] fetching movies and tv series catalog for static deployment...');
  const cat = await fetchFullCatalog({ pagesPerGenre: 1 });

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'shows'), { recursive: true });

  const payload = {
    generatedAt: cat.generatedAt,
    shows: cat.shows,
    tags: cat.tags,
    channels: [{ id: 'myflixer', title: 'Flixer Cinema', name: 'Flixer Cinema' }],
  };

  fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(payload));
  fs.writeFileSync(path.join(outDir, 'catalog.en.json'), JSON.stringify(payload));
  fs.writeFileSync(path.join(outDir, 'catalog.ar.json'), JSON.stringify(payload));

  for (const s of cat.shows) {
    fs.writeFileSync(path.join(outDir, 'shows', `${encodeURIComponent(s.id)}.json`), JSON.stringify(s));
  }

  fs.writeFileSync(path.join(outDir, 'status.json'), JSON.stringify({
    static: true,
    generatedAt: cat.generatedAt,
    refreshing: false,
    stats: { shows: cat.shows.length, episodes: cat.shows.reduce((acc, s) => acc + (s.episodeCount || 1), 0) },
  }));

  console.log(`[export] exported ${cat.shows.length} titles to ${outDir}`);
}

run().catch((err) => {
  console.error('[export] failed:', err);
  process.exit(1);
});
