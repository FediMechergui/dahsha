// CLI helpers:  node src/cli.js rebuild   (full network refresh, then exit)
//               node src/cli.js build     (rebuild catalogue from cached data only)
import { Catalogue } from './scheduler.js';

const cmd = process.argv[2] || 'rebuild';
const c = new Catalogue();
c.on('status', (s) => {
  if (s.progress) process.stdout.write(`\r[${s.stage}] ${s.progress.done}/${s.progress.total}    `);
});

if (cmd === 'build') {
  const diff = c.rebuild();
  console.log(`built: ${c.catalog.stats.shows} shows, ${c.catalog.stats.episodes} episodes (new episodes ${diff.newEpisodes.length})`);
} else {
  const full = cmd === 'rebuild';
  const diff = await c.refresh({ full });
  console.log(`\nrefreshed: ${c.catalog.stats.shows} shows, ${c.catalog.stats.episodes} episodes, ${c.catalog.stats.totalHours}h (new episodes ${diff.newEpisodes.length})`);
}
process.exit(0);
