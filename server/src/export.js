// Exports the catalogue as static JSON files for the Vercel / mobile builds (no server needed).
//   node src/export.js [outDir]     default outDir: ../client/public/data
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalogue } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2] || path.join(__dirname, '../../client/public/data'));

const c = new Catalogue();
if (!c.catalog) { console.error('no catalogue on disk - run "npm run rebuild" first'); process.exit(1); }
// Rebuild from cache so overrides/code changes are reflected without a network refresh.
c.rebuild();
const cat = c.catalog;

const liteEpisode = (e) => ({
  id: e.id,
  title: e.title,
  number: e.number,
  season: e.season,
  durationSec: e.durationSec,
  publishedAt: e.publishedAt,
  views: e.views,
  thumbs: e.thumbs?.custom ? e.thumbs : undefined,
  sourceUrl: e.sourceUrl || undefined,
  embedUrl: e.embedUrl || undefined,
});
const liteShow = (s) => ({
  id: s.id, title: s.title, kind: s.kind, channelId: s.channel?.id, lang: s.lang, contentLang: s.contentLang, tags: s.tags, primaryTag: s.primaryTag,
  episodeCount: s.episodeCount, posterId: s.posterVideoId, latestAt: s.latestAt, firstAt: s.firstAt, totalViews: s.totalViews,
  totalDurationSec: s.totalDurationSec, seasons: s.seasons, synopsisGenerated: s.synopsisGenerated,
  poster: s.poster?.custom ? s.poster : undefined, portrait: s.portrait || undefined, tmdbId: s.tmdbId || undefined,
  blurb: (s.synopsis || '').length > 220 ? `${s.synopsis.slice(0, 220).replace(/\s+\S*$/, '')}…` : s.synopsis,
  altTitles: (s.altTitles || []).slice(0, 3), episodes: s.episodes.map(liteEpisode),
});
const slimEpisode = ({ fullTitle, playlistIds, viewsText, publishedApprox, addedAt, ...e }) => e;
const fullShow = ({ key, promos, playlistIds, ...s }) => ({ ...s, episodes: s.episodes.map(slimEpisode) });

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'shows'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify({ ...cat, lite: true, shows: cat.shows.map(liteShow) }));
// One file per language so the client only loads the active section.
for (const lang of ['ar', 'en']) {
  const shows = cat.shows.filter((s) => (s.lang || 'ar') === lang);
  fs.writeFileSync(path.join(outDir, `catalog.${lang}.json`), JSON.stringify({ ...cat, lite: true, lang, shows: shows.map(liteShow), channels: cat.channels.filter((c) => (c.lang || 'ar') === lang) }));
}
for (const s of cat.shows) fs.writeFileSync(path.join(outDir, 'shows', `${s.id}.json`), JSON.stringify(fullShow(s)));
fs.writeFileSync(path.join(outDir, 'status.json'), JSON.stringify({ static: true, generatedAt: cat.generatedAt, lastRefreshAt: cat.generatedAt, stats: cat.stats, refreshing: false }));
fs.writeFileSync(path.join(outDir, 'sources.json'), JSON.stringify({ sources: c.sources.map(({ brands, ...s }) => s) }));

const size = (f) => (fs.statSync(f).size / 1024).toFixed(0);
console.log(`exported ${cat.stats.shows} shows / ${cat.stats.episodes} episodes to ${outDir} (catalog.json ${size(path.join(outDir, 'catalog.json'))} KB)`);
