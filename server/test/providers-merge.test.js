// Provider merge robustness: title keys, near-year editions, row validation, alias resolution and the
// cached artwork / TVmaze metadata every rebuild and export path applies.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// store.js fixes DATA_DIR at import time, so point it at a scratch directory first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-providers-merge-'));
process.env.DATA_DIR = dir;
process.env.ARTWORK = '0';
const write = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
const ml = await import('../src/merge-library.js');
const sync = await import('../src/provider-sync.js');
const art = await import('../src/artwork.js');
const svc = await import('../src/service-metadata.js');
const lib = await import('../src/library-service.js');
const { mergeLibrary, mergeShow, titleKey, slugToTitle, normalizeProviderRow, providerRowProblem, uniqueTitles } = ml;
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const fmFilm = (id, title, year, extra = {}) => ({ id: `fm:m:${id}`, tmdbId: id, kind: 'film', title, year, lang: 'hd', synopsis: '', tags: ['documentary'], documentary: true, channelId: 'fmovies',
  portrait: `https://image.tmdb.org/t/p/w500/${id}.jpg`, poster: { custom: `https://image.tmdb.org/t/p/w500/${id}.jpg` }, altTitles: [], seasons: [], episodeCount: 1,
  episodes: [{ id: `fm:m:${id}`, title, season: 1, number: 1, offerings: [{ provider: 'fmovies', id: `fm:m:${id}` }] }],
  offerings: [{ provider: 'fmovies', id: `fm:m:${id}`, tmdbId: id, kind: 'film', documentary: true }], ...extra });
const mfShow = (id, title, year, extra = {}) => ({ id, title, year, kind: 'film', lang: 'en', channel: { id: 'myflixer' }, tags: ['documentary'], altTitles: ['Myflixer Documentaries'],
  portrait: `https://myflixerz.day/wp-content/uploads/posters/${id}_medium.jpg`, episodes: [{ id: `mf:m:${id}`, title: 'Full film', season: null, number: null }], ...extra });
const catalogOf = (...shows) => ({ product: 'dahsha', shows, tags: [], channels: [] });

test('titleKey decodes entities and reads "&" as "and"', () => {
  assert.equal(titleKey('&#8216;Twas the Fight Before Christmas'), titleKey("'Twas the Fight Before Christmas"));
  assert.equal(titleKey('Going Clear: Scientology & the Prison of Belief'), titleKey('Going Clear: Scientology and the Prison of Belief'));
  assert.equal(titleKey('Naples &#038; Campania'), 'naples and campania');
  assert.equal(titleKey('Tom &amp; Jerry'), titleKey('Tom and Jerry'));
  assert.equal(titleKey('Fahrenheit 9/11'), 'fahrenheit 9 11');
  assert.notEqual(titleKey('Fahrenheit 9/11'), titleKey('Fahrenheit 11/9'));
});

test('an entity-encoded Myflixer title and the decoded FMovies title share one card', () => {
  const noYear = mergeLibrary(catalogOf(mfShow('s_84bujt', '&#8216;Twas the Fight Before Christmas', null)), [fmFilm(888652, "'Twas the Fight Before Christmas", 2021)], { product: 'dahsha' });
  assert.equal(noYear.catalog.shows.length, 1, 'no second card');
  assert.equal(noYear.catalog.shows[0].versions[0].id, 'fm:m:888652', 'kept playable as an uncertain version');
  const sameYear = mergeLibrary(catalogOf(mfShow('s_84bujt', '&#8216;Twas the Fight Before Christmas', 2021)), [fmFilm(888652, "'Twas the Fight Before Christmas", 2021)], { product: 'dahsha' });
  assert.equal(sameYear.catalog.shows.length, 1);
  assert.equal(sameYear.report.aliases['fm:m:888652'], 's_84bujt');
  assert.ok(sameYear.catalog.shows[0].offerings.some((o) => o.id === 'fm:m:888652'));
  const and = mergeLibrary(catalogOf(mfShow('s_13cxns', 'Going Clear: Scientology & the Prison of Belief', 2015)), [fmFilm(318224, 'Going Clear: Scientology and the Prison of Belief', 2015)], { product: 'dahsha' });
  assert.equal(and.catalog.shows.length, 1);
  assert.equal(and.report.matched, 1);
});

test('a single same-kind candidate one year apart becomes an uncertain version, never a confirmed identity', () => {
  const result = mergeLibrary(catalogOf(mfShow('s_1hcdqem', 'Ghost Elephants', 2025)), [fmFilm(1451867, 'Ghost Elephants', 2026)], { product: 'dahsha' });
  assert.equal(result.catalog.shows.length, 1);
  assert.deepEqual(result.catalog.shows[0].versions.map((v) => v.id), ['fm:m:1451867']);
  assert.equal(result.report.aliases['fm:m:1451867'], undefined);
  assert.deepEqual(result.report.pending, [{ id: 'fm:m:1451867', title: 'Ghost Elephants', year: 2026, candidates: ['s_1hcdqem'], nearYear: true }]);
  assert.equal(result.catalog.shows[0].episodes[0].offerings.length, 1, 'episode slots are not combined');
  // Re-merging the merged catalogue (export.js runs a second pass) keeps one version.
  const again = mergeLibrary(result.catalog, [fmFilm(1451867, 'Ghost Elephants', 2026)], { product: 'dahsha' });
  assert.equal(again.catalog.shows.length, 1);
  assert.equal(again.catalog.shows[0].versions.length, 1);
});

test('one year apart with the same poster is the same edition; two years apart or two near candidates stay separate', () => {
  const samePoster = mergeLibrary(catalogOf({ ...fmFilm(10, 'The Summit', 2012), id: 'hd:m:movie-the-summit-abc12345', tmdbId: undefined, channelId: 'hdtoday', offerings: [{ provider: 'hdtoday', id: 'hd:m:movie-the-summit-abc12345' }], episodes: [] }), [fmFilm(10, 'The Summit', 2013)], { product: 'dahsha' });
  assert.equal(samePoster.catalog.shows.length, 1);
  assert.equal(samePoster.report.matched, 1);
  assert.equal(mergeLibrary(catalogOf(mfShow('s_a', 'Cow', 2020)), [fmFilm(1, 'Cow', 2022)], { product: 'dahsha' }).catalog.shows.length, 2);
  const two = mergeLibrary(catalogOf(mfShow('s_a', 'Cow', 2020), mfShow('s_b', 'Cow', 2022)), [fmFilm(1, 'Cow', 2021)], { product: 'dahsha' });
  assert.equal(two.catalog.shows.length, 3, 'ambiguous between two near editions: its own card');
  const series = mergeLibrary(catalogOf(mfShow('s_a', 'Cow', 2020)), [{ ...fmFilm(1, 'Cow', 2021), id: 'fm:s:1', kind: 'series', episodes: [] }], { product: 'dahsha' });
  assert.equal(series.catalog.shows.length, 2, 'a series never groups with a film');
});

test('alternative titles drop entries with the title key of the title or of an earlier entry', () => {
  assert.deepEqual(uniqueTitles(['Dance For Your Life', 'Other name', 'other  NAME!', '', null, 7], 'Dance for Your Life'), ['Other name']);
  const merged = mergeShow({ id: 's_1', kind: 'film', title: 'Going Clear: Scientology & the Prison of Belief', altTitles: ['Myflixer Documentaries'] },
    { id: 'fm:m:1', kind: 'film', title: 'Going Clear: Scientology and the Prison of Belief', altTitles: ['going clear scientology and the prison of belief', 'Going Clear'] });
  assert.deepEqual(merged.altTitles, ['Myflixer Documentaries', 'Going Clear']);
  const decoded = mergeShow({ id: 's_2', kind: 'film', title: "'Twas the Fight Before Christmas", altTitles: ['&#8216;Twas the Fight Before Christmas', 'A &amp; B'] }, { id: 'fm:m:2', kind: 'film', title: "'Twas the Fight Before Christmas" });
  assert.deepEqual(decoded.altTitles, ['A & B']);
  const slug = normalizeProviderRow({ id: 'hd:m:movie-john-simpson-60-years-at-the-bbc-32403a6o', kind: 'film', title: 'john simpson 60 years at the bbc' });
  assert.equal(slug.title, 'John Simpson 60 Years at the BBC');
  assert.deepEqual(slug.altTitles, [], 'a lowercase copy of the title is not another name');
  const truncated = normalizeProviderRow({ id: 'hd:s:tv-motorway-cops-catching-britain-s-speeders-vzbm9zej', kind: 'series', title: 'Motorway Cops ..Season 11' });
  assert.deepEqual(truncated.altTitles, ['Motorway Cops ..Season 11']);
});

test('slug titles keep acronyms upper case without guessing ambiguous words', () => {
  assert.equal(slugToTitle('john simpson 60 years at the bbc'), 'John Simpson 60 Years at the BBC');
  assert.equal(slugToTitle('mercenary pilot from cia to pablo escobar'), 'Mercenary Pilot from CIA to Pablo Escobar');
  assert.equal(slugToTitle('murder in the skies who downed mh17'), 'Murder in the Skies Who Downed MH17');
  assert.equal(slugToTitle('the monday night war wwe raw vs wcw nitro'), 'The Monday Night War WWE Raw vs WCW Nitro');
  assert.equal(slugToTitle('sea rex 3d journey to a prehistoric world'), 'Sea Rex 3D Journey to a Prehistoric World');
  assert.equal(slugToTitle('search and rescue north shore nsr'), 'Search and Rescue North Shore NSR');
  assert.equal(slugToTitle('mccartney the hunt for the lost bass'), 'McCartney the Hunt for the Lost Bass');
  assert.equal(slugToTitle('the last first winter k2'), 'The Last First Winter K2');
  assert.equal(slugToTitle('ladies and gentlemen mr leonard cohen'), 'Ladies and Gentlemen Mr Leonard Cohen');
  assert.equal(slugToTitle('mrs buica'), 'Mrs Buica');
  assert.equal(slugToTitle('the killer among us'), 'The Killer Among Us');
  assert.equal(slugToTitle('ai weiwei without fear or favour'), 'Ai Weiwei Without Fear or Favour');
  assert.equal(slugToTitle('rocky iii and the 1980s'), 'Rocky III and the 1980s');
  assert.equal(slugToTitle('britain s 2nd best'), "Britain's 2nd Best");
  // Contractions are rebuilt, not read as acronyms ("LL", "M").
  assert.equal(slugToTitle('we ll meet again'), "We'll Meet Again");
  assert.equal(slugToTitle('i m a celebrity'), "I'm a Celebrity");
  assert.equal(slugToTitle('you re not alone'), "You're Not Alone");
  assert.equal(slugToTitle('they ve gone'), "They've Gone");
  assert.equal(slugToTitle('vitamin d the sunshine story'), 'Vitamin D the Sunshine Story');
});

test('providerRowProblem accepts crawled rows and names the malformed field', () => {
  assert.equal(providerRowProblem(fmFilm(1, 'A Film', 2020)), null);
  assert.equal(providerRowProblem({ id: 'hd:s:tv-x-abc12345', kind: 'series', title: 'X', episodes: [], altTitles: [], tags: [], seasons: [1, 2], poster: null }), null);
  assert.equal(providerRowProblem(null), 'not an object');
  assert.equal(providerRowProblem({ ...fmFilm(1, 'A', 2020), id: 7 }), 'invalid id');
  assert.equal(providerRowProblem({ ...fmFilm(1, 'A', 2020), kind: 'episode' }), 'invalid kind');
  assert.equal(providerRowProblem({ ...fmFilm(1, 'A', 2020), title: '' }), 'invalid title');
  assert.equal(providerRowProblem({ ...fmFilm(1, 'A', 2020), altTitles: 'A' }), 'invalid altTitles');
  assert.equal(providerRowProblem({ ...fmFilm(1, 'A', 2020), altTitles: ['A', 3] }), 'invalid altTitles');
  assert.equal(providerRowProblem({ ...fmFilm(1, 'A', 2020), tags: [{}] }), 'invalid tags');
  assert.equal(providerRowProblem({ ...fmFilm(1, 'A', 2020), episodes: ['fm:m:1'] }), 'invalid episodes');
  assert.equal(providerRowProblem({ ...fmFilm(1, 'A', 2020), episodes: { 0: {} } }), 'invalid episodes');
  assert.equal(providerRowProblem({ ...fmFilm(1, 'A', 2020), episodes: [{ id: 'fm:m:1', offerings: 'x' }] }), 'invalid episodes');
  assert.equal(providerRowProblem({ ...fmFilm(1, 'A', 2020), offerings: [null] }), 'invalid offerings');
  assert.equal(providerRowProblem({ ...fmFilm(1, 'A', 2020), synopsis: { text: 'x' } }), 'invalid synopsis');
});

test('the crawl keeps malformed rows out of the cache and reports them', () => {
  const items = new Map([['fm:m:1', { ...fmFilm(1, 'A Film', 2020), firstSeenAt: '2026-01-01T00:00:00.000Z', tags: ['documentary', 'history'] }]]);
  const rejected = [];
  sync.putProviderRows(items, [fmFilm(1, 'A Film', 2020, { tags: ['lang-en'] }), { ...fmFilm(2, 'B', 2021), altTitles: 'B' }, { ...fmFilm(3, 'C', 2021), episodes: [null] }],
    { reject: (row, reason) => rejected.push([row.id, reason]) });
  assert.deepEqual(rejected, [['fm:m:2', 'invalid altTitles'], ['fm:m:3', 'invalid episodes']]);
  assert.deepEqual([...items.keys()], ['fm:m:1']);
  assert.equal(items.get('fm:m:1').firstSeenAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(items.get('fm:m:1').tags, ['documentary', 'history', 'lang-en']);
});

test('mergeLibrary with onError skips a row that throws instead of failing the merge', () => {
  const exploding = { id: 'fm:m:9', title: 'Boom', documentary: true, get kind() { throw new Error('broken row'); } };
  const errors = [];
  const result = mergeLibrary(catalogOf(), [exploding, fmFilm(1, 'A Film', 2020)], { product: 'dahsha', onError: (row, error) => errors.push(error.message) });
  assert.deepEqual(errors, ['broken row']);
  assert.equal(result.report.failed, 1);
  assert.deepEqual(result.catalog.shows.map((s) => s.id), ['fm:m:1']);
  assert.throws(() => mergeLibrary(catalogOf(), [exploding], { product: 'dahsha' }), /broken row/, 'without onError the caller still sees the error');
});

test('the merge passes the catalogue id aliases through and never invents any', () => {
  const idAliases = { s_old: 's_mf' };
  const base = { ...catalogOf(mfShow('s_mf', 'Shared Film', 2020), mfShow('s_near', 'Near Film', 2019)), idAliases };
  const result = mergeLibrary(base, [fmFilm(1, 'Shared Film', 2020), fmFilm(2, 'Near Film', 2020), fmFilm(3, 'Own Card', 2020)], { product: 'dahsha' });
  assert.deepEqual(result.catalog.idAliases, { s_old: 's_mf' });
  assert.equal(result.report.aliases['fm:m:1'], 's_mf', 'the provider alias report still records the match');
  assert.equal(result.catalog.shows.find((s) => s.id === 's_near').versions[0].id, 'fm:m:2', 'a version keeps its own id and page');
  assert.equal(mergeLibrary(catalogOf(mfShow('s_mf', 'Shared Film', 2020)), [fmFilm(1, 'Shared Film', 2020)], { product: 'dahsha' }).catalog.idAliases, undefined);
});

test('mergeCachedProviders skips malformed rows and applies cached artwork and TVmaze metadata', () => {
  const now = new Date().toISOString();
  write('providers-dahsha.json', { version: 1, completed: false, queue: [], lastRefreshAt: '2026-10-18T00:00:00.000Z', errors: {}, items: [
    fmFilm(1, 'Provider Film', 2020),
    { ...fmFilm(2, 'Provider Series & More', 2019), id: 'fm:s:2', kind: 'series', episodes: [] },
    { ...fmFilm(3, 'Broken', 2020), altTitles: 'Broken' },
    { ...fmFilm(4, 'Near Film', 2021) },
    'not a row',
  ] });
  write('artwork.json', {
    'fm:m:1': { source: 'wikipedia', confidence: 'exact', name: 'Provider Film', overview: 'A long English overview of the provider film that is more than forty characters.', overviewLang: 'en', poster: null },
    'fm:m:4': { source: 'tvmaze', confidence: 'exact', name: 'Near Film', overview: 'An English overview for the edition that is grouped as a version of a card.', overviewLang: 'en' },
    'fm:s:2': { source: 'wikipedia', confidence: 'fuzzy', overview: 'A fuzzy overview must never reach the catalogue, however long it is.', overviewLang: 'en' },
  });
  art.resetArtworkCache();
  const legacyKey = 'provider series more'; // titleKey before '&' was read as 'and'
  write('service-metadata-dahsha.json', { 'fm:s:2': { key: legacyKey, year: 2019, tvm: { id: 5, svc: 'Netflix' }, checkedAt: now }, s_near: { key: 'near film', tvm: null, checkedAt: now } });
  const warnings = [];
  const base = catalogOf(mfShow('s_near', 'Near Film', 2020, { kind: 'film' }));
  const merged = sync.mergeCachedProviders(base, 'dahsha', { log: (m) => warnings.push(m) });
  const byId = new Map(merged.catalog.shows.map((s) => [s.id, s]));
  assert.deepEqual([...byId.keys()].sort(), ['fm:m:1', 'fm:s:2', 's_near']);
  assert.equal(merged.report.invalid, 2);
  assert.equal(merged.catalog.providerSync.skippedRecords, 2);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /fm:m:3: invalid altTitles/);
  assert.match(byId.get('fm:m:1').synopsis, /long English overview/);
  assert.equal(byId.get('fm:s:2').synopsis, '', 'fuzzy artwork is ignored');
  assert.match(byId.get('s_near').versions[0].synopsis, /grouped as a version/);
  assert.deepEqual(byId.get('fm:s:2').tvm, { id: 5, svc: 'Netflix' }, 'entries cached under the older title key still apply');
  assert.equal(byId.get('s_near').serviceCheckedAt, now);
  assert.equal(merged.report.services, 1);
  assert.equal(merged.report.artwork, 2);
  // export.js merges the rebuilt (already merged) catalogue again: same cards, nothing lost.
  const again = sync.mergeCachedProviders(merged.catalog, 'dahsha', { log: () => {} });
  assert.equal(again.catalog.shows.length, 3);
  assert.equal(again.catalog.shows.find((s) => s.id === 's_near').versions.length, 1);
  assert.deepEqual(again.catalog.shows.find((s) => s.id === 'fm:s:2').tvm, { id: 5, svc: 'Netflix' });
});

test('a merged synopsis keeps its own source label', () => {
  const own = mergeShow({ id: 's_1', kind: 'film', title: 'A', synopsis: 'Curated text.' }, { id: 'fm:m:1', kind: 'film', title: 'A', synopsis: 'Wikipedia text.', synopsisSource: 'wikipedia' });
  assert.equal(own.synopsis, 'Curated text.');
  assert.equal(own.synopsisSource, undefined, 'the discarded synopsis does not lend its source');
  const generated = mergeShow({ id: 's_1', kind: 'film', title: 'A', synopsis: 'A film.', synopsisGenerated: true }, { id: 'fm:m:1', kind: 'film', title: 'A', synopsis: 'Wikipedia text.', synopsisSource: 'wikipedia' });
  assert.equal(generated.synopsis, 'Wikipedia text.');
  assert.equal(generated.synopsisSource, 'wikipedia');
  assert.equal(generated.synopsisGenerated, false);
});

test('mergeCachedProviders tolerates missing or malformed side files', () => {
  write('providers-dahsha.json', { version: 1, items: [fmFilm(1, 'Provider Film', 2020)], queue: null, completed: false, lastRefreshAt: null, errors: {} });
  write('provider-aliases-dahsha.json', null);
  write('provider-identities-dahsha.json', ['not', 'a', 'map']);
  write('service-metadata-dahsha.json', 'oops');
  fs.writeFileSync(path.join(dir, 'artwork.json'), '{ broken json');
  art.resetArtworkCache();
  const merged = sync.mergeCachedProviders(catalogOf(mfShow('s_1', 'Other', 2020)), 'dahsha', { log: () => {} });
  assert.deepEqual(merged.catalog.shows.map((s) => s.id).sort(), ['fm:m:1', 's_1']);
  assert.equal(merged.catalog.providerSync.remainingPartitions, 0);
  assert.equal(merged.report.services, 0);
  for (const name of ['provider-aliases-dahsha.json', 'provider-identities-dahsha.json', 'service-metadata-dahsha.json', 'artwork.json']) fs.rmSync(path.join(dir, name));
  art.resetArtworkCache();
});

test('service metadata matches entries written under the older title key', () => {
  const shows = [{ id: 'hd:s:a', title: 'Crime &#038; Punishment', kind: 'series' }, { id: 'hd:s:b', title: 'Other', kind: 'series' }];
  const applied = svc.applyServiceMetadata(shows, { 'hd:s:a': { key: 'crime 038 punishment', tvm: { id: 1 }, checkedAt: 'x' }, 'hd:s:b': { key: 'renamed', tvm: { id: 2 }, checkedAt: 'y' } });
  assert.equal(applied, 1);
  assert.deepEqual(shows[0].tvm, { id: 1 });
  assert.equal(shows[1].tvm, undefined, 'a renamed show is not given the old answer');
});

test('live discovery lists a near-year edition through the card that groups it and skips malformed rows', async () => {
  const catalog = catalogOf(mfShow('s_1hcdqem', 'Ghost Elephants', 2025));
  const exploding = { id: 'fm:m:9', title: 'Boom', documentary: true, get kind() { throw new Error('broken row'); } };
  const page = (items) => async () => ({ items, totalPages: 1 });
  const result = await lib.discoverLibrary({ kind: 'film', product: 'dahsha', catalog, fetchers: [page([fmFilm(1451867, 'Ghost Elephants', 2026), exploding]), page([]), page([])] });
  assert.deepEqual(result.items.map((s) => s.id), ['s_1hcdqem']);
  assert.equal(result.items[0].versions[0].id, 'fm:m:1451867');
});

test('library lookups follow catalog.idAliases when an id is no longer live', async () => {
  const show = { id: 's_new', kind: 'series', title: 'Renamed Show', lang: 'en', episodes: [{ id: 'ABCDEFGHIJK', title: 'One', season: 1, number: 1 }] };
  const catalog = { product: 'dahsha', generatedAt: 'alias-test', idAliases: { s_old: 's_new', s_other: 's_missing', s_new: 's_old' }, shows: [show, { id: 's_other', kind: 'film', title: 'Still live' }] };
  assert.equal(lib.locate(catalog, 's_old').id, 's_new');
  assert.equal(lib.locate(catalog, 's_new').id, 's_new', 'a live id wins over an alias entry');
  assert.equal(lib.locate(catalog, 's_other').id, 's_other');
  assert.equal(lib.locate(catalog, 's_unknown'), null);
  assert.equal(lib.locate({ ...catalog, idAliases: { s_x: 's_missing' } }, 's_x'), null);
  assert.equal(lib.locate({ shows: [show] }, 's_old'), null, 'older catalogues without idAliases');
  assert.equal(lib.locate({ shows: [show], idAliases: { s_a: 's_b', s_b: 's_new' } }, 's_a').id, 's_new', 'an unflattened chain is followed');
  assert.equal(lib.locate({ shows: [show], idAliases: { s_a: 's_b', s_b: 's_a' } }, 's_a'), null, 'a cycle ends the search');
  assert.equal(lib.locate({ shows: [show], idAliases: 'junk' }, 's_a'), null);
  const title = await lib.unifiedTitle('s_old', { catalog, product: 'dahsha' });
  assert.equal(title.id, 's_new');
  assert.equal(title.episodes[0].id, 'ABCDEFGHIJK');
});

// ---- Provider freshness and discovery dates (step c2) ------------------------------------------
const cacheFile = () => JSON.parse(fs.readFileSync(path.join(dir, 'providers-dahsha.json'), 'utf8'));
const crawlRow = (row) => { const { firstSeenAt, providerUpdatedAt, lastSeenAt, discoveredAt, episodesAddedAt, ...listed } = row; return listed; };
const hdSeries = (slug, title, extra = {}) => ({ id: `hd:s:${slug}`, kind: 'series', title, year: null, tags: ['documentary'], documentary: true, channelId: 'hdtoday', altTitles: [], episodes: [], seasons: [],
  offerings: [{ provider: 'hdtoday', id: `hd:s:${slug}`, kind: 'series', documentary: true }], ...extra });
const BULK = '2026-10-14T13:28:28.647Z';

test('putProviderRows stamps lastSeenAt, discovers only when asked, and dates a changed latest episode', () => {
  const items = new Map([
    ['fm:m:1', { ...fmFilm(1, 'Old Film', 2020), firstSeenAt: BULK, providerUpdatedAt: BULK, discoveredAt: null }],
    ['hd:s:tv-show-abc12345', { ...hdSeries('tv-show-abc12345', 'Show'), latestEpisode: '1:2', firstSeenAt: BULK, providerUpdatedAt: BULK, discoveredAt: null }],
  ]);
  const added = [];
  const before = new Date().toISOString();
  sync.putProviderRows(items, [crawlRow(items.get('fm:m:1')), fmFilm(2, 'New Film', 2026)], { discover: true, onAdd: (row, at) => added.push([row.id, at]) });
  const fresh = items.get('fm:m:2'), old = items.get('fm:m:1');
  assert.deepEqual(added.map(([id]) => id), ['fm:m:2'], 'onAdd hears only of rows new to the cache');
  assert.equal(fresh.discoveredAt, fresh.firstSeenAt, 'a row new to a cache that already had this provider is a discovery');
  assert.ok(fresh.discoveredAt >= before);
  assert.equal(old.discoveredAt, null, 'a known bulk row is never re-dated');
  assert.equal(old.firstSeenAt, BULK);
  assert.ok(old.lastSeenAt >= before, 'every row seen in this put gets lastSeenAt');
  assert.equal('episodesAddedAt' in old, false, 'no episode date until one is seen');
  sync.putProviderRows(items, [fmFilm(3, 'Crawled Film', 1999)]);
  assert.equal(items.get('fm:m:3').discoveredAt, null, 'historical-crawl rows are never discoveries');
  // HDToday says "3 days ago" next to a new latest episode: that date (not the crawl time) is the episode date.
  const threeDaysAgo = new Date(Date.now() - 3 * 864e5).toISOString();
  sync.putProviderRows(items, [{ ...crawlRow(items.get('hd:s:tv-show-abc12345')), latestEpisode: '1:3', providerUpdatedAt: threeDaysAgo }]);
  assert.equal(items.get('hd:s:tv-show-abc12345').episodesAddedAt, threeDaysAgo);
  sync.putProviderRows(items, [{ ...crawlRow(items.get('hd:s:tv-show-abc12345')), latestEpisode: '1:3' }]);
  assert.equal(items.get('hd:s:tv-show-abc12345').episodesAddedAt, threeDaysAgo, 'an unchanged latest episode keeps its date');
  // A provider that starts showing latestEpisode for an old row has not added an episode.
  sync.putProviderRows(items, [{ ...crawlRow(old), latestEpisode: '1:1' }]);
  assert.equal(items.get('fm:m:1').episodesAddedAt, undefined);
});

test('older caches: rows first seen after the bulk import count as discovered, and provider freshness is estimated', () => {
  write('providers-dahsha.json', { version: 1, completed: false, queue: [{ provider: 'hdtoday', documentary: true, page: 35 }], lastRefreshAt: '2026-10-18T18:39:23.854Z', errors: { hdtoday: 'HDToday HTTP 403' }, items: [
    { ...fmFilm(1, 'Bulk Film', 2020), firstSeenAt: BULK, providerUpdatedAt: BULK },
    { ...fmFilm(1758536, 'The Widower', 2026), firstSeenAt: '2026-10-16T18:36:09.302Z', providerUpdatedAt: '2026-10-16T18:36:09.302Z' },
    { ...hdSeries('tv-customer-wars-f7ey801g', 'Customer Wars'), firstSeenAt: '2026-10-14T20:33:56.051Z', providerUpdatedAt: '2026-10-14T20:33:56.051Z' },
  ] });
  const cache = sync.providerCache('dahsha');
  assert.equal(cache.baselineAt, sync.LEGACY_BASELINE);
  assert.deepEqual(cache.items.map((r) => r.discoveredAt), [null, '2026-10-16T18:36:09.302Z', null]);
  const status = sync.providerStatus(cache);
  assert.deepEqual(status.fmovies, { lastAttemptAt: '2026-10-18T18:39:23.854Z', lastSuccessAt: '2026-10-18T18:39:23.854Z', lastNewRecordAt: '2026-10-16T18:36:09.302Z', lastError: null, lastErrorAt: null, consecutiveFailures: 0, records: 2 });
  assert.deepEqual(status.hdtoday, { lastAttemptAt: '2026-10-18T18:39:23.854Z', lastSuccessAt: '2026-10-14T20:33:56.051Z', lastNewRecordAt: '2026-10-14T20:33:56.051Z', lastError: 'HDToday HTTP 403', lastErrorAt: '2026-10-18T18:39:23.854Z', consecutiveFailures: 1, records: 1 },
    'a provider in error last answered when it last wrote a row, not at the shared lastRefreshAt');
  // A cache refreshed before the legacy cut-off (the local Flixer cache) treats everything it holds as bulk.
  write('providers-dahsha.json', { version: 1, items: [{ ...fmFilm(1, 'A', 2020), firstSeenAt: '2026-10-14T21:00:00.000Z' }], queue: [], lastRefreshAt: '2026-10-14T22:33:12.796Z', errors: {} });
  assert.equal(sync.providerCache('dahsha').baselineAt, '2026-10-14T22:33:12.796Z');
  assert.equal(sync.providerCache('dahsha').items[0].discoveredAt, null);
  write('providers-dahsha.json', { version: 1, items: [], queue: [], lastRefreshAt: null, errors: {} });
  assert.equal(sync.providerCache('dahsha').baselineAt, undefined, 'an empty cache has no baseline until its first scan');
});

test('recordProviderPass advances only the providers that answered', () => {
  const previous = { fmovies: { lastAttemptAt: 'a', lastSuccessAt: '2026-10-18T00:00:00.000Z', lastNewRecordAt: '2026-10-16T00:00:00.000Z', lastError: null, lastErrorAt: null, consecutiveFailures: 0, records: 9 },
    hdtoday: { lastAttemptAt: 'a', lastSuccessAt: '2026-10-14T00:00:00.000Z', lastNewRecordAt: '2026-10-14T00:00:00.000Z', lastError: 'HDToday HTTP 403', lastErrorAt: 'a', consecutiveFailures: 4, records: 3 } };
  const at = '2026-10-19T00:00:00.000Z';
  const next = sync.recordProviderPass(previous, { attempted: ['fmovies', 'hdtoday'], errors: { hdtoday: 'HDToday HTTP 403' }, added: { fmovies: '2026-10-18T23:59:00.000Z' }, at });
  assert.deepEqual(next.fmovies, { lastAttemptAt: at, lastSuccessAt: at, lastNewRecordAt: '2026-10-18T23:59:00.000Z', lastError: null, lastErrorAt: null, consecutiveFailures: 0 });
  assert.deepEqual(next.hdtoday, { lastAttemptAt: at, lastSuccessAt: '2026-10-14T00:00:00.000Z', lastNewRecordAt: '2026-10-14T00:00:00.000Z', lastError: 'HDToday HTTP 403', lastErrorAt: at, consecutiveFailures: 5 });
  const recovered = sync.recordProviderPass(next, { attempted: ['hdtoday'], errors: {}, at: '2026-10-20T00:00:00.000Z' });
  assert.equal(recovered.hdtoday.lastError, null);
  assert.equal(recovered.hdtoday.consecutiveFailures, 0);
  assert.equal(recovered.hdtoday.lastSuccessAt, '2026-10-20T00:00:00.000Z');
  assert.equal(recovered.fmovies.lastAttemptAt, at, 'a provider not tried keeps its status');
  assert.match(sync.providerFreshnessLine({ providers: next }), /^fmovies ok at 2026-10-19T00:00:00\.000Z, last new record 2026-10-18T23:59:00\.000Z; hdtoday failing x5, last success 2026-10-14T00:00:00\.000Z \(HDToday HTTP 403\)$/);
});

test('a scan with HDToday blocked dates new FMovies releases, keeps HDToday stale and never stamps a failed provider fresh', async () => {
  const known = { ...fmFilm(1, 'Known Film', 2026), firstSeenAt: BULK, providerUpdatedAt: BULK };
  write('providers-dahsha.json', { version: 1, completed: false, queue: [{ provider: 'hdtoday', documentary: true, page: 35 }, { provider: 'fmovies', kind: 'film', documentary: true, page: 7 }],
    lastRefreshAt: '2026-10-18T18:39:23.854Z', errors: { hdtoday: 'HDToday HTTP 403' },
    items: [known, { ...hdSeries('tv-customer-wars-f7ey801g', 'Customer Wars'), firstSeenAt: '2026-10-14T20:33:56.051Z', providerUpdatedAt: '2026-10-14T20:33:56.051Z' }] });
  const jobs = [];
  const fetch = async (job) => {
    jobs.push(`${job.provider}:${job.kind || '-'}:${job.page}${job.sort ? ':seed' : ''}`);
    if (job.provider === 'hdtoday') throw new Error('HDToday HTTP 403');
    if (job.sort && job.kind === 'film') return { items: [crawlRow(known), fmFilm(2, 'Brand New Release', 2026)], page: 1, totalPages: 1, hasNext: false };
    if (job.sort) return { items: [], page: 1, totalPages: 1, hasNext: false };
    return { items: [fmFilm(3, 'Archive Film', 1987)], page: job.page, totalPages: job.page, hasNext: false };
  };
  const logs = [];
  const before = new Date().toISOString();
  const cache = await sync.refreshProviders({ product: 'dahsha', pageBudget: 5, fetch, sleep: async () => {}, log: (m) => logs.push(m) });
  assert.deepEqual(jobs, ['fmovies:film:1:seed', 'fmovies:series:1:seed', 'hdtoday:-:1', 'fmovies:film:7'], 'the blocked HDToday cursor is skipped, as before');
  const saved = cacheFile();
  const byId = new Map(saved.items.map((r) => [r.id, r]));
  assert.ok(byId.get('fm:m:2').discoveredAt >= before, 'a new title in the latest listing is dated');
  assert.equal(byId.get('fm:m:3').discoveredAt, null, 'a title found by the historical crawl is not');
  assert.equal(byId.get('fm:m:1').discoveredAt, null);
  assert.ok(byId.get('fm:m:1').lastSeenAt >= before);
  assert.equal(byId.get('hd:s:tv-customer-wars-f7ey801g').lastSeenAt, undefined, 'rows not seen keep no lastSeenAt');
  assert.ok(saved.providers.fmovies.lastSuccessAt >= before);
  assert.equal(saved.providers.fmovies.lastNewRecordAt, byId.get('fm:m:3').firstSeenAt);
  assert.equal(saved.providers.hdtoday.lastSuccessAt, '2026-10-14T20:33:56.051Z', 'HDToday stays at its last real answer');
  assert.equal(saved.providers.hdtoday.consecutiveFailures, 2);
  assert.equal(saved.providers.hdtoday.lastError, 'HDToday HTTP 403');
  assert.equal(saved.lastRefreshAt, saved.providers.fmovies.lastSuccessAt);
  assert.equal(saved.baselineAt, sync.LEGACY_BASELINE);
  assert.equal(cache.providers.hdtoday.consecutiveFailures, 2);
  assert.ok(logs.some((m) => /freshness: fmovies ok .*hdtoday failing x2/.test(m)));
  // The merged catalogue: the new release leads by recency, bulk rows stay undated, freshness is exposed.
  const merged = sync.mergeCachedProviders({ ...catalogOf(mfShow('s_old', 'Old Card', 2020, { latestAt: '2026-10-18T10:00:00.000Z' })), generatedAt: '2026-10-18T18:50:07.241Z' }, 'dahsha', { log: () => {} });
  const shows = new Map(merged.catalog.shows.map((s) => [s.id, s]));
  assert.equal(shows.get('fm:m:2').updatedAt, byId.get('fm:m:2').discoveredAt);
  assert.equal(shows.get('fm:m:2').discoveredAt, byId.get('fm:m:2').discoveredAt);
  for (const id of ['fm:m:1', 'fm:m:3', 'hd:s:tv-customer-wars-f7ey801g']) assert.equal(shows.get(id).updatedAt, undefined, `${id} stays undated`);
  assert.equal(shows.get('s_old').updatedAt, undefined, 'updatedAt is left out where it equals latestAt');
  const channel = (id) => merged.catalog.channels.find((c) => c.id === id);
  assert.equal(channel('fmovies').latestAt, byId.get('fm:m:2').discoveredAt, 'the FMovies channel is as fresh as its newest discovery');
  assert.equal(channel('hdtoday').latestAt, null, 'HDToday has no dated card');
  assert.equal(merged.catalog.providerSync.providers.hdtoday.lastError, 'HDToday HTTP 403');
  assert.equal(merged.catalog.providerSync.providers.fmovies.records, 3);
  assert.equal(merged.catalog.providerSync.lastRefreshAt, saved.lastRefreshAt);
  assert.equal(merged.catalog.generatedAt, saved.lastRefreshAt, 'a successful provider refresh still lifts generatedAt');
  const recency = (s) => s.updatedAt ?? s.latestAt ?? '';
  assert.equal([...merged.catalog.shows].sort((a, b) => recency(b).localeCompare(recency(a)))[0].id, 'fm:m:2');
});

test('when every provider fails, neither lastRefreshAt nor the catalogue generatedAt moves', async () => {
  write('providers-dahsha.json', { version: 1, completed: true, queue: [], lastRefreshAt: '2026-10-18T18:39:23.854Z', errors: {}, items: [{ ...fmFilm(1, 'Known Film', 2026), firstSeenAt: BULK, providerUpdatedAt: BULK }],
    providers: { fmovies: { lastAttemptAt: '2026-10-18T18:39:23.854Z', lastSuccessAt: '2026-10-18T18:39:23.854Z', lastNewRecordAt: BULK, lastError: null, lastErrorAt: null, consecutiveFailures: 0 } } });
  const cache = await sync.refreshProviders({ product: 'dahsha', fetch: async (job) => { throw new Error(`${job.provider} down`); }, sleep: async () => {}, log: () => {} });
  assert.equal(cache.lastRefreshAt, '2026-10-18T18:39:23.854Z');
  assert.equal(cache.providers.fmovies.lastError, 'fmovies down');
  assert.equal(cache.providers.fmovies.lastSuccessAt, '2026-10-18T18:39:23.854Z');
  assert.equal(cache.providers.hdtoday.lastSuccessAt, null, 'a provider with no rows and no success is reported as never answered');
  assert.ok(cache.lastAttemptAt > cache.lastRefreshAt);
  const merged = sync.mergeCachedProviders({ ...catalogOf(), generatedAt: '2026-10-18T20:00:00.000Z' }, 'dahsha', { log: () => {} });
  assert.equal(merged.catalog.generatedAt, '2026-10-18T20:00:00.000Z', 'the build time stands; the failed scan does not make the data look fresh');
  assert.equal(merged.catalog.providerSync.lastRefreshAt, '2026-10-18T18:39:23.854Z');
  assert.equal(merged.catalog.providerSync.lastAttemptAt, cache.lastAttemptAt);
  fs.rmSync(path.join(dir, 'providers-dahsha.json'));
});

test('show-level updatedAt: discovery counts only for the title a crawled row leads, episodes always, never in the future', () => {
  assert.equal(ml.showUpdatedAt({ id: 'fm:m:1', latestAt: null, discoveredAt: '2026-10-19T08:00:00.000Z' }), '2026-10-19T08:00:00.000Z');
  assert.equal(ml.showUpdatedAt({ id: 's_1', latestAt: '2026-10-01T00:00:00.000Z', discoveredAt: '2026-10-19T08:00:00.000Z' }), '2026-10-01T00:00:00.000Z', 'a YouTube/Myflixer card is not news because a provider listed it');
  assert.equal(ml.showUpdatedAt({ id: 's_1', latestAt: '2026-10-01T00:00:00.000Z', episodesAddedAt: '2026-10-18T00:00:00.000Z' }), '2026-10-18T00:00:00.000Z');
  assert.equal(ml.showUpdatedAt({ id: 's_1', latestAt: '2026-10-18T20:00:00.000Z' }, '2026-10-18T18:50:07.241Z'), '2026-10-18T18:50:07.241Z', 'clamped to the catalogue time');
  assert.equal(ml.showUpdatedAt({ id: 'hd:s:x', latestAt: null, discoveredAt: null }), null);
  assert.equal(ml.showUpdatedAt({ id: 's_1', latestAt: 'not a date' }), null);
  // A crawled row joining a YouTube/Myflixer card lends its new episode but not its discovery date.
  const joined = mergeLibrary(catalogOf(mfShow('s_mf', 'Shared Film', 2026, { latestAt: '2026-01-01T00:00:00.000Z' })), [fmFilm(1, 'Shared Film', 2026, { discoveredAt: '2026-10-19T08:00:00.000Z', episodesAddedAt: '2026-10-18T00:00:00.000Z' })], { product: 'dahsha' });
  const card = joined.catalog.shows[0];
  assert.equal(card.id, 's_mf');
  assert.equal(card.discoveredAt, undefined);
  assert.equal(card.latestAt, '2026-10-18T00:00:00.000Z');
  // A second row joining a bulk provider-led card keeps the card's own (null) discovery date.
  const led = mergeLibrary(catalogOf(), [{ ...hdSeries('tv-the-widower-1g0egdew', 'The Widower'), id: 'hd:m:movie-the-widower-1g0egdew', kind: 'film', year: 2026, discoveredAt: null },
    { ...fmFilm(1758536, 'The Widower', 2026), discoveredAt: '2026-10-16T18:36:09.302Z' }], { product: 'dahsha' });
  assert.equal(led.catalog.shows.length, 1);
  assert.equal(led.catalog.shows[0].discoveredAt, null);
  assert.equal(ml.showUpdatedAt(led.catalog.shows[0]), null);
  // mergeShow keeps the newest episode date from either side.
  assert.equal(mergeShow({ id: 'hd:s:a', kind: 'series', title: 'A', episodesAddedAt: '2026-10-10T00:00:00.000Z' }, { id: 'hd:s:a', kind: 'series', title: 'A', episodesAddedAt: '2026-10-12T00:00:00.000Z' }).episodesAddedAt, '2026-10-12T00:00:00.000Z');
  assert.equal('episodesAddedAt' in mergeShow({ id: 'hd:s:a', kind: 'series', title: 'A' }, { id: 'hd:s:a', kind: 'series', title: 'A' }), false);
});

// ---- Version bookkeeping, alias renames and reachable version ids (review fixes) ---------------
const exp = await import('../src/export-catalog.js');
const fmSeries = (id, title, year, extra = {}) => ({ ...fmFilm(id, title, year), id: `fm:s:${id}`, kind: 'series', episodes: [], episodeCount: null,
  offerings: [{ provider: 'fmovies', id: `fm:s:${id}`, tmdbId: id, kind: 'series', documentary: true }], ...extra });
const ytSeries = (id, title, extra = {}) => ({ id, kind: 'series', title, lang: 'en', channel: { id: 'UCx' }, tags: ['documentary'], documentary: true,
  episodes: [{ id: 'ABCDEFGHIJK', title: 'One', season: 1, number: 1 }], ...extra });
const idsListed = (catalog, id) => catalog.shows.filter((s) => s.id === id).length + catalog.shows.reduce((n, s) => n + (s.versions || []).filter((v) => v.id === id).length, 0);

test('a row that is now its own card drops the uncertain version an earlier merge left in the base', () => {
  // Gen 37: Myflixer 'Cosmos' (Sagan's 1980 series, no year yet) groups FMovies 'Cosmos' (2014) as a version.
  const cosmos = { ...mfShow('s_1wi8zqx', 'Cosmos', null), kind: 'series', episodes: [{ id: 'mf:e:cosmos-1x1', title: 'The Shores of the Cosmic Ocean', season: 1, number: 1 }] };
  const row = fmSeries(58474, 'Cosmos', 2014);
  const first = mergeLibrary(catalogOf(cosmos), [row], { product: 'dahsha' });
  assert.deepEqual(first.catalog.shows.map((s) => s.id), ['s_1wi8zqx']);
  assert.deepEqual(first.catalog.shows[0].versions.map((v) => v.id), ['fm:s:58474']);
  // resolveProviderMatches then stores the card's year (1980) and refresh-providers merges the merged catalogue again.
  const confirmed = { ...first.catalog, shows: first.catalog.shows.map((s) => ({ ...s, year: 1980 })) };
  const again = mergeLibrary(confirmed, [row], { product: 'dahsha' });
  assert.deepEqual(again.catalog.shows.map((s) => s.id), ['s_1wi8zqx', 'fm:s:58474']);
  assert.deepEqual(again.catalog.shows[0].versions, [], 'no stale "Other versions" entry beside the new card');
  assert.equal(again.report.added, 1);
  assert.equal(again.report.pending.length, 0);
  assert.equal(idsListed(again.catalog, 'fm:s:58474'), 1);
  assert.equal(idsListed(exp.leanCatalog(again.catalog, 'dahsha'), 'fm:s:58474'), 1, 'the export lists the title once');
  assert.deepEqual(first.catalog.shows[0].versions.map((v) => v.id), ['fm:s:58474'], 'the base catalogue is not mutated');
  // The same through mergeCachedProviders, with the identity resolveProviderMatches writes.
  write('providers-dahsha.json', { version: 1, completed: true, queue: [], lastRefreshAt: null, errors: {}, items: [row] });
  write('provider-identities-dahsha.json', { s_1wi8zqx: { at: Date.now(), metadata: { year: 1980 } } });
  const cached = sync.mergeCachedProviders(first.catalog, 'dahsha', { log: () => {} });
  assert.equal(idsListed(cached.catalog, 'fm:s:58474'), 1);
  assert.ok(cached.catalog.shows.some((s) => s.id === 'fm:s:58474'));
  for (const name of ['providers-dahsha.json', 'provider-identities-dahsha.json']) fs.rmSync(path.join(dir, name));
});

test('a version moves with its row: held once, by the card that groups it now', () => {
  // An earlier merge left the row under another card; it now groups with a single one-year-off card.
  const stale = { ...mfShow('s_other', 'Other Title', 2020), versions: [{ ...fmFilm(1451867, 'Ghost Elephants', 2026), uncertainMatch: true }] };
  const result = mergeLibrary(catalogOf(stale, mfShow('s_1hcdqem', 'Ghost Elephants', 2025)), [fmFilm(1451867, 'Ghost Elephants', 2026)], { product: 'dahsha' });
  const byId = new Map(result.catalog.shows.map((s) => [s.id, s]));
  assert.deepEqual(byId.get('s_other').versions, []);
  assert.deepEqual(byId.get('s_1hcdqem').versions.map((v) => v.id), ['fm:m:1451867']);
  // A confirmed match drops the version too (the row joins the card it was a version of).
  const exact = mergeLibrary({ ...result.catalog, shows: result.catalog.shows.map((s) => s.id === 's_1hcdqem' ? { ...s, year: 2026 } : s) }, [fmFilm(1451867, 'Ghost Elephants', 2026)], { product: 'dahsha' });
  assert.equal(exact.report.matched, 1);
  assert.equal(idsListed(exact.catalog, 'fm:m:1451867'), 0, 'merged into the card, no longer a separate entry');
  assert.deepEqual(exact.catalog.shows.find((s) => s.id === 's_1hcdqem').versions, []);
});

test('resolveAliasTargets follows catalogue renames to a live id and keeps everything else', () => {
  const live = new Set(['s_B', 's_live', 'fm:m:1']);
  const isLive = (id) => live.has(id);
  const idAliases = { s_A: 's_B', s_chain1: 's_chain2', s_chain2: 's_B', s_loop1: 's_loop2', s_loop2: 's_loop1', s_dead: 's_gone', s_live: 's_B' };
  assert.deepEqual(ml.resolveAliasTargets({ 'fm:s:1': 's_A', 'fm:s:2': 's_chain1', 'fm:s:3': 's_loop1', 'fm:s:4': 's_dead', 'fm:s:5': 's_live', 'fm:m:1': 'fm:m:1', 'fm:s:6': 's_unknown', 'fm:s:7': 7 }, idAliases, isLive), {
    'fm:s:1': 's_B', 'fm:s:2': 's_B', 'fm:s:3': 's_loop1', 'fm:s:4': 's_dead', 'fm:s:5': 's_live', 'fm:m:1': 'fm:m:1', 'fm:s:6': 's_unknown', 'fm:s:7': 7,
  });
  assert.deepEqual(ml.resolveAliasTargets(null, idAliases, isLive), {});
  assert.deepEqual(ml.resolveAliasTargets(['x'], idAliases, isLive), {});
  assert.deepEqual(ml.resolveAliasTargets({ a: 's_A' }, 'junk', isLive), { a: 's_A' });
  const input = { a: 's_A' };
  ml.resolveAliasTargets(input, idAliases, isLive);
  assert.deepEqual(input, { a: 's_A' }, 'the input map is not mutated');
});

test('a confirmed provider alias follows catalog.idAliases when a rebuild renames its show', async () => {
  // Row confirmed as fm:s:68595 -> s_A; a rebuild retired s_A for s_B (idAliases {s_A: s_B}).
  const row = fmSeries(68595, 'Frozen Planet II', 2022);
  write('providers-dahsha.json', { version: 1, completed: true, queue: [], lastRefreshAt: null, errors: {}, items: [row] });
  const aliasFile = () => JSON.parse(fs.readFileSync(path.join(dir, 'provider-aliases-dahsha.json'), 'utf8'));
  // A: the survivor has no year, so the title fallback would only give an uncertain version.
  write('provider-aliases-dahsha.json', { 'fm:s:68595': 's_A' });
  const yearless = { ...catalogOf(ytSeries('s_B', 'Frozen Planet II')), idAliases: { s_A: 's_B' } };
  const a = sync.mergeCachedProviders(yearless, 'dahsha', { log: () => {} });
  assert.equal(a.report.matched, 1, 'the confirmed match survives the rename');
  assert.equal(a.report.pending.length, 0);
  assert.deepEqual(a.catalog.shows.map((s) => s.id), ['s_B']);
  assert.equal(a.catalog.shows[0].versions, undefined);
  assert.ok(a.catalog.shows[0].offerings.some((o) => o.id === 'fm:s:68595'));
  sync.saveMergeReport('dahsha', a.report);
  assert.equal(aliasFile()['fm:s:68595'], 's_B', 'the saved alias names the live show');
  // B: the survivor has another title, so the title fallback would add a duplicate fm:s card.
  write('provider-aliases-dahsha.json', { 'fm:s:68595': 's_A' });
  const retitled = { ...catalogOf(ytSeries('s_B', 'Frozen Planet II: The Making Of')), idAliases: { s_A: 's_B' } };
  const b = sync.mergeCachedProviders(retitled, 'dahsha', { log: () => {} });
  assert.equal(b.report.added, 0, 'no duplicate card');
  assert.deepEqual(b.catalog.shows.map((s) => s.id), ['s_B']);
  sync.saveMergeReport('dahsha', b.report);
  assert.equal(aliasFile()['fm:s:68595'], 's_B');
  // Live discovery merges read the same alias file through mergeLibrary.
  write('provider-aliases-dahsha.json', { 'fm:s:68595': 's_A' });
  const page = (items) => async () => ({ items, totalPages: 1 });
  const found = await lib.discoverLibrary({ kind: 'series', product: 'dahsha', catalog: retitled, fetchers: [page([row]), page([]), page([])] });
  assert.deepEqual(found.items.map((s) => s.id), ['s_B']);
  assert.ok(found.items[0].offerings.some((o) => o.id === 'fm:s:68595'));
  // Control: an alias to a live show is used as it is.
  write('provider-aliases-dahsha.json', { 'fm:s:68595': 's_B' });
  assert.equal(sync.mergeCachedProviders(catalogOf(ytSeries('s_B', 'Frozen Planet II: The Making Of')), 'dahsha', { log: () => {} }).report.matched, 1);
  for (const name of ['providers-dahsha.json', 'provider-aliases-dahsha.json', 'provider-matches-dahsha.json']) fs.rmSync(path.join(dir, name), { force: true });
});

test('a former provider card grouped as a version keeps its id reachable in the export', () => {
  // At HEAD fm:m:1445363 was its own card; a viewer's progress is stored under that id (Watch.jsx).
  const group = mfShow('s_1mt9z02', 'EPiC: Elvis Presley in Concert', 2025, { episodes: [{ id: 'mf:m:epic-elvis-presley-in-concert', title: 'Full film', season: null, number: null }] });
  const row = fmFilm(1445363, 'EPiC: Elvis Presley in Concert', 2026);
  row.episodes[0].thumbs = { custom: 'https://image.tmdb.org/t/p/w500/epic.jpg' };
  const merged = mergeLibrary(catalogOf(group), [row], { product: 'dahsha' });
  assert.deepEqual(merged.catalog.shows[0].versions.map((v) => v.id), ['fm:m:1445363']);
  const lean = exp.leanCatalog(merged.catalog, 'dahsha');
  const version = lean.shows[0].versions[0];
  assert.deepEqual(version.episodes.map((e) => e.id), ['fm:m:1445363'], 'the lean entry lists the id progress is stored under');
  assert.deepEqual(version.episodes[0].offerings.map((o) => o.id), ['fm:m:1445363']);
  assert.equal(version.episodes[0].thumbs.custom, 'https://image.tmdb.org/t/p/w500/epic.jpg');
  assert.equal(version.poster.custom, 'https://image.tmdb.org/t/p/w500/1445363.jpg');
  assert.equal(version.uncertainMatch, true);
  assert.deepEqual(lean.shows[0].episodes.map((e) => e.id), ['mf:m:epic-elvis-presley-in-concert'], 'episode slots are still not combined');
  assert.ok(exp.streamIds(merged.catalog.shows).includes('fm:m:1445363'), 'stream-ids.json keeps the version');
});
