// Cross-module handoffs applied by the integration step: provider merge statistics and episode titles,
// identity re-keying, artwork kept through a rules bump, Myflixer site dates and card recency.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// store.js fixes DATA_DIR at import time, so point it at a scratch directory first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-integration-'));
process.env.DATA_DIR = dir;
delete process.env.TMDB_API_KEY;
delete process.env.ARTWORK;
const { mergeLibrary, mergeShow, mergedSourceStats } = await import('../src/merge-library.js');
const { rekeyIdentities } = await import('../src/provider-sync.js');
const art = await import('../src/artwork.js');
const { buildCatalog } = await import('../src/catalog.js');
const { libraryHome, siteDatedRow } = await import('../src/library-service.js');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const writeData = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
const readData = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

test('the provider merge recounts stats.bySource and stats.classification over the merged cards', () => {
  const base = {
    sources: [{ id: 'UCa', title: 'Channel A' }, { id: 'myflixer', title: 'Myflixer Documentaries' }],
    stats: { shows: 2, bySource: { UCa: { title: 'Channel A', shows: 1, episodes: 3 }, myflixer: { title: 'Myflixer Documentaries', shows: 1, episodes: 1 } }, classification: { documentary: 0, uncertain: 1 } },
    shows: [
      { id: 's_a', title: 'Alpha', kind: 'series', lang: 'en', channelId: 'UCa', episodeCount: 3, episodes: [{ id: 'aaaaaaaaaaa' }, { id: 'bbbbbbbbbbb' }, { id: 'ccccccccccc' }], classification: { status: 'uncertain' } },
      { id: 's_b', title: 'Beta', kind: 'film', lang: 'en', channel: { id: 'myflixer' }, episodeCount: 1, episodes: [{ id: 'mf:m:beta' }] },
    ],
  };
  const rows = [{ id: 'fm:m:1', kind: 'film', title: 'Gamma', year: 2020, documentary: true, episodes: [] }];
  const { catalog } = mergeLibrary(base, rows, { product: 'dahsha' });
  assert.deepEqual(Object.keys(catalog.stats.bySource), ['UCa', 'myflixer', 'fmovies', 'hdtoday'], 'every source plus the provider channels');
  assert.deepEqual(catalog.stats.bySource.UCa, { title: 'Channel A', shows: 1, episodes: 3 });
  assert.equal(catalog.stats.bySource.fmovies.shows, 1, 'the added FMovies card is counted under fmovies');
  assert.equal(catalog.stats.bySource.hdtoday.shows, 0);
  assert.deepEqual(catalog.stats.classification, { documentary: 0, uncertain: 1 });
  // An episode of a programme group's show counts for the channel that uploaded it (its channelId).
  const shared = [{ ...base.shows[0], episodes: [{ id: 'aaaaaaaaaaa' }, { id: 'bbbbbbbbbbb', channelId: 'UCb' }, { id: 'ccccccccccc', channelId: 'UCzzz' }] }];
  const group = mergedSourceStats(base.stats, [...base.sources, { id: 'UCb', title: 'Channel B' }], shared).bySource;
  assert.deepEqual([group.UCa, group.UCb], [{ title: 'Channel A', shows: 1, episodes: 2 }, { title: 'Channel B', shows: 0, episodes: 1 }], 'an unknown channelId falls back to the card\'s channel');
  // An older catalogue (no bySource) or the per-group 'youtube' form is left as it is.
  assert.deepEqual(mergedSourceStats({ shows: 1 }, base.sources, base.shows), {});
  assert.deepEqual(mergedSourceStats({ bySource: { youtube: { shows: 1 } } }, base.sources, base.shows), {});
  assert.equal(mergeLibrary({ ...base, stats: { shows: 2 } }, rows, { product: 'dahsha' }).catalog.stats.bySource, undefined);
});

test('a provider episode title replaces an empty or placeholder one, never a real one', () => {
  const show = (title) => ({ id: 's_x', kind: 'series', title: 'X', episodes: [{ id: 'mf:e:x-1', season: 1, number: 1, title }] });
  const incoming = (title) => ({ id: 'fm:s:1', kind: 'series', title: 'X', episodes: [{ id: 'fm:e:1', season: 1, number: 1, title }] });
  assert.equal(mergeShow(show(''), incoming('The Real Name')).episodes[0].title, 'The Real Name');
  assert.equal(mergeShow(show('Episode #24.1'), incoming('The Real Name')).episodes[0].title, 'The Real Name');
  assert.equal(mergeShow(show('Episode 3'), incoming('The Real Name')).episodes[0].title, 'The Real Name');
  assert.equal(mergeShow(show(''), incoming('Episode 1')).episodes[0].title, '', 'a placeholder does not replace another placeholder');
  assert.equal(mergeShow(show('Own Title'), incoming('The Real Name')).episodes[0].title, 'Own Title');
});

test('identities of renamed shows follow their live id unless that id has its own', () => {
  const identities = { s_old: { at: 1, metadata: { year: 2001 } }, s_gone: { at: 2, metadata: { year: 2002 } }, s_live: { at: 3, metadata: { year: 2003 } }, s_keep: { at: 4, metadata: {} } };
  const out = rekeyIdentities(identities, { s_old: 's_new', s_gone: 's_live', s_bad: 42 });
  assert.deepEqual(out.s_new, { at: 1, metadata: { year: 2001 } });
  assert.equal(out.s_old, undefined);
  assert.deepEqual(out.s_live, { at: 3, metadata: { year: 2003 } }, 'the live show keeps its own identity');
  assert.ok(out.s_gone, 'not moved over an existing identity');
  assert.ok(out.s_keep);
  assert.equal(identities.s_new, undefined, 'the input is not changed');
  assert.deepEqual(rekeyIdentities(null, null), {});
});

test('a cached match the current rules no longer find is kept as fuzzy, so artwork.json keeps its matched count', async () => {
  const DAY = 864e5;
  writeData('artwork.json', { s_old: { source: 'tvmaze', confidence: 'exact', v: 1, tvmazeId: 99, name: 'Ocean Giants', poster: 'https://static.tvmaze.com/x/99.jpg', checkedAt: new Date(Date.now() - 200 * DAY).toISOString(), downgraded: ['rules'] } });
  art.resetArtworkCache();
  const shows = [{ id: 's_old', title: 'Ocean Giants', kind: 'series', lang: 'en', firstAt: '2015-01-01T00:00:00Z' }];
  const fetch = async () => ({ status: 404, ok: false, headers: { get: () => null }, json: async () => null });
  const view = await art.enrichArtwork(shows, { log: () => {}, sleep: async () => {}, aliases: {}, tmdbKey: '', fetch });
  assert.equal(view.s_old, undefined, 'no longer shown');
  const entry = readData('artwork.json').s_old;
  assert.equal(entry.source, 'tvmaze', 'still counted as matched');
  assert.equal(entry.confidence, 'fuzzy');
  assert.equal(entry.tvmazeId, 99);
  assert.equal(entry.downgraded, undefined, 'the online check settled the offline downgrade');
  assert.equal(entry.misses, 1);
  assert.equal(entry.v, 3);
  assert.ok(entry.notFoundAt);
});

test('artwork of an uncertain version grouped inside a card is not pruned', async () => {
  const fresh = new Date().toISOString();
  const exact = (id) => ({ source: 'tmdb', confidence: 'exact', v: 3, checkedAt: fresh, forTitle: id, tmdbChecked: true, poster: `https://image.tmdb.org/t/p/w500/${id}.jpg` });
  writeData('artwork.json', { s_card: exact('Card'), 'fm:m:9': exact('Version'), s_dead: exact('Dead') });
  art.resetArtworkCache();
  const catalog = { idAliases: {}, shows: [{ id: 's_card', title: 'Card', kind: 'film', lang: 'en', portrait: 'https://example.com/p.jpg', synopsis: 'Its own synopsis.', versions: [{ id: 'fm:m:9', title: 'Card' }] }] };
  await art.enrichArtwork(catalog, { log: () => {}, sleep: async () => {}, aliases: {}, tmdbKey: '', maxPerRun: 0, fetch: async () => { throw new Error('no network'); } });
  const cached = readData('artwork.json');
  assert.ok(cached['fm:m:9'], 'the version id counts as live');
  assert.ok(cached.s_card);
  assert.equal(cached.s_dead, undefined, 'an entry of no live show or version is pruned');
});

test('Myflixer dates without an offset are site time (+03:00), whatever the build machine zone', () => {
  const myflixer = { type: 'myflixer', id: 'myflixer', title: 'Myflixer Documentaries', short: 'Myflixer', lang: 'en', profile: 'myflixer' };
  const film = { id: 'mf:m:river', title: 'River', showTitle: 'River', episodeTitle: 'Full film', parsed: { showTitle: 'River', episodeTitle: 'Full film', kind: 'film', number: null, season: null }, durationSec: 0, thumb: 'https://example.com/river.jpg' };
  const playlists = { 'MYFLIXER:myflixer': { id: 'MYFLIXER:myflixer', sourceId: 'myflixer', title: 'Myflixer Documentaries', videos: [film] } };
  const at = (publishedAt) => buildCatalog({ sources: [myflixer], playlists, details: { 'mf:m:river': { title: 'River', durationSec: 0, publishedAt } }, seen: {}, overrides: {} }).shows[0].episodes[0].publishedAt;
  assert.equal(at('2026-09-11T16:17:50'), '2026-09-11T13:17:50.000Z');
  assert.equal(at('2026-09-11T13:17:50.000Z'), '2026-09-11T13:17:50.000Z', 'a stored UTC date is kept');
  assert.equal(at('not a date'), null);
  assert.deepEqual(siteDatedRow({ id: 'mf:m:x', publishedAt: '2026-09-11T16:17:50', latestAt: '2026-09-12T00:00:00Z', firstAt: null }),
    { id: 'mf:m:x', publishedAt: '2026-09-11T13:17:50.000Z', latestAt: '2026-09-12T00:00:00.000Z', firstAt: null });
});

test('library home orders cards by updatedAt ?? latestAt; a bulk crawl time does not outrank dated cards', () => {
  const catalog = { shows: [
    { id: 'fm:m:bulk', kind: 'film', title: 'Bulk', providerUpdatedAt: '2026-10-14T00:00:00Z' },
    { id: 's_old', kind: 'film', title: 'Old', latestAt: '2026-01-01T00:00:00Z' },
    { id: 's_new', kind: 'film', title: 'New', latestAt: '2026-10-01T00:00:00Z' },
    { id: 'fm:m:found', kind: 'film', title: 'Found', updatedAt: '2026-10-10T00:00:00Z', providerUpdatedAt: '2026-10-14T00:00:00Z' },
  ] };
  assert.deepEqual(libraryHome(catalog).trendingMovies.map((s) => s.id), ['fm:m:found', 's_new', 's_old', 'fm:m:bulk']);
});

test('parts of one numbered episode ("… | PART 1" / "… | PART 2") of similar length stay two episodes', () => {
  const history = { type: 'channel', id: 'UChistory', title: 'HISTORY', short: 'HISTORY', lang: 'en', profile: 'history', brands: ['History', 'HISTORY'] };
  const ids = { p1: 'lPYIGp4XZGQ', p2: 'NrBLY3daxDY', full: 'E8epmFE25xY', copy: 'RojV_bhSbqM' };
  const titles = {
    [ids.p1]: 'Three Evil Leaders Who Changed the World | Nostradamus Effect (S1, E1) | PART 1 | History',
    [ids.p2]: 'Three Evil Leaders Who Changed the World | Nostradamus Effect (S1, E1) | PART 2 | History',
    [ids.full]: 'Nostradamus Effect: The Third Antichrist (S1, E1) | Full Episode | History',
    [ids.copy]: 'The Third Antichrist? (S1, E1) | Nostradamus Effect | Full Episode',
  };
  const durations = { [ids.p1]: 576, [ids.p2]: 587, [ids.full]: 2712, [ids.copy]: 2706 };
  const videos = Object.keys(titles).map((id) => ({ id, title: titles[id] }));
  const details = Object.fromEntries(videos.map((v) => [v.id, { title: v.title, durationSec: durations[v.id], publishedAt: '2024-01-01T00:00:00Z' }]));
  const catalog = buildCatalog({ sources: [history], playlists: { PLnostra: { id: 'PLnostra', sourceId: history.id, title: 'Nostradamus Effect | Full Episodes', videos } }, details, seen: {}, overrides: { minEpisodeSeconds: 420 } });
  const episodes = catalog.shows.flatMap((s) => s.episodes);
  const of = (id) => episodes.find((e) => e.id === id || e.offerings?.some((o) => o.id === id));
  assert.notEqual(of(ids.p1), of(ids.p2), 'PART 1 and PART 2 are two episodes');
  assert.ok(of(ids.p1) && of(ids.p2));
  assert.equal(of(ids.full), of(ids.copy), 'the re-titled full episode is still one episode with its copy');
});

test('an upload dated only by its age text is dated from the time it was listed', () => {
  const src = { type: 'channel', id: 'UCcreator', title: 'Creator', lang: 'en', profile: 'creator' };
  const id = 'abcdefghijk';
  const playlists = { [`UPLOADS:${src.id}`]: { id: `UPLOADS:${src.id}`, sourceId: src.id, isUploads: true, title: '__uploads__', fetchedAt: '2026-10-18T00:00:00Z', videos: [{ id, title: 'A Long Film', relative: '3 weeks ago', listedAt: '2026-10-18T00:00:00.000Z', durationSec: 2700 }] } };
  const catalog = buildCatalog({ sources: [src], playlists, details: { [id]: { title: 'A Long Film', durationSec: 2700 } }, seen: { [id]: '2026-08-01T00:00:00.000Z' }, overrides: {} });
  const e = catalog.shows[0].episodes[0];
  assert.equal(e.publishedApprox, true);
  assert.equal(e.publishedAt, '2026-09-27T00:00:00.000Z', 'three weeks before the listing, not before the first-seen date');
});

test('tidyCase writes a plural acronym with a small s, and leaves the rest of its rules alone', async () => {
  const { tidyCase } = await import('../src/text.js');
  assert.equal(tidyCase('MONSTERS & UFOS INFILTRATE NYC'), 'Monsters & UFOs Infiltrate NYC');
  assert.equal(tidyCase('UFO SIGHTINGS ACROSS THE USA'), 'UFO Sightings Across the USA');
  assert.equal(tidyCase('THE ISIS FILES: INSIDE THE CIA'), 'The ISIS Files: Inside the CIA');
  assert.equal(tidyCase('Already Mixed Case UFOS'), 'Already Mixed Case UFOS', 'only all-caps titles are touched');
});

test('a numbered generic episode reads "Part N" when its own title numbers it as a part, else "Episode N"', () => {
  const vice = { type: 'channel', id: 'UCvice', title: 'VICE News', short: 'VICE News', lang: 'en', profile: 'generic-en', brands: ['VICE News', 'VICE'] };
  const rows = [['bokoharam01', 'The War Against Boko Haram (Part 1)'], ['bokoharam02', 'The War Against Boko Haram (Part 2)'], ['bokoharam03', 'The War Against Boko Haram (Part 3)']];
  const crux = [['thecrux0001', 'The Crux Episode 1 | Full Episode'], ['thecrux0002', 'The Crux Episode 2 | Full Episode']];
  const videos = rows.map(([id, title]) => ({ id, title }));
  const details = Object.fromEntries([...rows, ...crux].map(([id, title]) => [id, { title, durationSec: 900, publishedAt: '2015-01-01T00:00:00Z' }]));
  const catalog = buildCatalog({ sources: [vice], playlists: { PLboko: { id: 'PLboko', sourceId: vice.id, title: 'The War Against Boko Haram', videos }, PLcrux: { id: 'PLcrux', sourceId: vice.id, title: 'The Crux', videos: crux.map(([id, title]) => ({ id, title })) } }, details, seen: {}, overrides: {} });
  const show = catalog.shows.find((s) => s.episodes.some((e) => e.id === 'bokoharam01'));
  assert.equal(show.episodes.length, 3);
  assert.deepEqual(show.episodes.map((e) => e.title), ['Part 1', 'Part 2', 'Part 3']);
  const other = catalog.shows.find((s) => s.episodes.some((e) => e.id === 'thecrux0001'));
  assert.deepEqual(other.episodes.map((e) => e.title), ['Episode 1', 'Episode 2'], 'numbered as episodes, not parts');
});

test('Asharq: a subtitle that starts with "موسم" but has no number is the episode title, not a season', async () => {
  const { parseTitle } = await import('../src/text.js');
  const src = { id: 'UCasharq', title: 'Discovery الشرق', lang: 'ar', profile: 'asharq', brands: ['الشرق ديسكفري'] };
  assert.deepEqual(parseTitle('حمى الذهب - موسم الرياح - الحلقة 9 - الموسم الثالث | الشرق ديسكفري', src), { showTitle: 'حمى الذهب', episodeTitle: 'موسم الرياح', number: 9, season: 3, kind: 'series', label: null });
  assert.equal(parseTitle('حمى الذهب - الموسم 3 - الحلقة 2 | الشرق ديسكفري', src).season, 3);
  assert.equal(parseTitle('حمى الذهب - الحلقة 9 - الموسم الثالث | الشرق ديسكفري', src).episodeTitle, 'الحلقة 9');
});
