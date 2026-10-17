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
} else if (cmd === 'poll') {
  try {
    const diff = await c.fastPoll();
    console.log(`polled: ${diff?.newEpisodes?.length || 0} new episodes`);
  } catch (error) {
    console.error(error.message);
    process.exit(error.code === 'INGESTION_EMPTY' ? 3 : 1);
  }
} else {
  const full = cmd === 'rebuild';
  const diff = await c.refresh({ full }).catch(error => {
    console.error(error.message);
    process.exit(error.code === 'INGESTION_EMPTY' ? 3 : 1);
  }); // includes TMDB artwork enrichment when TMDB_API_KEY is set
  console.log(`\nrefreshed: ${c.catalog.stats.shows} shows, ${c.catalog.stats.episodes} episodes, ${c.catalog.stats.totalHours}h (new episodes ${diff.newEpisodes.length})`);
}
process.exit(0);
