import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseTitle, playlistShowName, arShowName, arShowPlaylist, arShowNames, arFilmSegments, arFilmsPlaylistName,
  arFilmsPlaylistIsSeries, isFilmLabel, seasonNumberFromTitle,
} from '../src/text.js';
import { buildCatalog } from '../src/catalog.js';

// The 'ar-show' and 'ar-films' profiles of the 9 Arabic channels added on 2026-10-19. Every title below
// is real (listed from the channels on 2026-10-19/20).
const sources = JSON.parse(fs.readFileSync(new URL('../data/sources.json', import.meta.url), 'utf8')).sources;
const byId = new Map(sources.map((s) => [s.id, s]));
const conf = (id, fallback) => byId.get(id) || fallback;
const AJ = conf('UC-4KnPMmZzwAzW7SbVATUZQ', { id: 'UC-4KnPMmZzwAzW7SbVATUZQ', profile: 'ar-show', brands: ['AJ+ كبريت', 'AJ+', 'كبريت'] });
const NM = conf('UCtJmfVv0a52Bu7BnJJtZXKw', { id: 'UCtJmfVv0a52Bu7BnJJtZXKw', profile: 'ar-show', brands: ['New Media Academy Life', 'New Media Academy', 'نيو ميديا'] });
const MOTF = conf('UC4CqD-RfKw-eE8xSFByMIHw', { id: 'UC4CqD-RfKw-eE8xSFByMIHw', profile: 'ar-show', brands: ['Museum of The Future', 'متحف المستقبل', 'Museum of The Future متحف المستقبل'] });
const film = (id, brands) => conf(id, { id, profile: 'ar-films', brands });
const TRAVEL = film('UCZrs1_RojgqE0zKN9evvfJw', ['Discovery Travel']);
const ODYSSEY = film('UCUETY-zVLykpUQlVweNaLsg', ['World Odyssey']);
const AFAQ = film('UCKo9YhpBHN7FzOSFleKZvLg', ['آفاق World Docs', 'آفاق', 'World Docs']);
const ASRAR = film('UCSNjn6j2NvWYSSB7xrAJaXg', ['أسرار خفية - مصعب', 'أسرار خفية']);
const WEST = film('UCcxFARHBsl_Ufy0WwnekavA', ['الغرب الوثائقية', 'WestDocs']);
const HAYAH = film('UC4tNC0SDwlGrx1SpTz-gJGA', ['Hayah Documentary', 'Hayah Documentry', 'حياة الوثائقية']);

const ctxOf = (src, playlistTitle = null, extra = {}) => ({ profile: src.profile, lang: 'ar', brands: src.brands, playlistTitle, playlistGeneric: !playlistTitle, ...extra });
const parse = (src, title, playlistTitle, extra) => {
  const r = parseTitle(title, ctxOf(src, playlistTitle, extra));
  return [r.showTitle, r.episodeTitle, r.kind, r.number, r.season];
};
const FILM = 'الفيلم الكامل';

test('the sources.json entries of the 9 channels use the profiles these tests cover', () => {
  for (const s of [AJ, NM, MOTF]) assert.equal(s.profile, 'ar-show', s.title);
  for (const s of [TRAVEL, ODYSSEY, AFAQ, ASRAR, WEST, HAYAH]) assert.equal(s.profile, 'ar-films', s.title);
});

// ---- 'ar-show' --------------------------------------------------------------------------------

test('ar-show: "Show | Episode" (AJ+ كبريت); a year after the name is the season\'s, not the name\'s', () => {
  assert.deepEqual(parse(AJ, 'الدحيح | طرابزون سبور: النادي الذي تحدّى العالم!'), ['الدحيح', 'طرابزون سبور: النادي الذي تحدّى العالم!', 'series', null, null]);
  assert.deepEqual(parse(AJ, 'المُخبر الاقتصادي+ | سيطروا على هوليوود! كيف وضعت عائلة إليسون يدها على إمبراطورية إعلامية ضخمة؟').slice(0, 3),
    ['المُخبر الاقتصادي+', 'سيطروا على هوليوود! كيف وضعت عائلة إليسون يدها على إمبراطورية إعلامية ضخمة؟', 'series']);
  assert.deepEqual(parse(AJ, 'السليط الإخباري 2026 | هل ضاع شغف العالم بعد عام على وقف إطلاق النار؟').slice(0, 3),
    ['السليط الإخباري', 'هل ضاع شغف العالم بعد عام على وقف إطلاق النار؟', 'series']);
  assert.deepEqual(parse(AJ, 'السليط الإخباري الموسم الثالث | الحلقة 4'), ['السليط الإخباري', 'الحلقة 4', 'series', 4, 3]);
  // "المخبر الاقتصادي+|" without a space before the pipe, in the "+ المُخبر الاقتصادي" playlist: the same show.
  const [show] = parse(AJ, 'المخبر الاقتصادي+| هل تستطيع أمريكا محاربة الصين وروسيا معاً؟ كيف يحاول ترمب تدبير انقلاب على الصين؟', '+ المُخبر الاقتصادي');
  assert.equal(show, 'المخبر الاقتصادي+');
});

test('ar-show: "الموسم 2026" names a season by its year: no season number, and the year is not the name\'s', () => {
  assert.deepEqual(arShowPlaylist('الدحيح - الموسم 2026'), { name: 'الدحيح', season: null });
  assert.deepEqual(arShowPlaylist('السليط الإخباري موسم 2022'), { name: 'السليط الإخباري', season: null });
  assert.deepEqual(arShowPlaylist('الدحيح - الموسم ٢٠٢٦'), { name: 'الدحيح', season: null });
  assert.deepEqual(arShowPlaylist('الدحيح - الموسم 10'), { name: 'الدحيح', season: 10 });
  assert.deepEqual(arShowPlaylist('الدحيح - الموسم الثامن - الحلقات الكاملة'), { name: 'الدحيح', season: 8 });
  assert.deepEqual(parse(AJ, 'السليط الإخباري الموسم 2022 | الحلقة (49)'), ['السليط الإخباري', 'الحلقة (49)', 'series', null, null]);
  const year = parse(AJ, 'الدحيح | كيف نجا؟ | الموسم 2026');
  assert.deepEqual([year[0], year[4]], ['الدحيح', null]);
  // A year-named playlist gives its episodes no season either.
  assert.deepEqual(parse(AJ, 'كيف نجا؟', 'الدحيح - الموسم 2026'), ['الدحيح', 'كيف نجا؟', 'series', null, null]);
  // The same for the generic season marker of the other profiles.
  assert.equal(seasonNumberFromTitle('رحلة - موسم 2022 - الحلقة 5'), null);
  assert.equal(seasonNumberFromTitle('رحلة - موسم 12 - الحلقة 5'), 12);
  assert.equal(parseTitle('رحلة - موسم 2022 - الحلقة 5', { profile: 'asharq' }).season, null);
});

test('ar-show: a bare marker names no programme, a known name before a dash does, and a show\'s playlist beats a name-like segment', () => {
  const known = new Map([['الدحيح', 5], ['الجهبذ', 4], ['السليط الاخباري', 9]]);
  // "الحلقة (49)" is a marker, not the show; the known name before the dash is.
  assert.deepEqual(parse(AJ, 'السليط الإخباري - خلف الكواليس 2 | الحلقة (49) موسم 2022', null, { showNames: known }).slice(0, 3),
    ['السليط الإخباري', 'خلف الكواليس 2 | الحلقة (49) موسم 2022', 'series']);
  // Without the channel's names "X - Y" is a title with a subtitle: a film, never a show named "الحلقة (49".
  assert.deepEqual(parse(AJ, 'السليط الإخباري - خلف الكواليس 2 | الحلقة (49) موسم 2022').slice(1, 3), [FILM, 'film']);
  assert.deepEqual(parse(AJ, 'الجهبذ - عقدة النقص | الحلقة 12', null, { showNames: known }), ['الجهبذ', 'عقدة النقص | الحلقة 12', 'series', 12, null]);
  assert.deepEqual(parse(AJ, 'عقدة النقص - الجهبذ | الحلقة 12', null, { showNames: known }).slice(0, 2), ['الجهبذ', 'عقدة النقص | الحلقة 12']);
  // In a show's playlist (a title that reads like a name) a name-like segment is part of the episode.
  assert.deepEqual(parse(AJ, 'قصة أغنية | من هو فيروز؟', 'الوتر الحساس').slice(0, 3), ['الوتر الحساس', 'قصة أغنية | من هو فيروز؟', 'series']);
  assert.deepEqual(parse(AJ, 'ضيف خاص | حلقة استثنائية', 'الدحيح - الموسم الثامن - الحلقات الكاملة'), ['الدحيح', 'ضيف خاص | حلقة استثنائية', 'series', null, 8]);
  // A topic playlist does not read like a name: the segment still names the programme.
  assert.deepEqual(parse(AJ, 'الدحيح | هتلر', 'هتلر والحرب العالمية الثانية').slice(0, 2), ['الدحيح', 'هتلر']);
  // Recurring markers never become programme names; "حلقة وصل" is a name.
  const titles = ['حلقة وصل | أ', 'حلقة وصل | ب', 'حلقة وصل | ج', 'أ | الحلقة 1', 'ب | الحلقة 2', 'ج | الحلقة 3', 'د | الحلقة الأخيرة', 'ه | الحلقة الأخيرة', 'و | الحلقة الأخيرة', 'ز | الموسم الثالث', 'ح | الموسم الثالث', 'ط | الموسم الثالث'];
  assert.deepEqual([...arShowNames(titles, AJ.brands)], [['حلقه وصل', 3]]);
});

test('ar-show: "Show - Episode" (AJ+ 2017-2020) and episodes that name no programme', () => {
  assert.deepEqual(parse(AJ, 'الدحيح - نُصك ملحد'), ['الدحيح', 'نُصك ملحد', 'series', null, null]);
  assert.deepEqual(parse(AJ, 'الدحيح -  المساس بالاحتباس').slice(0, 2), ['الدحيح', 'المساس بالاحتباس']);
  // In a topic playlist the title still names its programme.
  assert.deepEqual(parse(AJ, 'الدحيح - هتلر', 'هتلر والحرب العالمية الثانية').slice(0, 2), ['الدحيح', 'هتلر']);
  // A title naming no programme is an episode of its show's playlist, else a standalone film.
  assert.deepEqual(parse(AJ, 'كم كان دين سوريا عند وفاة حافظ الأسد؟', 'الجهبذ').slice(0, 3), ['الجهبذ', 'كم كان دين سوريا عند وفاة حافظ الأسد؟', 'series']);
  const upload = 'حرائق وغضب وآلاف الاعتقالات.. لماذا أشعل طلاب المدارس انتفاضة هزت فرنسا؟';
  assert.deepEqual(parse(AJ, upload).slice(0, 3), [upload, FILM, 'film']);
  // The channel's name is never a show.
  assert.deepEqual(parse(AJ, 'AJ+ كبريت | قصة السليط').slice(0, 3), ['قصة السليط', FILM, 'film']);
});

test('ar-show: "Episode | Show" (New Media seasons 3-8) in the season playlists, which give the season', () => {
  const s3 = 'الدحيح - الموسم الثالث - الحلقات الكاملة';
  assert.deepEqual(parse(NM, 'الحساسية | الدحيح', s3), ['الدحيح', 'الحساسية', 'series', null, 3]);
  assert.deepEqual(parse(NM, 'Oppenheimer | الدحيح', s3).slice(0, 2), ['الدحيح', 'Oppenheimer']);
  const s4 = 'الدحيح - الموسم الرابع - الحلقات الكاملة';
  assert.deepEqual(parse(NM, 'فلسطين .. حكاية الأرض | الدحيح | Palestine .. a Tale of Land', s4), ['الدحيح', 'فلسطين .. حكاية الأرض | Palestine .. a Tale of Land', 'series', null, 4]);
  assert.deepEqual(parse(NM, 'كريستيانو رونالدو - الجزء التاني | الدحيح', s4).slice(0, 2), ['الدحيح', 'كريستيانو رونالدو - الجزء التاني']);
  // Season 1 still wrote "Show | Episode"; the playlist names the show either way.
  assert.deepEqual(parse(NM, 'الدحيح | تشارلي شابلن', 'الدحيح - الموسم الأول - الحلقات الكاملة'), ['الدحيح', 'تشارلي شابلن', 'series', null, 1]);
  // An episode named like another programme is still the playlist's.
  assert.deepEqual(parse(NM, 'روح | الدحيح', 'الدحيح - الموسم الثامن - الحلقات الكاملة'), ['الدحيح', 'روح', 'series', null, 8]);
  assert.deepEqual(parse(NM, 'المدينة التي صنعت المستحيل | روح', 'برنامج روح'), ['روح', 'المدينة التي صنعت المستحيل', 'series', null, null]);
  // Museum of The Future: "!الدحيح" is the Daheeh.
  assert.deepEqual(parse(MOTF, '!الدحيح | كمبيوترات حية', 'الدحيح').slice(0, 2), ['الدحيح', 'كمبيوترات حية']);
});

test('ar-show: an episode titled with emoji only keeps it ("😂 | الدحيح", New Media season 4)', () => {
  const s4 = 'الدحيح - الموسم الرابع - الحلقات الكاملة';
  assert.deepEqual(parse(NM, '😂 | الدحيح', s4), ['الدحيح', '😂', 'series', null, 4]);
  assert.deepEqual(parse(NM, '😂 | الدحيح', null, { showNames: new Map([['الدحيح', 300]]) }).slice(0, 3), ['الدحيح', '😂', 'series']);
  // Symbols that are no pictographs are still dropped with the brands; a digit title is a title.
  assert.deepEqual(parse(NM, '01110011 01110100 | الدحيح', s4).slice(0, 2), ['الدحيح', '01110011 01110100']);
  assert.deepEqual(parse(NM, 'نيو ميديا | الدحيح | ليه', s4).slice(0, 2), ['الدحيح', 'ليه']);
});

test('ar-show: outside a show playlist, the channel\'s recurring programme names (arShowNames) pick the side', () => {
  const uploads = [
    'استقلال الجزائر | الدحيح', 'العبودية | الدحيح ', 'تاريخ الإعدام | الدحيح', 'البورصة | الدحيح', 'كيف تصبح قرصان؟ | الدحيح',
    'المدينة التي صنعت المستحيل | روح', 'ما سرّ مدينة الألف نافذة في ألبانيا؟ | روح', 'تنزانيا.. أرض العجائب الإفريقية | روح',
    'كيف ممكن ينتهي كل شيء؟ | كوانتوبيديا', 'أغرب برهان في تاريخ الرياضيات | كوانتوبيديا', 'هل الارض مسطحة؟ | كوانتوبيديا',
    'نيو ميديا | ظنّوا أنها مجرد منافسة...', 'نيو ميديا | 700 ألف دولار أسبوعياً', 'نيو ميديا | خلف الكواليس',
  ];
  const names = arShowNames(uploads, NM.brands);
  assert.deepEqual([...names.keys()].sort(), ['الدحيح', 'روح', 'كوانتوبيديا'], 'brands and episode titles do not count');
  assert.equal(names.get('الدحيح'), 5);
  // Without the names "Episode | Show" with two short sides reads the first as the show; with them it is right.
  assert.equal(parse(NM, 'استقلال الجزائر | الدحيح')[0], 'استقلال الجزائر');
  assert.deepEqual(parse(NM, 'استقلال الجزائر | الدحيح', null, { showNames: names }).slice(0, 2), ['الدحيح', 'استقلال الجزائر']);
  assert.deepEqual(parse(NM, 'العبودية | الدحيح ', null, { showNames: names }).slice(0, 2), ['الدحيح', 'العبودية']);
  assert.deepEqual(parse(NM, 'رحلة المَجد من لؤلؤة الخليج إلى عاصمة الثقافة الإسلامية | روح', null, { showNames: names }).slice(0, 2), ['روح', 'رحلة المَجد من لؤلؤة الخليج إلى عاصمة الثقافة الإسلامية']);
  // AJ+ "Show - Episode" titles count too; a Set of names works as well as the Map.
  const aj = arShowNames(['الدحيح - البوس', 'الدحيح - إنت جامد', 'الدحيح | أدب ضد الحروب', 'الجهبذ | المندسون'], AJ.brands);
  assert.deepEqual([...aj], [['الدحيح', 3]]);
  assert.deepEqual(parse(AJ, 'الدحيح - ليلة سقوط الواقع', null, { showNames: new Set(['الدحيح']) }).slice(0, 2), ['الدحيح', 'ليلة سقوط الواقع']);
});

test('ar-show playlists: the programme and its season ("- الحلقات الكاملة" and "برنامج" dropped)', () => {
  assert.deepEqual(arShowPlaylist('الدحيح - الموسم الثامن - الحلقات الكاملة'), { name: 'الدحيح', season: 8 });
  assert.deepEqual(arShowPlaylist('الدحيح-الموسم الثاني'), { name: 'الدحيح', season: 2 });
  assert.deepEqual(arShowPlaylist('برنامج روح'), { name: 'روح', season: null });
  assert.deepEqual(arShowPlaylist('السليط الإخباري 2024'), { name: 'السليط الإخباري', season: null });
  assert.deepEqual(arShowPlaylist('"السليط الإخباري "الموسم الخامس'), { name: 'السليط الإخباري', season: 5 });
  assert.deepEqual(arShowPlaylist('موسم الهجرة إلى الشمال'), { name: 'موسم الهجرة إلى الشمال', season: null }, 'an unnumbered "موسم" is part of the name');
  assert.deepEqual(arShowPlaylist('AJ+ كبريت', AJ.brands), { name: '', season: null });
  assert.equal(arShowName('!الدحيح'), 'الدحيح');
  assert.equal(arShowName('المُخبر الاقتصادي+'), 'المُخبر الاقتصادي+');
  assert.equal(playlistShowName('الدحيح - الموسم الثالث - الحلقات الكاملة', NM), 'الدحيح');
  assert.equal(playlistShowName('برنامج روح', NM), 'روح');
});

// ---- 'ar-films' -------------------------------------------------------------------------------

test('ar-films: label segments are dropped, the descriptive subtitle stays in the film title', () => {
  const cases = [
    [TRAVEL, 'تشوكوتكا: الحياة في أكثر مناطق روسيا قسوةً وعزلةً | فيلم وثائقي عن السفر بدقة 4K', 'تشوكوتكا: الحياة في أكثر مناطق روسيا قسوةً وعزلةً'],
    [TRAVEL, 'الحياة في ليسوتو | كيف يعيش الناس في "المملكة فوق السحاب" الوحيدة في إفريقيا | فيلم وثائقي بدقة 4K', 'الحياة في ليسوتو | كيف يعيش الناس في "المملكة فوق السحاب" الوحيدة في إفريقيا'],
    [TRAVEL, 'الحياة في القارة القطبية الجنوبية | كيف يعيش الناس في أبرد مكان على وجه الأرض | وثائقي سفر بدقة 4K', 'الحياة في القارة القطبية الجنوبية | كيف يعيش الناس في أبرد مكان على وجه الأرض'],
    [TRAVEL, 'منغوليا | كيف يعيش الناس في "أقل دول العالم كثافة سكانية"؟ | وثائقي 4K', 'منغوليا | كيف يعيش الناس في "أقل دول العالم كثافة سكانية"؟'],
    [TRAVEL, 'نيبال: الحياة "المستحيلة" في الهيمالايا قبل الفيضان المفاجئ المدمر | 4K', 'نيبال: الحياة "المستحيلة" في الهيمالايا قبل الفيضان المفاجئ المدمر'],
    [ODYSSEY, 'واشنطن: كيف يعيش الناس بين إمبراطورية تكنولوجية وبرية جامحة | دقة 4K', 'واشنطن: كيف يعيش الناس بين إمبراطورية تكنولوجية وبرية جامحة'],
    [ODYSSEY, 'عجائب المجر - ما الذي يجعل المجر مذهلة للعالم؟ - 4K', 'عجائب المجر - ما الذي يجعل المجر مذهلة للعالم؟'],
    [ODYSSEY, 'يوتا – السر وراء أغرب مناظر الصخور الحمراء في أمريكا – فيلم وثائقي سياحي بدقة 4K', 'يوتا – السر وراء أغرب مناظر الصخور الحمراء في أمريكا'],
    [ODYSSEY, 'العيش في إيطاليا 🇮🇹 | حقيقة الحياة في الدولة الأكثر حبًا في العالم | دقة 4K', 'العيش في إيطاليا | حقيقة الحياة في الدولة الأكثر حبًا في العالم'],
    [ODYSSEY, 'نيوزيلندا | جنة خفية في نهاية العالم | سافر بجودة 4K', 'نيوزيلندا | جنة خفية في نهاية العالم'],
    [AFAQ, 'هاواي  أخطر جنة على هذا الكوكب  فيلم وثائقي للسفر بدقة 4K', 'هاواي أخطر جنة على هذا الكوكب'],
    [AFAQ, 'عجائب ميشيغان | الأماكن المخفية التي لا يتحدث عنها أحد | فيديو سفر 2026', 'عجائب ميشيغان | الأماكن المخفية التي لا يتحدث عنها أحد'],
    [AFAQ, 'حياة السكان حول بحيرة كيفو | الكونغو الغامضة | وثائقي اجتماعي', 'حياة السكان حول بحيرة كيفو | الكونغو الغامضة'],
    [WEST, 'كيف أصبح الجيش النازي أقوى جيش في أوروبا؟ فيلم وثائقي كامل', 'كيف أصبح الجيش النازي أقوى جيش في أوروبا؟'],
    [WEST, 'الحرب العراقية الكويتية.. الغزو العراقي للكويت فيلم وثائقي كامل | الغرب الوثائقية', 'الحرب العراقية الكويتية.. الغزو العراقي للكويت'],
    [WEST, 'القائد خطاب المقاتل الذي هز عرش الروس | فيلم وثائقي كامل .. الغرب الوثائقية', 'القائد خطاب المقاتل الذي هز عرش الروس'],
    [WEST, 'معركة أمريكا مع الجليد: أسرار الإمداد البحري في القطب الشمالي| وثائقي مدبلج', 'معركة أمريكا مع الجليد: أسرار الإمداد البحري في القطب الشمالي'],
    [WEST, 'فيلم وثائقي كامل: لماذا هتلر كان يكره اليهود؟ الغرب الوثائقية', 'لماذا هتلر كان يكره اليهود؟'],
    [WEST, 'الفيلم الوثائقي .. سقوط الجيش الأحمر: القوة الأعظم في القرن الماضي | الغرب الوثائقية', 'سقوط الجيش الأحمر: القوة الأعظم في القرن الماضي'],
    [WEST, 'سقوط فرنسا الفيلم الوثائقي الكامل كيف سيطر هتلر على فرنسا واجتاح قلب أوروبا', 'سقوط فرنسا | كيف سيطر هتلر على فرنسا واجتاح قلب أوروبا'],
    [WEST, 'وثائقي برلين 1945: من مدينة مدمّرة إلى رمز لوحدة ألمانيا وسقوط الشيوعية | الغرب الوثائقية', 'برلين 1945: من مدينة مدمّرة إلى رمز لوحدة ألمانيا وسقوط الشيوعية'],
    [WEST, 'أضخم المشاريع تحت الماء التي غيّرت عالم الهندسة | عمالقة الهندسة الغرب الوثائقية', 'أضخم المشاريع تحت الماء التي غيّرت عالم الهندسة | عمالقة الهندسة'],
    [WEST, 'كيف انتحر هتلر في ثلوج روسيا؟ السر الحقيقي وراء "عملية بارباروسا" وخيانة ستالين! ❄️', 'كيف انتحر هتلر في ثلوج روسيا؟ السر الحقيقي وراء "عملية بارباروسا" وخيانة ستالين!'],
    [HAYAH, 'وثائقي أورشليم من البداية للنهاية', 'أورشليم من البداية للنهاية'],
  ];
  for (const [src, title, show] of cases) assert.deepEqual(parse(src, title).slice(0, 3), [show, FILM, 'film'], title);
});

test('ar-films: what only looks like a label stays ("فيلم العدوان", "الوثائقي الذي يكشف", "وثائقي يكشف"); a censored pipe is no separator', () => {
  const keep = [
    [WEST, 'فيلم العدوان: كيف أشعل هتلر نار الحرب العالمية الثانية؟ | أسرار الغزو وسقوط فرنسا ومعركة بريطانيا', 'العدوان: كيف أشعل هتلر نار الحرب العالمية الثانية؟ | أسرار الغزو وسقوط فرنسا ومعركة بريطانيا'],
    [WEST, 'هل كان الهبوط على القمر حقيقياً؟ وثائقي يكشف كواليس مهمة ناسا', 'هل كان الهبوط على القمر حقيقياً؟ وثائقي يكشف كواليس مهمة ناسا'],
    [ASRAR, 'الوثائقي الذي يكشف أسطورة كليب والزير سالم… بالأدلة والنقوش!', 'الوثائقي الذي يكشف أسطورة كليب والزير سالم… بالأدلة والنقوش!'],
    [ASRAR, 'نبوءة أشعياء.. بدأت تحققها إسر|ئيل بالحرف؟ تدمير إيران هو البداية فقط!', 'نبوءة أشعياء.. بدأت تحققها إسر|ئيل بالحرف؟ تدمير إيران هو البداية فقط!'],
    [WEST, 'أفقر 10 دول على وجه الأرض.. دول تعيش في قاع الفقر | الغرب الوثائقية', 'أفقر 10 دول على وجه الأرض.. دول تعيش في قاع الفقر'],
    [HAYAH, 'العراق لا هي شامية ولا خليجية.. فما هويتها؟ ولماذا لم تنضم لمجلس التعاون الخليجي؟', 'العراق لا هي شامية ولا خليجية.. فما هويتها؟ ولماذا لم تنضم لمجلس التعاون الخليجي؟'],
    [WEST, 'قصة الحرب الهندية الباكستانية الكاملة – وثائقي يكشف أخطر المواجهات العسكرية في آسيا', 'قصة الحرب الهندية الباكستانية الكاملة – وثائقي يكشف أخطر المواجهات العسكرية في آسيا'],
  ];
  for (const [src, title, show] of keep) assert.deepEqual(parse(src, title).slice(0, 3), [show, FILM, 'film'], title);
  // A noun or a name starting with "ي" is no verb: the label before it goes.
  assert.deepEqual(parse(HAYAH, 'وثائقي يهود المغرب وعلاقتهم بإسرائيل').slice(0, 3), ['يهود المغرب وعلاقتهم بإسرائيل', FILM, 'film']);
  assert.deepEqual(parse(HAYAH, 'فيلم وثائقي يوسف بن تاشفين').slice(0, 3), ['يوسف بن تاشفين', FILM, 'film']);
  for (const label of ['فيلم وثائقي عن السفر بدقة 4K', 'وثائقي سفر بدقة 4K', 'وثائقي 4K', 'دقة 4K', '4K', 'فيلم وثائقي كامل', 'وثائقي مدبلج', 'دليل سياحي بدقة 4K', 'فيديو سفر 2026', 'الفيلم الوثائقي الكامل']) {
    assert.equal(isFilmLabel(label), true, label);
  }
  for (const text of ['دليل السفر إلى الولايات المتحدة', 'عمالقة الهندسة', '2026', 'عن', 'رحلة إلى إثيوبيا']) assert.equal(isFilmLabel(text), false, text);
  assert.deepEqual(arFilmSegments('أفقر 10 دول على وجه الأرض.. دول تعيش في قاع الفقر | الغرب الوثائقية', WEST.brands), ['أفقر 10 دول على وجه الأرض.. دول تعيش في قاع الفقر']);
});

test('ar-films: numbered titles are episodes of the series they name; "(جزء N)" too', () => {
  assert.deepEqual(parse(ASRAR, 'ملوك اليمن القديم(16) سيف بن ذي يزن: الملحمة اليمنية التي غيّرت تاريخ الجزيرة العربية!').slice(0, 4),
    ['ملوك اليمن القديم', 'سيف بن ذي يزن: الملحمة اليمنية التي غيّرت تاريخ الجزيرة العربية!', 'series', 16]);
  assert.deepEqual(parse(ASRAR, 'ملوك اليمن القديم7 | الحارث الرائش.. كيف أسس مملكة التبابعة العظيمة؟ (جزء1)').slice(0, 4),
    ['ملوك اليمن القديم', 'الحارث الرائش.. كيف أسس مملكة التبابعة العظيمة؟ (جزء1)', 'series', 7]);
  assert.deepEqual(parse(ASRAR, 'تاريخ الفينيقيين 3 | الصلة الخفية بين سبأ وكنعان ومعارك رعمسيس | أسرار القرن 12 قبل الميلاد').slice(0, 4),
    ['تاريخ الفينيقيين', 'الصلة الخفية بين سبأ وكنعان ومعارك رعمسيس | أسرار القرن 12 قبل الميلاد', 'series', 3]);
  assert.deepEqual(parse(ASRAR, 'وثائقي صادم: تاريخ الأمازيغ (1) | الرحلة المنسية للأمازيغ عبر التاريخ!').slice(0, 4), ['تاريخ الأمازيغ', 'الرحلة المنسية للأمازيغ عبر التاريخ!', 'series', 1]);
  assert.deepEqual(parse(ASRAR, 'وثائقي: تاريخ الأمازيغ (جزء 2) | الرحلة المنسية للأمازيغ عبر التاريخ!').slice(0, 4), ['تاريخ الأمازيغ', 'الرحلة المنسية للأمازيغ عبر التاريخ!', 'series', 2]);
  // A "#سلسلة_X (N)" hashtag names the series and the number; the channel's name after it is dropped.
  assert.deepEqual(parse(ASRAR, 'غموض الأحلام: كيف يصنع الدماغ أحلامنا؟ #سلسلة_عالم_الملكوت (3) | أسرار خفية').slice(0, 4), ['عالم الملكوت', 'غموض الأحلام: كيف يصنع الدماغ أحلامنا؟', 'series', 3]);
  assert.deepEqual(parse(ASRAR, 'كيف يعرف "الشيطان" ما نفكر فيه؟؟  #سلسلة_عالم_الملكوت(2). | أسرار خفية').slice(0, 4), ['عالم الملكوت', 'كيف يعرف "الشيطان" ما نفكر فيه؟؟', 'series', 2]);
  assert.deepEqual(parse(ASRAR, 'اليمن حضارة قديمة تسبق الفراعنة والآشوريين | #سلسلة_تاريخ_اليمن (1).').slice(0, 4), ['تاريخ اليمن', 'اليمن حضارة قديمة تسبق الفراعنة والآشوريين', 'series', 1]);
  // A count in a sentence is no episode number.
  for (const t of ['أقوى 9 جيوش عربية في 2026.. من يعتلي عرش القوة؟', 'أكبر 10 دول منتجة للألومنيوم في العالم: حقائق مذهلة وحضور عربي قوي!', 'الوحدة 731: أخطر تجارب البشر في التاريخ | وثائقي']) {
    assert.equal(parse(WEST, t)[2], 'film', t);
  }
});

test('ar-films: a war or an event numbered by its year or its ordinal is a film, not a numbered series', () => {
  // Hayah's "حرب أكتوبر" playlist (34 films) and titles like "أكتوبر 73: …" make such titles natural there.
  for (const t of ['حرب أكتوبر 73 | القصة الكاملة', 'الحرب العالمية 2 | كيف بدأت؟', 'الحرب العالمية2: كيف بدأت؟', 'نكسة 67 | ماذا حدث؟',
    'حرب الخليج (2) | عاصفة الصحراء', 'ثورة 25 يناير | الأيام الثمانية عشر', 'معركة حطين 1187 | يوم استرداد القدس']) {
    assert.deepEqual(parse(HAYAH, t).slice(0, 4), [t, FILM, 'film', null], t);
  }
  // A bare number before the " | " is an episode's only when small enough to be one.
  assert.deepEqual(parse(HAYAH, 'الجيش المصري 73 | القصة الكاملة').slice(0, 4), ['الجيش المصري 73 | القصة الكاملة', FILM, 'film', null]);
  // A "جزء" / "حلقة" marker says episode, whatever the name.
  assert.deepEqual(parse(HAYAH, 'الحرب العالمية (الجزء 2) | كيف بدأت؟').slice(0, 4), ['الحرب العالمية', 'كيف بدأت؟', 'series', 2]);
  assert.deepEqual(parse(HAYAH, 'الحرب الباردة (الحلقة 3) | أزمة الصواريخ الكوبية').slice(0, 4), ['الحرب الباردة', 'أزمة الصواريخ الكوبية', 'series', 3]);
  // In a series playlist the unrelated year is not the episode's number either; a numbered title of
  // another name still gives its number ("تاريخ البربر الأمازيغ(4) …" in "سلسلة #تاريخ_الأمازيغ", real).
  const series = (src, playlist, title) => parse(src, title, playlist, { playlistSeries: true }).slice(0, 4);
  assert.deepEqual(series(HAYAH, 'وثائقي مصر في عهد السادات', 'حرب أكتوبر 73 | القصة الكاملة'), ['مصر في عهد السادات', 'حرب أكتوبر 73 | القصة الكاملة', 'series', null]);
  const berber = series(ASRAR, 'سلسلة #تاريخ_الأمازيغ', 'تاريخ البربر الأمازيغ(4) الكذبة الكبرى لتأسيس قرطاج.. كيف تم تزوير التاريخ؟');
  assert.deepEqual([berber[0], berber[2], berber[3]], ['تاريخ الأمازيغ', 'series', 4]);
  // Such titles do not make a topic playlist a series.
  assert.equal(arFilmsPlaylistIsSeries('حرب أكتوبر', ['حرب أكتوبر 73 | القصة الكاملة', 'أكتوبر 73: العبور والثغرة.. الروايات الممنوعة في صدام السادات والشاذلي', 'القصة الكاملة لمنسِيّين أكتوبر 1973 وليه محدش سمع عنهم'], HAYAH.brands), false);
});

test('ar-films playlists: series names, and series told from topic collections by their titles', () => {
  assert.equal(arFilmsPlaylistName('سلسلة #ملوك_اليمن_القديم'), 'ملوك اليمن القديم');
  assert.equal(arFilmsPlaylistName('سلسلة #تاريخ_الأمازيغ'), 'تاريخ الأمازيغ');
  assert.equal(arFilmsPlaylistName('الوعد المزعوم | سلسلة تبحث في أصل اليهود من بداية ظهورهم حتى اليوم'), 'الوعد المزعوم');
  assert.equal(arFilmsPlaylistName('سلسلة الملوك التبابعة (ملوك اليمن السبعين)'), 'الملوك التبابعة');
  assert.equal(arFilmsPlaylistName('وثائقي مصر في عهد السادات'), 'مصر في عهد السادات');
  assert.equal(arFilmsPlaylistName('Nepal - نيبال'), 'نيبال');
  assert.equal(arFilmsPlaylistName('روسيا و العالم 🇷🇺'), 'روسيا و العالم');
  assert.equal(arFilmsPlaylistName('فيلم وثائقي عن السفر حول العالم'), '', 'what the films are about names no series');
  assert.equal(playlistShowName('سلسلة #ملوك_اليمن_القديم', ASRAR), 'ملوك اليمن القديم');
  // "سلسلة …" says so.
  assert.equal(arFilmsPlaylistIsSeries('سلسلة #ملوك_اليمن_القديم', [], ASRAR.brands), true);
  // Episode markers in most titles (Hayah's "قصص القرآن…", 10 videos).
  const quran = ['الحلقة الثامنة ماحدث للسامري صانع العجل الذي عبدته بني إسرائيل من قصص القرآن', 'الحلقة الاولى قصة سيدنا آدم عليه السلام كاملة من الخلق إلى نزوله على الأرض من قصص القرآن',
    'الحلقة الثانية أبناء آدم: كيف تزوجوا ولماذا قتل قابيل أخاه؟ قصص القرآن', 'الحلقة الخامسة من الذي بنى الكعبة المشرفة أول مرة؟ القصة الكاملة من البداية'];
  assert.equal(arFilmsPlaylistIsSeries('قصص القرآن… أعظم الحكايات التي غيّرت التاريخ', quran, HAYAH.brands), true);
  // Series hashtags in most titles (أسرار خفية's "عالم الملكوت", 5 videos).
  const malakut = ['غموض الأحلام: كيف يصنع الدماغ أحلامنا؟ #سلسلة_عالم_الملكوت (3) | أسرار خفية', 'كيف يعرف "الشيطان" ما نفكر فيه؟؟  #سلسلة_عالم_الملكوت(2). | أسرار خفية',
    'البُعد الذي يتجاوز حدود العقل! تعريف #سلسلة_عالم_الملكوت | أسرار خفية', 'مفتاح سر الكون , سِرُّ الـكـاف والنون, #سلسلة_عالم_الملكوت (1).', 'أسرار شيطان الجنـ.ـس؟ كيف يثير الشيطان شهوة الإنسان؟'];
  assert.equal(arFilmsPlaylistIsSeries('عالم الملكوت', malakut, ASRAR.brands), true);
  assert.deepEqual(parse(ASRAR, malakut[4], 'عالم الملكوت', { playlistSeries: true }).slice(0, 3), ['عالم الملكوت', 'أسرار شيطان الجنـ.ـس؟ كيف يثير الشيطان شهوة الإنسان؟', 'series']);
  // Topic collections: Hayah's "العراق" (48 videos) and "مصر في عهد جمال عبد الناصر" (27) hold standalone films.
  const iraq = ['قصي وعدي صدام حسين', 'صدام حسين مهيب الركن من بائع بطيخ إلى رئيس العراق', 'حقيقة كشف صدام حسين لخيانة حافظ الأسد وبيعه للجولان', 'سوق بيع النساء في العراق', 'يهود العراق وعلاقتهم بإسرائيل'];
  assert.equal(arFilmsPlaylistIsSeries('العراق', iraq, HAYAH.brands), false);
  const nasser = ['أسرار تجنيد الفنانات أيام عبد الناصر على ايد صلاح نصر وصفوت الشريف', 'حرب اليمن أسوء ما قام به جمال عبد الناصر في حق الجيش المصري', 'الرئيس جمال عبد الناصر بطل قومي أم فاشل', 'وثائقي حال المصريين في عهد جمال عبد الناصر'];
  assert.equal(arFilmsPlaylistIsSeries('مصر في عهد جمال عبد الناصر', nasser, HAYAH.brands), false);
  assert.equal(arFilmsPlaylistIsSeries('أفلام وثائقية مدبلجة', ['معركة أمريكا مع الجليد: أسرار الإمداد البحري في القطب الشمالي| وثائقي مدبلج'], WEST.brands), false);
});

test('ar-films: in a series playlist a video is an episode, without the series name and the episode markers', () => {
  const series = (src, playlist, title) => parse(src, title, playlist, { playlistSeries: true }).slice(0, 4);
  assert.deepEqual(series(ASRAR, 'سلسلة #ملوك_اليمن_القديم', 'ملوك اليمن القديم(13) بلقيس ملكة سبأ: أعظم ملكة في التاريخ.. لماذا خاف منها الجميع؟'),
    ['ملوك اليمن القديم', 'بلقيس ملكة سبأ: أعظم ملكة في التاريخ.. لماذا خاف منها الجميع؟', 'series', 13]);
  assert.deepEqual(series(ASRAR, 'سلسلة #تاريخ_الأمازيغ', 'وثائقي: تاريخ الأمازيغ (جزء 2) | الرحلة المنسية للأمازيغ عبر التاريخ!'),
    ['تاريخ الأمازيغ', 'الرحلة المنسية للأمازيغ عبر التاريخ!', 'series', 2]);
  assert.deepEqual(series(ASRAR, 'سلسلة #تاريخ_اليمن القديم من بعد الطوفان إلى اليوم', 'اليمنيون في عصر النبوة والخلافة: أبطال الإسلام الأوائل | #سلسلة_تاريخ_اليمن (7)'),
    ['تاريخ اليمن القديم من بعد الطوفان إلى اليوم', 'اليمنيون في عصر النبوة والخلافة: أبطال الإسلام الأوائل', 'series', 7]);
  assert.deepEqual(series(ASRAR, 'الوعد المزعوم | سلسلة تبحث في أصل اليهود من بداية ظهورهم حتى اليوم', 'كيف بدأ أصل اليهود من إبراهيم إلى يعقوب؟'),
    ['الوعد المزعوم', 'كيف بدأ أصل اليهود من إبراهيم إلى يعقوب؟', 'series', null]);
  assert.deepEqual(series(HAYAH, 'قصة سيدنا محمد ﷺ كاملة - السيرة النبوية', 'هجرة سيدنا محمد ﷺ إلى المدينة المنورة يثرب الحلقة ١٢ : مسلسل السيرة النبوية'),
    ['قصة سيدنا محمد ﷺ كاملة - السيرة النبوية', 'هجرة سيدنا محمد ﷺ إلى المدينة المنورة يثرب', 'series', 12]);
  assert.deepEqual(series(HAYAH, 'قصص القرآن… أعظم الحكايات التي غيّرت التاريخ', 'الحلقة الثامنة ماحدث للسامري صانع العجل الذي عبدته بني إسرائيل من قصص القرآن'),
    ['قصص القرآن… أعظم الحكايات التي غيّرت التاريخ', 'ماحدث للسامري صانع العجل الذي عبدته بني إسرائيل من قصص القرآن', 'series', 8]);
  // A playlist the catalogue does not call a series gives no context: the video stays a film.
  assert.deepEqual(parse(HAYAH, 'قصي وعدي صدام حسين', 'العراق', { playlistSeries: false }).slice(0, 3), ['قصي وعدي صدام حسين', FILM, 'film']);
});

test('ar-films: "Show | الحلقة N: title" episodes lose the series name and the marker wherever they sit', () => {
  const PL = 'وثائقي مصر في عهد السادات';
  const sadat = (title) => parse(HAYAH, title, PL, { playlistSeries: true }).slice(0, 4);
  assert.deepEqual(sadat('مصر في عهد السادات | الحلقة 3: حرب أكتوبر'), ['مصر في عهد السادات', 'حرب أكتوبر', 'series', 3]);
  assert.deepEqual(sadat('مصر في عهد السادات | الحلقة 3 | حرب أكتوبر'), ['مصر في عهد السادات', 'حرب أكتوبر', 'series', 3]);
  assert.deepEqual(sadat('مصر في عهد السادات | حرب أكتوبر'), ['مصر في عهد السادات', 'حرب أكتوبر', 'series', null]);
  assert.deepEqual(sadat('حرب أكتوبر | مصر في عهد السادات'), ['مصر في عهد السادات', 'حرب أكتوبر', 'series', null]);
  assert.deepEqual(sadat('مصر في عهد السادات | الحلقة 3'), ['مصر في عهد السادات', 'الحلقة 3', 'series', 3]);
  assert.deepEqual(sadat('مصر في عهد السادات: الحلقة 3: حرب أكتوبر'), ['مصر في عهد السادات', 'حرب أكتوبر', 'series', 3]);
  // "الحلقة 1000" is no episode marker of a segment.
  assert.deepEqual(sadat('مصر في عهد السادات | الحلقة 1000'), ['مصر في عهد السادات', 'الحلقة 1000', 'series', null]);
  // These very titles make the playlist a series, so the catalogue files them this way.
  const titles = ['مصر في عهد السادات | الحلقة 1: الوصول إلى الحكم', 'مصر في عهد السادات | الحلقة 2: تصحيح ثورة', 'مصر في عهد السادات | كامب ديفيد'];
  assert.equal(arFilmsPlaylistIsSeries(PL, titles, HAYAH.brands), true);
  const src = { ...HAYAH, type: 'channel', lang: 'ar' };
  const videos = titles.map((title, i) => ({ id: `sadat0000${i}1`, title }));
  const details = Object.fromEntries(videos.map((v) => [v.id, { durationSec: 1800, title: v.title }]));
  const catalog = buildCatalog({ sources: [src], playlists: { PLsadat: { id: 'PLsadat', sourceId: src.id, title: PL, videos } }, details, seen: {}, overrides: {} });
  const show = catalog.shows.find((s) => s.channel.id === src.id && s.title === 'مصر في عهد السادات');
  assert.ok(show, catalog.shows.map((s) => s.title).join(', '));
  assert.deepEqual(show.episodes.map((e) => [e.title, e.number]).sort(), [['الوصول إلى الحكم', 1], ['تصحيح ثورة', 2], ['كامب ديفيد', null]].sort());
});

// ---- the catalogue ------------------------------------------------------------------------------

test('buildCatalog: the Daheeh\'s playlists of AJ+ كبريت and New Media give the show, its seasons and its episodes', () => {
  const vid = (s) => s.padEnd(11, '_').slice(0, 11);
  const ajSrc = { ...AJ, type: 'channel', lang: 'ar' };
  const nmSrc = { ...NM, type: 'channel', lang: 'ar' };
  const playlists = {
    PLaj: { id: 'PLaj', sourceId: ajSrc.id, title: 'الجهبذ', videos: [{ id: vid('jah1'), title: 'الجهبذ | لماذا ينتفض شباب أوروبا؟' }, { id: vid('jah2'), title: 'كم كان دين سوريا عند وفاة حافظ الأسد؟' }] },
    PLnm3: { id: 'PLnm3', sourceId: nmSrc.id, title: 'الدحيح - الموسم الثالث - الحلقات الكاملة', videos: [{ id: vid('nm31'), title: 'الحساسية | الدحيح' }, { id: vid('nm32'), title: 'الهاكر | الدحيح' }] },
    PLnm8: { id: 'PLnm8', sourceId: nmSrc.id, title: 'الدحيح - الموسم الثامن - الحلقات الكاملة', videos: [{ id: vid('nm81'), title: 'منابع النيل | الدحيح' }] },
  };
  const details = Object.fromEntries(Object.values(playlists).flatMap((p) => p.videos).map((v) => [v.id, { durationSec: 1800, title: v.title }]));
  const catalog = buildCatalog({ sources: [ajSrc, nmSrc], playlists, details, seen: {}, overrides: {} });
  const show = (channel, title) => catalog.shows.find((s) => s.channel.id === channel && s.title === title);
  const jahbaz = show(ajSrc.id, 'الجهبذ');
  assert.ok(jahbaz, catalog.shows.map((s) => s.title).join(', '));
  assert.deepEqual(jahbaz.episodes.map((e) => e.title).sort(), ['كم كان دين سوريا عند وفاة حافظ الأسد؟', 'لماذا ينتفض شباب أوروبا؟'].sort());
  const daheeh = show(nmSrc.id, 'الدحيح');
  assert.ok(daheeh, catalog.shows.map((s) => s.title).join(', '));
  assert.deepEqual(daheeh.episodes.map((e) => [e.title, e.season]).sort(), [['الحساسية', 3], ['الهاكر', 3], ['منابع النيل', 8]].sort());
});
