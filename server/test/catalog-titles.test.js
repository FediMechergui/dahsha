import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, cleanProviderEpisodeTitle, rankNames } from '../src/catalog.js';
import { tagShow } from '../src/tagger.js';
import { FILM_EPISODE_TITLE, FILM_EPISODE_TITLE_EN } from '../src/text.js';

const LONG = 1800;
const yt = (id) => id.padEnd(11, '_').slice(0, 11);
const channel = (o) => ({ type: 'channel', title: 'Channel', lang: 'en', ...o });
const myflixer = { type: 'myflixer', id: 'myflixer', title: 'Myflixer Documentaries', short: 'Myflixer', lang: 'en', profile: 'myflixer', brands: ['Myflixer'] };
const build = ({ sources, playlists, details = {}, overrides = {} }) => buildCatalog({ sources, playlists, details, seen: {}, overrides });
const uploads = (src, videos) => ({ [`UPLOADS:${src.id}`]: { id: `UPLOADS:${src.id}`, sourceId: src.id, isUploads: true, title: '__uploads__', videos } });
const longDetails = (ids, extra = {}) => Object.fromEntries(ids.map((id) => [id, { durationSec: LONG, category: 'Education', ...(extra[id] || {}) }]));
const showOf = (catalog, videoId) => catalog.shows.find((s) => s.episodes.some((e) => e.id === videoId));
const epOf = (catalog, videoId) => showOf(catalog, videoId)?.episodes.find((e) => e.id === videoId);
const mfFilm = (slug, title) => ({ id: `mf:m:${slug}`, title, showTitle: title, episodeTitle: 'Full film', parsed: { showTitle: title, episodeTitle: 'Full film', kind: 'film', number: null, season: null }, durationSec: 5400, thumb: `https://example.com/${slug}.jpg`, tags: ['documentary'] });
const mfEpisode = (show, slug, title, season, number) => ({ id: `mf:e:${slug}`, title: `${show} - S${season}E${number}: ${title}`, showTitle: show, episodeTitle: title, parsed: { showTitle: show, episodeTitle: title, kind: 'series', number, season }, durationSec: 3000, thumb: 'https://example.com/s.jpg', tags: ['documentary'] });
const mfPlaylist = (videos) => ({ 'MYFLIXER:myflixer': { id: 'MYFLIXER:myflixer', sourceId: 'myflixer', title: 'Myflixer Documentaries', videos } });

test('provider episode titles keep only a real subtitle; placeholders become empty', () => {
  const cases = [
    ['TYSON – Season 1 Episode 1: Power', 'TYSON', 'Power'],
    ["999: What\\'s Your Emergency? Season 1 Episode 3", "999: What\\'s Your Emergency?", ''],
    ['Commando Missions Season 1 Episode 1', 'Missions Commandos', ''],
    ["The Beatles Anthology – S1995E1 – July '40 to March '63", 'The Beatles Anthology', "July '40 to March '63"],
    ['King of the Road – S2010E01 – Episode 1', 'King of the Road', ''],
    ['Episode #24.1', 'Big Brother', ''],
    ['Episode 5', 'Outback Truckers', ''],
    ['Series 2, Episode 13', 'One Born Every Minute', ''],
    ['Episode Nine', 'Show', ''],
    ['Episode 2: The Truth', 'WWE: Unreal', 'The Truth'],
    ['American Justice: Marty Tankleff', 'American Justice', 'Marty Tankleff'],
    ['Naples &#038; Campania', 'Tucci in Italy', 'Naples & Campania'],
    ["Sunderland &#8216;Til I Die Season 2 Episode 1", "Sunderland &#8216;Til I Die", ''],
    // Not prefixes: no separator after the show name, or not a placeholder.
    ['Chelsea Does Marriage', 'Chelsea Does', 'Chelsea Does Marriage'],
    ['Part 1', 'Show', 'Part 1'],
    ['Mighty Mekong: Episode 4', 'Primal Survivor', 'Mighty Mekong: Episode 4'],
    ['Episode dated 4 October 2020', 'Show', 'Episode dated 4 October 2020'],
  ];
  for (const [title, show, expected] of cases) assert.equal(cleanProviderEpisodeTitle(title, show), expected, title);
});

test('Myflixer titles, ids and synopses are built from decoded text', () => {
  const twas = mfFilm('twas-the-fight-before-christmas-7dsu2', '&#8216;Twas the Fight Before Christmas');
  const tucci = [
    mfEpisode('Tucci in Italy', 'tucci-in-italy-s02e01-naples-campania', 'Naples &#038; Campania', 2, 1),
    mfEpisode('Tucci in Italy', 'tucci-in-italy-s2e2-episode-2-2', 'Episode #2.2', 2, 2),
    mfEpisode('Tucci in Italy', 'tucci-in-italy-season-2-episode-3-rome', 'Tucci in Italy – Season 2 Episode 3: Rome', 2, 3),
  ];
  const details = {
    [twas.id]: { title: twas.title, description: 'A look at the feud behind the self-proclaimed &#8216;best decorated&#8217; street in America, and the neighbours who sued.', durationSec: 5400 },
  };
  const catalog = build({ sources: [myflixer], playlists: mfPlaylist([twas, ...tucci]), details });
  const film = showOf(catalog, twas.id);
  assert.equal(film.title, '‘Twas the Fight Before Christmas');
  assert.equal(film.key, 'twas the fight before christmas');
  assert.equal(film.id, 's_164uzlk', 'the id hashes the decoded key, so it can match the FMovies row of the same title');
  assert.doesNotMatch(JSON.stringify(film), /&#\d+;/);
  assert.equal(film.synopsisGenerated, false, 'an entity no longer reads as a #hashtag line');
  assert.match(film.synopsis, /‘best decorated’/);
  const series = showOf(catalog, tucci[0].id);
  assert.deepEqual(series.episodes.map((e) => [e.season, e.number, e.title]), [[2, 1, 'Naples & Campania'], [2, 2, ''], [2, 3, 'Rome']]);
  assert.match(series.synopsis, /including "Naples & Campania", "Rome"\.$/);
  assert.equal(series.episodes[0].fullTitle, 'Tucci in Italy - S2E1: Naples & Campania');
});

test('a provider episode titled like its show is a numbered placeholder, not "Full episode"', () => {
  const rows = [1, 2].map((n) => mfEpisode('Homes Under the Hammer', `homes-under-the-hammer-s1e${n}`, 'Homes Under the Hammer', 1, n));
  const show = build({ sources: [myflixer], playlists: mfPlaylist(rows) }).shows[0];
  assert.equal(show.kind, 'series');
  assert.deepEqual(show.episodes.map((e) => e.title), ['', '']);
});

test('English sources use the original title when the cached listing is an Arabic localization', () => {
  const hoog = channel({ id: 'UChoog', title: 'Hoog', profile: 'creator' });
  const natgeo = channel({ id: 'UCnatgeo', title: 'National Geographic', profile: 'natgeo-en' });
  const amsterdam = yt('QMlfVwN3iTw'), typhoon = yt('mmOlDDOcmNc'), mixed = yt('ftPHG8yGuts');
  const playlists = {
    ...uploads(hoog, [{ id: amsterdam, title: 'أغرب حي في أمستردام' }]),
    ...uploads(natgeo, [
      { id: typhoon, title: 'النجاة من رعب الإعصار العملاق (الحلقة الكاملة) | العاصفة المتجمعة | ناشيونال جيوغرافيك' },
      { id: mixed, title: 'Life in Baghdad: Joy Amid the Chaos of War | الحياة في بغداد | FRONTLINE' },
    ]),
  };
  const details = longDetails([amsterdam, typhoon, mixed], {
    [amsterdam]: { title: 'The Weirdest Neighborhood in Amsterdam' },
    [typhoon]: { title: 'Surviving Super Typhoon Terror (Full Episode) | Gathering Storm | National Geographic' },
    [mixed]: { title: 'Life in Baghdad: Joy Amid the Chaos of War | الحياة في بغداد | FRONTLINE' },
  });
  const catalog = build({ sources: [hoog, natgeo], playlists, details });
  const a = showOf(catalog, amsterdam);
  assert.equal(a.title, 'The Weirdest Neighborhood in Amsterdam');
  assert.equal(a.episodes[0].fullTitle, 'The Weirdest Neighborhood in Amsterdam');
  const storm = showOf(catalog, typhoon);
  assert.equal(storm.title, 'Gathering Storm');
  assert.equal(epOf(catalog, typhoon).title, 'Surviving Super Typhoon Terror');
  assert.equal(epOf(catalog, typhoon).fullTitle, details[typhoon].title);
  // A genuinely bilingual original stays as YouTube serves it.
  assert.equal(epOf(catalog, mixed).fullTitle, details[mixed].title);
});

test('Arabic sources, provider ids and rows without details keep the listing title', () => {
  const ngad = channel({ id: 'UCngad', title: 'Nat Geo Abu Dhabi', lang: 'ar', profile: 'natgeo' });
  const v = yt('arabicvideo');
  const ar = build({ sources: [ngad], playlists: uploads(ngad, [{ id: v, title: 'سمكة قرش تأكل سمكة قرش' }]), details: longDetails([v], { [v]: { title: 'Shark Eat Shark' } }) });
  assert.equal(showOf(ar, v).title, 'سمكة قرش تأكل سمكة قرش');
  const film = mfFilm('a-film', 'فيلم');
  const mf = build({ sources: [myflixer], playlists: mfPlaylist([film]), details: { [film.id]: { title: 'Some other title', durationSec: 5400 } } });
  assert.equal(mf.shows[0].title, 'فيلم');
  const hoog = channel({ id: 'UChoog', title: 'Hoog', profile: 'creator' });
  const w = yt('nodetails00');
  const none = build({ sources: [hoog], playlists: uploads(hoog, [{ id: w, title: 'عنوان عربي', durationSec: LONG }]) });
  assert.equal(none.shows[0].title, 'عنوان عربي', 'without a details title the listing title is all there is');
});

test('the original title reaches the tagger', () => {
  const hoog = channel({ id: 'UChoog', title: 'Hoog', profile: 'creator' });
  const v = yt('sharkvideo1');
  const catalog = build({ sources: [hoog], playlists: uploads(hoog, [{ id: v, title: 'أسماك القرش في أعماق المحيط' }]), details: longDetails([v], { [v]: { title: 'Sharks of the Deep Ocean Reef' } }) });
  assert.equal(catalog.shows[0].primaryTag, 'sharks-ocean');
});

test('numbered generic episodes read "Episode N"; a lone unnumbered full episode is a film', () => {
  const natgeo = channel({ id: 'UCnatgeo', title: 'National Geographic', profile: 'natgeo-en' });
  const crux = [1, 2].map((n) => ({ id: yt(`crux${n}`), title: `The Crux Episode ${n} | Full Episode | National Geographic` }));
  const special = { id: yt('special'), title: 'Special Report | Special Report | National Geographic' };
  const playlists = { PLcrux: { id: 'PLcrux', sourceId: natgeo.id, title: 'The Crux', videos: crux }, ...uploads(natgeo, [special]) };
  const catalog = build({ sources: [natgeo], playlists, details: longDetails([...crux, special].map((v) => v.id)) });
  const show = showOf(catalog, crux[0].id);
  assert.deepEqual(show.episodes.map((e) => [e.number, e.title]), [[1, 'Episode 1'], [2, 'Episode 2']]);
  const one = showOf(catalog, special.id);
  assert.equal(one.kind, 'film');
  assert.equal(one.episodes[0].title, FILM_EPISODE_TITLE_EN);

  const ngad = channel({ id: 'UCngad', title: 'Nat Geo Abu Dhabi', lang: 'ar', profile: 'natgeo' });
  const v = yt('sharkspec');
  const ar = build({ sources: [ngad], playlists: { PLs: { id: 'PLs', sourceId: ngad.id, title: 'سمكة قرش تأكل سمكة قرش', videos: [{ id: v, title: 'سمكة قرش تأكل سمكة قرش | ناشونال جيوغرافيك أبوظبي' }] } }, details: longDetails([v]) });
  assert.equal(ar.shows[0].kind, 'film');
  assert.equal(ar.shows[0].episodes[0].title, FILM_EPISODE_TITLE);
});

test('all-caps YouTube titles get display casing; fullTitle, French, providers and overrides are respected', () => {
  const history = channel({ id: 'UChistory', title: 'HISTORY', profile: 'history' });
  const eps = [{ id: yt('caps1'), title: 'TOP 4 UNBELIEVABLE INSTANCES OF ALIENS & TIME TRAVEL | Ancient Aliens' }, { id: yt('caps2'), title: 'The Pyramid Code | Ancient Aliens' }];
  const catalog = build({ sources: [history], playlists: { PLa: { id: 'PLa', sourceId: history.id, title: 'Ancient Aliens', videos: eps } }, details: longDetails(eps.map((v) => v.id)) });
  const ep = epOf(catalog, eps[0].id);
  assert.equal(ep.title, 'Top 4 Unbelievable Instances of Aliens & Time Travel');
  assert.equal(ep.fullTitle, eps[0].title);
  assert.equal(epOf(catalog, eps[1].id).title, 'The Pyramid Code');

  const shout = channel({ id: 'UCshout', title: 'Shout', profile: 'creator' });
  const s = yt('shoutshow1');
  const caps = build({ sources: [shout], playlists: uploads(shout, [{ id: s, title: 'EASTER SPECIAL IN THE ALPS' }]), details: longDetails([s]) });
  assert.equal(caps.shows[0].title, 'Easter Special in the Alps');
  assert.equal(caps.shows[0].episodes[0].fullTitle, 'EASTER SPECIAL IN THE ALPS');
  const kept = build({ sources: [shout], playlists: uploads(shout, [{ id: s, title: 'EASTER SPECIAL IN THE ALPS' }]), details: longDetails([s]), overrides: { shows: { 'EASTER SPECIAL IN THE ALPS': { title: 'EASTER SPECIAL IN THE ALPS' } } } });
  assert.equal(kept.shows[0].title, 'EASTER SPECIAL IN THE ALPS');
  const last = build({ sources: [shout], playlists: uploads(shout, [{ id: s, title: 'SOUTH KOREA IS OVER' }]), details: longDetails([s]) });
  assert.equal(last.shows[0].title, 'South Korea Is Over', 'the last word is capitalized even when it is a minor word');

  const cps = channel({ id: 'UCcps', title: "C'est pas sorcier", contentLang: 'fr', profile: 'dash-show', brands: ["C'est pas sorcier"] });
  const f = yt('frenchcaps');
  const fr = build({ sources: [cps], playlists: uploads(cps, [{ id: f, title: "LES VOLCANS D'AUVERGNE - C'est pas sorcier" }]), details: longDetails([f]) });
  assert.equal(epOf(fr, f).title, "Les volcans d'auvergne");

  const film = mfFilm('mlk-fbi', 'MLK/FBI SPECIAL EDITION');
  const mf = build({ sources: [myflixer], playlists: mfPlaylist([film]) });
  assert.equal(mf.shows[0].title, 'MLK/FBI SPECIAL EDITION');
});

test('templated synopses skip generic labels and metadata overviews are decoded', () => {
  const natgeo = channel({ id: 'UCnatgeo', title: 'National Geographic', profile: 'natgeo-en' });
  const eps = [1, 2].map((n) => ({ id: yt(`gen${n}`), title: `Lost Cities Episode ${n} | Full Episode | National Geographic` }));
  const playlists = { PLl: { id: 'PLl', sourceId: natgeo.id, title: 'Lost Cities', videos: eps } };
  const show = build({ sources: [natgeo], playlists, details: longDetails(eps.map((v) => v.id)) }).shows[0];
  assert.deepEqual(show.episodes.map((e) => e.title), ['Episode 1', 'Episode 2']);
  assert.equal(show.synopsisGenerated, true);
  assert.equal(show.synopsis, 'Lost Cities from National Geographic. 2 full episodes.');

  const art = { [show.id]: { overview: 'Ruins &amp; legends, explored &#8216;on foot&#8217;.', overviewLang: 'en' } };
  const withArt = buildCatalog({ sources: [natgeo], playlists, details: longDetails(eps.map((v) => v.id)), seen: {}, overrides: {}, artwork: art }).shows[0];
  assert.equal(withArt.synopsis, 'Ruins & legends, explored ‘on foot’.');
  assert.equal(withArt.synopsisGenerated, false);
});

// ---- "Also known as" and the section's script ----------------------------------------------------

const natgeoEn = channel({ id: 'UCngen', title: 'National Geographic', short: 'Nat Geo', profile: 'natgeo-en', brands: ['National Geographic', 'Nat Geo'] });
const dwEn = channel({ id: 'UCdwen', title: 'DW Documentary', short: 'DW Documentary', profile: 'dw-en', brands: ['DW Documentary', 'DW'] });
const playlist = (id, src, title, videos) => ({ [id]: { id, sourceId: src.id, title, videos } });

test('alt titles: topic collections are not names of a show, though they still hint its topics', () => {
  const [cash, korea] = [yt('dwcash'), yt('dwkorea')];
  const playlists = {
    ...playlist('PLpol', dwEn, 'Politics, Economics & Business | DW Documentary', [{ id: cash, title: 'How cash is becoming a thing of the past | DW Documentary' }, { id: korea, title: 'Visiting North Korea | DW Documentary' }]),
    ...playlist('PLtravel', dwEn, 'Travel | DW Documentary', [{ id: korea, title: 'Visiting North Korea | DW Documentary' }]),
  };
  const catalog = build({ sources: [dwEn], playlists, details: longDetails([cash, korea]) });
  for (const id of [cash, korea]) assert.deepEqual(showOf(catalog, id).altTitles, [], 'no "Politics, Economics & Business | DW Documentary" alt title');
  // The channel's filing is a tagging hint, at most as strong as one title keyword.
  assert.deepEqual(tagShow({ title: 'Visiting North Korea', kind: 'film', lang: 'en' }).tags, ['politics']);
  assert.deepEqual(showOf(catalog, korea).tags, ['politics', 'economy-tech']);
});

test('alt titles: a playlist title counts only when the show name came from it, cleaned, and by normalized key', () => {
  // The show name is the raw playlist title (generic profile): its cleaned form is the alt title.
  const sea = channel({ id: 'UCsea', title: 'قناة المثال', short: 'المثال', lang: 'ar', profile: 'generic', brands: ['قناة المثال'] });
  const [s1, s2] = [yt('sea1'), yt('sea2')];
  const raw = build({ sources: [sea], playlists: playlist('PLsea', sea, 'حكايات البحر | قناة المثال', [{ id: s1, title: 'الحلقة 1' }, { id: s2, title: 'الحلقة 2' }]), details: longDetails([s1, s2]) });
  assert.deepEqual(raw.shows[0].altTitles, ['حكايات البحر']);

  // Case and brand variants of the show's own name are the same name.
  const [u1, u2, u3] = [yt('ufo1'), yt('ufo2'), yt('ufo3')];
  const ufo = build({ sources: [natgeoEn], details: longDetails([u1, u2, u3]), playlists: {
    ...playlist('PLu1', natgeoEn, 'UFOs: Investigating the Unknown | National Geographic', [{ id: u1, title: 'The Roswell Files | UFOs: Investigating the Unknown' }]),
    ...playlist('PLu2', natgeoEn, 'UFOS: Investigating the Unknown | National Geographic', [{ id: u2, title: 'Area 51 | UFOS: Investigating the Unknown' }, { id: u3, title: 'Skinwalker | UFOS: Investigating the Unknown' }]),
  } });
  assert.equal(ufo.shows.length, 1);
  assert.deepEqual(ufo.shows[0].altTitles, []);

  // A genuinely different spelling the show also goes by stays.
  const [e1, e2, e3] = [yt('egypt1'), yt('egypt2'), yt('egypt3')];
  const egypt = build({ sources: [natgeoEn], details: longDetails([e1, e2, e3]), playlists: {
    ...playlist('PLe1', natgeoEn, 'Lost Treasures of Egypt | National Geographic', [{ id: e1, title: 'Rise of the Pharaohs | Lost Treasures of Egypt' }, { id: e2, title: 'The Valley of Kings | Lost Treasures of Egypt' }]),
    ...playlist('PLe2', natgeoEn, 'Lost Treasure of Egypt | National Geographic', [{ id: e3, title: 'Cleopatra | Lost Treasure of Egypt' }]),
  } });
  assert.equal(egypt.shows.length, 1);
  assert.equal(egypt.shows[0].title, 'Lost Treasures of Egypt');
  assert.deepEqual(egypt.shows[0].altTitles, ['Lost Treasure of Egypt']);
  for (const c of [raw, ufo, egypt]) for (const s of c.shows) assert.ok(s.altTitles.every((t) => !t.includes(' | ')), JSON.stringify(s.altTitles));
});

test('display names prefer the section\'s script, then the most used', () => {
  const names = [['أغرب حي في أمستردام', 3], ['The Weirdest Neighborhood in Amsterdam', 1]];
  assert.equal(rankNames(names, 'en'), 'The Weirdest Neighborhood in Amsterdam');
  assert.equal(rankNames(names, 'ar'), 'أغرب حي في أمستردام');
  assert.equal(rankNames([['Shark Week 2021', 1], ['Shark Week 2023', 2]], 'en'), 'Shark Week 2023');
  assert.equal(rankNames([['First', 1], ['Second', 1]], 'en'), 'First');
  assert.equal(rankNames([], 'en'), undefined);
});

test('a provider film row without an episode title still gets a string title', () => {
  const film = mfFilm('no-episode-title', 'The Quiet Film');
  delete film.parsed.episodeTitle; delete film.episodeTitle;
  const show = build({ sources: [myflixer], playlists: mfPlaylist([film]) }).shows[0];
  assert.equal(typeof show.episodes[0].title, 'string');
  assert.equal(show.title, 'The Quiet Film');
});
