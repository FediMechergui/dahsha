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

test('re-checks: exact after 90+ days, misses on their own schedule, exact entries from older rules at once', async () => {
  const V = art.ARTWORK_RULES_VERSION;
  const exact = (days, v = V) => ({ source: 'tvmaze', confidence: 'exact', v, poster: 'https://static.tvmaze.com/x/1.jpg', checkedAt: ago(days) });
  reset({ artwork: {
    s_exact_recent: exact(10), s_exact_old: exact(200), s_exact_v2: exact(10, 2),
    s_fuzzy_v2: { source: 'wikipedia', confidence: 'fuzzy', v: 2, overview: LONG, checkedAt: ago(10) },
    s_miss_recent: { v: 2, checkedAt: ago(10) }, s_miss_old: { v: 2, checkedAt: ago(50) },
    s_miss_once_due: { v: V, misses: 1, checkedAt: ago(11) }, s_miss_once_fresh: { v: V, misses: 1, checkedAt: ago(5) },
    s_incomplete: { v: V, incomplete: true, misses: 0, checkedAt: ago(5) },
    s_legacy: { source: 'tvmaze', poster: 'https://static.tvmaze.com/x/2.jpg', checkedAt: ago(5) },
  } });
  assert.deepEqual(Object.keys(art.getArtwork()).sort(), ['s_exact_old', 's_exact_recent', 's_exact_v2'], 'old entries without confidence are not used');
  const calls = [];
  const ids = Object.keys(readData('artwork.json'));
  await art.enrichArtwork(ids.map((id) => ({ id, title: `Title ${id}`, kind: 'series', lang: 'en' })), { ...quiet, fetch: fakeFetch([], calls) });
  const queried = new Set(calls.filter((u) => u.startsWith('https://api.tvmaze.com')).map((u) => new URL(u).searchParams.get('q')));
  assert.deepEqual([...queried].sort(), ['Title s_exact_old', 'Title s_exact_v2', 'Title s_incomplete', 'Title s_legacy', 'Title s_miss_old', 'Title s_miss_once_due'],
    'a v2 fuzzy entry or miss is not re-checked for the rules bump: the rules since v2 only got stricter');
});

test('misses come back after 7, 30, then 90 days, spread over extra days fixed per show id', async () => {
  const within = (days, base) => days >= base && days < base * 1.5;
  for (const id of ['s_a', 's_b', 's_c', 'fm:m:1', 'mf:x']) {
    assert.ok(within(art.recheckDays({ v: 3, misses: 1 }, id), 7));
    assert.ok(within(art.recheckDays({ v: 3, misses: 2 }, id), 30));
    assert.ok(within(art.recheckDays({ v: 3, misses: 5 }, id), 90));
    assert.ok(within(art.recheckDays({ v: 2 }, id), 30), 'a miss cached before misses were counted keeps the 30-day cadence');
    assert.ok(within(art.recheckDays({ source: 'tvmaze', confidence: 'exact', v: 3 }, id), 90));
    assert.ok(within(art.recheckDays({ v: 3, incomplete: true }, id), 3));
    assert.equal(art.recheckDays({ v: 2 }, id), art.recheckDays({ v: 2 }, id), 'deterministic');
  }
  // 1,000 misses looked up in the same run no longer come back on the same day.
  const days = new Set(Array.from({ length: 1000 }, (_, i) => art.recheckDays({ v: 2 }, `s_${i.toString(36)}`)));
  assert.ok(days.size >= 12, `spread over ${days.size} days`);
  assert.equal(Math.min(...days), 30);

  // The counter: a first miss, a second miss, then an exact match clears it.
  reset({ artwork: { s_twice: { v: 3, misses: 1, checkedAt: ago(20) } } });
  const show = (id, title) => ({ id, title, kind: 'series', lang: 'en', firstAt: '2020-01-01T00:00:00Z' });
  await art.enrichArtwork([show('s_new', 'Brand New Programme'), show('s_twice', 'Twice Missed')], { ...quiet, fetch: fakeFetch([]) });
  let cached = readData('artwork.json');
  assert.equal(cached.s_new.misses, 1);
  assert.equal(cached.s_twice.misses, 2);
  reset({ artwork: { s_found: { v: 3, misses: 2, checkedAt: ago(60) } } });
  await art.enrichArtwork([show('s_found', 'Found Programme')], { ...quiet, fetch: fakeFetch([[tvmaze('Found Programme'), [{ show: { id: 5, name: 'Found Programme', type: 'Documentary', premiered: '2010-01-01', image: { original: 'https://static.tvmaze.com/x/5.jpg' } } }]]]) });
  cached = readData('artwork.json');
  assert.equal(cached.s_found.confidence, 'exact');
  assert.equal(cached.s_found.misses, undefined);
});

const DISCOVERY = { id: 'UCqOoboPm3uhY_YXhvhmL-WA', title: 'Discovery', short: 'Discovery', profile: 'generic-en' };
const VICE = { id: 'UCZaT_X_mc0BI-djXOlfhqWQ', title: 'VICE News', short: 'VICE News', profile: 'generic-en' };
const HISTORY = { id: 'UC9MAhZQQd9egwWCxrwSIsJQ', title: 'HISTORY', short: 'HISTORY', profile: 'history' };
const CURIOSITY = { id: 'UCd7zlpSjvUuUwsQdqV3LF3w', title: 'Curiosity Stream', short: 'Curiosity Stream', profile: 'generic-en' };

test('broadcasters: a channel that uploads its own programmes never takes another network\'s programme as exact', () => {
  assert.deepEqual(art.namedNetworks('Shockwave is an American documentary television series that premiered on November 30, 2007, on the History Channel.'), ['History Channel']);
  assert.deepEqual(art.namedNetworks('The docu-series was developed for Freeform by director Jon Kasbe.'), ['Freeform']);
  assert.deepEqual(art.namedNetworks('A Netflix original documentary.'), ['Netflix']);
  assert.deepEqual(art.namedNetworks('A documentary on the history of the Amazon rainforest by Lifetime Achievement winners.'), [], 'prose words are not networks');
  assert.equal(art.networkFamily('Comedy Central'), 'comedycentral');
  assert.equal(art.networkFamily('Science'), 'discovery', 'TVmaze calls the Science Channel "Science"');
  assert.equal(art.networkFamily('Seven Network'), 'other:seven network');
  const bb = { title: 'BattleBots', kind: 'series', lang: 'en', channel: DISCOVERY };
  assert.equal(art.networkConflict(bb, ['Comedy Central']), true);
  assert.equal(art.networkConflict(bb, ['Discovery Channel', 'HBO Max']), false);
  assert.equal(art.networkConflict(bb, [null]), false, 'no network named: nothing to compare');
  assert.equal(art.networkConflict({ ...bb, channel: CURIOSITY }, ['Comedy Central']), false, 'aggregator channels carry other networks\' programmes');
  assert.equal(art.networkConflict({ ...bb, lang: 'ar', channel: { title: 'Discovery الشرق', profile: 'asharq' } }, ['Comedy Central']), false, 'Arabic dub channels are exempt');
  assert.equal(art.networkConflict({ title: 'X', kind: 'film', lang: 'en', channel: { title: 'Kurzgesagt', profile: 'creator' } }, ['Netflix']), true, 'a creator\'s video is never a network programme');
  assert.equal(art.networkConflict({ title: 'VICE News Tonight', kind: 'series', lang: 'en', channel: VICE }, ['HBO']), false);
  const hit = { query: 'BattleBots', names: ['BattleBots'], kind: 'series', typeOk: true, year: 2000 };
  assert.equal(art.matchConfidence({ ...bb, firstAt: '2023-01-19T00:00:00Z' }, { ...hit, networks: ['Comedy Central'] }), 'fuzzy');
  assert.equal(art.matchConfidence({ ...bb, firstAt: '2023-01-19T00:00:00Z' }, { ...hit, networks: ['Discovery'] }), 'exact');
});

test('TVmaze: BattleBots (Reality 2000 vs Game Show 2015) is only fuzzy, by namesake and by network', async () => {
  const rows = (withNetworks) => [
    { show: { id: 33675, name: 'BattleBots', type: 'Reality', premiered: '2000-08-23', ...(withNetworks ? { network: { name: 'Comedy Central' } } : {}), image: { original: 'https://static.tvmaze.com/uploads/images/original_untouched/137/343191.jpg' }, summary: `<p>${LONG}</p>` } },
    { show: { id: 1823, name: 'BattleBots', type: 'Game Show', premiered: '2015-06-21', ...(withNetworks ? { network: { name: 'ABC' } } : {}), image: { original: 'https://static.tvmaze.com/x/1823.jpg' } } },
  ];
  const show = (id, channel) => ({ id, title: 'BattleBots', kind: 'series', lang: 'en', firstAt: '2023-01-19T21:30:05Z', episodeCount: 28, channel });
  for (const [label, routes, channel] of [['networks', rows(true), DISCOVERY], ['namesake only, aggregator channel', rows(false), CURIOSITY]]) {
    reset();
    const view = await art.enrichArtwork([show('s_1nrcim1', channel)], { ...quiet, fetch: fakeFetch([[tvmaze('BattleBots'), routes]]) });
    assert.equal(view.s_1nrcim1, undefined, label);
    const cached = readData('artwork.json').s_1nrcim1;
    assert.equal(cached.confidence, 'fuzzy', label);
    assert.equal(cached.tvmazeId, 33675, label);
  }
  // The same 2000 programme alone: Comedy Central is not Discovery, but an aggregator channel may carry it.
  reset();
  const alone = [rows(true)[0]];
  let view = await art.enrichArtwork([show('s_bb_discovery', DISCOVERY), show('s_bb_curiosity', CURIOSITY)], { ...quiet, fetch: fakeFetch([[tvmaze('BattleBots'), alone]]) });
  assert.deepEqual(Object.keys(view), ['s_bb_curiosity']);
  assert.equal(readData('artwork.json').s_bb_discovery.network, 'Comedy Central');
  // A namesake that premiered after the upload is not a namesake: it cannot be this programme.
  reset();
  const later = [rows(false)[0], { show: { id: 99, name: 'BattleBots', type: 'Game Show', premiered: '2025-01-01' } }];
  view = await art.enrichArtwork([show('s_bb_old', CURIOSITY)].map((s) => ({ ...s, firstAt: '2010-01-01T00:00:00Z' })), { ...quiet, fetch: fakeFetch([[tvmaze('BattleBots'), later]]) });
  assert.equal(view.s_bb_old.tvmazeId, 33675);
});

test('Wikipedia: VICE News vs History Channel and Freeform pages stay fuzzy; the right channel gets the match', async () => {
  reset();
  const poster = 'https://upload.wikimedia.org/wikipedia/en/6/62/Shockwave_title_credits.jpg';
  const shows = [
    { id: 's_113emp', title: 'The Shockwave', kind: 'series', lang: 'en', firstAt: '2021-06-20T16:00:01Z', channel: VICE },
    { id: 's_history_shockwave', title: 'Shockwave', kind: 'series', lang: 'en', firstAt: '2015-01-01T00:00:00Z', channel: HISTORY },
    { id: 's_xdxmjf', title: 'The Deep End', kind: 'series', lang: 'en', firstAt: '2022-01-01T16:00:02Z', channel: VICE },
  ];
  const fetch = fakeFetch([
    [wikiSearch('en', 'Shockwave'), { query: { search: [{ title: 'Shockwave (TV series)' }] } }],
    [wikiSearch('en', 'The Shockwave'), { query: { search: [{ title: 'Shockwave (TV series)' }] } }],
    [wikiSummary('en', 'Shockwave (TV series)'), { type: 'standard', description: 'American documentary television series', extract: 'Shockwave is an American documentary television series that premiered on November 30, 2007, on the History Channel. The program compiles video footage and eyewitness accounts.', originalimage: { source: poster, width: 320, height: 240 } }],
    [wikiSearch('en', 'The Deep End'), { query: { search: [{ title: 'The Deep End (2022 TV series)' }] } }],
    [wikiSummary('en', 'The Deep End (2022 TV series)'), { type: 'standard', description: '2022 American documentary series', extract: 'The Deep End is an American four-part documentary series about the spiritual influencer Teal Swan. The docu-series was developed for Freeform by director Jon Kasbe.' }],
  ]);
  const view = await art.enrichArtwork(shows, { ...quiet, fetch });
  assert.deepEqual(Object.keys(view), ['s_history_shockwave']);
  const cached = readData('artwork.json');
  assert.equal(cached.s_113emp.confidence, 'fuzzy');
  assert.equal(cached.s_xdxmjf.confidence, 'fuzzy');
});

test('Wikipedia: Turkish dramas, pages that never say documentary and two same-title pages are not exact', async () => {
  reset();
  const local = (f) => ({ source: `https://upload.wikimedia.org/wikipedia/${f}`, width: 300, height: 450 });
  const shows = [
    { id: 's_affair', title: 'المتخفي', kind: 'series', lang: 'ar', firstAt: '2019-01-01T00:00:00Z' },
    { id: 's_plain', title: 'Ocean Giants', kind: 'series', lang: 'en', firstAt: '2015-01-01T00:00:00Z' },
    { id: 's_twin', title: 'Wild China', kind: 'series', lang: 'en', firstAt: '2024-01-01T00:00:00Z' },
  ];
  const fetch = fakeFetch([
    [wikiSearch('ar', 'المتخفي'), { query: { search: [{ title: 'المتخفي (مسلسل)' }] } }],
    [wikiSummary('ar', 'المتخفي (مسلسل)'), { type: 'standard', description: 'مسلسل تلفزيوني تركي', extract: 'المتخفي هو المسلسل التركي من بطولة نجوم الدراما التركية، عرض لأول مرة عام 2014 وحقق نجاحا كبيرا في العالم العربي.', originalimage: local('ar/a/ab/Affair_poster.jpg') }],
    [wikiSearch('en', 'Ocean Giants'), { query: { search: [{ title: 'Ocean Giants (TV series)' }] } }],
    [wikiSummary('en', 'Ocean Giants (TV series)'), { type: 'standard', description: 'British television series', extract: 'Ocean Giants is a British television series about whales and dolphins, first shown in 2011 and narrated by Stephen Fry.', originalimage: local('en/a/ab/Ocean_Giants_poster.jpg') }],
    [wikiSearch('en', 'Wild China'), { query: { search: [{ title: 'Wild China (2008 TV series)' }, { title: 'Wild China (2023 TV series)' }] } }],
    [wikiSummary('en', 'Wild China (2008 TV series)'), { type: 'standard', description: 'British nature documentary series', extract: 'Wild China is a 2008 nature documentary series about the natural history of China, with six episodes.', originalimage: local('en/a/ab/Wild_China_2008_poster.jpg') }],
    [wikiSummary('en', 'Wild China (2023 TV series)'), { type: 'standard', description: 'Chinese nature documentary series', extract: 'Wild China is a 2023 nature documentary series made in China about its national parks and wildlife.', originalimage: local('en/a/ab/Wild_China_2023_poster.jpg') }],
  ]);
  const view = await art.enrichArtwork(shows, { ...quiet, fetch });
  assert.deepEqual(Object.keys(view), []);
  const cached = readData('artwork.json');
  assert.equal(cached.s_affair.source, undefined, 'the Turkish drama page is rejected outright');
  assert.equal(cached.s_plain.confidence, 'fuzzy', 'a "television series" that never says documentary');
  assert.equal(cached.s_twin.confidence, 'fuzzy');
  assert.equal(cached.s_twin.namesakes, 2);
});

test('Wikipedia: a same-title page with nothing to show still counts as a namesake, also in the next language', async () => {
  reset();
  const local = (f) => ({ source: `https://upload.wikimedia.org/wikipedia/${f}`, width: 300, height: 450 });
  const enShow = { id: 's_empty_twin', title: 'Desert Kings', kind: 'series', lang: 'en', firstAt: '2024-01-01T00:00:00Z' };
  const arShow = { id: 's_ar_twin', title: 'ملوك الصحراء', kind: 'series', lang: 'ar', firstAt: '2024-01-01T00:00:00Z' };
  const fetch = fakeFetch([
    [wikiSearch('en', 'Desert Kings'), { query: { search: [{ title: 'Desert Kings (2010 TV series)' }, { title: 'Desert Kings (2021 TV series)' }] } }],
    [wikiSummary('en', 'Desert Kings (2010 TV series)'), { type: 'standard', description: 'British nature documentary series', extract: 'Desert Kings is a 2010 nature documentary series about desert lions, shown in three parts.', originalimage: local('en/a/ab/Desert_Kings_poster.jpg') }],
    // The second programme of that name: a stub, no image and too little text for an overview.
    [wikiSummary('en', 'Desert Kings (2021 TV series)'), { type: 'standard', description: 'Emirati documentary series', extract: 'A documentary series.' }],
    [wikiSearch('ar', 'ملوك الصحراء'), { query: { search: [{ title: 'ملوك الصحراء (برنامج 2010)' }, { title: 'ملوك الصحراء (برنامج 2021)' }] } }],
    [wikiSummary('ar', 'ملوك الصحراء (برنامج 2010)'), { type: 'standard', description: 'سلسلة وثائقية بريطانية', extract: 'قصير.' }],
    [wikiSummary('ar', 'ملوك الصحراء (برنامج 2021)'), { type: 'standard', description: 'سلسلة وثائقية إماراتية', extract: 'قصير.' }],
    [wikiSearch('en', 'ملوك الصحراء'), { query: { search: [{ title: 'ملوك الصحراء' }] } }],
    [wikiSummary('en', 'ملوك الصحراء'), { type: 'standard', description: 'documentary series', extract: 'A documentary series about desert lions, with a poster on the English page.', originalimage: local('en/a/ab/Desert_Kings_poster.jpg') }],
  ]);
  const view = await art.enrichArtwork([enShow, arShow], { ...quiet, fetch });
  assert.deepEqual(Object.keys(view), []);
  const cached = readData('artwork.json');
  assert.equal(cached.s_empty_twin.confidence, 'fuzzy');
  assert.equal(cached.s_empty_twin.namesakes, 2);
  assert.equal(cached.s_ar_twin.confidence, 'fuzzy', 'two Arabic programmes of that name: the English page is not taken as exact either');
});

test('Wikipedia: the channel\'s own network or a dated provider row vouches for a page without "documentary"', async () => {
  reset();
  const shows = [
    { id: 's_nostra', title: 'Nostradamus Effect', kind: 'series', lang: 'en', firstAt: '2015-01-01T00:00:00Z', channel: HISTORY },
    { id: 's_nostra_vice', title: 'Nostradamus Effect', kind: 'series', lang: 'en', firstAt: '2015-01-01T00:00:00Z', channel: VICE },
    { id: 'fm:m:836485', title: 'Jane by Charlotte', kind: 'film', year: 2021, channelId: 'fmovies', synopsis: '', portrait: 'https://image.tmdb.org/t/p/w500/j.jpg' },
    { id: 's_jane', title: 'Jane by Charlotte', kind: 'film', lang: 'en', firstAt: '2023-01-01T00:00:00Z', channel: CURIOSITY },
  ];
  const fetch = fakeFetch([
    [wikiSearch('en', 'Nostradamus Effect'), { query: { search: [{ title: 'Nostradamus Effect' }] } }],
    [wikiSummary('en', 'Nostradamus Effect'), { type: 'standard', description: 'American TV series', extract: 'Nostradamus Effect is an American television series that premiered on September 9, 2009, on the History Channel. Each episode examines a prophecy.' }],
    [wikiSearch('en', 'Jane by Charlotte'), { query: { search: [{ title: 'Jane by Charlotte' }] } }],
    [wikiSummary('en', 'Jane by Charlotte'), { type: 'standard', description: '2021 film by Charlotte Gainsbourg', extract: 'Jane by Charlotte is a 2021 French drama film directed by Charlotte Gainsbourg in her directorial debut, about her mother Jane Birkin.' }],
  ]);
  const view = await art.enrichArtwork(shows, { ...quiet, fetch });
  assert.deepEqual(Object.keys(view).sort(), ['fm:m:836485', 's_nostra']);
  const cached = readData('artwork.json');
  assert.equal(cached.s_nostra_vice.confidence, 'fuzzy', 'a History Channel page is not a VICE News programme');
  assert.equal(cached.s_jane.source, undefined, 'without a year to compare, a "drama film" page is rejected');
  assert.ok(art.staleMatchReasons({ source: 'wikipedia', confidence: 'exact', name: 'Jane by Charlotte', overview: 'Jane by Charlotte is a 2021 French docu-drama film.' }, { title: 'Jane by Charlotte', kind: 'film' }).length === 0, '"docu-drama" is documentary');
});

test('cached matches from older rules are downgraded without a single request', async () => {
  const wiki = (name, overview, extra = {}) => ({ source: 'wikipedia', wiki: `en:${name}`, name, confidence: 'exact', v: 2, score: 1, poster: null, overview, overviewLang: 'en', checkedAt: ago(1), ...extra });
  reset({ artwork: {
    s_113emp: wiki('Shockwave (TV series)', 'Shockwave is an American documentary television series that premiered on November 30, 2007, on the History Channel.', { poster: 'https://upload.wikimedia.org/wikipedia/en/6/62/Shockwave_title_credits.jpg' }),
    s_xdxmjf: wiki('The Deep End (2022 TV series)', 'The Deep End is an American four-part documentary series. The docu-series was developed for Freeform by director Jon Kasbe.'),
    s_film: wiki('Gold Rush (1925 film)', 'The Gold Rush is a 1925 American silent comedy film written and directed by Charlie Chaplin, a documentary of sorts.'),
    s_good: wiki('Forged in Fire (TV series)', 'Forged in Fire is an American documentary competition series that airs on the History channel and premiered on History in 2015.'),
    s_tv_good: { source: 'tvmaze', tvmazeId: 1, name: 'Gold Rush', confidence: 'exact', v: 2, tvmazeType: 'Reality', premiered: '2010-12-03', poster: 'https://static.tvmaze.com/x/gr.jpg', checkedAt: ago(1) },
  } });
  const show = (id, title, channel) => ({ id, title, kind: 'series', lang: 'en', firstAt: '2021-06-20T16:00:01Z', channel });
  const shows = [show('s_113emp', 'The Shockwave', VICE), show('s_xdxmjf', 'The Deep End', VICE), show('s_film', 'Gold Rush', DISCOVERY), show('s_good', 'Forged in Fire', HISTORY), show('s_tv_good', 'Gold Rush', DISCOVERY)];
  const calls = [];
  const view = await art.enrichArtwork(shows, { ...quiet, fetch: fakeFetch([], calls), maxPerRun: 0 });
  assert.equal(calls.length, 0);
  assert.deepEqual(Object.keys(view).sort(), ['s_good', 's_tv_good']);
  const cached = readData('artwork.json');
  assert.deepEqual(cached.s_113emp.downgraded, ['network']);
  assert.deepEqual(cached.s_xdxmjf.downgraded, ['network']);
  assert.deepEqual(cached.s_film.downgraded, ['kind']);
  assert.equal(cached.s_113emp.source, 'wikipedia', 'kept for diagnostics (and the snapshot matched count)');
  assert.equal(art.artworkRunSummary().downgraded, 3);
  assert.equal(art.artworkRunSummary().due, 5, 'the two surviving v2 matches and the three downgrades all wait for an online re-check');
  assert.deepEqual(art.staleMatchReasons(cached.s_good, shows[3]), []);
  const tiers = Object.fromEntries(art.artworkQueue(shows, cached).map((q) => [q.s.id, q.tier]));
  assert.deepEqual(tiers, { s_good: 0, s_tv_good: 0, s_113emp: 2, s_xdxmjf: 2, s_film: 2 }, 'shown v2 matches first; offline downgrades are confirmed online after the never-looked-up titles');

  // The online re-check replaces the downgraded entry with a current-rules one, and it is not queued again.
  await art.enrichArtwork([shows[0]], { ...quiet, fetch: fakeFetch([]) });
  const confirmed = readData('artwork.json').s_113emp;
  assert.equal(confirmed.downgraded, undefined);
  assert.equal(confirmed.v, art.ARTWORK_RULES_VERSION);
  assert.equal(confirmed.forTitle, 'The Shockwave');
  assert.deepEqual(art.artworkQueue([shows[0]], readData('artwork.json')), []);
});

test('queue: YouTube before Myflixer before fmovies/hdtoday in each tier; ARTWORK_MAX_PER_RUN is read at call time', async (t) => {
  const yt = (id, latestAt, extra = {}) => ({ id, title: `Programme ${id}`, kind: 'series', lang: 'en', latestAt, channel: DISCOVERY, ...extra });
  const shows = [
    { id: 'fm:s:1', title: 'Provider Series', kind: 'series', channelId: 'fmovies', synopsis: '', portrait: 'https://image.tmdb.org/t/p/w500/a.jpg', firstSeenAt: '2026-10-18T00:00:00Z' },
    { id: 's_mf', title: 'Myflixer Film', kind: 'film', lang: 'en', latestAt: '2026-10-17T00:00:00Z', channel: { id: 'myflixer', title: 'Myflixer Documentaries', profile: 'myflixer' }, posterVideoId: 'mf:m:x', portrait: 'https://myflixerz.day/p.jpg', synopsis: 'Template.', synopsisGenerated: true },
    yt('s_yt_old', '2020-01-01T00:00:00Z'),
    yt('s_yt_new', '2026-01-01T00:00:00Z'),
    yt('s_yt_rules', '2026-10-18T00:00:00Z'),
  ];
  const v2exact = { source: 'tvmaze', confidence: 'exact', v: 2, poster: 'https://static.tvmaze.com/x/1.jpg', checkedAt: ago(2) };
  const withProvider = [...shows, { id: 'hd:s:2', title: 'Provider Matched', kind: 'series', channelId: 'hdtoday', synopsis: '', portrait: 'https://img.example/p.jpg', firstSeenAt: '2026-10-18T00:00:00Z' }];
  const cachedArt = { s_yt_rules: v2exact, 'hd:s:2': v2exact, s_yt_legacy: { source: 'wikipedia', checkedAt: ago(3) } };
  const order = art.artworkQueue([...withProvider, yt('s_yt_legacy', '2026-10-18T00:00:00Z')], cachedArt, { now: Date.now() }).map((q) => `${q.tier}:${q.s.id}`);
  assert.deepEqual(order, ['0:s_yt_rules', '1:s_yt_new', '1:s_yt_old', '1:s_mf', '1:fm:s:1', '2:s_yt_legacy', '2:hd:s:2'],
    'a shown match from older rules is re-checked first; fmovies/hdtoday rows stay in the queue, last in their tier');
  // A Myflixer show with its own cover and a real synopsis is only looked up to re-check the match it shows.
  const covered = { ...shows[1], id: 's_mf_covered', synopsis: 'The provider\'s own synopsis.', synopsisGenerated: false };
  assert.deepEqual(art.artworkQueue([covered], { s_mf_covered: v2exact }).map((q) => q.tier), [0]);
  assert.deepEqual(art.artworkQueue([covered], { s_mf_covered: { ...v2exact, v: art.ARTWORK_RULES_VERSION, checkedAt: ago(400) } }), []);
  assert.deepEqual(art.artworkQueue([covered], {}), []);
  // A Myflixer card an fmovies row merged into keeps its s_ id (and gets channelId 'fmovies'): still a Myflixer show.
  const merged = { ...shows[1], id: 's_mf_merged', channelId: 'fmovies', offerings: [{ provider: 'myflixer' }, { provider: 'fmovies', tmdbId: 5 }] };
  assert.deepEqual(art.artworkQueue([merged, shows[0]], { s_mf_merged: v2exact, 'fm:s:1': v2exact }).map((q) => [q.s.id, q.tier, q.group]), [['s_mf_merged', 0, 1], ['fm:s:1', 2, 2]]);

  const saved = process.env.ARTWORK_MAX_PER_RUN;
  t.after(() => { if (saved == null) delete process.env.ARTWORK_MAX_PER_RUN; else process.env.ARTWORK_MAX_PER_RUN = saved; });
  reset();
  process.env.ARTWORK_MAX_PER_RUN = '2';
  await art.enrichArtwork(shows, { ...quiet, fetch: fakeFetch([]) });
  assert.equal(art.artworkRunSummary().cap, 2);
  assert.equal(art.artworkRunSummary().looked, 2);
  assert.deepEqual(art.artworkRunSummary().queued, { youtube: 2 });
  reset();
  process.env.ARTWORK_MAX_PER_RUN = '1,500';
  const logs = [];
  await art.enrichArtwork(shows, { ...quiet, log: (m) => logs.push(m), fetch: fakeFetch([]) });
  assert.equal(art.artworkRunSummary().cap, 600, 'junk falls back to the default instead of silently looking up nothing');
  assert.ok(logs.some((m) => m.includes('ARTWORK_MAX_PER_RUN "1,500" is not a number')));
  assert.equal(art.artworkRunSummary().looked, 5);
});

test('saving prunes artwork.json to live show ids and id aliases; a renamed show keeps its match', async (t) => {
  const exact = (n) => ({ source: 'tvmaze', tvmazeId: n, name: `P${n}`, confidence: 'exact', v: 3, poster: `https://static.tvmaze.com/x/${n}.jpg`, checkedAt: ago(1) });
  const miss = () => ({ v: 3, misses: 1, checkedAt: ago(1) });
  const artwork = { s_live: miss(), s_gone: exact(1), s_old: exact(2), s_old2: exact(3), s_has: exact(4), s_oldmiss: miss(), s_a: exact(5) };
  const live = ['s_live', 's_new', 's_has', 's_fresh', 's_new2'].map((id) => ({ id, title: `Programme ${id}`, kind: 'series', lang: 'en' }));
  const idAliases = { s_old: 's_new', s_old2: 's_has', s_oldmiss: 's_fresh', s_a: 's_b', s_b: 's_new2' };
  reset({ artwork });
  await art.enrichArtwork({ shows: live, idAliases }, { ...quiet, fetch: fakeFetch([]), maxPerRun: 0 });
  const cached = readData('artwork.json');
  assert.deepEqual(Object.keys(cached).sort(), ['s_has', 's_live', 's_new', 's_new2', 's_old2', 's_oldmiss']);
  assert.equal(cached.s_new.tvmazeId, 2);
  assert.equal(cached.s_new.rekeyedFrom, 's_old');
  assert.equal(cached.s_new2.tvmazeId, 5, 'alias chains are followed to the live show');
  assert.equal(cached.s_has.tvmazeId, 4, 'an existing entry is never overwritten');
  assert.equal(cached.s_fresh, undefined, 'a miss does not follow the rename: the new title gets a fresh lookup');
  assert.equal(art.getArtwork().s_new.tvmazeId, 2);
  assert.deepEqual([art.artworkRunSummary().pruned, art.artworkRunSummary().rekeyed], [1, 2]);
  const tiers = Object.fromEntries(art.artworkQueue(live, cached).map((q) => [q.s.id, q.tier]));
  assert.equal(tiers.s_new, 2, 'a moved match is re-checked online for its new show, after the never-looked-up titles');
  assert.equal(tiers.s_fresh, 1);
  assert.equal(tiers.s_has, undefined, 'an entry that stayed with its show is not due');

  // Without catalog.idAliases the persisted show-id-aliases.json is used.
  reset({ artwork });
  writeData('show-id-aliases.json', idAliases);
  t.after(() => fs.rmSync(path.join(dir, 'show-id-aliases.json'), { force: true }));
  await art.enrichArtwork(live, { ...quiet, fetch: fakeFetch([]), maxPerRun: 0 });
  assert.equal(readData('artwork.json').s_new.rekeyedFrom, 's_old');
  assert.equal(readData('artwork.json').s_gone.tvmazeId, 1, 'with only the committed seed a matched entry is kept, not lost');
  // A catalogue without idAliases has no renamed shows beyond the seed: its orphan matches go.
  reset({ artwork });
  await art.enrichArtwork({ shows: live }, { ...quiet, fetch: fakeFetch([]), maxPerRun: 0 });
  assert.equal(readData('artwork.json').s_gone, undefined);
  assert.equal(readData('artwork.json').s_new.rekeyedFrom, 's_old', 'the seed still re-keys');

  // A partial show list never wipes the cache.
  const big = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`s_${i}`, miss()]));
  reset({ artwork: big });
  const logs = [];
  await art.enrichArtwork([{ id: 's_0', title: 'Programme zero', kind: 'series', lang: 'en' }], { ...quiet, log: (m) => logs.push(m), fetch: fakeFetch([]), maxPerRun: 0, idAliases: {} });
  assert.equal(Object.keys(readData('artwork.json')).length, 200);
  assert.ok(logs.some((m) => m.includes('not pruning: 199 of 200')));
});

test('a match that moves to a renamed show is judged for that show; a renamed show is looked up again', async () => {
  const wiki = { source: 'wikipedia', wiki: 'en:Shockwave (TV series)', name: 'Shockwave (TV series)', confidence: 'exact', v: art.ARTWORK_RULES_VERSION, poster: 'https://upload.wikimedia.org/wikipedia/en/6/62/Shockwave_title_credits.jpg', overview: 'Shockwave is an American documentary television series that premiered on November 30, 2007, on the History Channel.', overviewLang: 'en', checkedAt: ago(1), forTitle: 'Shockwave' };
  reset({ artwork: { s_hist_old: wiki } });
  const vice = { id: 's_vice_new', title: 'Shockwave', kind: 'series', lang: 'en', firstAt: '2021-06-20T00:00:00Z', channel: VICE };
  const calls = [];
  const view = await art.enrichArtwork({ shows: [vice], idAliases: { s_hist_old: 's_vice_new' } }, { ...quiet, fetch: fakeFetch([], calls), maxPerRun: 0 });
  assert.equal(calls.length, 0);
  assert.equal(view.s_vice_new, undefined, 'a History Channel page moved onto a VICE News show is downgraded at once');
  const moved = readData('artwork.json').s_vice_new;
  assert.deepEqual([moved.rekeyedFrom, moved.confidence, moved.downgraded], ['s_hist_old', 'fuzzy', ['network']]);
  assert.equal(art.artworkRunSummary().due, 1);

  // forTitle: recorded at lookup; a real rename is due in tier 2, a season suffix or entity spelling is not.
  const exact = { source: 'tvmaze', tvmazeId: 7, name: 'Gold Rush', confidence: 'exact', v: art.ARTWORK_RULES_VERSION, poster: 'https://static.tvmaze.com/x/7.jpg', checkedAt: ago(1), forTitle: 'Gold Rush' };
  const show = (title) => ({ id: 's_gr', title, kind: 'series', lang: 'en' });
  assert.deepEqual(art.artworkQueue([show('Gold Rush: White Water')], { s_gr: exact }).map((q) => q.tier), [2]);
  assert.deepEqual(art.artworkQueue([show('Gold Rush | Season 3')], { s_gr: exact }), []);
  assert.deepEqual(art.artworkQueue([show('Gold Rush')], { s_gr: { ...exact, forTitle: undefined } }), [], 'entries from before forTitle are not re-checked for it');
  reset();
  await art.enrichArtwork([show('Gold Rush')], { ...quiet, fetch: fakeFetch([]) });
  assert.equal(readData('artwork.json').s_gr.forTitle, 'Gold Rush');
});

test('the missing-key warning starts on its own line and the active sources are exported', async (t) => {
  const saved = process.env.GITHUB_ACTIONS;
  t.after(() => { if (saved == null) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = saved; });
  process.env.GITHUB_ACTIONS = 'true';
  reset();
  const logs = [];
  await art.enrichArtwork([], { ...quiet, log: (m) => logs.push(m), fetch: fakeFetch([]) });
  const warning = logs.find((m) => m.includes('TMDB_API_KEY is not set'));
  assert.ok(warning.startsWith('\n'), 'after the CLI\'s \\r progress line');
  assert.ok(warning.split('\n').some((line) => line.startsWith('::warning::TMDB_API_KEY is not set')));
  assert.deepEqual(art.artworkSources(''), ['tvmaze', 'wikidata', 'wikipedia']);
  assert.deepEqual(art.artworkSources('k'), ['tmdb', 'tvmaze', 'wikidata', 'wikipedia']);
  assert.deepEqual(art.artworkRunSummary().sources, ['tvmaze', 'wikidata', 'wikipedia']);
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

test('a row that shows its cached match is re-checked: rules bump, 90 days and TMDB key, versions included', () => {
  const V = art.ARTWORK_RULES_VERSION;
  const entry = { source: 'wikipedia', wiki: 'en:Free Solo Climb', name: 'Free Solo Climb', confidence: 'exact', v: 2, score: 1, poster: 'https://upload.wikimedia.org/wikipedia/en/a/ab/Free_Solo_Climb_poster.jpg', overview: LONG, overviewLang: 'en', checkedAt: ago(2) };
  const v3 = { ...entry, v: V, forTitle: 'Free Solo Climb' };
  const raw = { id: 'fm:m:101', title: 'Free Solo Climb', kind: 'film', year: 2018, channelId: 'fmovies', synopsis: '', portrait: 'https://image.tmdb.org/t/p/w342/own.jpg', poster: { custom: 'https://image.tmdb.org/t/p/w342/own.jpg' }, firstSeenAt: ago(3) };
  // What the provider merge (applyCachedArtwork) hands to enrichArtwork: the row already carries the entry's overview.
  const row = art.applyProviderArtwork(raw, entry);
  assert.equal(row.synopsis, LONG);
  const tiers = (rows, cached, opts = {}) => art.artworkQueue(rows, cached, { now: Date.now(), ...opts }).map((q) => `${q.tier}:${q.s.id}`);
  assert.deepEqual(tiers([row], { [row.id]: entry }), ['2:fm:m:101'], 'a match from older rules is re-checked under the current ones');
  assert.deepEqual(tiers([row], { [row.id]: { ...v3, checkedAt: ago(200) } }), ['3:fm:m:101'], 'the 90-day re-check');
  assert.deepEqual(tiers([row], { [row.id]: v3 }, { key: 'k' }), ['2:fm:m:101'], 'the TMDB lookup once a key is set');
  assert.deepEqual(tiers([row], { [row.id]: v3 }), [], 'a current match is not due');
  // A synopsis and a cover of the row's own: the entry adds nothing shown, so the row is not looked up.
  const own = { ...raw, synopsis: 'The provider\'s own synopsis of this climbing film, long enough to be real.' };
  assert.deepEqual(tiers([own], { [own.id]: { ...v3, checkedAt: ago(200) } }), []);
  // Its own synopsis, but the cover came from the entry.
  const coverOnly = art.applyProviderArtwork({ ...own, portrait: null, poster: null }, entry);
  assert.equal(coverOnly.portrait, entry.poster);
  assert.deepEqual(tiers([coverOnly], { [own.id]: { ...v3, checkedAt: ago(200) } }), ['3:fm:m:101']);

  // A Myflixer card with its own cover whose synopsis is the entry's cleaned overview (finalizeShow), or whose card
  // poster is the entry's backdrop.
  const myflixer = { id: 's_mf_art', title: 'Rivers and Lakes', kind: 'film', lang: 'en', channel: { id: 'myflixer', title: 'Myflixer Documentaries', profile: 'myflixer' }, posterVideoId: 'mf:m:rivers', portrait: 'https://myflixerz.day/rivers.jpg', synopsisGenerated: false };
  const tmdbEntry = { source: 'tmdb', tmdbId: 5, confidence: 'exact', v: V, poster: 'https://image.tmdb.org/t/p/w500/r.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/rb.jpg', overview: `Rivers &amp; lakes: ${LONG}`, overviewLang: 'en', checkedAt: ago(200), tmdbChecked: true };
  assert.deepEqual(tiers([{ ...myflixer, synopsis: `Rivers & lakes: ${LONG}` }], { s_mf_art: tmdbEntry }), ['3:s_mf_art']);
  assert.deepEqual(tiers([{ ...myflixer, synopsis: 'Myflixer\'s own synopsis of the film.', poster: { custom: tmdbEntry.backdrop } }], { s_mf_art: tmdbEntry }), ['3:s_mf_art']);
  assert.deepEqual(tiers([{ ...myflixer, synopsis: 'Myflixer\'s own synopsis of the film.', poster: { custom: myflixer.portrait } }], { s_mf_art: tmdbEntry }), []);

  // An uncertain version grouped inside a card is a row of its own, looked up under its own id.
  const card = { id: 's_card', title: 'Free Solo Climb', kind: 'film', lang: 'en', synopsis: 'A documentary.', synopsisGenerated: true, versions: [{ ...row, uncertainMatch: true }] };
  assert.deepEqual(tiers([card], { [row.id]: entry, s_card: v3 }), ['2:fm:m:101']);
  assert.deepEqual(tiers([card, row], { [row.id]: entry, s_card: v3 }), ['2:fm:m:101'], 'each id once');
});

test('through the provider merge: copied artwork never blocks a re-check, versions are judged offline, matched rows keep their entries', async (t) => {
  const { mergeCachedProviders } = await import('../src/provider-sync.js');
  t.after(() => fs.rmSync(path.join(dir, 'providers-dahsha.json'), { force: true }));
  const V = art.ARTWORK_RULES_VERSION;
  const fresh = ago(0.1);
  const wiki = (name, overview, extra = {}) => ({ source: 'wikipedia', wiki: `en:${name}`, name, confidence: 'exact', v: 2, score: 1, poster: null, overview, overviewLang: 'en', checkedAt: ago(2), ...extra });
  const ocean = 'Ocean Giants is a 2015 documentary film about whales, filmed over three years in four oceans.';
  const provider = (id, title, kind, year) => ({ id, title, kind, year, documentary: true, synopsis: '', lang: 'en', channelId: /^hd:/.test(id) ? 'hdtoday' : 'fmovies',
    poster: { custom: `https://img.example/${encodeURIComponent(id)}.jpg` }, portrait: `https://img.example/${encodeURIComponent(id)}.jpg`, firstSeenAt: fresh, lastSeenAt: fresh, providerUpdatedAt: fresh, discoveredAt: null,
    offerings: [{ provider: /^hd:/.test(id) ? 'hdtoday' : 'fmovies', id, kind, sourceUrl: `https://provider.example/${encodeURIComponent(id)}`, documentary: true }] });
  const standalone = provider('fm:m:101', 'Free Solo Climb', 'film', 2018);
  const version = provider('hd:s:tv-desert-lions-x', 'Desert Lions', 'series', 2016);
  const matched = provider('hd:m:movie-ocean-giants-ab123', 'Ocean Giants', 'film', 2015);
  writeData('providers-dahsha.json', { version: 1, items: [standalone, version, matched], queue: [], completed: true, baselineAt: fresh });
  reset({ artwork: {
    [standalone.id]: wiki('Free Solo Climb', LONG),
    [version.id]: wiki('Desert Lions (2015 film)', `Desert Lions is a 2015 documentary film. ${LONG}`),
    [matched.id]: { ...wiki('Ocean Giants', ocean), v: V, checkedAt: fresh, forTitle: 'Ocean Giants' },
    s_card: { v: V, misses: 1, checkedAt: fresh, forTitle: 'Ocean Giants' },
    s_desert: { v: V, misses: 1, checkedAt: fresh, forTitle: 'Desert Lions' },
  } });
  const youtube = (id, title, kind, year, videoId) => ({ id, title, kind, year, lang: 'en', channelId: 'UCx', channel: { id: 'UCx', title: 'Some Channel', profile: 'generic-en' },
    synopsis: 'A documentary from the channel.', synopsisGenerated: true, posterVideoId: videoId, latestAt: fresh, tags: ['documentary'], episodes: [{ id: videoId, title, season: 1, number: 1 }] });
  const built = { idAliases: {}, channels: [], tags: [], stats: {}, shows: [youtube('s_card', 'Ocean Giants', 'film', 2015, 'abcdefghijk'), youtube('s_desert', 'Desert Lions', 'series', 2015, 'bcdefghijkl')] };
  const merged = mergeCachedProviders(built, 'dahsha', { log: () => {} }).catalog;
  const byId = Object.fromEntries(merged.shows.map((s) => [s.id, s]));
  assert.equal(byId[standalone.id].synopsis, LONG, 'the merge copied the cached overview into the standalone row');
  assert.deepEqual(byId.s_desert.versions.map((v) => v.id), [version.id]);
  assert.deepEqual(byId.s_card.offerings.map((o) => o.id), [matched.id]);
  assert.equal(byId.s_card.synopsis, ocean, 'the matched row\'s artwork fills the card');

  const calls = [];
  await art.enrichArtwork(merged, { ...quiet, fetch: fakeFetch([], calls), maxPerRun: 0 });
  assert.equal(calls.length, 0);
  const cached = readData('artwork.json');
  assert.equal(cached[matched.id]?.confidence, 'exact', 'an entry under a matched row (a card offering) is live, not pruned');
  assert.equal(art.artworkRunSummary().pruned, 0);
  assert.deepEqual(cached[version.id].downgraded, ['kind'], 'a version is judged offline like a show');
  const tiers = Object.fromEntries(art.artworkQueue(merged.shows, cached).map((q) => [q.s.id, q.tier]));
  assert.deepEqual(tiers, { [standalone.id]: 2, [version.id]: 2 });
  assert.equal(mergeCachedProviders(built, 'dahsha', { log: () => {} }).catalog.shows.find((s) => s.id === 's_card').synopsis, ocean, 'still applied after the enrich');

  // The online pass reaches both rows and records them under the current rules.
  await art.enrichArtwork(merged, { ...quiet, fetch: fakeFetch([], calls) });
  assert.ok(calls.some((u) => u.startsWith('https://en.wikipedia.org/w/api.php') && decodeURIComponent(u).includes('Free Solo Climb')));
  assert.ok(calls.includes(tvmaze('Desert Lions')));
  const after = readData('artwork.json');
  assert.equal(after[standalone.id].v, V);
  assert.equal(after[version.id].v, V);
  assert.equal(after[version.id].downgraded, undefined);
});

const tmdbSearch = (kind, q) => (url) => url.startsWith(`https://api.themoviedb.org/3/search/${kind}?`) && new URL(url).searchParams.get('query') === q;
const tmdbDetails = (kind, id) => (url) => url.startsWith(`https://api.themoviedb.org/3/${kind}/${id}?`);

test('TMDB: same-title dramas and cartoons are not namesakes; a same-title documentary or talk show is', async () => {
  const doc = { id: 62215, title: 'Home', release_date: '2009-06-05', genre_ids: [99], poster_path: '/home.jpg', backdrop_path: '/home-b.jpg', overview: LONG };
  const film = { id: 's_home', title: 'Home', kind: 'film', lang: 'en', firstAt: '2012-01-01T00:00:00Z' };
  const run = async (show, routes) => {
    reset();
    const view = await art.enrichArtwork([show], { ...quiet, tmdbKey: 'test-key', fetch: fakeFetch(routes) });
    return { view: view[show.id], cached: readData('artwork.json')[show.id] };
  };
  let r = await run(film, [[tmdbSearch('movie', 'Home'), { results: [doc, { id: 9001, title: 'Home', release_date: '1954-03-01', genre_ids: [18] }, { id: 9002, title: 'Home', release_date: '1990-03-01', genre_ids: [16, 10751] }] }]]);
  assert.equal(r.view?.tmdbId, 62215, 'the drama and the cartoon of that name do not make the documentary uncertain');
  assert.equal(r.view.poster, 'https://image.tmdb.org/t/p/w500/home.jpg');
  assert.equal(r.view.backdrop, 'https://image.tmdb.org/t/p/w1280/home-b.jpg');
  r = await run(film, [[tmdbSearch('movie', 'Home'), { results: [doc, { id: 9003, title: 'Home', release_date: '2005-03-01', genre_ids: [99, 36] }] }]]);
  assert.equal(r.view, undefined, 'two documentaries of that name');
  assert.deepEqual([r.cached.confidence, r.cached.namesakes], ['fuzzy', 2]);

  const series = { id: 's_life', title: 'Life', kind: 'series', lang: 'en', firstAt: '2015-01-01T00:00:00Z' };
  const life = { id: 4100, name: 'Life', first_air_date: '2009-10-12', genre_ids: [99], poster_path: '/life.jpg', overview: LONG };
  r = await run(series, [[tmdbSearch('tv', 'Life'), { results: [life, { id: 4101, name: 'Life', first_air_date: '2007-09-26', genre_ids: [80, 18] }] }]]);
  assert.equal(r.view?.tmdbId, 4100, 'NBC\'s crime drama Life is not a namesake');
  r = await run(series, [[tmdbSearch('tv', 'Life'), { results: [life, { id: 4102, name: 'Life', first_air_date: '2010-01-01', genre_ids: [10767] }] }]]);
  assert.equal(r.view, undefined, 'a talk show of that name could be the programme, as on TVmaze');
  assert.equal(r.cached.namesakes, 2);
});

test('TMDB: a channel that uploads its own programmes checks the broadcaster on the details record', async () => {
  reset();
  const calls = [];
  const shockwave = { id: 7001, name: 'Shockwave', first_air_date: '2007-11-30', genre_ids: [99], poster_path: '/history.jpg', overview: LONG };
  const fetch = fakeFetch([
    [tmdbSearch('tv', 'Shockwave'), { results: [shockwave] }],
    [tmdbDetails('tv', 7001), { id: 7001, name: 'Shockwave', networks: [{ name: 'History' }], production_companies: [{ name: 'Termite Art Productions' }] }],
    [tmdbSearch('tv', 'Deep Dive'), { results: [{ id: 7002, name: 'Deep Dive', first_air_date: '2010-01-01', genre_ids: [99], poster_path: '/deep.jpg', overview: LONG }] }],
    [tmdbDetails('tv', 7002), raw(null, 500)],
  ], calls);
  const show = (id, channel, extra = {}) => ({ id, title: 'Shockwave', kind: 'series', lang: 'en', firstAt: '2023-01-01T00:00:00Z', channel, ...extra });
  const shows = [
    show('s_vice', VICE),
    show('s_history', HISTORY),
    show('s_curiosity', CURIOSITY),
    // A VICE card an fmovies row merged into: the provider's TMDB id names that row's programme.
    show('s_vice_fm', VICE, { offerings: [{ provider: 'fmovies', id: 'fm:s:7001', tmdbId: 7001 }] }),
    { id: 's_deep', title: 'Deep Dive', kind: 'series', lang: 'en', firstAt: '2023-01-01T00:00:00Z', channel: HISTORY },
  ];
  const view = await art.enrichArtwork(shows, { ...quiet, tmdbKey: 'test-key', fetch });
  assert.deepEqual(Object.keys(view).sort(), ['s_curiosity', 's_history']);
  assert.deepEqual(view.s_history.networks, ['History']);
  const cached = readData('artwork.json');
  assert.deepEqual([cached.s_vice.source, cached.s_vice.confidence, cached.s_vice.networks], ['tmdb', 'fuzzy', ['History']], 'the History Channel programme is not VICE News\'s');
  assert.equal(cached.s_vice_fm.confidence, 'fuzzy');
  assert.equal(cached.s_curiosity.networks, undefined, 'an aggregator channel is not checked');
  assert.equal(cached.s_deep.incomplete, true, 'a details record that cannot be fetched leaves the match unconfirmed and retried soon');
  assert.notEqual(cached.s_deep.confidence, 'exact');
  // Recorded networks let the offline pass judge a TMDB match again.
  const stored = { ...view.s_history, confidence: 'exact' };
  assert.deepEqual(art.staleMatchReasons(stored, shows[0]), ['network']);
  assert.deepEqual(art.staleMatchReasons(stored, shows[1]), []);
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
