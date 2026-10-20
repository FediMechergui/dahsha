import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchMovies, fetchFullCatalog } from '../src/myflixer.js';
import { fetchMyflixerCatalog } from '../src/documentaries.js';
import { writeCatalog } from '../src/export-catalog.js';
import { buildCatalog } from '../src/catalog.js';
import { genreTopicTags, allTagDefs } from '../src/tagger.js';

test('year taxonomy is applied and pagination inputs are bounded', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input); urls.push(url);
    const rows = url.pathname.includes('release-year') ? [{ id: 202, name: '2026' }] : [];
    return Response.json(rows, { headers: { 'x-wp-totalpages': '1' } });
  });
  await fetchMovies({ year: 2026, page: -10, perPage: 10000 });
  const url = urls.at(-1);
  assert.equal(url.searchParams.get('release-year'), '202');
  assert.equal(url.searchParams.get('page'), '1');
  assert.equal(url.searchParams.get('per_page'), '100');
});

test('Flixer walks every page and keeps films and series with identical slugs', async t => {
  const requested = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.pathname.includes('release-year')) return Response.json([]);
    const page = Number(url.searchParams.get('page'));
    requested.push(`${url.pathname}:${page}`);
    return Response.json([{ id: page, slug: `shared-${page}`, title: { rendered: 'Title' }, categories: [39], date: '2026-01-01' }], { headers: { 'x-wp-totalpages': '3', 'x-wp-total': '3' } });
  });
  const result = await fetchFullCatalog({ episodeLimit: 0 });
  assert.equal(result.shows.length, 6);
  assert.equal(result.product, 'flixer');
  assert.equal(requested.length, 6);
  assert.equal(result.shows[0].latestAt, '2026-01-01');
});

test('Dahsha requests documentary category and rejects unrelated upstream results', async t => {
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.pathname.includes('release-year')) return Response.json([]);
    assert.equal(url.searchParams.get('categories'), '212');
    const rows = url.pathname.endsWith('/posts') ? [
      { id: 1, slug: 'documentary', title: { rendered: 'Documentary' }, categories: [212] },
      { id: 2, slug: 'action-movie', title: { rendered: 'Action Movie' }, categories: [39] },
    ] : [];
    return Response.json(rows, { headers: { 'x-wp-totalpages': '1' } });
  });
  const result = await fetchMyflixerCatalog({});
  assert.deepEqual(result.films.map(s => s.slug), ['documentary']);
  assert.equal(result.series.length, 0);
});

test('upstream errors cannot produce a successful empty catalogue', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status: 503 }));
  await assert.rejects(fetchFullCatalog(), /503/);
});

test('exports preserve existing data on empty results and separate language sections', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-export-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'data');
  fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'marker'), 'keep');
  assert.throws(() => writeCatalog(out, { shows: [] }, 'dahsha'), /empty/);
  assert.equal(fs.readFileSync(path.join(out, 'marker'), 'utf8'), 'keep');
  writeCatalog(out, { generatedAt: '2026-01-01', shows: [{ id: 'ar', lang: 'ar' }, { id: 'en', lang: 'en' }] }, 'dahsha');
  const ar = JSON.parse(fs.readFileSync(path.join(out, 'catalog.ar.json')));
  assert.equal(ar.product, 'dahsha');
  assert.deepEqual(ar.shows.map(s => s.id), ['ar']);
  assert.ok(fs.existsSync(path.join(out, 'shows/en.json')));
});

test('Flixer exports retain universe and streaming service metadata across refreshes',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flixer-metadata-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const catalog={shows:[{id:'mf:m:example',kind:'film',title:'Example'}]};
  writeCatalog(dir,catalog,'flixer');
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir,'universes.json'))).universes.length>0);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir,'services.json'))).services.length>0);
  fs.writeFileSync(path.join(dir,'services.json'),JSON.stringify({services:[{name:'Custom service',logo:'https://example.com/logo.svg'}]}));
  writeCatalog(dir,catalog,'flixer');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'services.json'))).services[0].name,'Custom service');
});

test('Myflixer synopses are decoded before boilerplate cleaning and lose the excerpt tail', () => {
  const id = 'mf:m:the-swan-behind-the-mirror';
  const title = 'The Swan: Behind the Mirror';
  const row = { id, title, showTitle: title, episodeTitle: 'Full film', parsed: { showTitle: title, episodeTitle: 'Full film', kind: 'film', number: null, season: null }, durationSec: 5400, thumb: 'https://example.com/swan.jpg' };
  const description = 'A look at the controversial 2004 reality series The Swan, which took self-proclaimed &#8216;ugly ducklings&#8217; and made them over for television &#038; ratings [&hellip;]';
  const catalog = buildCatalog({ sources: [{ type: 'myflixer', id: 'myflixer', title: 'Myflixer', lang: 'en', profile: 'myflixer' }], seen: {}, overrides: {},
    playlists: { 'MYFLIXER:myflixer': { id: 'MYFLIXER:myflixer', sourceId: 'myflixer', title: 'Myflixer', videos: [row] } },
    details: { [id]: { title, description, durationSec: 5400 } } });
  const [show] = catalog.shows;
  assert.equal(show.synopsisGenerated, false);
  assert.equal(show.synopsis, 'A look at the controversial 2004 reality series The Swan, which took self-proclaimed ‘ugly ducklings’ and made them over for television & ratings');
});

// ---- Availability, covers, tags, durations, dates and stats ------------------------------------------

const ytId = (id) => id.padEnd(11, '_').slice(0, 11);
const mfSource = { type: 'myflixer', id: 'myflixer', title: 'Myflixer Documentaries', short: 'Myflixer', lang: 'en', profile: 'myflixer', brands: ['Myflixer'] };
const dwEn = { type: 'channel', id: 'UCdwen', title: 'DW Documentary', short: 'DW Documentary', lang: 'en', profile: 'dw-en', brands: ['DW Documentary', 'DW'] };
const dwAr = { type: 'channel', id: 'UCdwar', title: 'DW Documentary وثائقية دي دبليو', short: 'وثائقية دي دبليو', lang: 'ar', profile: 'dw' };
const natgeoEn = { type: 'channel', id: 'UCngen', title: 'National Geographic', short: 'Nat Geo', lang: 'en', profile: 'natgeo-en', brands: ['National Geographic', 'Nat Geo'] };
const mfRow = (slug, title, extra = {}) => ({ id: `mf:m:${slug}`, title, showTitle: title, episodeTitle: 'Full film', parsed: { showTitle: title, episodeTitle: 'Full film', kind: 'film', number: null, season: null }, durationSec: 0, durationText: '', views: null, thumb: `https://myflixerz.day/posters/${slug}.jpg`, tags: ['documentary'], ...extra });
const mfEp = (show, slug, title, season, number, extra = {}) => ({ id: `mf:e:${slug}`, title: `${show} - S${season}E${number}: ${title}`, showTitle: show, episodeTitle: title, parsed: { showTitle: show, episodeTitle: title, kind: 'series', number, season }, durationSec: 0, durationText: '', views: null, thumb: 'https://myflixerz.day/posters/series.jpg', tags: ['documentary'], ...extra });
const mfList = (videos) => ({ 'MYFLIXER:myflixer': { id: 'MYFLIXER:myflixer', sourceId: 'myflixer', title: 'Myflixer Documentaries', videos } });
const uploadsList = (src, videos, extra = {}) => ({ [`UPLOADS:${src.id}`]: { id: `UPLOADS:${src.id}`, sourceId: src.id, isUploads: true, title: '__uploads__', videos, ...extra } });
const make = ({ sources, playlists, details = {}, seen = {}, overrides = {}, artwork = {} }) => buildCatalog({ sources, playlists, details, seen, overrides, artwork });
const showWith = (catalog, videoId) => catalog.shows.find((s) => s.episodes.some((e) => e.id === videoId));

test('contract 1: removed, private and non-embeddable videos are neither episodes, promos nor posters', () => {
  const [ok, gone, embedOff, priv, reported, embeds] = ['ok', 'gone', 'embedoff', 'private', 'reported', 'embeds'].map(ytId);
  const titles = { [ok]: 'Life on the Rhine', [gone]: 'The Last Glacier', [embedOff]: 'Secrets of the Alps', [priv]: 'The Lost Forest', [reported]: 'Mountain Rescue', [embeds]: 'Desert Nomads' };
  const details = {
    [ok]: { durationSec: 2700 },
    [gone]: { durationSec: 2700, unavailable: true, unavailableChecks: 2 },
    [embedOff]: { durationSec: 2700, embeddable: false },
    [priv]: { durationSec: 2700, isPrivate: true },
    [reported]: { durationSec: 2700, unavailableChecks: 1 }, // one report, not confirmed yet
    [embeds]: { durationSec: 2700, embeddable: true },
  };
  const catalog = make({ sources: [dwEn], playlists: uploadsList(dwEn, Object.entries(titles).map(([id, title]) => ({ id, title, durationSec: 2700 }))), details });
  const listed = catalog.shows.flatMap((s) => [...s.episodes.map((e) => e.id), ...s.promos]);
  assert.deepEqual(listed.sort(), [ok, reported, embeds].sort());

  // A series whose most-viewed episode cannot be embedded takes its poster from a playable one.
  const [a, b] = [ytId('branch1'), ytId('branch2')];
  const series = make({ sources: [natgeoEn],
    playlists: { PLbo: { id: 'PLbo', sourceId: natgeoEn.id, title: 'Branching Out | National Geographic', videos: [{ id: a, title: 'The Wood Wide Web | Branching Out' }, { id: b, title: 'Roots | Branching Out' }] } },
    details: { [a]: { durationSec: 2700, viewCount: 900000, embeddable: false }, [b]: { durationSec: 2700, viewCount: 10 } } });
  assert.equal(series.shows.length, 1);
  assert.equal(series.shows[0].posterVideoId, b);
  assert.deepEqual(series.shows[0].episodes.map((e) => e.id), [b]);
});

test('contract 4: invented Myflixer runtimes and views read as unknown; unknown lengths are not clips', () => {
  // Rows as older code cached them (films 5400 s / 75,000 views, episodes 3000 s / 50,000 views) …
  const oldFilm = mfRow('jail-blazers', 'Jail Blazers', { durationSec: 5400, durationText: '1:30:00', views: 75000 });
  const oldEp = mfEp('TYSON', 'tyson-season-1-episode-1-power', 'Power', 1, 1, { durationSec: 3000, durationText: '50:00', views: 50000 });
  // … and as the scheduler stores them now (durationSec 0, no views).
  const newFilm = mfRow('the-noah-flood', 'The NOAH Flood');
  const newEp = mfEp('TYSON', 'tyson-season-1-episode-2-fear', 'Fear', 1, 2);
  const details = {
    [oldFilm.id]: { title: oldFilm.title, durationSec: 5400, viewCount: 75000 },
    [oldEp.id]: { title: 'Power', durationSec: 3000, viewCount: 50000 },
    [newFilm.id]: { title: newFilm.title, durationSec: 0, viewCount: null },
    [newEp.id]: { title: 'Fear', durationSec: 0, viewCount: null },
  };
  const catalog = make({ sources: [mfSource], playlists: mfList([oldFilm, oldEp, newFilm, newEp]), details, overrides: { minEpisodeSeconds: 420 } });
  for (const row of [oldFilm, oldEp, newFilm, newEp]) {
    const show = showWith(catalog, row.id);
    assert.ok(show, `${row.id} is listed, not dropped as a clip`);
    const episode = show.episodes.find((e) => e.id === row.id);
    assert.equal(episode.durationSec, 0, row.id);
    assert.equal(episode.views, null, row.id);
    assert.equal(show.promos.length, 0);
  }
  const tyson = showWith(catalog, oldEp.id);
  assert.equal(tyson.episodeCount, 2);
  assert.equal(tyson.totalDurationSec, 0);
  assert.equal(tyson.totalViews, 0);
  assert.equal(showWith(catalog, oldFilm.id).synopsis, 'A documentary from Myflixer: "Jail Blazers".', 'no "90-minute" from an invented runtime');
  assert.equal(showWith(catalog, newFilm.id).synopsis, 'A documentary from Myflixer: "The NOAH Flood".');
  assert.equal(catalog.stats.totalHours, 0);

  // YouTube lengths are real: a 0-length video is still a clip, a 90-minute film keeps its minutes.
  const [clip, film] = [ytId('clip0'), ytId('film90')];
  const yt = make({ sources: [dwEn], playlists: uploadsList(dwEn, [{ id: clip, title: 'Teaser for the river | DW Documentary', durationSec: 0 }, { id: film, title: 'The river that feeds Europe | DW Documentary', durationSec: 5400 }]),
    details: { [clip]: { durationSec: 0 }, [film]: { durationSec: 5400 } } });
  assert.deepEqual(yt.shows.map((s) => s.episodes[0].id), [film]);
  assert.equal(yt.shows[0].synopsis, 'A 90-minute documentary from DW Documentary: "The river that feeds Europe".');
  const ar = make({ sources: [dwAr], playlists: uploadsList(dwAr, [{ id: film, title: 'النهر الذي يغذي أوروبا | وثائقية دي دبليو', durationSec: 2700 }]), details: { [film]: { durationSec: 2700 } } });
  assert.equal(ar.shows[0].synopsis, 'فيلم وثائقي من وثائقية دي دبليو بعنوان «النهر الذي يغذي أوروبا»، مدته 45 دقيقة.');
});

test('contract 4: a Myflixer discovery date (row addedAt) lifts the show; first-seen stamps do not', () => {
  const show = "Harlan Coben's Final Twist";
  const s1 = mfEp(show, 'final-twist-s01e01', 'Episode 1', 1, 1);
  const s2 = mfEp(show, 'final-twist-season-2-episode-1-betsys-trust', "Betsy's Trust", 2, 1, { addedAt: '2026-10-12T09:00:00.000Z' });
  const early = mfEp(show, 'final-twist-season-2-episode-2', "A Mother's Crusade", 2, 2, { addedAt: '2025-01-01T00:00:00.000Z' }); // before publishedAt
  const junk = mfEp(show, 'final-twist-season-2-episode-3', 'Third', 2, 3, { addedAt: 'not a date' });
  const published = '2026-01-17T20:00:42.000Z';
  const rows = [s1, s2, early, junk];
  const details = Object.fromEntries(rows.map((v) => [v.id, { title: v.episodeTitle, durationSec: 0, publishedAt: published }]));
  const bulk = '2026-10-15T01:00:30.163Z'; // the initial import's first-seen date, on every row
  const seen = Object.fromEntries(rows.map((v) => [v.id, bulk]));
  const catalog = make({ sources: [mfSource], playlists: mfList(rows), details, seen });
  const card = showWith(catalog, s1.id);
  assert.equal(card.latestAt, '2026-10-12T09:00:00.000Z');
  assert.equal(card.firstAt, published);
  const added = Object.fromEntries(card.episodes.map((e) => [e.id, e.addedAt]));
  assert.deepEqual(added, { [s1.id]: null, [s2.id]: '2026-10-12T09:00:00.000Z', [early.id]: '2025-01-01T00:00:00.000Z', [junk.id]: null });
  assert.equal(catalog.channels[0].latestAt, '2026-10-12T09:00:00.000Z');

  // YouTube addedAt stays the first-seen date and never counts as recency.
  const v = ytId('ytrecency');
  const yt = make({ sources: [dwEn], playlists: uploadsList(dwEn, [{ id: v, title: 'Life on the Rhine | DW Documentary', durationSec: 2700 }]),
    details: { [v]: { durationSec: 2700, publishedAt: '2024-05-01T10:00:00.000Z' } }, seen: { [v]: '2026-10-12T09:04:00.000Z' } });
  assert.equal(yt.shows[0].episodes[0].addedAt, '2026-10-12T09:04:00.000Z');
  assert.equal(yt.shows[0].latestAt, '2024-05-01T10:00:00.000Z');
});

test('approximate dates are anchored to when the listing was read, so rebuilds give the same catalogue', (t) => {
  const [inPlaylist, inUploads, fromFeed, unanchored, stamped] = ['relpl', 'relup', 'feed', 'noanchor', 'stamped'].map(ytId);
  const playlists = {
    PLstories: { id: 'PLstories', sourceId: dwAr.id, title: 'حكايات من الشرق', fetchedAt: '2026-10-10T12:00:00.000Z', videos: [{ id: inPlaylist, title: 'حكاية مدينة | وثائقية دي دبليو', durationSec: 2700, relative: 'قبل 3 أيام' }] },
    ...uploadsList(dwAr, [
      { id: inUploads, title: 'رحلة النهر | وثائقية دي دبليو', durationSec: 2700, relative: 'قبل يومين' },
      { id: fromFeed, title: 'جبال الأطلس | وثائقية دي دبليو', durationSec: 2700, published: '2026-10-16T08:30:00+00:00' },
      { id: stamped, title: 'مدينة الملح | وثائقية دي دبليو', durationSec: 2700, relative: 'قبل يوم واحد', listedAt: '2026-10-17T00:00:00.000Z' },
    ], { fetchedAt: '2026-10-18T18:30:00.000Z' }),
    PLnone: { id: 'PLnone', sourceId: dwAr.id, title: 'قصص الصحراء', videos: [{ id: unanchored, title: 'واحة في الصحراء | وثائقية دي دبليو', durationSec: 2700, relative: 'قبل أسبوع' }] },
  };
  const ids = [inPlaylist, inUploads, fromFeed, unanchored, stamped];
  const details = Object.fromEntries(ids.map((id) => [id, { durationSec: 2700, publishedAt: null }]));
  const seen = { [inPlaylist]: '2026-10-01T00:00:00.000Z', [inUploads]: '2026-10-05T00:00:00.000Z', [fromFeed]: '2026-10-16T09:00:00.000Z', [stamped]: '2026-10-02T00:00:00.000Z' };
  const run = () => make({ sources: [dwAr], playlists, details, seen });
  const first = run();
  const ep = (c, id) => showWith(c, id).episodes.find((e) => e.id === id);
  const dated = (id) => [ep(first, id).publishedAt, ep(first, id).publishedApprox];
  assert.deepEqual(dated(inPlaylist), ['2026-10-07T12:00:00.000Z', true], 'a playlist row counts from the playlist fetch');
  assert.deepEqual(dated(inUploads), ['2026-10-03T00:00:00.000Z', true], 'a cached uploads row counts from its first listing');
  assert.deepEqual(dated(fromFeed), ['2026-10-16T08:30:00.000Z', false], 'a feed date is exact');
  assert.deepEqual(dated(stamped), ['2026-10-16T00:00:00.000Z', true], "a row's own listedAt stamp comes first");
  assert.equal(ep(first, unanchored).publishedAt, null, 'nothing stored to count from: no date rather than one relative to the build');
  // An hour and a day later (polls that found nothing new): only generatedAt may differ.
  const realNow = Date.now;
  t.after(() => { Date.now = realNow; });
  for (const later of [3600e3, 864e5]) {
    Date.now = () => realNow() + later;
    assert.deepEqual({ ...run(), generatedAt: null }, { ...first, generatedAt: null });
  }
});

test('show-page portrait: a provider cover beats looked-up artwork; an empty override turns artwork off', () => {
  const film = mfRow('burning-2021', 'Burning');
  const v = ytId('ytart');
  const sources = [mfSource, dwEn];
  const playlists = { ...mfList([film]), ...uploadsList(dwEn, [{ id: v, title: 'Life on the Rhine | DW Documentary', durationSec: 2700 }]) };
  const details = { [film.id]: { title: 'Burning', durationSec: 0 }, [v]: { durationSec: 2700 } };
  const plain = make({ sources, playlists, details });
  const mfShow = showWith(plain, film.id).id, ytShow = showWith(plain, v).id;
  const artwork = Object.fromEntries([mfShow, ytShow].map((id) => [id, { poster: `https://upload.wikimedia.org/${id}.jpg` }]));
  const portraits = (overrides = {}) => {
    const c = make({ sources, playlists, details, artwork, overrides });
    return [showWith(c, film.id).portrait, showWith(c, v).portrait];
  };
  assert.deepEqual(portraits(), [film.thumb, `https://upload.wikimedia.org/${ytShow}.jpg`]);
  assert.deepEqual(portraits({ shows: { [mfShow]: { portrait: '' }, [ytShow]: { portrait: '' } } }), [film.thumb, null]);
  assert.deepEqual(portraits({ shows: { [mfShow]: { portrait: 'https://example.com/a.jpg' }, [ytShow]: { portrait: 'https://example.com/b.jpg' } } }), ['https://example.com/a.jpg', 'https://example.com/b.jpg']);
});

test('Myflixer genre slugs go through the topic mapping; unknown ones are dropped and documentary comes last', () => {
  assert.deepEqual(genreTopicTags(['documentary', 'comedy', 'people', 'sci-fi', 'bogus', 'history', 'music']), ['documentary', 'people-culture', 'science-space', 'history']);
  assert.deepEqual(genreTopicTags(undefined), []);
  const film = mfRow('who-is-martin-mull', 'Who Is Martin Mull?', { tags: ['documentary', 'comedy', 'sport', 'bogus'] });
  const catalog = make({ sources: [mfSource], playlists: mfList([film]), details: { [film.id]: { title: film.title, durationSec: 0 } } });
  const [show] = catalog.shows;
  assert.deepEqual(show.tags, ['people-culture', 'survival', 'documentary']);
  assert.equal(show.primaryTag, 'people-culture');
  const known = new Set(allTagDefs().map((x) => x.id));
  for (const s of catalog.shows) for (const tag of s.tags) assert.ok(known.has(tag) || tag.startsWith('lang-'), tag);
  assert.ok(catalog.tags.every((x) => x.label !== x.id));
});

test('contract 3: stats.bySource lists every configured source; stats.classification counts classified uploads', () => {
  const [doc, unsure] = [ytId('statdoc'), ytId('statunsure')];
  const idle = { type: 'channel', id: 'UCidle', title: 'Idle Channel', lang: 'en', profile: 'generic-en' };
  const film = mfRow('jail-blazers', 'Jail Blazers');
  const catalog = make({ sources: [dwEn, idle, mfSource],
    playlists: { ...uploadsList(dwEn, [{ id: doc, title: 'The river that feeds Europe | DW Documentary', durationSec: 2700 }, { id: unsure, title: 'Why the Rhine matters', durationSec: 2700 }]), ...mfList([film]) },
    details: { [doc]: { durationSec: 2700 }, [unsure]: { durationSec: 2700 }, [film.id]: { title: film.title, durationSec: 0 } } });
  assert.deepEqual(catalog.stats.bySource, {
    [dwEn.id]: { title: 'DW Documentary', shows: 2, episodes: 2 },
    [idle.id]: { title: 'Idle Channel', shows: 0, episodes: 0 },
    myflixer: { title: 'Myflixer Documentaries', shows: 1, episodes: 1 },
  });
  assert.deepEqual(catalog.stats.classification, { documentary: 1, uncertain: 1 });
  assert.deepEqual(catalog.channels.map((c) => c.id), [dwEn.id, 'myflixer'], 'channels still list only sources with shows');
});
