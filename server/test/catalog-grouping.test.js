import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, diffCatalog, partOf, markersDiffer, ownEpisodeInfo, sisterFamily } from '../src/catalog.js';
import { normalizeArabic, shortHash } from '../src/text.js';

const LONG = 1800;
const yt = (id) => id.padEnd(11, '_').slice(0, 11);
const channel = (o) => ({ type: 'channel', title: 'Channel', lang: 'en', ...o });
const myflixer = { type: 'myflixer', id: 'myflixer', title: 'Myflixer Documentaries', short: 'Myflixer', lang: 'en', profile: 'myflixer', brands: ['Myflixer'] };
const build = ({ sources, playlists, details = {}, overrides = {} }) => buildCatalog({ sources, playlists, details, seen: {}, overrides });
const uploadsOf = (src, videos) => ({ id: `UPLOADS:${src.id}`, sourceId: src.id, isUploads: true, title: '__uploads__', videos });
const longDetails = (ids, extra = {}) => Object.fromEntries(ids.map((id) => [id, { durationSec: LONG, ...(extra[id] || {}) }]));
const showOf = (catalog, videoId) => catalog.shows.find((s) => s.episodes.some((e) => e.id === videoId));
const mfFilm = (slug, title) => ({ id: `mf:m:${slug}`, title, showTitle: title, episodeTitle: 'Full film', parsed: { showTitle: title, episodeTitle: 'Full film', kind: 'film', number: null, season: null }, durationSec: 5400, thumb: `https://example.com/${slug}.jpg` });

test('show keys and ids come from decoded titles, so an entity never changes the grouping', () => {
  const ids = ['&#8216;Twas the Fight Before Christmas', '‘Twas the Fight Before Christmas', '&amp;#8216;Twas the Fight Before Christmas'].map((title) => {
    const catalog = build({ sources: [myflixer], playlists: { 'MYFLIXER:myflixer': { id: 'MYFLIXER:myflixer', sourceId: 'myflixer', title: 'Myflixer', videos: [mfFilm('twas', title)] } } });
    assert.doesNotMatch(catalog.shows[0].key, /8216|amp/);
    return catalog.shows[0].id;
  });
  assert.deepEqual(new Set(ids).size, 1);
  assert.equal(ids[0], `s_${shortHash(normalizeArabic('‘Twas the Fight Before Christmas'))}`);
});

test('hl=ar upload copies of an English series join the English show instead of forming Arabic ones', () => {
  const natgeo = channel({ id: 'UCnatgeo', title: 'National Geographic', profile: 'natgeo-en' });
  const listed = yt('ep1listed'), stale = yt('ep2stale');
  const english = { [listed]: 'The Last Cyclone (Full Episode) | Gathering Storm | National Geographic', [stale]: 'Surviving Super Typhoon Terror (Full Episode) | Gathering Storm | National Geographic' };
  const series = { id: 'PLstorm', sourceId: natgeo.id, title: 'Gathering Storm | National Geographic', videos: [{ id: listed, title: english[listed] }] };
  const uploads = uploadsOf(natgeo, [
    { id: listed, title: 'الإعصار الأخير (الحلقة الكاملة) | العاصفة المتجمعة | ناشيونال جيوغرافيك' },
    { id: stale, title: 'النجاة من رعب الإعصار العملاق (الحلقة الكاملة) | العاصفة المتجمعة | ناشيونال جيوغرافيك' },
  ]);
  const details = longDetails([listed, stale], { [listed]: { title: english[listed] }, [stale]: { title: english[stale] } });
  for (const playlists of [{ a: uploads, b: series }, { a: series, b: uploads }]) {
    const catalog = build({ sources: [natgeo], playlists, details });
    assert.equal(catalog.shows.length, 1, 'one English show regardless of listing order');
    const [show] = catalog.shows;
    assert.equal(show.title, 'Gathering Storm');
    assert.deepEqual(show.episodes.map((e) => e.title).sort(), ['Surviving Super Typhoon Terror', 'The Last Cyclone']);
    assert.ok(show.episodes.find((e) => e.id === listed).playlistIds.includes('PLstorm'));
  }
});

test('Nat Geo Abu Dhabi "Show: Episode" uploads still fold into the parent show', () => {
  const ngad = channel({ id: 'UCngad', title: 'Nat Geo Abu Dhabi', lang: 'ar', profile: 'natgeo' });
  const one = yt('ngadep1'), two = yt('ngadep2'), loose = yt('ngadloose');
  const playlists = {
    PLhomes: { id: 'PLhomes', sourceId: ngad.id, title: 'منازل غريبة', videos: [{ id: one, title: 'الحلقة 1 | منازل غريبة | ناشونال جيوغرافيك أبوظبي' }, { id: two, title: 'الحلقة 2 | منازل غريبة | ناشونال جيوغرافيك أبوظبي' }] },
    up: uploadsOf(ngad, [{ id: loose, title: 'منازل غريبة: البيت العائم' }]),
  };
  const catalog = build({ sources: [ngad], playlists, details: longDetails([one, two, loose]) });
  assert.equal(catalog.shows.length, 1);
  const [show] = catalog.shows;
  assert.equal(show.kind, 'series');
  assert.deepEqual(show.episodes.map((e) => e.title).sort(), ['البيت العائم', 'الحلقة 1', 'الحلقة 2'].sort());
  assert.equal(show.episodes.find((e) => e.id === loose).fullTitle, 'منازل غريبة: البيت العائم');
  assert.deepEqual(show.altTitles, [], 'the folded "Show: Episode" title names the episode, not the show');
});

test('only numbered generic episodes are renamed; unnumbered ones in a real series keep the label', () => {
  const vice = channel({ id: 'UCvice', title: 'VICE News', profile: 'generic-en' });
  const a = yt('vicea'), b = yt('viceb'), c = yt('vicec');
  const playlists = { PLs: { id: 'PLs', sourceId: vice.id, title: 'Shane Has Questions', videos: [
    { id: a, title: 'Shane Has Questions Episode 1 | Shane Has Questions' },
    { id: b, title: 'Shane Has Questions | Shane Has Questions' },
    { id: c, title: 'The Robots Are Coming | Shane Has Questions' },
  ] } };
  const catalog = build({ sources: [vice], playlists, details: longDetails([a, b, c]) });
  const show = showOf(catalog, a);
  assert.equal(show.kind, 'series');
  const byId = Object.fromEntries(show.episodes.map((e) => [e.id, e.title]));
  assert.deepEqual(byId, { [a]: 'Episode 1', [b]: 'Full episode', [c]: 'The Robots Are Coming' });
});

// ---- Work identity, parts, re-posts and sister channels ----------------------------------------------

const mfPlaylist = (videos) => ({ 'MYFLIXER:myflixer': { id: 'MYFLIXER:myflixer', sourceId: 'myflixer', title: 'Myflixer Documentaries', videos } });
const mfEpisode = (show, slug, title, season, number) => ({ id: `mf:e:${slug}`, title: `${show} - S${season}E${number}: ${title}`, showTitle: show, episodeTitle: title, parsed: { showTitle: show, episodeTitle: title, kind: 'series', number, season }, durationSec: 3000, thumb: `https://example.com/${slug}.jpg` });
const mfDetails = (rows) => Object.fromEntries(rows.map(([id, publishedAt, description]) => [id, { title: id, durationSec: 5400, publishedAt, description }]));
const cardOf = (catalog, id) => catalog.shows.find((s) => s.episodes.some((e) => e.id === id || e.offerings?.some((o) => o.id === id)));
const episodeOf = (catalog, id) => catalog.shows.flatMap((s) => s.episodes).find((e) => e.id === id);
const plainId = (title) => `s_${shortHash(normalizeArabic(title))}`;

test('Myflixer re-posts of one film fold into one film card; same-titled different works stay apart', () => {
  const rows = [
    mfFilm('restless-creature-wendy-whelan', 'Restless Creature: Wendy Whelan'), mfFilm('restless-creature-wendy-whelan-2', 'Restless Creature: Wendy Whelan'),
    mfFilm('lost-in-the-maze', 'Lost in the Maze'), mfFilm('lost-in-the-maze-2', 'Lost in the Maze'),
    mfFilm('penguins', 'Penguins'), mfFilm('penguins-2', 'Penguins'),
  ];
  const details = mfDetails([
    // The -2 re-post carries the WordPress post date, but the same synopsis.
    ['mf:m:restless-creature-wendy-whelan', '2017-05-24T03:00:00', 'Documentary about the American dancer Wendy Whelan'],
    ['mf:m:restless-creature-wendy-whelan-2', '2025-12-04T13:42:28', 'Documentary about the American dancer Wendy Whelan'],
    // Re-worded synopsis, same release date.
    ['mf:m:lost-in-the-maze', '2025-01-11T00:00:00', 'Lost in the Maze is story of two men navigating the Uraricoera River deep in the Amazon jungle.'],
    ['mf:m:lost-in-the-maze-2', '2025-01-11T00:00:00', '"Lost in the Maze" follows the journey of two men as they traverse the Uraricoera River.'],
    // Two different films named Penguins (2012 and 2019).
    ['mf:m:penguins', '2012-10-23T03:00:00', 'Narrated by David Attenborough, "Penguins 3D" celebrates the destiny of a King Penguin.'],
    ['mf:m:penguins-2', '2019-03-18T00:00:00', 'A coming-of-age story about an Adélie penguin named Steve.'],
  ]);
  const catalog = build({ sources: [myflixer], playlists: mfPlaylist(rows), details });
  for (const [a, b, title] of [['restless-creature-wendy-whelan', 'restless-creature-wendy-whelan-2', 'Restless Creature: Wendy Whelan'], ['lost-in-the-maze', 'lost-in-the-maze-2', 'Lost in the Maze']]) {
    const show = cardOf(catalog, `mf:m:${a}`);
    assert.equal(show, cardOf(catalog, `mf:m:${b}`), `${title}: one card`);
    assert.equal(show.kind, 'film');
    assert.equal(show.episodes.length, 1);
    assert.equal(show.id, plainId(title), 'the card keeps the title id');
    assert.equal(show.episodes[0].id, `mf:m:${a}`, 'the original slug is the episode');
    assert.deepEqual(show.episodes[0].offerings.map((o) => [o.provider, o.id]), [['myflixer', `mf:m:${a}`], ['myflixer', `mf:m:${b}`]]);
  }
  const p1 = cardOf(catalog, 'mf:m:penguins'), p2 = cardOf(catalog, 'mf:m:penguins-2');
  assert.notEqual(p1, p2, 'Penguins (2012) and Penguins (2019) are two cards');
  assert.equal(p1.kind, 'film');
  assert.equal(p2.kind, 'film');
  assert.equal(p1.id, plainId('Penguins'), 'the unsuffixed slug keeps the title id');
  assert.notEqual(p2.id, p1.id);
  assert.equal(new Set(catalog.shows.map((s) => s.id)).size, catalog.shows.length);
});

test('Myflixer sequels, volumes and numbered titles are never fuzzy-merged', () => {
  const titles = ['Generation Iron', 'Generation Iron 2', 'Generation Iron 3', 'Fahrenheit 9/11', 'Fahrenheit 11/9', 'Savage X Fenty Show Vol. 2', 'Savage x Fenty Show Vol. 3', 'Cocaine Cowboys', 'Cocaine Cowboys 2'];
  const rows = titles.map((t, i) => mfFilm(`film-${i}`, t));
  const details = mfDetails(rows.map((r, i) => [r.id, `${2000 + i}-01-01T00:00:00`, `Synopsis ${i}`]));
  const catalog = build({ sources: [myflixer], playlists: mfPlaylist([...rows,
    mfEpisode('Planet Earth II', 'planet-earth-ii-s01e01-islands', 'Islands', 1, 1), mfEpisode('Planet Earth III', 'planet-earth-iii-s01e01-coasts', 'Coasts', 1, 1)]), details });
  for (const r of rows) {
    const show = cardOf(catalog, r.id);
    assert.equal(show.kind, 'film', r.title);
    assert.equal(show.episodes.length, 1, r.title);
    assert.equal(show.title, r.title);
  }
  const iii = cardOf(catalog, 'mf:e:planet-earth-iii-s01e01-coasts');
  assert.notEqual(cardOf(catalog, 'mf:e:planet-earth-ii-s01e01-islands'), iii, 'Planet Earth II and III are two series');
  assert.equal(iii.posterVideoId, 'mf:e:planet-earth-iii-s01e01-coasts');
});

test('a Myflixer film named like a Myflixer series gets its own card; the series keeps the id, its poster and no channel alias', () => {
  const film = { ...mfFilm('home', 'Home'), views: 75000 };
  const eps = [mfEpisode('Home', 'home-s01e01-sweden', 'Sweden', 1, 1), mfEpisode('Home', 'home-s01e02-chicago', 'Chicago', 1, 2)];
  const catalog = build({ sources: [myflixer], playlists: mfPlaylist([film, ...eps]), details: { 'mf:m:home': { durationSec: 5400, viewCount: 75000, publishedAt: '2009-05-04T00:00:00' } } });
  const series = cardOf(catalog, 'mf:e:home-s01e01-sweden');
  const own = cardOf(catalog, 'mf:m:home');
  assert.notEqual(series, own);
  assert.equal(series.kind, 'series');
  assert.equal(series.id, plainId('Home'));
  assert.equal(series.episodes.length, 2);
  assert.ok(series.posterVideoId.startsWith('mf:e:'), 'the series cover is one of its own episodes, not the film');
  assert.equal(own.kind, 'film');
  assert.equal(own.title, 'Home');
  for (const s of catalog.shows) assert.ok(!(s.altTitles || []).includes('Myflixer Documentaries'), 'the pseudo-playlist title is no alias');
});

const frontline = channel({ id: 'UCfrontline', title: 'FRONTLINE PBS | Official', short: 'FRONTLINE', profile: 'frontline' });
const aljazeera = channel({ id: 'UCaj', title: 'Al Jazeera Documentary الجزيرة الوثائقية', short: 'الجزيرة الوثائقية', lang: 'ar', profile: 'aljazeera' });

test('parts of one film become one series numbered by part', () => {
  const ids = { one: yt('putin1'), two: yt('putin2'), trailer: yt('putin2t'), a1: yt('masali1'), a2: yt('masali2'), d1: yt('derna1'), d2: yt('derna2') };
  const playlists = {
    up: uploadsOf(frontline, [
      { id: ids.one, title: "Putin's Revenge, Part One (full documentary) | FRONTLINE" },
      { id: ids.two, title: "Putin's Revenge, Part Two (full documentary) | FRONTLINE" },
      // A trailer for part two (too short to be an episode) does not block the grouping.
      { id: ids.trailer, title: "Putin's Revenge, Part Two | Trailer | FRONTLINE" },
    ]),
    aj: uploadsOf(aljazeera, [
      { id: ids.a1, title: 'مصالي الحاج.. صانع فكرة استقلال الجزائر | الجزء الأول' },
      { id: ids.a2, title: 'مصالي الحاج.. أبو الوطنية الذي عادته الثورة | الجزء الثاني' },
      { id: ids.d1, title: 'الرمال المتحركة - درنة' },
      { id: ids.d2, title: 'الرمال المتحركة - درنة 2' },
    ]),
  };
  const details = longDetails(Object.values(ids), { [ids.trailer]: { durationSec: 30 }, [ids.two]: { durationSec: 3300 } });
  const catalog = build({ sources: [frontline, aljazeera], playlists, details });
  const putin = showOf(catalog, ids.one);
  assert.equal(putin, showOf(catalog, ids.two));
  assert.equal(putin.title, "Putin's Revenge");
  assert.equal(putin.kind, 'series');
  assert.deepEqual(putin.episodes.map((e) => [e.number, e.title]), [[1, 'Part 1'], [2, 'Part 2']]);
  assert.equal(putin.id, plainId("Putin's Revenge"));
  const masali = showOf(catalog, ids.a1);
  assert.equal(masali, showOf(catalog, ids.a2));
  assert.equal(masali.title, 'مصالي الحاج');
  assert.deepEqual(masali.episodes.map((e) => [e.number, e.title]), [[1, 'صانع فكرة استقلال الجزائر'], [2, 'أبو الوطنية الذي عادته الثورة']]);
  const derna = showOf(catalog, ids.d1);
  assert.equal(derna, showOf(catalog, ids.d2), 'the unnumbered base is part 1');
  assert.deepEqual(derna.episodes.map((e) => [e.number, e.title]), [[1, 'الجزء 1'], [2, 'الجزء 2']]);
});

test('part markers only group genuine parts', () => {
  const ids = { egypt: yt('press_eg'), lebanon: yt('press_lb'), apollo11: yt('apollo11'), apollo13: yt('apollo13'), vol: yt('sayings2'), base: yt('sayings1') };
  const creator = channel({ id: 'UCcreator', title: 'Some Creator', profile: 'creator' });
  const playlists = {
    aj: uploadsOf(aljazeera, [
      // Two different films that are each a "part 1": not one series.
      { id: ids.egypt, title: 'تاريخ الصحافة العربية.. مصر | الجزء الأول' },
      { id: ids.lebanon, title: 'تاريخ الصحافة العربية.. لبنان | الجزء الأول' },
    ]),
    en: uploadsOf(creator, [
      { id: ids.apollo11, title: 'Apollo 11' }, { id: ids.apollo13, title: 'Apollo 13' },
      { id: ids.base, title: 'The Curious Origins of Popular Sayings' }, { id: ids.vol, title: 'The Curious Origins of Popular Sayings (Vol.II)' },
    ]),
  };
  const details = longDetails(Object.values(ids), { [ids.lebanon]: { durationSec: 1790 } });
  const catalog = build({ sources: [aljazeera, creator], playlists, details });
  for (const id of Object.values(ids)) assert.equal(showOf(catalog, id).kind, 'film', id);
  assert.equal(new Set(Object.values(ids).map((id) => showOf(catalog, id).id)).size, 6);
});

test('re-uploads of one YouTube film fold into one film; a same-titled cut of another length stays apart', () => {
  const a = yt('athens_old'), b = yt('athens_new'), longCut = yt('libya_long'), shortCut = yt('libya_shrt');
  const playlists = { aj: uploadsOf(aljazeera, [
    { id: a, title: 'الآثار الإسلامية في اليونان.. حضارة إسلامية مفقودة في أثينا' }, { id: b, title: 'الآثار الإسلامية في اليونان.. حضارة إسلامية مفقودة في أثينا' },
    { id: longCut, title: 'ليبيا.. بلد المليون حافظ للقرآن' }, { id: shortCut, title: 'ليبيا بلد المليون حافظ للقرآن' },
  ]) };
  const details = {
    [a]: { durationSec: 3089, viewCount: 243527, publishedAt: '2016-03-03T00:00:00Z' }, [b]: { durationSec: 3092, viewCount: 43719, publishedAt: '2026-08-25T00:00:00Z' },
    [longCut]: { durationSec: 2772, viewCount: 104642, publishedAt: '2016-05-01T00:00:00Z' }, [shortCut]: { durationSec: 453, viewCount: 7257, publishedAt: '2022-02-14T00:00:00Z' },
  };
  const catalog = build({ sources: [aljazeera], playlists, details });
  const athens = showOf(catalog, a);
  assert.equal(athens.kind, 'film');
  assert.equal(athens.episodes.length, 1);
  assert.deepEqual(athens.episodes[0].offerings.map((o) => [o.provider, o.id]), [['youtube', a], ['youtube', b]], 'the first-posted upload plays first');
  assert.equal(cardOf(catalog, b), athens);
  const long = showOf(catalog, longCut), short = showOf(catalog, shortCut);
  assert.notEqual(long, short);
  assert.equal(long.kind, 'film');
  assert.equal(short.kind, 'film');
  assert.equal(long.id, plainId('ليبيا.. بلد المليون حافظ للقرآن'), 'the cut posted first keeps the title id');
});

test('the episode of a re-uploaded video does not follow view counts: its id, date and poster stay put across rebuilds', () => {
  const history = channel({ id: 'UChistory', title: 'HISTORY', profile: 'history' });
  const a = yt('BNYx41fYCBw'), b = yt('BWWJIKClNJc');
  // The uploads tab lists the re-upload first.
  const playlists = { up: uploadsOf(history, [{ id: b, title: 'New York vs. Philly: Mob War' }, { id: a, title: 'New York vs. Philly: Mob War' }]) };
  const details = (viewsA, viewsB, extra = {}) => ({
    [a]: { durationSec: 2580, viewCount: viewsA, publishedAt: '2025-11-06T00:00:00Z', ...extra[a] },
    [b]: { durationSec: 2585, viewCount: viewsB, publishedAt: '2026-05-06T00:00:00Z', ...extra[b] },
  });
  const run = (d, previous = null) => buildCatalog({ sources: [history], playlists, details: d, seen: {}, overrides: {}, previous });
  const first = run(details(29846, 27683));
  const film = cardOf(first, a);
  assert.equal(film.episodes.length, 1);
  assert.deepEqual(film.episodes[0].offerings.map((o) => o.id), [a, b]);
  assert.equal(film.latestAt, '2025-11-06T00:00:00.000Z');
  // The re-check of view counts passes one copy's views over the other's, back and forth.
  let previous = first;
  for (const [viewsA, viewsB] of [[29846, 30100], [30500, 30100], [10, 900000]]) {
    const next = run(details(viewsA, viewsB), previous);
    const show = cardOf(next, a);
    assert.equal(show.id, film.id);
    assert.deepEqual(show.episodes.map((e) => [e.id, e.publishedAt, e.offerings.map((o) => o.id)]), [[a, '2025-11-06T00:00:00.000Z', [a, b]]], `${viewsA} / ${viewsB} views`);
    assert.equal(show.latestAt, film.latestAt);
    assert.equal(show.posterVideoId, a);
    assert.deepEqual(diffCatalog(previous, next).newEpisodes, [], 'no copy is announced as a new episode');
    previous = next;
  }
  // Even without a previous catalogue the first-posted copy is the episode, whichever has more views.
  assert.equal(episodeOf(run(details(10, 900000)), a)?.offerings.length, 2);
  // A copy listed as the episode before stays the episode when an older copy turns up later (it was
  // private, or listed only now); a cold build takes the older one.
  const hidden = run(details(1, 1, { [a]: { isPrivate: true } }));
  assert.equal(cardOf(hidden, b).episodes[0].id, b);
  const shown = run(details(1, 1), hidden);
  assert.deepEqual(cardOf(shown, b).episodes.map((e) => [e.id, e.offerings.map((o) => o.id)]), [[b, [b, a]]]);
  assert.deepEqual(diffCatalog(hidden, shown).newEpisodes, []);
  assert.equal(episodeOf(run(details(1, 1)), a)?.offerings.length, 2);
});

test('a re-posted part keeps its first post as the episode, whatever the listing order and views', () => {
  const [p1, p1again, p2] = [yt('revenge1'), yt('revenge1b'), yt('revenge2')];
  const details = { [p1]: { durationSec: 3300, viewCount: 10, publishedAt: '2020-01-01T00:00:00Z' }, [p1again]: { durationSec: 3305, viewCount: 99999, publishedAt: '2024-01-01T00:00:00Z' }, [p2]: { durationSec: 3400, publishedAt: '2020-01-08T00:00:00Z' } };
  const rows = { [p1]: "Putin's Revenge, Part One | FRONTLINE", [p1again]: "Putin's Revenge, Part One | FRONTLINE", [p2]: "Putin's Revenge, Part Two | FRONTLINE" };
  for (const order of [[p1again, p2, p1], [p1, p1again, p2]]) {
    const catalog = build({ sources: [frontline], playlists: { up: uploadsOf(frontline, order.map((id) => ({ id, title: rows[id] }))) }, details });
    const show = showOf(catalog, p1);
    assert.equal(show.kind, 'series');
    assert.deepEqual(show.episodes.map((e) => [e.number, e.id, (e.offerings || []).map((o) => o.id)]), [[1, p1, [p1, p1again]], [2, p2, []]], order.join(','));
  }
});

test("series re-uploads fold only when the episode's own words match", () => {
  const cps = channel({ id: 'UCcps', title: "C'est pas sorcier", profile: 'dash-show', contentLang: 'fr', brands: ["C'est pas sorcier"], playlistsGeneric: true });
  const natgeo = channel({ id: 'UCng', title: 'National Geographic', profile: 'natgeo-en' });
  const ids = { cirqueA: yt('cirque_a'), cirqueB: yt('cirque_b'), sable: yt('sable'), cafe: yt('cafe'), scams: yt('scams'), cocaine: yt('cocaine') };
  const playlists = {
    PLcps: { id: 'PLcps', sourceId: cps.id, title: "C'est pas sorcier", videos: [
      { id: ids.cirqueA, title: "TOUS EN PISTE (le cirque) - C'est Pas Sorcier" }, { id: ids.cirqueB, title: "Le cirque, tous en piste ! - C'est Pas Sorcier [Intégrale]" },
      { id: ids.sable, title: "C'est pas sorcier -SABLE : Les sorciers veillent au grain" }, { id: ids.cafe, title: "C'est pas sorcier -CAFE :  LES SORCIERS VEILLENT AU GRAIN" },
    ] },
    PLtraf: { id: 'PLtraf', sourceId: natgeo.id, title: 'Trafficked with Mariana Van Zeller | National Geographic', videos: [
      { id: ids.scams, title: 'Scams (Full Episode) | Trafficked with Mariana Van Zeller' }, { id: ids.cocaine, title: 'Cocaine (Full Episode) | Trafficked with Mariana Van Zeller' },
    ] },
  };
  const details = longDetails(Object.values(ids), { [ids.cirqueB]: { durationSec: 1810 }, [ids.sable]: { durationSec: 1566 }, [ids.cafe]: { durationSec: 1561 } });
  const catalog = build({ sources: [cps, natgeo], playlists, details });
  const cirque = catalog.shows.flatMap((s) => s.episodes).find((e) => e.offerings?.some((o) => o.id === ids.cirqueB));
  assert.ok(cirque && [ids.cirqueA, ids.cirqueB].includes(cirque.id), 'the re-titled re-upload is one episode');
  for (const id of [ids.sable, ids.cafe, ids.scams, ids.cocaine]) assert.ok(episodeOf(catalog, id) && !episodeOf(catalog, id).offerings, `${id} stays its own episode`);
});

test('films grouped under one name take their number, season and subtitle from their own title', () => {
  const asharq = channel({ id: 'UCasharq', title: 'Discovery الشرق', lang: 'ar', profile: 'asharq' });
  const freedoc = channel({ id: 'UCfreedoc', title: 'Free Documentary - History', short: 'Free Documentary', profile: 'freedoc' });
  const critic = [1, 2, 3].map((n) => ({ id: yt(`critic${n}`), title: `الناقد في رمضان | تغطية خاصة لدراما رمضان 2024 على الشرق ديسكفري - الحلقة ${n}` }));
  const cosmetic = [[1, 'أورام محرجة'], [2, 'فقدان الثقة']].map(([n, t]) => ({ id: yt(`cosm${n}`), title: `علاجات تجميلية | ${t} - الحلقة ${n} | الشرق ديسكفري` }));
  const weird = [[5, "Plague Bombs & Nazi's Rings of Power"], [6, 'Hollywood Spy & The Fate of Atlantis']].map(([n, t]) => ({ id: yt(`weird${n}`), title: `World War Weird | Season 2, Ep. ${n}: ${t} | Free Documentary History` }));
  const vietnam = [
    { id: yt('viet1'), title: 'The Vietnam War | Part 1 | Vietnam and the War | Free Documentary History' },
    { id: yt('viet2'), title: 'The Vietnam War | Part 2 | The TV War | Free Documentary History' },
    { id: yt('vietall'), title: 'The Vietnam War | All Episodes | Free Documentary History' },
  ];
  const playlists = {
    up: uploadsOf(asharq, critic),
    PLcos: { id: 'PLcos', sourceId: asharq.id, title: 'علاجات تجميلية', videos: cosmetic },
    fd: uploadsOf(freedoc, [...weird, ...vietnam]),
  };
  const all = [...critic, ...cosmetic, ...weird, ...vietnam];
  const details = longDetails(all.map((v) => v.id), Object.fromEntries(all.map((v, i) => [v.id, { durationSec: 2400 + i * 200 }])));
  const catalog = build({ sources: [asharq, freedoc], playlists, details });
  const code = (id) => { const e = episodeOf(catalog, id); return [e.season, e.number, e.title]; };
  const criticShow = showOf(catalog, critic[0].id);
  assert.equal(criticShow.kind, 'series');
  assert.equal(criticShow.title, 'الناقد في رمضان');
  assert.deepEqual(critic.map((v) => code(v.id)), [[null, 1, 'الحلقة 1'], [null, 2, 'الحلقة 2'], [null, 3, 'الحلقة 3']], 'a subtitle all of them share is not an episode title');
  assert.deepEqual(cosmetic.map((v) => code(v.id)), [[null, 1, 'أورام محرجة'], [null, 2, 'فقدان الثقة']]);
  assert.deepEqual(weird.map((v) => code(v.id)), [[2, 5, "Plague Bombs & Nazi's Rings of Power"], [2, 6, 'Hollywood Spy & The Fate of Atlantis']]);
  assert.deepEqual(code(vietnam[2].id), [null, null, 'All episodes']);
});

test('sister channels of one profile share a show once: their copies become offerings', () => {
  const main = channel({ id: 'UCasharq', title: 'Discovery الشرق', lang: 'ar', profile: 'asharq' });
  const wild = channel({ id: 'UCwild', title: 'حياة برية وطبيعة - Discovery الشرق', lang: 'ar', profile: 'asharq' });
  const natgeo = channel({ id: 'UCng', title: 'National Geographic', profile: 'natgeo-en' });
  const animals = channel({ id: 'UCnga', title: 'Nat Geo Animals', profile: 'natgeo-en' });
  const ep = (ch, n, title) => ({ id: yt(`${ch}ep${n}`), title: `الرؤية بعيون الطائر - ${title} - الحلقة ${n} | الشرق ديسكفري` });
  const mainEps = [ep('m', 1, 'تحليق بلا أجنحة'), ep('m', 2, 'رقصة التزاوج')];
  const wildEps = [ep('w', 1, 'تحليق بلا أجنحة'), ep('w', 2, 'رقصة التزاوج'), ep('w', 3, 'حراس السماء')];
  const playlists = {
    PLm: { id: 'PLm', sourceId: main.id, title: 'الرؤية بعيون الطائر', videos: mainEps },
    PLw: { id: 'PLw', sourceId: wild.id, title: 'الرؤية بعيون الطائر', videos: wildEps },
    PLng: { id: 'PLng', sourceId: natgeo.id, title: 'Wicked Tuna | National Geographic', videos: [{ id: yt('tuna1'), title: 'Hook, Line & Sinker (Full Episode) | Wicked Tuna' }] },
    PLnga: { id: 'PLnga', sourceId: animals.id, title: 'Wicked Tuna | Nat Geo Animals', videos: [{ id: yt('tuna2'), title: 'Fish On (Full Episode) | Wicked Tuna' }] },
  };
  const ids = [...mainEps, ...wildEps].map((v) => v.id);
  const catalog = build({ sources: [wild, main, natgeo, animals], playlists, details: longDetails([...ids, yt('tuna1'), yt('tuna2')]) });
  const show = showOf(catalog, wildEps[0].id);
  assert.equal(show, cardOf(catalog, mainEps[0].id));
  assert.equal(show.channel.id, wild.id, 'the show with more episodes is kept');
  assert.equal(show.episodes.length, 3);
  assert.deepEqual(show.episodes.find((e) => e.number === 1).offerings.map((o) => o.id), [wildEps[0].id, mainEps[0].id]);
  assert.equal(catalog.shows.filter((s) => s.title === 'الرؤية بعيون الطائر').length, 1);
  assert.notEqual(showOf(catalog, yt('tuna1')), showOf(catalog, yt('tuna2')), 'no shared episodes: two channel cards');
});

test('only sister channels share a show: unrelated channels of one catch-all profile keep their same-titled films and shows', () => {
  const vice = channel({ id: 'UCvice', title: 'VICE News', profile: 'generic-en', brands: ['VICE News', 'VICE'] });
  const welt = channel({ id: 'UCwelt', title: 'WELT Documentary', profile: 'generic-en', brands: ['WELT Documentary'] });
  const ids = { vFilm: yt('vicechern'), wFilm: yt('weltchern'), vSeries: yt('vicenk'), wSeries: yt('weltnk') };
  const playlists = {
    vu: uploadsOf(vice, [{ id: ids.vFilm, title: 'Chernobyl: The Untold Story | Documentary' }]),
    wu: uploadsOf(welt, [{ id: ids.wFilm, title: 'Chernobyl: The Untold Story | Documentary' }]),
    PLvnk: { id: 'PLvnk', sourceId: vice.id, title: 'Inside North Korea', videos: [{ id: ids.vSeries, title: 'Inside North Korea | Inside North Korea' }] },
    PLwnk: { id: 'PLwnk', sourceId: welt.id, title: 'Inside North Korea', videos: [{ id: ids.wSeries, title: 'Inside North Korea | Inside North Korea' }] },
  };
  const details = {
    [ids.vFilm]: { durationSec: 2700, publishedAt: '2019-04-01T00:00:00Z', description: 'VICE goes inside the exclusion zone.' },
    [ids.wFilm]: { durationSec: 2745, publishedAt: '2023-04-01T00:00:00Z', description: 'Eine Dokumentation über die Katastrophe.' },
    [ids.vSeries]: { durationSec: 3000 }, [ids.wSeries]: { durationSec: 3030 },
  };
  const apart = build({ sources: [vice, welt], playlists, details });
  for (const id of Object.values(ids)) assert.ok(episodeOf(apart, id) && !episodeOf(apart, id).offerings, `${id} is its own channel's episode`);
  assert.equal(showOf(apart, ids.wFilm).channel.id, welt.id);
  assert.deepEqual(apart.stats.bySource[welt.id], { title: 'WELT Documentary', shows: 2, episodes: 2 });
  assert.equal(apart.channels.find((c) => c.id === welt.id)?.films, 2);
  // Channels declared one family in sources.json are sisters.
  const family = build({ sources: [{ ...vice, family: 'one-house' }, { ...welt, family: 'one-house' }], playlists, details });
  assert.deepEqual(cardOf(family, ids.wFilm).episodes.map((e) => [e.id, e.offerings?.map((o) => o.id)]), [[ids.vFilm, [ids.vFilm, ids.wFilm]]]);
  assert.equal(family.stats.bySource[welt.id].shows, 0);

  assert.equal(sisterFamily({ profile: 'natgeo-en' }), 'profile:natgeo-en');
  assert.equal(sisterFamily({ profile: 'asharq' }), 'profile:asharq');
  for (const src of [{ profile: 'generic-en' }, { profile: 'generic' }, { profile: 'creator' }, { profile: 'ar-films' }, { profile: 'ar-show' }, { profile: 'history' }, { profile: 'myflixer', family: 'x' }, { profile: 'asharq', family: false }, null]) {
    assert.equal(sisterFamily(src), null, JSON.stringify(src));
  }
  assert.equal(sisterFamily({ profile: 'ar-films', family: ' daheeh ' }), 'family:daheeh');
});

test("sister copies pair up by number when their titles are placeholders ('Full episode')", () => {
  const natgeo = channel({ id: 'UCng', title: 'National Geographic', profile: 'natgeo-en' });
  const animals = channel({ id: 'UCnga', title: 'Nat Geo Animals', profile: 'natgeo-en' });
  const [ng1, ng2, nga2] = [yt('tuna_ng1'), yt('tuna_ng2'), yt('tuna_nga2')];
  const playlists = {
    PLng: { id: 'PLng', sourceId: natgeo.id, title: 'Wicked Tuna | National Geographic', videos: [{ id: ng1, title: 'Wicked Tuna Episode 1 | Wicked Tuna' }, { id: ng2, title: 'Wicked Tuna Episode 2 | Wicked Tuna' }] },
    PLnga: { id: 'PLnga', sourceId: animals.id, title: 'Wicked Tuna | Nat Geo Animals', videos: [{ id: nga2, title: 'Wicked Tuna Episode 2 | Wicked Tuna' }] },
  };
  const catalog = build({ sources: [natgeo, animals], playlists, details: { [ng1]: { durationSec: 2600 }, [ng2]: { durationSec: 2640 }, [nga2]: { durationSec: 2630 } } });
  const show = cardOf(catalog, nga2);
  assert.equal(show.channel.id, natgeo.id);
  assert.deepEqual(show.episodes.map((e) => [e.number, e.title, e.id, (e.offerings || []).map((o) => o.id)]), [[1, 'Episode 1', ng1, []], [2, 'Episode 2', ng2, [ng2, nga2]]]);
});

test('film keys and numbered keys are not fuzzy-merged; near-identical series names still are', () => {
  const dw = channel({ id: 'UCdw', title: 'DW Documentary', profile: 'dw-en' });
  const discovery = channel({ id: 'UCdisc', title: 'Discovery', profile: 'generic-en' });
  const ids = { kabul: yt('kabul'), taliban: yt('taliban'), naf: yt('naf1'), xl: yt('nafxl1'), lost1: yt('lost1'), lost2: yt('lost2') };
  const playlists = {
    dw: uploadsOf(dw, [{ id: ids.kabul, title: 'Afghanistan: Kabul under the Taliban | DW Documentary' }, { id: ids.taliban, title: 'Afghanistan under the Taliban | DW Documentary' }]),
    PLnaf: { id: 'PLnaf', sourceId: discovery.id, title: 'Naked and Afraid', videos: [{ id: ids.naf, title: 'Gnats from Hell | Naked and Afraid' }] },
    PLxl: { id: 'PLxl', sourceId: discovery.id, title: 'Naked and Afraid XL', videos: [{ id: ids.xl, title: 'Scary Encounter with a Scorpion! | Naked and Afraid XL' }] },
    PLl1: { id: 'PLl1', sourceId: discovery.id, title: 'Lost Treasure of Egypt', videos: [{ id: ids.lost1, title: 'Hidden Tomb | Lost Treasure of Egypt' }] },
    PLl2: { id: 'PLl2', sourceId: discovery.id, title: 'Lost Treasures of Egypt', videos: [{ id: ids.lost2, title: 'Mummy Valley | Lost Treasures of Egypt' }] },
  };
  const details = longDetails(Object.values(ids), { [ids.kabul]: { durationSec: 746 }, [ids.taliban]: { durationSec: 1090 } });
  const catalog = build({ sources: [dw, discovery], playlists, details });
  assert.notEqual(showOf(catalog, ids.kabul), showOf(catalog, ids.taliban), 'two DW films');
  assert.notEqual(showOf(catalog, ids.naf), showOf(catalog, ids.xl), 'Naked and Afraid XL is its own show');
  assert.equal(showOf(catalog, ids.lost1), showOf(catalog, ids.lost2), 'a plural spelling of one series still merges');
});

test('"<Show> Full Episodes" playlists are series when their videos name the show; favourites and orphaned playlists name no show', () => {
  const vice = channel({ id: 'UCvice', title: 'VICE News', profile: 'generic-en', brands: ['VICE News', 'VICE'] });
  const titles = ['Opioid-Addicted Mothers & Iraq Peace', 'Brexit Begins & Property Rights', 'London Attack & Border Patrol Power', 'Ferguson Election & Russia Protests'];
  const vnt = titles.map((t, i) => ({ id: yt(`vnt${i}`), title: `${t}: VICE News Tonight Full Episode (HBO)` }));
  const fav = { id: yt('favvid'), title: 'The Robots Are Coming' };
  const orphan = { id: yt('orphan'), title: 'A Film From A Removed Channel' };
  const playlists = {
    PLvnt: { id: 'PLvnt', sourceId: vice.id, title: 'VICE News Tonight Full Episodes (HBO)', videos: [...vnt, { id: yt('vntx'), title: 'Behind the Scenes at HBO' }] },
    FLvice: { id: 'FLZaT_X_mc0BI-djXOlfhqWQ', sourceId: vice.id, title: 'Shane Smith Has Questions', videos: [fav] },
    PLgone: { id: 'PLgone', sourceId: 'UCremoved', title: 'Removed Channel Series', videos: [orphan] },
  };
  const catalog = build({ sources: [vice], playlists, details: longDetails([...vnt.map((v) => v.id), yt('vntx'), fav.id, orphan.id]) });
  const show = showOf(catalog, vnt[0].id);
  assert.equal(show.title, 'VICE News Tonight');
  assert.deepEqual(vnt.map((v) => showOf(catalog, v.id)), vnt.map(() => show));
  assert.ok(show.playlistIds.includes('PLvnt'), 'the playlist is a series playlist, not a collection');
  assert.notEqual(showOf(catalog, fav.id).title, 'Shane Smith Has Questions', 'a favourites list does not name a show');
  assert.ok(!showOf(catalog, fav.id).playlistIds.includes('FLZaT_X_mc0BI-djXOlfhqWQ'));
  assert.equal(showOf(catalog, orphan.id), undefined, 'a playlist of a removed channel is skipped, not filed under the first source');
});

test('part markers, number markers and own episode labels', () => {
  const p = (t, lang) => { const r = partOf(t, lang); return r && [r.n, r.kind, r.before, r.after]; };
  assert.deepEqual(p("Putin's Revenge, Part One"), [1, 'part', "Putin's Revenge", '']);
  assert.deepEqual(p('The Power of Big Oil, Part Three: Delay'), [3, 'part', 'The Power of Big Oil', 'Delay']);
  assert.deepEqual(p('Rocket Science - The success story of Ariane 5 (Pt 2)'), [2, 'part', 'Rocket Science - The success story of Ariane 5', '']);
  assert.deepEqual(p("Steven's Death: A Family's Fight for Justice (1/3)"), [1, 'part', "Steven's Death: A Family's Fight for Justice", '']);
  assert.deepEqual(p('SPACETIME SPECIAL: SpaceX Crew Dragon on the way back to earth (2)'), [2, 'part', 'SPACETIME SPECIAL: SpaceX Crew Dragon on the way back to earth', '']);
  assert.deepEqual(p('عُمان معجزة الجزيرة العربية.. الجزء الثاني - إنتاج ميساء الهوتي', 'ar'), [2, 'part', 'عُمان معجزة الجزيرة العربية', 'إنتاج ميساء الهوتي']);
  assert.deepEqual(p('ثالث الرحابنة.. إلياس الرحباني | كيف أصبح مدرسة عالمية؟ | الجزء التاني', 'ar'), [2, 'part', 'ثالث الرحابنة.. إلياس الرحباني | كيف أصبح مدرسة عالمية؟', '']);
  assert.deepEqual(p('باحثون عن الحرية - مؤسسة الأرض المقدسة ج.2', 'ar'), [2, 'part', 'باحثون عن الحرية - مؤسسة الأرض المقدسة', '']);
  assert.deepEqual(p('أرض الألوان- آسيا الوسطى- الحلقة الثانية عشر', 'ar'), [12, 'episode', 'أرض الألوان- آسيا الوسطى', '']);
  assert.deepEqual(p('مصطفى كمال أتاتورك 2', 'ar'), [2, 'num', 'مصطفى كمال أتاتورك', '']);
  for (const t of ['Apollo 11', 'Fahrenheit 9/11', 'The Curious Origins of Popular Sayings (Vol.II)', 'Part of the Plan', 'Generation Iron 2']) assert.equal(partOf(t, 'en'), null, t);
  assert.equal(partOf('الجزء الخفي من القصة', 'ar'), null);

  assert.ok(markersDiffer('fahrenheit 9 11', 'fahrenheit 11 9'));
  assert.ok(markersDiffer('generation iron', 'generation iron 2'));
  assert.ok(markersDiffer('ذاكره السينما الجزء الاول', 'ذاكره السينما الجزء الثاني'));
  assert.ok(markersDiffer('the coke vs pepsi war s2 e5', 'the coke vs pepsi war s2 e14'));
  assert.ok(!markersDiffer('lost treasure of egypt', 'lost treasures of egypt'));
  assert.ok(!markersDiffer('shark week 2013', 'shark week 2015', { romanOnly: true }), 'years of one series');
  assert.ok(markersDiffer('naked and afraid', 'naked and afraid xl', { romanOnly: true }));

  const src = { title: 'National Geographic', lang: 'en', brands: ['National Geographic'] };
  assert.deepEqual(ownEpisodeInfo('The Crux Episode 2 | Full Episode | National Geographic', 'The Crux', src), { number: 2, season: null, title: '' });
  assert.deepEqual(ownEpisodeInfo('Savage Kingdom Season 3 MEGA EPISODE Compilation | Nat Geo Wild', 'Savage Kingdom', src), { number: null, season: 3, title: 'MEGA Episode', label: true });
  assert.deepEqual(ownEpisodeInfo('Inside Airport: Lost & Found (Full Episode) | National Geographic', 'Inside Airport Lost & Found', src), { number: null, season: null, title: '' });
  assert.deepEqual(ownEpisodeInfo('UFOs: Top Secret Alien Files | Special | Full Episode', 'UFOs: Top Secret Alien Files', src), { number: null, season: null, title: 'Special' });
  assert.deepEqual(ownEpisodeInfo('الخبر الآخر | سيطرة أصالة على قوائم بيلبورد - الشرق ديسكفري', 'الخبر الآخر', { title: 'Discovery الشرق', lang: 'ar' }), { number: null, season: null, title: 'سيطرة أصالة على قوائم بيلبورد' });
});
