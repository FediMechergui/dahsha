// Moves per-series episode lists out of the Flixer index into data/shows/<id>.json files, so the
// index stays small (the client loads a series' episodes when it is opened).
//   node server/src/split-episodes.js [dataDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.argv[2] || path.join(__dirname, '../../client/public/data'));
const file = path.join(dataDir, 'catalog.json');
const showsDir = path.join(dataDir, 'shows');

const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
fs.rmSync(showsDir, { recursive: true, force: true });
fs.mkdirSync(showsDir, { recursive: true });
let moved = 0, episodes = 0;
for (const s of cat.shows) {
  if (!Array.isArray(s.episodes)) continue;
  if (s.episodes.length > 1 || s.kind === 'series') {
    fs.writeFileSync(path.join(showsDir, `${encodeURIComponent(s.id)}.json`), JSON.stringify({ id: s.id, episodes: s.episodes }));
    s.episodeCount = s.episodes.length;
    s.seasons = [...new Set(s.episodes.map((e) => e.season || 1))].sort((a, b) => a - b);
    moved += 1; episodes += s.episodes.length;
  }
  delete s.episodes;
}
fs.writeFileSync(file, JSON.stringify(cat));
const mb = (fs.statSync(file).size / 1048576).toFixed(1);
console.log(`[split] ${moved} series (${episodes} episodes) moved to ${path.relative(process.cwd(), showsDir)}; index is now ${mb} MB`);
