// CLI helpers:  node src/cli.js rebuild   (full network refresh, then exit)
//               node src/cli.js build     (rebuild catalogue from cached data only)
import { Catalogue } from './scheduler.js';

const cmd = process.argv[2] || 'rebuild';
const c = new Catalogue();
// In a terminal the progress line rewrites itself; in CI logs each update gets its own line, so the
// per-channel log lines never start in the middle of a progress line.
const tty = process.stdout.isTTY;
c.on('status', (s) => {
  if (s.progress) process.stdout.write(tty ? `\r[${s.stage}] ${s.progress.done}/${s.progress.total}    ` : `[${s.stage}] ${s.progress.done}/${s.progress.total}\n`);
});
// Show ids are kept stable against this catalogue (catalog.json as restored), so say which one it is.
if (c.catalog) {
  console.log(`[catalogue] previous catalogue: ${c.catalog.shows?.length ?? 0} shows, ${Object.keys(c.catalog.idAliases || {}).length} id aliases, generated ${c.catalog.generatedAt || 'unknown'}`);
} else {
  const ids = c.idState
    ? `show ids kept from show-ids.json (${Object.keys(c.idState.units || {}).length} shows)`
    : 'show ids are assigned from scratch and earlier ids get no aliases';
  // With cached data but no catalogue, ids may change: shown as an annotation in Actions.
  const cached = Object.keys(c.playlists || {}).length > 0 || Object.keys(c.details || {}).length > 0;
  console.log(cached ? `::warning::[catalogue] no previous catalogue (catalog.json): ${ids}` : `[catalogue] no previous catalogue (catalog.json): ${ids}`);
}

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
