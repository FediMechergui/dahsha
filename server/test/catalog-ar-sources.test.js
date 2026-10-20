import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCatalog, showGroupOf, sisterFamily } from '../src/catalog.js';
import { normalizeArabic, shortHash } from '../src/text.js';
import { showIdState } from '../src/show-ids.js';

// The catalogue of the 9 Arabic channels added on 2026-10-19, with their sources.json entries (title
// filters, showGroup, playlistSeasons). Titles, lengths and dates are the channels' own (listed
// 2026-10-19/20); video ids are made up.
const sources = JSON.parse(fs.readFileSync(new URL('../data/sources.json', import.meta.url), 'utf8')).sources;
const byId = new Map(sources.map((s) => [s.id, s]));
const conf = (id) => ({ type: 'channel', lang: 'ar', ...byId.get(id) });
const AJ = conf('UC-4KnPMmZzwAzW7SbVATUZQ');
const NM = conf('UCtJmfVv0a52Bu7BnJJtZXKw');
const MOTF = conf('UC4CqD-RfKw-eE8xSFByMIHw');
const TRAVEL = conf('UCZrs1_RojgqE0zKN9evvfJw');
// World Odyssey disables embedding on every upload (none can play), so sources.json may drop it: its
// entry as added on 2026-10-19 stands in for a sister travel channel whose copies are no offerings.
const ODYSSEY = byId.has('UCUETY-zVLykpUQlVweNaLsg') ? conf('UCUETY-zVLykpUQlVweNaLsg')
  : { type: 'channel', id: 'UCUETY-zVLykpUQlVweNaLsg', title: 'World Odyssey', short: 'World Odyssey', profile: 'ar-films', lang: 'ar', brands: ['World Odyssey'], playlistsGeneric: true, scanUploads: true, maxUploads: 1500, documentaryUploads: true };
const AFAQ = conf('UCKo9YhpBHN7FzOSFleKZvLg');
const ASRAR = conf('UCSNjn6j2NvWYSSB7xrAJaXg');
const HAYAH = conf('UC4tNC0SDwlGrx1SpTz-gJGA');
const MOTF_PLAYLIST = 'PL0ePmFx_GS-I6LJcY13e1UNdD1TJgaJvU';

const yt = (id) => id.padEnd(11, '_').slice(0, 11);
const uploadsOf = (src, videos) => ({ id: `UPLOADS:${src.id}`, sourceId: src.id, isUploads: true, title: '__uploads__', videos });
const playlist = (id, src, title, videos) => ({ id, sourceId: src.id, title, videos });
const build = ({ sources: list, playlists, details, previous = null }) => buildCatalog({ sources: list, playlists, details, seen: {}, overrides: {}, previous });
const showOf = (catalog, videoId) => catalog.shows.find((s) => s.episodes.some((e) => e.id === videoId || e.offerings?.some((o) => o.id === videoId)));
// Rows [id, title, seconds, published]: playlist videos plus their details.
const rows = (list) => list.map(([id, title]) => ({ id, title }));
const detailsOf = (...lists) => Object.fromEntries(lists.flat().map(([id, title, durationSec, publishedAt, extra]) => [id, { title, durationSec, publishedAt, ...(extra || {}) }]));

test('the sources.json entries give the Daheeh\'s three channels one programme group, and no other channel one', () => {
  for (const s of [AJ, NM, MOTF]) assert.equal(showGroupOf(s), 'daheeh', s.title);
  for (const s of [TRAVEL, ODYSSEY, AFAQ, ASRAR, HAYAH]) assert.equal(showGroupOf(s), null, s.title);
  assert.equal(sisterFamily(AJ), 'family:daheeh');
  assert.equal(showGroupOf({ profile: 'myflixer', showGroup: 'x' }), null);
  assert.equal(showGroupOf({ profile: 'ar-show', showGroup: '  ' }), null);
  assert.equal(MOTF.playlistSeasons[MOTF_PLAYLIST], 2);
});

// ---- الدحيح: one show across AJ+ كبريت, New Media Academy Life and Museum of The Future --------------
const AJ_ERA = [
  [yt('aj_sell'), 'الدحيح - أبيع نفسي', 490, '2017-03-05T10:00:00Z'],
  [yt('aj_hole'), 'الدحيح - الثقب الأسود', 434, '2017-09-10T10:00:00Z'],
  [yt('aj_peak'), 'الدحيح - هزت عرش العلم', 1561, '2020-06-20T10:00:00Z'],
];
const AJ_2026 = [
  [yt('aj_port'), 'الدحيح | كيف هزمت بورسعيد ثلاث دول؟', 2790, '2026-10-19T15:00:00Z'],
  [yt('aj_trab'), 'الدحيح | طرابزون سبور: النادي الذي تحدّى العالم!', 1889, '2026-10-16T15:00:00Z'],
];
const AJ_OTHER = [
  [yt('aj_jah1'), 'الجهبذ | الترحيب المصري والإبداع السوري.. ما أسرار نجاح السوريين في مصر؟', 1119, '2026-09-01T10:00:00Z'],
  [yt('aj_jah2'), 'الجهبذ | كيف أصبحت سوريا والعراق بعد عقود من حكم البعث؟', 1538, '2026-09-08T10:00:00Z'],
  [yt('aj_khb1'), 'المُخبر الاقتصادي+ | تجارة الأدوية واللقاحات', 1834, '2026-08-01T10:00:00Z'],
  [yt('aj_khb2'), 'المُخبر الاقتصادي+ | خدع وحيل تستخدمها “السوبر ماركت” لاستنزاف نقودك', 2405, '2026-08-08T10:00:00Z'],
];
const AJ_SALIT = [yt('aj_salit'), 'السليط الإخباري 2026 | هل ضاع شغف العالم بعد عام على وقف إطلاق النار؟', 1500, '2026-10-10T10:00:00Z'];
const NM_S1 = [
  [yt('nm_apple'), 'الدحيح | أبل', 905, '2021-02-01T10:00:00Z'],
  [yt('nm_trans'), 'الدحيح | الترجمة', 1313, '2021-03-01T10:00:00Z'],
];
const NM_S3 = [[yt('nm_allergy'), 'الحساسية | الدحيح', 1557, '2023-05-01T10:00:00Z']];
const NM_UPLOADS = [
  [yt('nm_focus'), 'الدحيح | ركز في اللعب', 1133, '2022-06-01T10:00:00Z'], // a special in no season playlist
  [yt('nm_sell'), 'الدحيح | أبيع نفسي', 500, '2021-01-10T10:00:00Z'], // New Media's copy of an AJ+ episode
  [yt('nm_ruh'), 'المدينة التي صنعت المستحيل | روح', 2233, '2025-01-01T10:00:00Z'],
];
const MOTF_S2 = [
  [yt('mo_worm'), 'الدحيح | الثقب الدودي', 917, '2022-09-01T10:00:00Z'],
  [yt('mo_comp'), '!الدحيح | كمبيوترات حية', 1408, '2022-10-01T10:00:00Z'],
];
const daheehData = () => ({
  playlists: {
    PLaj: playlist('PLaj', AJ, 'الدحيح', rows([...AJ_2026, ...AJ_ERA])),
    PLjah: playlist('PLjah', AJ, 'الجهبذ', rows(AJ_OTHER.slice(0, 2))),
    PLkhb: playlist('PLkhb', AJ, '+ المُخبر الاقتصادي', rows(AJ_OTHER.slice(2))),
    PLsalit: playlist('PLsalit', AJ, 'السليط الإخباري 2024', rows([AJ_SALIT])),
    ajUp: uploadsOf(AJ, rows([AJ_SALIT, ...AJ_2026])),
    PLnm1: playlist('PLnm1', NM, 'الدحيح - الموسم الأول - الحلقات الكاملة', rows(NM_S1)),
    PLnm3: playlist('PLnm3', NM, 'الدحيح - الموسم الثالث - الحلقات الكاملة', rows(NM_S3)),
    nmUp: uploadsOf(NM, rows([...NM_UPLOADS, ...NM_S1])),
    [MOTF_PLAYLIST]: playlist(MOTF_PLAYLIST, MOTF, 'الدحيح', rows(MOTF_S2)),
  },
  details: detailsOf(AJ_ERA, AJ_2026, AJ_OTHER, [AJ_SALIT], NM_S1, NM_S3, NM_UPLOADS, MOTF_S2),
});

test('الدحيح is one show across its three channels, with seasons, era groups and each episode\'s own channel', () => {
  const { playlists, details } = daheehData();
  const catalog = build({ sources: [AJ, NM, MOTF], playlists, details });
  const shows = catalog.shows.filter((s) => s.key === normalizeArabic('الدحيح'));
  assert.equal(shows.length, 1, shows.map((s) => `${s.channel.short}: ${s.id}`).join(', '));
  const [show] = shows;
  // The first source's show keeps its title id and presents it.
  assert.equal(show.id, `s_${shortHash(normalizeArabic('الدحيح'))}`);
  assert.equal(show.channel.id, AJ.id);
  assert.equal(show.kind, 'series');
  assert.deepEqual(show.seasons, [1, 2, 3]);
  // Catalogue order = the page's: AJ+ 2017-2020, seasons 1-3, AJ+ 2026, then the unnumbered special;
  // dates order the episodes within each group.
  const groupOf = (e) => e.seasonLabel || (e.season != null ? `S${e.season}` : 'other');
  assert.deepEqual(show.episodes.map((e) => [groupOf(e), e.id]), [
    ['AJ+ كبريت 2017–2020', AJ_ERA[0][0]], ['AJ+ كبريت 2017–2020', AJ_ERA[1][0]], ['AJ+ كبريت 2017–2020', AJ_ERA[2][0]],
    ['S1', NM_S1[0][0]], ['S1', NM_S1[1][0]],
    ['S2', MOTF_S2[0][0]], ['S2', MOTF_S2[1][0]],
    ['S3', NM_S3[0][0]],
    ['AJ+ كبريت 2026', AJ_2026[1][0]], ['AJ+ كبريت 2026', AJ_2026[0][0]],
    ['other', NM_UPLOADS[0][0]],
  ]);
  assert.deepEqual(show.episodes.map((e) => e.title).slice(0, 4), ['أبيع نفسي', 'الثقب الأسود', 'هزت عرش العلم', 'أبل']);
  // Each episode keeps its channel and playlist; New Media's copy of an AJ+ episode is an offering.
  const channelOf = Object.fromEntries(show.episodes.map((e) => [e.id, e.channelId]));
  assert.equal(channelOf[AJ_ERA[0][0]], AJ.id);
  assert.equal(channelOf[NM_S3[0][0]], NM.id);
  assert.equal(channelOf[MOTF_S2[0][0]], MOTF.id);
  assert.ok(show.episodes.find((e) => e.id === MOTF_S2[0][0]).playlistIds.includes(MOTF_PLAYLIST));
  assert.deepEqual(show.episodes[0].offerings.map((o) => o.id), [AJ_ERA[0][0], NM_UPLOADS[1][0]]);
  const ids = show.episodes.flatMap((e) => [e.id, ...(e.offerings || []).map((o) => o.id).slice(1)]);
  assert.equal(new Set(ids).size, ids.length, 'no video twice');
  assert.equal(show.episodeCount, 11);
  assert.ok(show.episodes.every((e) => e.showId === show.id));
  // The other programmes stay their channel's series; السليط الإخباري is filtered out.
  const titled = (t) => catalog.shows.find((s) => s.title === t);
  assert.equal(titled('الجهبذ')?.kind, 'series');
  assert.equal(titled('الجهبذ').episodes.length, 2);
  assert.equal(titled('المُخبر الاقتصادي+')?.episodes.length, 2, 'the title as the channel writes it in its videos');
  assert.equal(titled('روح')?.channel.id, NM.id);
  assert.equal(showOf(catalog, AJ_SALIT[0]), undefined);
  assert.ok(!catalog.shows.some((s) => /السليط/.test(s.title)));
  // The show counts for the presenting channel, each episode for the channel that uploaded it, so the
  // per-source guard follows each channel's own share (New Media's copy of an AJ+ episode is no episode).
  assert.deepEqual(catalog.stats.bySource[AJ.id], { title: AJ.title, shows: 3, episodes: 5 + 4 });
  assert.deepEqual(catalog.stats.bySource[NM.id], { title: NM.title, shows: 1, episodes: 4 + 1 });
  assert.deepEqual(catalog.stats.bySource[MOTF.id], { title: MOTF.title, shows: 0, episodes: 2 });
  assert.equal(catalog.stats.episodes, 9 + 5 + 2);
});

test('the Daheeh\'s show keeps its id across rebuilds whichever channel grows, and absorbed ids alias to it', () => {
  const { playlists, details } = daheehData();
  const first = build({ sources: [AJ, NM, MOTF], playlists, details });
  const id = first.shows.find((s) => s.key === normalizeArabic('الدحيح')).id;
  // New Media lists far more episodes than AJ+ in the next build: still the same show and id.
  const more = Array.from({ length: 8 }, (_, i) => [yt(`nm_s4_${i}`), `حلقة ${i + 10} | الدحيح`, 1500 + i, `2024-0${(i % 8) + 1}-01T10:00:00Z`]);
  playlists.PLnm4 = playlist('PLnm4', NM, 'الدحيح - الموسم الرابع - الحلقات الكاملة', rows(more));
  Object.assign(details, detailsOf(more));
  const next = build({ sources: [AJ, NM, MOTF], playlists, details, previous: first });
  const show = next.shows.find((s) => s.key === normalizeArabic('الدحيح'));
  assert.equal(show.id, id);
  assert.deepEqual(show.seasons, [1, 2, 3, 4]);
  assert.equal(show.episodes.filter((e) => e.season === 4).length, 8);
  // New Media now lists most of the show's episodes (13 of 20), one of them the newest: the show keeps its
  // id and stays with AJ+ كبريت, and the new episode counts for New Media, so neither channel's
  // regression guard sees a loss.
  const later = [yt('nm_new'), 'الدحيح | حلقة خاصة', 1300, '2026-10-20T08:00:00Z'];
  playlists.nmUp.videos.push(...rows([later]));
  Object.assign(details, detailsOf([later]));
  const after = build({ sources: [AJ, NM, MOTF], playlists, details, previous: next });
  const moved = after.shows.find((s) => s.key === normalizeArabic('الدحيح'));
  assert.equal(moved.id, id);
  assert.equal(moved.channel.id, AJ.id);
  assert.equal(Date.parse(moved.latestAt), Date.parse(later[3]));
  assert.equal(moved.episodes.find((e) => e.id === later[0]).channelId, NM.id);
  assert.equal(after.stats.bySource[NM.id].episodes, next.stats.bySource[NM.id].episodes + 1);
  assert.equal(after.stats.bySource[AJ.id].episodes, next.stats.bySource[AJ.id].episodes);
  // A catalogue that listed the channels' shows apart (before showGroup) points their ids to the one show,
  // which keeps the title id (the first source's when apart, and the id a cold build gives) although
  // New Media's show listed most of the programme's episodes (14 of 21, as production's 332 of 667).
  const apart = build({ sources: [AJ, NM, MOTF].map(({ showGroup, ...s }) => s), playlists, details });
  const apartShows = apart.shows.filter((s) => s.key === normalizeArabic('الدحيح'));
  assert.equal(apartShows.length, 3);
  const apartOf = (src) => apartShows.find((s) => s.channel.id === src.id);
  assert.equal(apartOf(AJ).id, id, 'the first source held the title id when apart');
  assert.ok(apartOf(NM).episodes.length > apartShows.reduce((n, s) => n + s.episodes.length, 0) / 2);
  const joined = build({ sources: [AJ, NM, MOTF], playlists, details, previous: apart });
  const one = joined.shows.find((s) => s.key === normalizeArabic('الدحيح'));
  assert.equal(one.id, id);
  assert.equal(one.channel.id, AJ.id);
  assert.deepEqual(joined.idAliases, { [apartOf(NM).id]: id, [apartOf(MOTF).id]: id });
  assert.equal(build({ sources: [AJ, NM, MOTF], playlists, details, previous: joined }).shows.find((s) => s.key === normalizeArabic('الدحيح')).id, id, 'stable from then on');
  // The id state of that catalogue (showIdState) settles the same.
  assert.equal(build({ sources: [AJ, NM, MOTF], playlists, details, previous: showIdState(apart) }).shows.find((s) => s.key === normalizeArabic('الدحيح')).id, id);
  // A programme the previous catalogue listed under another id (a re-title) keeps it, like any show.
  const renamed = { ...first, shows: first.shows.map((s) => (s.id === id ? { ...s, id: 's_retitled' } : s)) };
  const kept = build({ sources: [AJ, NM, MOTF], playlists, details, previous: renamed });
  assert.equal(kept.shows.find((s) => s.key === normalizeArabic('الدحيح')).id, 's_retitled');
  assert.ok(!(id in kept.idAliases));
});

test('a declared family stays sister channels: same-named shows with different episodes stay apart', () => {
  const { playlists, details } = daheehData();
  const family = [AJ, NM, MOTF].map(({ showGroup, ...s }) => ({ ...s, family: 'daheeh' }));
  const catalog = build({ sources: family, playlists, details });
  const shows = catalog.shows.filter((s) => s.key === normalizeArabic('الدحيح'));
  assert.deepEqual(shows.map((s) => s.channel.id).sort(), [AJ.id, NM.id, MOTF.id].sort());
  assert.ok(catalog.shows.every((s) => s.episodes.every((e) => e.seasonLabel === undefined && e.channelId === undefined)));
});

test('a programme channel numbering no season gets one era group, or none when no channel numbers one', () => {
  const { playlists, details } = daheehData();
  delete playlists.PLnm1; delete playlists.PLnm3; delete playlists.nmUp;
  // No season anywhere: one list, no labels.
  const plain = build({ sources: [AJ, NM], playlists, details });
  const show = plain.shows.find((s) => s.key === normalizeArabic('الدحيح'));
  assert.ok(show.episodes.every((e) => e.seasonLabel === undefined));
  assert.deepEqual(show.seasons, []);
  // Museum of The Future's season 2 is the only one: AJ+'s runs sit around it.
  const withMotf = build({ sources: [AJ, NM, MOTF], playlists, details });
  const daheeh = withMotf.shows.find((s) => s.key === normalizeArabic('الدحيح'));
  assert.deepEqual([...new Set(daheeh.episodes.map((e) => e.seasonLabel || `S${e.season}`))], ['AJ+ كبريت 2017–2020', 'S2', 'AJ+ كبريت 2026']);
  // Undated episodes take no label and come last.
  for (const [id] of AJ_ERA) delete details[id].publishedAt;
  const undated = build({ sources: [AJ, NM, MOTF], playlists, details }).shows.find((s) => s.key === normalizeArabic('الدحيح'));
  assert.deepEqual(undated.episodes.slice(-3).map((e) => [e.id, e.seasonLabel ?? null, e.season]), AJ_ERA.map(([id]) => [id, null, null]));
});

// ---- 'ar-show': names as the channel writes them in its titles --------------------------------------
test('ar-show: an upload outside its playlist that names its programme last ("X | كوانتوبيديا") joins that programme', () => {
  const quanto = [
    [yt('q_sky'), 'لماذا السماء لونها أزرق؟ | كوانتوبيديا', 794, '2025-03-01T10:00:00Z'],
    [yt('q_zero'), 'لماذا من المُحرمات أن تقسم على "صفر"؟ |  كوانتوبيديا', 753, '2025-03-08T10:00:00Z'],
    [yt('q_time'), 'ما هو الزمن؟ | كوانتوبيديا', 900, '2025-03-15T10:00:00Z'],
  ];
  const loose = [yt('q_oxid'), 'حدث الأكسدة العظيم | كوانتوبيديا', 927, '2025-04-01T10:00:00Z'];
  const playlists = { PLq: playlist('PLq', NM, 'كوانتوبيديا', rows(quanto)), up: uploadsOf(NM, rows([loose, ...quanto])) };
  const catalog = build({ sources: [NM], playlists, details: detailsOf(quanto, [loose]) });
  assert.equal(catalog.shows.length, 1, catalog.shows.map((s) => s.title).join(', '));
  const [show] = catalog.shows;
  assert.equal(show.title, 'كوانتوبيديا');
  assert.ok(show.episodes.some((e) => e.id === loose[0] && e.title === 'حدث الأكسدة العظيم'));
});

// ---- 'ar-films': re-uploaded travel films -----------------------------------------------------------
const CONGO_T = [yt('t_congo'), 'الكونغو | في قلب أكثر مناطق أفريقيا بريةً وغموضًا | فيلم وثائقي عن السفر بدقة 4K', 4839, '2026-08-14T11:00:13Z'];
const CONGO_A = [yt('a_congo'), 'الكونغو | أكثر دول أفريقيا بريةً وغموضًا | وثائقي سفر بدقة 4K', 4811, '2026-07-23T11:00:19Z'];
const CONGO_O = [yt('o_congo'), 'الكونغو | قلب أفريقيا البري الذي لم تره من قبل | فيلم وثائقي بدقة 4K', 4820, '2026-06-01T11:00:00Z', { embeddable: false }];
const KENYA_T = [yt('t_kenya'), 'كينيا: الجمال الخطير في قلب أفريقيا البري | وثائقي بدقة 4K', 8235, '2026-09-11T11:00:21Z'];
const KENYA_A = [yt('a_kenya'), 'كينيا | الجمال الأخطر في أفريقيا الذي لم تره من قبل | فيلم وثائقي بدقة 4K', 8379, '2026-05-15T11:00:27Z'];
const KENYA_LONG = [yt('a_kenya2'), 'كينيا | رحلة في أرض السافانا | وثائقي سفر بدقة 4K', 9100, '2026-04-01T11:00:00Z'];
const TANZANIA = [yt('t_tanz'), 'تنزانيا | المكان الأكثر وحشية على وجه الأرض | فيلم وثائقي بدقة 4K', 7742, '2026-03-01T11:00:00Z'];
const AUSTRALIA = [yt('a_aus'), 'أستراليا | رحلة إلى المكان الأكثر عزلةً وخطورةً على وجه الأرض | وثائقي سفر بدقة 4K', 7894, '2026-03-02T11:00:00Z'];
const SHORT_T = [yt('t_short'), 'هاواي | جزر النار | وثائقي سفر بدقة 4K', 3000, '2026-02-01T11:00:00Z'];
const SHORT_A = [yt('a_short'), 'هاواي | الجنة الأخيرة | وثائقي سفر بدقة 4K', 3020, '2026-02-02T11:00:00Z'];
const travelData = ({ withAfaq = true } = {}) => ({
  playlists: {
    tUp: uploadsOf(TRAVEL, rows([CONGO_T, KENYA_T, TANZANIA, SHORT_T])),
    oUp: uploadsOf(ODYSSEY, rows([CONGO_O])),
    ...(withAfaq ? { aUp: uploadsOf(AFAQ, rows([CONGO_A, KENYA_A, KENYA_LONG, AUSTRALIA, SHORT_A])) } : {}),
  },
  details: detailsOf([CONGO_T, CONGO_A, CONGO_O, KENYA_T, KENYA_A, KENYA_LONG, TANZANIA, AUSTRALIA, SHORT_T, SHORT_A]),
});

test('ar-films: a travel film re-uploaded under another subtitle is one card, the other uploads its offerings', () => {
  const { playlists, details } = travelData();
  const catalog = build({ sources: [TRAVEL, ODYSSEY, AFAQ], playlists, details });
  // Labels and brands are gone from every title.
  assert.ok(catalog.shows.every((s) => !/4K|وثائقي|Discovery|آفاق/.test(s.title)), catalog.shows.map((s) => s.title).join(' / '));
  // Congo: the same subject before the first separator and lengths within 3%; the first posted upload
  // (آفاق) is the card. World Odyssey's copy cannot be embedded, so it is no offering.
  const congo = showOf(catalog, CONGO_T[0]);
  assert.equal(congo, showOf(catalog, CONGO_A[0]));
  assert.equal(congo.kind, 'film');
  assert.equal(congo.channel.id, AFAQ.id);
  assert.equal(congo.title, 'الكونغو | أكثر دول أفريقيا بريةً وغموضًا');
  assert.deepEqual(congo.episodes.map((e) => [e.id, e.offerings.map((o) => o.id)]), [[CONGO_A[0], [CONGO_A[0], CONGO_T[0]]]]);
  assert.ok(congo.altTitles.includes('الكونغو | في قلب أكثر مناطق أفريقيا بريةً وغموضًا'));
  assert.equal(showOf(catalog, CONGO_O[0]), undefined);
  // Kenya: "كينيا: …" and "كينيا | …" name the same country; a third upload 9% longer is another film.
  const kenya = showOf(catalog, KENYA_T[0]);
  assert.equal(kenya, showOf(catalog, KENYA_A[0]));
  assert.deepEqual(kenya.episodes[0].offerings.map((o) => o.id), [KENYA_A[0], KENYA_T[0]]);
  assert.notEqual(showOf(catalog, KENYA_LONG[0]), kenya);
  // Another subject at a close length, and films under an hour, stay apart: no fake series either.
  assert.notEqual(showOf(catalog, TANZANIA[0]), showOf(catalog, AUSTRALIA[0]));
  assert.notEqual(showOf(catalog, SHORT_T[0]), showOf(catalog, SHORT_A[0]));
  assert.ok(catalog.shows.every((s) => s.kind === 'film'));
  assert.equal(catalog.shows.length, 7);
  assert.deepEqual(catalog.stats.bySource[ODYSSEY.id], { title: ODYSSEY.title, shows: 0, episodes: 0 });
});

test('ar-films: the re-upload card keeps the film the previous catalogue listed, so its id stays', () => {
  const before = travelData({ withAfaq: false });
  const first = build({ sources: [TRAVEL, ODYSSEY, AFAQ], ...before });
  const congoId = showOf(first, CONGO_T[0]).id;
  const { playlists, details } = travelData();
  const next = build({ sources: [TRAVEL, ODYSSEY, AFAQ], playlists, details, previous: first });
  const congo = showOf(next, CONGO_A[0]);
  assert.equal(congo.id, congoId);
  assert.equal(congo.episodes[0].id, CONGO_T[0], 'the listed upload stays the episode');
  assert.equal(congo.channel.id, TRAVEL.id);
  // Built from scratch the first posted upload is the card; a later build listing it apart aliases it.
  const fresh = build({ sources: [TRAVEL, ODYSSEY, AFAQ], playlists, details });
  const apart = build({ sources: [TRAVEL, ODYSSEY], playlists, details });
  const rebuilt = build({ sources: [TRAVEL, ODYSSEY, AFAQ], playlists, details, previous: apart });
  assert.equal(showOf(rebuilt, CONGO_A[0]).id, showOf(apart, CONGO_T[0]).id);
  assert.equal(showOf(fresh, CONGO_A[0]).episodes[0].id, CONGO_A[0]);
});

// ---- 'ar-films': series playlists -----------------------------------------------------------------
test('ar-films: series playlists of أسرار خفية and Hayah are series; topic playlists stay films', () => {
  const quran = [
    [yt('h_q1'), 'الحلقة الاولى قصة سيدنا آدم عليه السلام كاملة من الخلق إلى نزوله على الأرض من قصص القرآن', 1500, '2025-01-01T10:00:00Z'],
    [yt('h_q2'), 'الحلقة الثانية أبناء آدم: كيف تزوجوا ولماذا قتل قابيل أخاه؟ قصص القرآن', 1400, '2025-01-08T10:00:00Z'],
  ];
  const iraq = [
    [yt('h_i1'), 'قصي وعدي صدام حسين', 1300, '2024-01-01T10:00:00Z'],
    [yt('h_i2'), 'لماذا غزت أمريكا العراق؟', 1350, '2024-02-01T10:00:00Z'],
  ];
  const kings = [
    [yt('s_k9'), 'ملوك اليمن القديم(9) أسرار  إمبراطورية ذو القرنين المنسية (تحليل علمي مفصل) ', 2400, '2025-05-01T10:00:00Z'],
    [yt('s_k10'), 'ملوك اليمن القديم(10) الملك الرائش باران ذو رياش: أعظم ملوك التبابعة…', 2500, '2025-05-08T10:00:00Z'],
    [yt('s_kx'), 'أخطر ملك في تاريخ اليمن: لماذا حاولوا مسح اسم \'حمير\' من التاريخ؟', 2200, '2025-06-01T10:00:00Z'],
  ];
  const africa = [[yt('t_af1'), 'العيش في ناميبيا | كيف ينجو الناس في واحد من أكثر الأماكن جفافًا على وجه الأرض | وثائقي بدقة 4K', 5504, '2026-01-01T10:00:00Z']];
  const playlists = {
    PLq: playlist('PLq', HAYAH, 'قصص القرآن… أعظم الحكايات التي غيّرت التاريخ', rows(quran)),
    PLi: playlist('PLi', HAYAH, 'العراق', rows(iraq)),
    PLk: playlist('PLk', ASRAR, 'سلسلة #ملوك_اليمن_القديم', rows(kings)),
    PLaf: playlist('PLaf', TRAVEL, 'استكشف أفريقيا', rows(africa)),
  };
  const catalog = build({ sources: [TRAVEL, ASRAR, HAYAH], playlists, details: detailsOf(quran, iraq, kings, africa) });
  const quranShow = showOf(catalog, quran[0][0]);
  assert.equal(quranShow.kind, 'series');
  assert.deepEqual(quranShow.episodes.map((e) => e.number), [1, 2]);
  assert.equal(quranShow, showOf(catalog, quran[1][0]));
  for (const [id] of iraq) assert.equal(showOf(catalog, id).kind, 'film');
  const kingsShow = showOf(catalog, kings[0][0]);
  assert.equal(kingsShow.title, 'ملوك اليمن القديم');
  assert.equal(kingsShow.episodes.length, 3, 'an unnumbered episode of the series playlist joins it');
  assert.deepEqual(kingsShow.episodes.filter((e) => e.number != null).map((e) => e.number), [9, 10]);
  // Discovery Travel files its films by region (playlistsGeneric): never a series.
  assert.equal(showOf(catalog, africa[0][0]).kind, 'film');
});
