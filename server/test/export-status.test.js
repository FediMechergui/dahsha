// What the static export ships about freshness: status.json (stats incl. contract 3, id alias count,
// enrichment sources, per-provider freshness), the show-level updatedAt / discoveredAt and episode addedAt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// store.js fixes DATA_DIR at import time (artwork.js reads through it), so point it at a scratch directory first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-export-status-'));
process.env.DATA_DIR = dir;
const { leanCatalog, writeCatalog, exportStatus, enrichmentStatus, exportedAddedAt, exportedShow } = await import('../src/export-catalog.js');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const providerSync = {
  lastRefreshAt: '2026-10-18T18:39:23.854Z', lastAttemptAt: '2026-10-18T18:39:23.854Z', completed: false, remainingPartitions: 1,
  errors: { hdtoday: 'HDToday HTTP 403' }, sourceRecords: 2, skippedRecords: 0, baselineAt: '2026-10-15T00:00:00.000Z',
  providers: {
    fmovies: { lastAttemptAt: '2026-10-18T18:39:23.854Z', lastSuccessAt: '2026-10-18T18:39:23.854Z', lastNewRecordAt: '2026-10-16T18:36:09.302Z', lastError: null, lastErrorAt: null, consecutiveFailures: 0, records: 1 },
    hdtoday: { lastAttemptAt: '2026-10-18T18:39:23.854Z', lastSuccessAt: '2026-10-14T20:33:56.051Z', lastNewRecordAt: '2026-10-14T20:33:56.051Z', lastError: 'HDToday HTTP 403', lastErrorAt: '2026-10-18T18:39:23.854Z', consecutiveFailures: 3, records: 1 },
  },
};
const mfSeries = {
  id: 's_giwba2', kind: 'series', title: "Harlan Coben's Final Twist", lang: 'en', channel: { id: 'myflixer' }, latestAt: '2026-10-12T09:00:00.000Z',
  episodes: [
    { id: 'mf:e:final-twist-1x1', season: 1, number: 1, publishedAt: '2026-01-17T20:00:42.000Z', addedAt: '2026-10-15T01:02:03.000Z' }, // bulk first-seen stamp
    { id: 'mf:e:final-twist-2x2', season: 2, number: 2, publishedAt: '2026-01-17T20:00:42.000Z', addedAt: '2026-10-12T09:00:00.000Z' }, // counted in latestAt
  ],
};
const ytShow = { id: 's_yt', kind: 'series', title: 'A Channel Show', lang: 'en', channel: { id: 'UCx' }, latestAt: '2026-10-18T10:00:00.000Z',
  episodes: [{ id: 'ABCDEFGHIJK', season: 1, number: 1, publishedAt: '2020-01-01T00:00:00.000Z', addedAt: '2026-10-15T01:02:03.000Z' }] };
const discovered = { id: 'fm:m:9999001', kind: 'film', title: 'A Brand New Documentary', lang: 'en', channelId: 'fmovies', latestAt: null, updatedAt: '2026-10-19T08:00:00.000Z', discoveredAt: '2026-10-19T08:00:00.000Z', episodes: [] };
const bulk = { id: 'hd:s:tv-customer-wars-f7ey801g', kind: 'series', title: 'Customer Wars', lang: 'en', channelId: 'hdtoday', latestAt: null, discoveredAt: null, firstSeenAt: '2026-10-14T13:28:29.217Z', episodes: [] };
const catalog = (extra = {}) => ({
  product: 'dahsha', generatedAt: '2026-10-19T08:00:00.000Z', shows: [mfSeries, ytShow, discovered, bulk], channels: [], tags: [],
  stats: { shows: 4, series: 2, films: 2, episodes: 3, channels: 3, bySource: { UCx: { title: 'A Channel', shows: 1, episodes: 1 }, myflixer: { title: 'Myflixer', shows: 1, episodes: 2 } }, classification: { documentary: 1, uncertain: 0 } },
  idAliases: { s_old: 's_giwba2', s_older: 's_yt' }, providerSync, ...extra,
});

test('episode addedAt is exported only when it is a counted discovery date of a non-YouTube episode', () => {
  assert.equal(exportedAddedAt(mfSeries.episodes[1], mfSeries), '2026-10-12T09:00:00.000Z');
  assert.equal(exportedAddedAt(mfSeries.episodes[0], mfSeries), undefined, 'a bulk first-seen stamp later than latestAt is left out');
  assert.equal(exportedAddedAt(ytShow.episodes[0], ytShow), undefined, 'YouTube publish dates are exact; their seen date is not exported');
  assert.equal(exportedAddedAt({ id: 'mf:m:x', publishedAt: '2026-10-12T00:00:00.000Z', addedAt: '2026-10-11T00:00:00.000Z' }, { latestAt: '2026-10-12T00:00:00.000Z' }), undefined, 'not newer than its publish date');
  assert.equal(exportedAddedAt({ id: 'mf:m:x', addedAt: 'soon' }, { latestAt: '2026-10-12T00:00:00.000Z' }), undefined);
  assert.equal(exportedAddedAt({ id: 'mf:m:x', addedAt: '2026-10-12T00:00:00.000Z' }, { latestAt: null }), undefined);
  const full = exportedShow(mfSeries);
  assert.deepEqual(full.episodes.map((e) => e.addedAt), [undefined, '2026-10-12T09:00:00.000Z']);
  assert.equal('addedAt' in full.episodes[0], false, 'the shows file drops it instead of writing null');
  assert.equal(exportedShow(discovered), discovered, 'records without addedAt are written unchanged');
  assert.equal(mfSeries.episodes[0].addedAt, '2026-10-15T01:02:03.000Z', 'the catalogue object is not mutated');
});

test('the lean catalogue carries updatedAt and real discovery dates only', () => {
  const lean = leanCatalog(catalog(), 'dahsha');
  const byId = new Map(lean.shows.map((s) => [s.id, JSON.parse(JSON.stringify(s))]));
  assert.equal(byId.get('fm:m:9999001').updatedAt, '2026-10-19T08:00:00.000Z');
  assert.equal(byId.get('fm:m:9999001').discoveredAt, '2026-10-19T08:00:00.000Z');
  assert.equal('discoveredAt' in byId.get('hd:s:tv-customer-wars-f7ey801g'), false, 'the null of a bulk-imported row is not exported');
  assert.equal('updatedAt' in byId.get('s_yt'), false, 'no updatedAt where it would repeat latestAt');
  assert.deepEqual(byId.get('s_giwba2').episodes.map((e) => e.addedAt), [undefined, '2026-10-12T09:00:00.000Z']);
  assert.equal('addedAt' in byId.get('s_yt').episodes[0], false);
  assert.deepEqual(lean.providerSync, providerSync, 'the lean catalogue keeps catalog.providerSync');
});

test('the lean catalogue keeps the era label and own channel of a programme group\'s episodes, and adds them nowhere else', () => {
  const daheeh = { id: 's_1nkbn9f', kind: 'series', title: 'الدحيح', lang: 'ar', channel: { id: 'UC-aj' }, latestAt: '2026-10-19T15:00:00.000Z',
    episodes: [
      { id: 'aj_sell____', title: 'أبيع نفسي', seasonLabel: 'AJ+ كبريت 2017–2020', channelId: 'UC-aj', publishedAt: '2017-03-05T10:00:00.000Z', synopsis: 'not exported' },
      { id: 'mo_worm____', title: 'الثقب الدودي', season: 2, channelId: 'UC-mo', publishedAt: '2022-09-01T10:00:00.000Z' },
    ] };
  const lean = JSON.parse(JSON.stringify(leanCatalog(catalog({ shows: [daheeh, ytShow] }), 'dahsha')));
  assert.deepEqual(lean.shows[0].episodes, [
    { id: 'aj_sell____', title: 'أبيع نفسي', seasonLabel: 'AJ+ كبريت 2017–2020', publishedAt: '2017-03-05T10:00:00.000Z', channelId: 'UC-aj' },
    { id: 'mo_worm____', title: 'الثقب الدودي', season: 2, publishedAt: '2022-09-01T10:00:00.000Z', channelId: 'UC-mo' },
  ]);
  assert.deepEqual(Object.keys(lean.shows[1].episodes[0]), ['id', 'season', 'number', 'publishedAt'], 'other episodes are exported as before');
});

test('status.json reports stats (contract 3), id aliases, enrichment sources and provider freshness', () => {
  const status = exportStatus(catalog(), 'dahsha', { enrichment: { artwork: true, sources: ['tvmaze', 'wikidata', 'wikipedia'], tmdb: false } });
  assert.equal(status.product, 'dahsha');
  assert.equal(status.static, true);
  assert.equal(status.generatedAt, '2026-10-19T08:00:00.000Z');
  assert.deepEqual(status.stats.bySource.myflixer, { title: 'Myflixer', shows: 1, episodes: 2 });
  assert.deepEqual(status.stats.classification, { documentary: 1, uncertain: 0 });
  assert.equal(status.idAliasCount, 2);
  assert.deepEqual(status.enrichment, { artwork: true, sources: ['tvmaze', 'wikidata', 'wikipedia'], tmdb: false });
  assert.equal(status.providerSync.providers.hdtoday.lastSuccessAt, '2026-10-14T20:33:56.051Z');
  assert.equal(status.providerSync.providers.hdtoday.consecutiveFailures, 3);
  // An older catalogue (no stats, aliases or provider sync) still gets a valid status.
  const old = exportStatus({ product: 'dahsha', generatedAt: 'g', shows: [discovered, bulk], channels: [] }, 'dahsha', { enrichment: { artwork: false, sources: [], tmdb: false } });
  assert.deepEqual(old.stats, { shows: 2, films: 1, series: 1, episodes: 0, channels: 0 });
  assert.equal(old.idAliasCount, 0);
  assert.equal('providerSync' in old, false);
});

test('enrichment sources follow the TMDB key and the ARTWORK switch', () => {
  const saved = { key: process.env.TMDB_API_KEY, art: process.env.ARTWORK };
  try {
    process.env.ARTWORK = '1';
    delete process.env.TMDB_API_KEY;
    assert.deepEqual(enrichmentStatus(), { artwork: true, sources: ['tvmaze', 'wikidata', 'wikipedia'], tmdb: false });
    process.env.TMDB_API_KEY = 'test-key';
    assert.deepEqual(enrichmentStatus(), { artwork: true, sources: ['tmdb', 'tvmaze', 'wikidata', 'wikipedia'], tmdb: true });
    process.env.ARTWORK = '0';
    assert.deepEqual(enrichmentStatus(), { artwork: false, sources: [], tmdb: false });
  } finally {
    if (saved.key === undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY = saved.key;
    if (saved.art === undefined) delete process.env.ARTWORK; else process.env.ARTWORK = saved.art;
  }
});

test('writeCatalog writes the new status.json, lean sections and shows files', () => {
  const out = path.join(dir, 'data');
  writeCatalog(out, catalog(), 'dahsha');
  const status = JSON.parse(fs.readFileSync(path.join(out, 'status.json'), 'utf8'));
  assert.equal(status.idAliasCount, 2);
  assert.ok(Array.isArray(status.enrichment.sources));
  assert.deepEqual(Object.keys(status.providerSync.providers), ['fmovies', 'hdtoday']);
  const en = JSON.parse(fs.readFileSync(path.join(out, 'catalog.en.json'), 'utf8'));
  assert.equal(en.shows.find((s) => s.id === 'fm:m:9999001').updatedAt, '2026-10-19T08:00:00.000Z');
  const file = JSON.parse(fs.readFileSync(path.join(out, 'shows', encodeURIComponent('s_giwba2') + '.json'), 'utf8'));
  assert.deepEqual(file.episodes.map((e) => e.addedAt ?? null), [null, '2026-10-12T09:00:00.000Z'], 'shows files follow the lean rule');
  const provider = JSON.parse(fs.readFileSync(path.join(out, 'shows', encodeURIComponent('fm:m:9999001') + '.json'), 'utf8'));
  assert.equal(provider.updatedAt, '2026-10-19T08:00:00.000Z');
  assert.equal(provider.discoveredAt, '2026-10-19T08:00:00.000Z');
});

// Uncertain versions (show.versions[]) are played on their own page /show/<versionId>, which stores
// progress under the version's episode ids: the export lists those ids wherever ids are looked up.
const epicFilm = {
  id: 'fm:m:1445363', tmdbId: 1445363, kind: 'film', title: 'EPiC: Elvis Presley in Concert', year: 2026, lang: 'en', documentary: true, providerMetadata: true, uncertainMatch: true,
  sourceUrl: 'https://www.f-movies.org/movie/epic-elvis-presley-in-concert-1445363', poster: { custom: 'https://image.tmdb.org/t/p/w500/epic.jpg', hq: 'not exported' },
  offerings: [{ provider: 'fmovies', id: 'fm:m:1445363', tmdbId: 1445363, kind: 'film' }], synopsis: 'Not in the lean entry.',
  episodes: [{ id: 'fm:m:1445363', title: 'EPiC: Elvis Presley in Concert', season: 1, number: 1, offerings: [{ provider: 'fmovies', id: 'fm:m:1445363' }], thumbs: { custom: 'https://image.tmdb.org/t/p/w500/epic.jpg', sd: 'x' } }],
};
const compactFilm = { id: 'hd:m:movie-stolen-kingdom-3402wqe1', kind: 'film', title: 'Stolen Kingdom', documentary: true, uncertainMatch: true, offerings: [{ provider: 'hdtoday', id: 'hd:m:movie-stolen-kingdom-3402wqe1' }] };
const seriesVersion = { id: 'fm:s:32608', kind: 'series', title: 'Ancient Aliens', documentary: true, uncertainMatch: true, offerings: [{ provider: 'fmovies', id: 'fm:s:32608' }], episodes: [] };
const holder = { id: 's_1mt9z02', kind: 'film', title: 'EPiC: Elvis Presley in Concert', lang: 'en', channel: { id: 'myflixer' }, latestAt: '2026-10-01T00:00:00.000Z',
  episodes: [{ id: 'mf:m:epic-elvis-presley-in-concert', title: 'Full film' }], versions: [epicFilm, compactFilm, seriesVersion] };

test('a version lists the episodes its page plays: lean entry, shows file and stream-ids.json agree', () => {
  const lean = leanCatalog(catalog({ shows: [holder] }), 'dahsha');
  const versions = JSON.parse(JSON.stringify(lean.shows[0].versions));
  assert.deepEqual(versions.map((v) => v.episodes.map((e) => e.id)), [['fm:m:1445363'], ['hd:m:movie-stolen-kingdom-3402wqe1'], []], 'a cached film, a compact film (the film itself), a series without a guide');
  assert.deepEqual(versions[0].episodes[0], { id: 'fm:m:1445363', title: 'EPiC: Elvis Presley in Concert', season: 1, number: 1, offerings: [{ provider: 'fmovies', id: 'fm:m:1445363' }], thumbs: { custom: 'https://image.tmdb.org/t/p/w500/epic.jpg' } });
  assert.deepEqual(versions[0].poster, { custom: 'https://image.tmdb.org/t/p/w500/epic.jpg' });
  assert.equal(versions[0].synopsis, undefined, 'still a compact entry');
  assert.ok(versions.every((v) => v.uncertainMatch === true));
  assert.deepEqual(lean.shows[0].episodes.map((e) => e.id), ['mf:m:epic-elvis-presley-in-concert'], 'the card keeps its own episode slots');
  const out = path.join(dir, 'data-versions');
  writeCatalog(out, catalog({ shows: [holder] }), 'dahsha');
  const ids = JSON.parse(fs.readFileSync(path.join(out, 'stream-ids.json'), 'utf8'));
  assert.deepEqual(ids, ['mf:m:epic-elvis-presley-in-concert', 'fm:m:1445363', 'hd:m:movie-stolen-kingdom-3402wqe1']);
  const en = JSON.parse(fs.readFileSync(path.join(out, 'catalog.en.json'), 'utf8'));
  for (const version of en.shows[0].versions) {
    const file = JSON.parse(fs.readFileSync(path.join(out, 'shows', `${encodeURIComponent(version.id)}.json`), 'utf8'));
    assert.deepEqual(file.episodes.map((e) => e.id), version.episodes.map((e) => e.id), `${version.id}: its page plays what the catalogue lists`);
    assert.equal(file.uncertainMatch, true);
  }
});

test('a card keeps its own shows file when a stale version of the same id is listed earlier', () => {
  const card = { id: 'fm:s:58474', kind: 'series', title: 'Cosmos', lang: 'en', channelId: 'fmovies', year: 2014, episodes: [] };
  const group = { id: 's_1wi8zqx', kind: 'series', title: 'Cosmos', lang: 'en', channel: { id: 'myflixer' }, episodes: [], versions: [{ ...card, uncertainMatch: true, title: 'Cosmos (stale)' }] };
  for (const shows of [[group, card], [card, group]]) {
    const out = path.join(dir, 'data-card-wins');
    writeCatalog(out, catalog({ shows }), 'dahsha');
    const file = JSON.parse(fs.readFileSync(path.join(out, 'shows', encodeURIComponent('fm:s:58474') + '.json'), 'utf8'));
    assert.equal(file.title, 'Cosmos');
    assert.equal(file.uncertainMatch, undefined);
  }
});
