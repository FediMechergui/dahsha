import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// store.js fixes DATA_DIR at import time, so point it at a scratch directory first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-artwork-'));
process.env.DATA_DIR = dir;
delete process.env.TMDB_API_KEY;
delete process.env.ARTWORK;
const art = await import('../src/artwork.js');
const svc = await import('../src/service-metadata.js');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const DAY = 864e5;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const writeData = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
const readData = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
function reset({ artwork = {}, rejects = null } = {}) {
  writeData('artwork.json', artwork);
  if (rejects) writeData('artwork-rejects.json', rejects); else fs.rmSync(path.join(dir, 'artwork-rejects.json'), { force: true });
  art.resetArtworkCache();
}

const respond = (body, status = 200, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body });
const RESPONSE = Symbol('response');
const raw = (body, status, headers) => ({ [RESPONSE]: respond(body, status, headers) });
/** Offline fetch: routes are [predicate, body | raw(...) | fn]; anything else is a 404. */
function fakeFetch(routes, calls = []) {
  return async (url, init = {}) => {
    calls.push(url);
    for (const [match, reply] of routes) {
      if (!(typeof match === 'function' ? match(url) : url === match)) continue;
      const value = typeof reply === 'function' ? await reply(url, init) : reply;
      return value?.[RESPONSE] || respond(value);
    }
    return respond(null, 404);
  };
}
const tvmaze = (q) => `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`;
const wikiSearch = (lang, q) => (url) => url.startsWith(`https://${lang}.wikipedia.org/w/api.php`) && decodeURIComponent(url).includes(`srsearch=${q}`);
const wikiSummary = (lang, page) => `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.replace(/ /g, '_'))}`;
const wikidata = (q) => (url) => url.startsWith('https://www.wikidata.org/') && url.includes(`search=${encodeURIComponent(q)}&`);
const quiet = { log: () => {}, sleep: async () => {}, aliases: {}, tmdbKey: '' };
const LONG = 'A long enough summary of this documentary programme, well past forty characters.';

test('exact confidence needs the same title, kind, documentary type and a compatible year', () => {
  const series = { title: 'Earth', kind: 'series', firstAt: '2021-03-01T00:00:00Z' };
  const hit = { query: 'Earth', names: ['Earth'], kind: 'series', typeOk: true };
  assert.equal(art.matchConfidence(series, { ...hit, year: 2023 }), null, 'premiered two years after the first upload: another programme');
  assert.equal(art.matchConfidence(series, { ...hit, year: 2007 }), 'exact');
  assert.equal(art.matchConfidence(series, { ...hit, year: 2022 }), 'fuzzy', 'within the slack year is never exact');
  assert.equal(art.matchConfidence(series, { ...hit, year: 2007, kind: 'film' }), 'fuzzy');
  assert.equal(art.matchConfidence(series, { ...hit, year: 2007, typeOk: false }), 'fuzzy');
  assert.equal(art.matchConfidence(series, { ...hit, year: 2007, names: ['Earthflight'] }), 'fuzzy');
  const dated = { title: 'Gold Rush', kind: 'series', year: 2020 };
  assert.equal(art.matchConfidence(dated, { query: 'Gold Rush', names: ['Gold Rush'], kind: 'series', typeOk: true, year: 2021 }), 'exact');
  assert.equal(art.matchConfidence(dated, { query: 'Gold Rush', names: ['Gold Rush'], kind: 'series', typeOk: true, year: 2023 }), 'fuzzy');
  assert.equal(art.titleKey('The Lion Ranger'), art.titleKey('Lion Ranger'));
  assert.equal(art.titleKey('Tom &amp; Jerry'), art.titleKey('Tom and Jerry'));
  assert.equal(art.titleKey('الأسد الحارس'), art.titleKey('الاسد الحارس'));
});

test('Wikipedia images: logos, tiny files and Commons paintings are never programme artwork', () => {
  assert.equal(art.usableWikiImage({ source: 'https://upload.wikimedia.org/wikipedia/ar/thumb/a/ab/Thmanyah.svg/42px-Thmanyah.svg.png', width: 42, height: 42 }), null);
  assert.equal(art.usableWikiImage({ source: 'https://upload.wikimedia.org/wikipedia/en/a/ab/Channel_logo.png', width: 800, height: 600 }), null);
  assert.equal(art.usableWikiImage({ source: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Frederick_II_and_al-Kamil.jpg', width: 191, height: 393 }), null);
  assert.equal(art.usableWikiImage({ source: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Frederick_II_and_al-Kamil.jpg', width: 900, height: 1200 }), null, 'Commons lead image of a programme page is not its poster');
  const poster = 'https://upload.wikimedia.org/wikipedia/en/1/1a/The_Cave_poster.jpg';
  assert.equal(art.usableWikiImage({ source: poster, width: 220, height: 326 }), poster);
  assert.equal(art.usableWikiImage({ source: 'https://upload.wikimedia.org/wikipedia/commons/2/2b/Nanook_of_the_north_poster.jpg', width: 400, height: 600 }), 'https://upload.wikimedia.org/wikipedia/commons/2/2b/Nanook_of_the_north_poster.jpg');
  assert.equal(art.imageKey('https://static.tvmaze.com/uploads/images/medium_portrait/9/999.jpg'), art.imageKey('https://static.tvmaze.com/uploads/images/original_untouched/9/999.jpg'));
});

test('an overrides alias finds the right programme and the animated namesake is never attached', async () => {
  reset();
  const logs = [], calls = [];
  const show = { id: 's_lion', title: 'الأسد الحارس', kind: 'series', lang: 'ar', firstAt: '2014-02-01T00:00:00Z', latestAt: '2014-06-01T00:00:00Z', episodeCount: 10 };
  const fetch = fakeFetch([
    [tvmaze('Lion Ranger'), [{ show: { id: 13620, name: 'Lion Ranger', type: 'Documentary', premiered: '2012-05-01', image: { original: 'https://static.tvmaze.com/uploads/images/original_untouched/1/13620.jpg' }, summary: `<p>${LONG}</p>` } }]],
    [tvmaze('The Lion Guard'), [{ show: { id: 6770, name: 'The Lion Guard', type: 'Animation', premiered: '2015-11-22', image: { original: 'https://static.tvmaze.com/uploads/images/original_untouched/622/1555671.jpg' } } }]],
    [wikidata('الأسد الحارس'), { search: [{ id: 'Q19363670', label: 'The Lion Guard', description: '2015 American animated television series', match: { type: 'label', language: 'ar', text: 'الأسد الحارس' } }] }],
  ], calls);
  const view = await art.enrichArtwork([show], { ...quiet, log: (m) => logs.push(m), fetch, aliases: { 'Lion Ranger': 'الأسد الحارس' } });
  assert.equal(view.s_lion.tvmazeId, 13620);
  assert.equal(view.s_lion.confidence, 'exact');
  assert.ok(!calls.some((u) => u.includes('themoviedb')), 'no TMDB request without a key');
  assert.equal(logs.filter((m) => m.includes('TMDB_API_KEY is not set')).length, 1, 'one clear warning per run');

  // Without the alias the Wikidata bridge only offers the cartoon, which must be rejected.
  reset();
  const bare = await art.enrichArtwork([show], { ...quiet, fetch });
  assert.equal(bare.s_lion, undefined);
  assert.equal(readData('artwork.json').s_lion.source, undefined);
});

test('drama namesakes and programmes that premiered after the upload are rejected', async () => {
  reset();
  const calls = [];
  const shows = [
    { id: 's_affair', title: 'المتخفي', kind: 'series', lang: 'ar', firstAt: '2019-01-01T00:00:00Z' },
    { id: 's_earth', title: 'Earth', kind: 'series', lang: 'en', firstAt: '2021-05-01T00:00:00Z' },
    { id: 's_mayday', title: 'Mayday', kind: 'series', lang: 'en', firstAt: '2013-01-01T00:00:00Z' },
  ];
  const fetch = fakeFetch([
    [wikidata('المتخفي'), { search: [
      { id: 'Q119167856', label: 'The Affair', description: 'Turkish television drama series', match: { language: 'ar', text: 'المتخفي' } },
      { id: 'Q1', label: 'The Affair', description: 'television series', match: { language: 'ar', text: 'المتخفي' } },
    ] }],
    [tvmaze('The Affair'), [{ show: { id: 127, name: 'The Affair', type: 'Scripted', premiered: '2014-10-12', image: { original: 'https://static.tvmaze.com/uploads/images/original_untouched/494/1235104.jpg' } } }]],
    [tvmaze('Earth'), [{ show: { id: 69733, name: 'Earth', type: 'Documentary', premiered: '2023-02-01', image: { original: 'https://static.tvmaze.com/uploads/images/original_untouched/468/1172225.jpg' }, summary: LONG } }]],
    [tvmaze('Mayday'), [{ show: { id: 94833, name: 'Mayday', type: 'Documentary', premiered: '2026-10-05', image: { original: 'https://static.tvmaze.com/x/94833.jpg' }, summary: LONG } }]],
  ], calls);
  const view = await art.enrichArtwork(shows, { ...quiet, fetch });
  assert.ok(calls.includes(tvmaze('The Affair')), 'the bridge reached TVmaze, where the Scripted type is rejected');
  assert.deepEqual(Object.keys(view), []);
  const cached = readData('artwork.json');
  for (const s of shows) assert.equal(cached[s.id].source, undefined, `${s.id} must be a miss`);
});

test('Wikipedia: platform pages and film pages for a series are skipped; exact film pages are used', async () => {
  reset();
  const poster = 'https://upload.wikimedia.org/wikipedia/en/1/1a/The_Cave_poster.jpg';
  const shows = [
    { id: 's_thmanyah', title: 'ثمانية', kind: 'series', lang: 'ar' },
    { id: 's_goldrush', title: 'حمى الذهب', kind: 'series', lang: 'ar', episodeCount: 70 },
    { id: 's_cave', title: 'The Cave', kind: 'film', lang: 'en', firstAt: '2020-01-10T00:00:00Z' },
  ];
  const fetch = fakeFetch([
    [wikiSearch('ar', 'ثمانية'), { query: { search: [{ title: 'ثمانية (منصة)' }] } }],
    [wikiSummary('ar', 'ثمانية (منصة)'), { type: 'standard', description: 'منصة ترفيهية سعودية', extract: 'ثمانية منصة إعلامية سعودية تنتج البودكاست والأفلام والبرامج الوثائقية منذ سنوات.', originalimage: { source: 'https://upload.wikimedia.org/wikipedia/ar/thumb/a/ab/Thmanyah.svg/42px-Thmanyah.svg.png', width: 42, height: 42 } }],
    [wikiSearch('ar', 'حمى الذهب'), { query: { search: [{ title: 'حمى الذهب (فلم)' }] } }],
    [wikiSummary('ar', 'حمى الذهب (فلم)'), { type: 'standard', description: 'فيلم أمريكي من إنتاج 1925', extract: 'حمى الذهب فيلم كوميدي صامت من إخراج وبطولة تشارلي تشابلن صدر عام 1925 ونال شهرة واسعة.', originalimage: { source: 'https://upload.wikimedia.org/wikipedia/ar/a/ab/Gold_Rush_poster.jpg', width: 300, height: 450 } }],
    [wikiSearch('en', 'The Cave'), { query: { search: [{ title: 'The Cave (2019 film)' }] } }],
    [wikiSummary('en', 'The Cave (2019 film)'), { type: 'standard', description: '2019 documentary film by Feras Fayyad', extract: 'The Cave is a 2019 documentary film directed by Feras Fayyad about an underground hospital in Syria.', originalimage: { source: poster, width: 220, height: 326 } }],
  ]);
  const view = await art.enrichArtwork(shows, { ...quiet, fetch });
  assert.deepEqual(Object.keys(view), ['s_cave']);
  assert.equal(view.s_cave.poster, poster);
  assert.equal(view.s_cave.source, 'wikipedia');
  assert.match(view.s_cave.overview, /underground hospital/);
  const cached = readData('artwork.json');
  assert.equal(cached.s_thmanyah.source, undefined);
  assert.equal(cached.s_goldrush.source, undefined);
});

test('fuzzy matches are cached for diagnostics but never handed to the catalogue', async () => {
  reset();
  const fetch = fakeFetch([[tvmaze('Storyville'), [{ show: { id: 9133, name: 'Storyville', type: 'Talk Show', premiered: '1997-01-01', image: { original: 'https://static.tvmaze.com/x/9133.jpg' }, summary: LONG } }]]]);
  const view = await art.enrichArtwork([{ id: 's_story', title: 'Storyville', kind: 'series', lang: 'en', firstAt: '2020-01-01T00:00:00Z' }], { ...quiet, fetch });
  assert.equal(view.s_story, undefined);
  assert.equal(readData('artwork.json').s_story.confidence, 'fuzzy');
  assert.equal(art.getArtwork().s_story, undefined);
});

test('provider-only rows: TMDB by the provider id with a key, exact TVmaze title without one', async () => {
  reset();
  const fmRow = { id: 'fm:m:77', tmdbId: 77, kind: 'film', title: 'A Shared Film', year: 2024, synopsis: '', channelId: 'fmovies', portrait: 'https://image.tmdb.org/t/p/w500/own.jpg', poster: { custom: 'https://image.tmdb.org/t/p/w500/own.jpg' }, firstSeenAt: ago(1) };
  const hdRow = { id: 'hd:s:tv-customer-wars-x', kind: 'series', title: 'Customer Wars', year: null, synopsis: '', channelId: 'hdtoday', portrait: 'https://image.tmdb.org/t/p/w342/kw.jpg', firstSeenAt: ago(2) };
  const calls = [];
  const fetch = fakeFetch([
    [(u) => u.startsWith('https://api.themoviedb.org/3/movie/77?'), { id: 77, title: 'A Shared Film', overview: 'The overview TMDB publishes for this shared documentary film.', poster_path: '/p.jpg', backdrop_path: '/b.jpg' }],
    [tvmaze('Customer Wars'), [{ show: { id: 65006, name: 'Customer Wars', type: 'Reality', premiered: '2016-01-01', image: { original: 'https://static.tvmaze.com/x/65006.jpg' }, summary: `<p>${LONG}</p>` } }]],
  ], calls);
  const view = await art.enrichArtwork([fmRow, hdRow], { ...quiet, fetch, tmdbKey: 'test-key' });
  const movieCall = calls.find((u) => u.includes('/3/movie/77'));
  assert.ok(movieCall && new URL(movieCall).searchParams.get('language') === 'en-US');
  assert.equal(view['fm:m:77'].confidence, 'exact');
  const applied = art.applyProviderArtwork(fmRow, view['fm:m:77']);
  assert.equal(applied.synopsis, 'The overview TMDB publishes for this shared documentary film.');
  assert.equal(applied.portrait, fmRow.portrait, 'the provider cover is never replaced');
  assert.equal(art.applyProviderArtwork(hdRow, view[hdRow.id]).synopsis, LONG);
  assert.equal(art.applyProviderArtwork(hdRow, { ...view[hdRow.id], confidence: 'fuzzy' }).synopsis, '');
});

test('queue: newest first, bounded per run, covered and rejected titles skipped', async () => {
  reset({ rejects: ['s_rejected'] });
  const calls = [];
  const series = (id, title, latestAt, extra = {}) => ({ id, title, kind: 'series', lang: 'en', latestAt, ...extra });
  const shows = [
    series('s_old', 'Old Programme', '2020-01-01T00:00:00Z', { episodeCount: 50 }),
    series('s_new', 'New Programme', '2026-10-01T00:00:00Z'),
    series('s_mid', 'Mid Programme', '2023-01-01T00:00:00Z'),
    series('s_covered', 'Covered Programme', '2026-10-10T00:00:00Z', { posterVideoId: 'mf:e:covered', portrait: 'https://myflixerz.day/p.jpg', synopsis: 'Real synopsis from the provider.', synopsisGenerated: false }),
    series('s_rejected', 'Rejected Programme', '2026-10-11T00:00:00Z'),
  ];
  await art.enrichArtwork(shows, { ...quiet, fetch: fakeFetch([], calls), maxPerRun: 2 });
  const queried = calls.filter((u) => u.startsWith('https://api.tvmaze.com')).map((u) => decodeURIComponent(new URL(u).searchParams.get('q')));
  assert.deepEqual(queried, ['New Programme', 'Mid Programme']);
  assert.deepEqual(Object.keys(readData('artwork.json')).sort(), ['s_mid', 's_new']);
  assert.equal(art.artworkRunSummary().due, 3);
});

test('re-checks: exact after 90 days, misses after 30, entries from older rules at once', async () => {
  const exact = (days) => ({ source: 'tvmaze', confidence: 'exact', v: 2, poster: 'https://static.tvmaze.com/x/1.jpg', checkedAt: ago(days) });
  reset({ artwork: {
    s_exact_recent: exact(10), s_exact_old: exact(100),
    s_miss_recent: { v: 2, checkedAt: ago(10) }, s_miss_old: { v: 2, checkedAt: ago(31) },
    s_incomplete: { v: 2, incomplete: true, checkedAt: ago(4) },
    s_legacy: { source: 'tvmaze', poster: 'https://static.tvmaze.com/x/2.jpg', checkedAt: ago(5) },
  } });
  assert.deepEqual(Object.keys(art.getArtwork()).sort(), ['s_exact_old', 's_exact_recent'], 'old entries without confidence are not used');
  const calls = [];
  const ids = ['s_exact_recent', 's_exact_old', 's_miss_recent', 's_miss_old', 's_incomplete', 's_legacy'];
  await art.enrichArtwork(ids.map((id) => ({ id, title: `Title ${id}`, kind: 'series', lang: 'en' })), { ...quiet, fetch: fakeFetch([], calls) });
  const queried = new Set(calls.filter((u) => u.startsWith('https://api.tvmaze.com')).map((u) => new URL(u).searchParams.get('q')));
  assert.deepEqual([...queried].sort(), ['Title s_exact_old', 'Title s_incomplete', 'Title s_legacy', 'Title s_miss_old']);
});

test('reject list removes shows and images, including other sizes of a rejected image', async () => {
  const entry = (poster) => ({ source: 'tvmaze', confidence: 'exact', v: 2, poster, overview: LONG, checkedAt: ago(100) });
  reset({
    artwork: { s_rej: entry('https://static.tvmaze.com/uploads/images/original_untouched/1/1.jpg'), s_img: entry('https://static.tvmaze.com/uploads/images/medium_portrait/9/999.jpg') },
    rejects: { shows: ['s_rej'], images: ['https://static.tvmaze.com/uploads/images/original_untouched/9/999.jpg'] },
  });
  const view = art.getArtwork();
  assert.equal(view.s_rej, undefined);
  assert.equal(view.s_img.poster, null);
  assert.equal(view.s_img.overview, LONG);
  const calls = [];
  await art.enrichArtwork([{ id: 's_rej', title: 'Rejected', kind: 'series', lang: 'en' }], { ...quiet, fetch: fakeFetch([], calls) });
  assert.equal(calls.length, 0);
});

test('hung requests time out, 429 retries are bounded, and failed lookups retry sooner', async (t) => {
  // AbortSignal.timeout uses an unreferenced timer. A real HTTP request keeps
  // Node alive; this deliberately socket-free fetch mock needs its own handle.
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  reset();
  const hang = (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const show = { id: 's_hang', title: 'Hanging Programme', kind: 'series', lang: 'en' };
  const view = await art.enrichArtwork([show], { ...quiet, fetch: hang, timeoutMs: 20 });
  assert.equal(view.s_hang, undefined);
  assert.equal(readData('artwork.json').s_hang.incomplete, true);
  assert.equal(art.artworkRunSummary().incomplete, 1);

  reset();
  const calls = [], waits = [];
  const limited = fakeFetch([[() => true, raw(null, 429, { 'retry-after': '1' })]], calls);
  await art.enrichArtwork([{ id: 's_busy', title: 'Busy Programme', kind: 'series', lang: 'en' }], { ...quiet, fetch: limited, sleep: async (ms) => { waits.push(ms); } });
  const perUrl = new Map();
  for (const u of calls) perUrl.set(u, (perUrl.get(u) || 0) + 1);
  assert.ok(Math.max(...perUrl.values()) <= 4, 'one request plus at most three retries');
  assert.ok(waits.filter((ms) => ms === 1000).length >= 3, 'Retry-After is honoured');
  assert.equal(readData('artwork.json').s_busy.incomplete, true);
});

test('service metadata is cached by show id and only missing or stale series are queried', async () => {
  const catalog = () => ({ product: 'dahsha', shows: [
    { id: 'hd:s:customer-wars', kind: 'series', title: 'Customer Wars' },
    { id: 's_unknown', kind: 'series', title: 'Unknown Programme' },
    { id: 's_film', kind: 'film', title: 'A Film' },
  ] });
  const queried = [];
  const fetchJson = async (url) => {
    const q = new URL(url).searchParams.get('q');
    queried.push(q);
    return q === 'Customer Wars' ? [{ show: { id: 65006, name: 'Customer Wars', premiered: '2016-01-01', network: { name: 'A&E', country: { code: 'US' } } } }] : [];
  };
  const first = catalog();
  assert.equal(await svc.enrichServices(first, { fetchJson, delayMs: 0, log: () => {} }), 1);
  assert.deepEqual(queried.sort(), ['Customer Wars', 'Unknown Programme']);
  const file = readData(svc.serviceMetadataFile('dahsha'));
  assert.equal(file['hd:s:customer-wars'].tvm.svc, 'A&E');
  assert.equal(file.s_unknown.tvm, null);

  // A rebuilt catalogue has no tvm: it comes back from the cache without a single request.
  const rebuilt = catalog();
  const never = async () => { throw new Error('must not query TVmaze'); };
  assert.equal(await svc.enrichServices(rebuilt, { fetchJson: never, delayMs: 0, log: () => {} }), 1);
  assert.equal(rebuilt.shows[0].tvm.id, 65006);
  assert.ok(rebuilt.shows[1].serviceCheckedAt);

  queried.length = 0;
  const later = catalog();
  await svc.enrichServices(later, { fetchJson: async (url) => (queried.push(new URL(url).searchParams.get('q')), []), delayMs: 0, log: () => {}, now: Date.now() + 31 * DAY });
  assert.deepEqual(queried.sort(), ['Customer Wars', 'Unknown Programme'], 'everything older than 30 days is re-checked');
  assert.equal(later.shows[0].tvm.id, 65006, 'a later miss keeps the verified match');

  queried.length = 0;
  const renamed = catalog();
  renamed.shows[0].title = 'Customer Wars: Extra';
  await svc.enrichServices(renamed, { fetchJson, delayMs: 0, log: () => {} });
  assert.deepEqual(queried, ['Customer Wars: Extra']);
});
