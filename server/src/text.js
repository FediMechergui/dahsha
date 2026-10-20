// Arabic-aware text utilities: normalization, per-channel title parsing, duration parsing,
// description cleaning.

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

export function normalizeArabic(s = '') {
  return String(s)
    .replace(TASHKEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Stable short hash (for ids) - djb2 in base36
export function shortHash(s = '') {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function parseDuration(text) {
  if (!text) return 0;
  const parts = String(text).trim().split(':').map((p) => parseInt(p, 10));
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export const hasArabic = (s = '') => /[؀-ۿ]/.test(s);

// ---------------------------------------------------------------------------------------------
// HTML entities and display titles
// ---------------------------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', laquo: '«', raquo: '»', prime: '′', Prime: '″',
  times: '×', divide: '÷', middot: '·', bull: '•', deg: '°', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£',
  lrm: '‎', rlm: '‏', zwnj: '‌', zwj: '‍',
  aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä', atilde: 'ã', aring: 'å', aelig: 'æ', ccedil: 'ç',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï', ntilde: 'ñ',
  oacute: 'ó', ograve: 'ò', ocirc: 'ô', ouml: 'ö', otilde: 'õ', oslash: 'ø', uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', yuml: 'ÿ', szlig: 'ß', oelig: 'œ',
  Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Auml: 'Ä', Ccedil: 'Ç', Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Iacute: 'Í', Ntilde: 'Ñ',
  Oacute: 'Ó', Ouml: 'Ö', Oslash: 'Ø', Uacute: 'Ú', Uuml: 'Ü', OElig: 'Œ',
};
// WordPress sometimes emits Windows-1252 code points as numeric entities (&#150; for an en dash).
const CP1252 = { 128: '€', 130: '‚', 132: '„', 133: '…', 139: '‹', 145: '‘', 146: '’', 147: '“', 148: '”', 150: '–', 151: '—', 153: '™', 155: '›' };

/** Decode named, decimal and hex HTML entities (twice, for double-encoded "&amp;#8230;"). */
export function decodeEntities(value) {
  if (value == null) return value;
  let s = String(value);
  for (let pass = 0; pass < 2 && s.includes('&'); pass++) {
    s = s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,15});/gi, (m, body) => {
      if (body[0] !== '#') return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : Object.hasOwn(NAMED_ENTITIES, body.toLowerCase()) ? NAMED_ENTITIES[body.toLowerCase()] : m;
      const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (CP1252[code]) return CP1252[code];
      if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || code < 32 || (code >= 127 && code < 160)) return code === 9 || code === 10 ? ' ' : m;
      return String.fromCodePoint(code);
    });
  }
  return s;
}

/**
 * Display title: entities decoded, stray markup and escaped quotes removed, whitespace collapsed.
 * Safe for provider titles too (no casing or wording changes).
 */
export function cleanTitle(value) {
  if (value == null) return value;
  return decodeEntities(value)
    .replace(/<\/?[a-z][^<>]*>/gi, ' ')
    .replace(/\\+(['"’])/g, '$1')
    .replace(/[\u0000-\u001f\u007f​﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Synopsis text: like cleanTitle but keeps line breaks and drops a WordPress "[…]" excerpt tail. */
export function cleanSynopsis(value) {
  if (!value) return '';
  return decodeEntities(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^<>]*>/gi, ' ')
    .replace(/\\+(['"’])/g, '$1')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f​﻿]/g, ' ')
    .replace(/\s*\[\s*(?:…|\.\.\.)\s*\]\s*$/u, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

// All-caps YouTube titles ("TOP 4 UNBELIEVABLE INSTANCES OF ALIENS") → display casing. Acronyms,
// Roman numerals, short unknown tokens (likely acronyms) and tokens with digits stay as they are.
const ACRONYMS = new Set(('NASA BBC WWII WWI WW2 WW1 USA UK DNA CIA FBI NFL NBA NHL MLB UFO UAP AI HBO CNN PBS NSA KGB MI5 MI6 ISIS NATO UN EU USSR '
  + 'LAPD NYPD DEA ATF IRS ISS SAS SWAT CEO LGBT LGBTQ HIV AIDS COVID DIY SOS VR TV DC NYC LA UAE JFK MLK IRA MMA UFC WWE NCAA GMO OMG '
  + 'IQ OCD PTSD ADHD VICE NYC SUV ATV GPS CGI DJ MC MVP NBC CBS ABC ESPN MTV IMAX NHS NYU MIT UCLA FDA EPA ICU ER CPR DUI KKK IRL '
  + 'BTS NCT K-POP CSI NCIS RAF RAAF USAF USMC SEAL SEALS OK').split(' '));
const SHORT_WORDS = new Set(('a an the and but or nor of in on at to for by with from vs via as up off out into onto over per than '
  + 'i is it its be am are was were has had do did does can may new old big top bad all any one two six ten our his her him she he we '
  + 'you who why how what when day war man men boy god law age air art ask buy car cat cop cow cry cut dad die dig dog dry due eat egg '
  + 'end era eye far fat few fix fly fun gap gas get got gun guy hat hey hit hot ice ill jet job joy key kid lab lay led leg let lie lit '
  + 'log lot low mad map mix mom mud net not now odd oil own pay pet pig pit pop pot put ran rat raw red rid row run sad saw say sea see '
  + 'set sit sky son spy sun tax tea tie tip toe too toy try use van wet win won yes yet zoo ant ape bee bug cub elk fox hen owl yak '
  + 'ark axe bay bow box fog fur hut ink inn lip nut pan pen pie rib rod rug sin tag tin tub vet wax wig wit aid aim bet bid bin bit cap '
  + 'den dot ear fan fee fit gem hug jaw lid mob nap pad pin rap ray rim rip rob rot rub sip sum tap tow wed so no my me if us go do oh '
  + 'way web who').split(' '));
const MINOR_WORDS = new Set('a an the and but or nor of in on at to for by with from vs via as per into onto over than up off out'.split(' '));
const isRoman = (w) => /^(?=[IVX]{2,4}$)X{0,3}(IX|IV|V?I{0,3})$/.test(w);

/**
 * Re-case a fully upper-case Latin title for display. Mixed-case titles, Arabic titles and titles with
 * fewer than 6 Latin letters are returned unchanged. `lang` 'fr' uses sentence case.
 */
export function tidyCase(title, { lang = 'en' } = {}) {
  if (!title || hasArabic(title)) return title;
  const s = String(title);
  if (/\p{Ll}/u.test(s)) return title;
  const letters = s.match(/\p{Lu}/gu) || [];
  if (letters.length < 6) return title;
  const words = s.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || [];
  if (!words.some((w) => w.length >= 4 && !/\d/.test(w) && !ACRONYMS.has(w.replace(/['’]S$/, '')))) return title;
  let first = true;
  return s.replace(/([^\s]+)/g, (token) => {
    const m = token.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}'’\-.&/_]*?)([^\p{L}\p{N}]*)$/u);
    if (!m) return token;
    const [, pre, word, post] = m;
    const atStart = first || /[:(\[|—–-]$/.test(pre);
    first = /[:|—–.!?]$/.test(post) || /^[—–-]$/.test(word);
    const base = word.replace(/['’]S$/, '');
    const lower = word.toLowerCase();
    // Unknown short tokens: two letters, or three without a vowel ("TFW", "MLK"), read as acronyms.
    const shortAcronym = !SHORT_WORDS.has(lower) && !SHORT_WORDS.has(base.toLowerCase()) && (word.length <= 2 || (word.length === 3 && !/[AEIOUY]/.test(word)));
    let out = word;
    if (/\d/.test(word) || /[./_&]/.test(word) || isRoman(word) || (ACRONYMS.has(base) && (lang !== 'fr' || word.length > 2))) out = word;
    // A plural acronym ("UFOS", "CEOS") keeps the acronym and a small s: "UFOs".
    else if (lang !== 'fr' && base.length >= 4 && base.endsWith('S') && ACRONYMS.has(base.slice(0, -1))) out = word.slice(0, base.length - 1) + 's' + word.slice(base.length);
    else if (lang === 'fr') out = atStart ? word[0] + word.slice(1).toLowerCase() : word.toLowerCase();
    else if (shortAcronym) out = word;
    else if (!atStart && MINOR_WORDS.has(word.toLowerCase())) out = word.toLowerCase();
    else out = word.toLowerCase().replace(/(^|[-])(\p{L})/gu, (x, sep, ch) => sep + ch.toUpperCase());
    return pre + out + post;
  });
}

// ---------------------------------------------------------------------------------------------
// Branding / generic playlists
// ---------------------------------------------------------------------------------------------

// A title segment that is just a channel name (not a show that merely mentions it).
const BRANDING = [
  /^((ناشونال|ناشيونال|ناشونل|نات)\s*(جيوغرافيك|جغرافيك|جيوغرافك|جيو)?(\s*(ابوظبي|ابو ظبي|ابو ضبي))?|nat\s*geo(\s*abu\s*dhabi)?|national\s*geographic(\s*abu\s*dhabi)?|ngad|قناة ناشونال جيوغرافيك ابوظبي)$/i,
  /^(الشرق\s*ديسكفري|ديسكفري\s*الشرق|asharq\s*discovery(\s*wildlife)?|discovery\s*الشرق|حياه بريه وطبيعه\s*discovery الشرق|الشرق\s*ديسكفري\s*وايلد\s*لايف)$/i,
  /^(وثايقيه\s*دي\s*دبليو|دي\s*دبليو|dw(\s*documentary)?(\s*arabic)?|dw\s*عربيه)$/i,
  /^(الجزيره\s*الوثايقيه|الجزيره|al\s*jazeera(\s*documentary)?|aj\s*documentary|aljazeera\s*documentary)$/i,
];
export function isBranding(part) {
  const n = normalizeArabic(part);
  return BRANDING.some((re) => re.test(n));
}

// Playlist names that are collections / events rather than shows.
const GENERIC_PLAYLIST = /(حلقات كاملة|حلقة كاملة|اليوم العالمي|يوم العالمي|يوم الأرض|يوم الارض|شهر |moments|مقاطع|الأكثر مشاهدة|الاكثر مشاهدة|أفضل |مميز|highlights|best of|full episodes|أسبوع |رمضان|عيد |^العلوم والتاريخ$|^الحياة البرية$|^وثائقيات$|^أفلام وثائقية|أفلام وثائقية متنوعة|متنوعة|#shorts|shorts|مختارات|مسابقة|الأحدث|أحدث |جديد القناة|^خلفيات |ترند|الأعلى مشاهدة|اخترنا لكم|__uploads__|^الجائزة|مهرجان|^أفلام (قصيرة|الطلبة|الطلاب)|الأكثر رواجاً|^جديد)/i;
// English collection playlists ("MEGA Episodes | National Geographic", "Nat Geo Animals Newest Videos",
// "Now Trending", "Livestreams", "Favorites"/"المفضلة"). Anchored so real series such as
// "Beyond the Spotlight" or "... | A National Geographic YouTube Original Series" stay shows.
const COLLECTION_PLAYLIST = /^(mega episodes?|livestreams?|live streams?|live|now trending|trending( videos| now)?|newest (videos|uploads?)|latest( videos| uploads?)?|recent( videos| uploads?)|new (videos|uploads)|documentary films|full documentaries|(web|disney\+) originals|welt spotlight|favou?rites|المفضلة)$|(newest videos|latest videos|newest uploads?|recent uploads|latest & greatest)$/i;
// The same collections behind a channel name: "National Geographic Documentary Films",
// "WELT Documentary - Livestreams", "WELT LIVESTREAM". Bare "Live" is left out so series such as
// "National Geographic Live!" stay shows.
const BRAND_COLLECTION = /^(documentary films|full (episodes|documentaries)|live ?streams?|mega episodes?|newest (videos|uploads?)|latest (videos|uploads?)|recent (videos|uploads?)|now trending|trending( videos)?|originals|favou?rites|spotlight)$/i;
function isCollectionName(part, brands = []) {
  const p = String(part).replace(/\s+/g, ' ').replace(/[!.]+$/, '').trim();
  if (COLLECTION_PLAYLIST.test(p)) return true;
  const words = p.split(' ');
  for (let k = 1; k < Math.min(words.length, 7); k++) {
    const rest = words.slice(k).join(' ').replace(/^[\s\-–—:]+/, '').trim();
    // A show named like a brand ("VICE News Tonight Full Episodes") is not a channel collection.
    if (rest && BRAND_COLLECTION.test(rest) && isChannelBrandEn(words.slice(0, k).join(' ').replace(/[\s\-–—:]+$/, ''), brands)) return true;
  }
  return false;
}
// "Full Episode Marathons | History" is a collection; "Ancient Aliens | Full Episode Marathons | History"
// is that show's playlist, so this one only counts as the first segment.
const LEAD_COLLECTION = /^(full episode marathons?|marathons?)$/i;
/** Collection / event playlists that do not denote one show. `brands` (the channel's names) is optional. */
export function isGenericPlaylist(title = '', brands = []) {
  const t = cleanTitle(String(title)).trim();
  if (GENERIC_PLAYLIST.test(t)) return true;
  return splitPipes(t).some((p, i) => ((i === 0 || i === 1) && isCollectionName(p, brands)) || (i === 0 && LEAD_COLLECTION.test(p.replace(/[!.]+$/, '').trim())));
}

/** Lists YouTube or the ingester generate (uploads UU…/UPLOADS:…, favourites FL…, likes LL…, watch later, mixes RD…). */
export function isAutoPlaylistId(id = '') {
  const s = String(id ?? '');
  return /^(UU|FL|LL)[\w-]{10,}$/.test(s) || /^RD[\w-]{2,}$/.test(s) || /^(WL|LL|LM)$/.test(s) || s.startsWith('UPLOADS:');
}

// ---------------------------------------------------------------------------------------------
// Numbers: episode / season / part ordinals
// ---------------------------------------------------------------------------------------------

const ORDINALS = {
  'الاولي': 1, 'الاول': 1, 'الثانيه': 2, 'الثاني': 2, 'الثالثه': 3, 'الثالث': 3, 'الرابعه': 4, 'الرابع': 4,
  'الخامسه': 5, 'الخامس': 5, 'السادسه': 6, 'السادس': 6, 'السابعه': 7, 'السابع': 7, 'الثامنه': 8, 'الثامن': 8,
  'التاسعه': 9, 'التاسع': 9, 'العاشره': 10, 'العاشر': 10,
  'الحاديه عشر': 11, 'الحادي عشر': 11, 'الحاديه عشره': 11, 'الثانيه عشر': 12, 'الثاني عشر': 12, 'الثانيه عشره': 12,
  'الثالثه عشر': 13, 'الثالث عشر': 13, 'الثالثه عشره': 13, 'الرابعه عشر': 14, 'الرابع عشر': 14, 'الرابعه عشره': 14,
  'الخامسه عشر': 15, 'الخامس عشر': 15, 'الخامسه عشره': 15, 'السادسه عشر': 16, 'السادس عشر': 16, 'السادسه عشره': 16,
  'السابعه عشر': 17, 'السابع عشر': 17, 'السابعه عشره': 17, 'الثامنه عشر': 18, 'الثامن عشر': 18, 'الثامنه عشره': 18,
  'التاسعه عشر': 19, 'التاسع عشر': 19, 'التاسعه عشره': 19, 'العشرون': 20, 'العشرين': 20,
  'الحاديه والعشرون': 21, 'الحادي والعشرون': 21, 'الثانيه والعشرون': 22, 'الثاني والعشرون': 22,
  'الثالثه والعشرون': 23, 'الثالث والعشرون': 23, 'الرابعه والعشرون': 24, 'الرابع والعشرون': 24,
  'الخامسه والعشرون': 25, 'الخامس والعشرون': 25, 'الاخيره': null, 'الاخير': null,
};

// "الحلقة 4", "الحلقة الرابعة", "الحلقة الرابعة والأخيرة", "EP 4", "الجزء الثاني", "الموسم الثالث" → number
export function wordToNumber(w = '') {
  const n = normalizeArabic(w).replace(/\s*(و)?الاخير[هة]?$/, '').trim();
  if (!n) return null;
  if (/^\d{1,3}$/.test(n)) return parseInt(n, 10);
  const latin = n.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  if (/^\d{1,3}$/.test(latin)) return parseInt(latin, 10);
  if (n in ORDINALS) return ORDINALS[n];
  const two = n.split(' ').slice(0, 2).join(' ');
  if (two in ORDINALS) return ORDINALS[two];
  const one = n.split(' ')[0];
  if (one in ORDINALS) return ORDINALS[one];
  return null;
}

// A number is a whole run of digits: "موسم 2022" names a year, not season 20, and "الحلقة 1000" no episode.
const EPISODE_RE = /(?:^|\s)(?:الحلق[ةه]|الحلق|حلقة|حلقه|ep|episode|e)\.?\s*[:：]?\s*([\d٠-٩]{1,3}(?![\d٠-٩])|ال\S+(?:\s+(?:عشر[ةه]?|و\S+))?)/iu;
const SEASON_RE = /(?:^|\s)(?:الموسم|موسم|season|s)\.?\s*[:：]?\s*([\d٠-٩]{1,2}(?![\d٠-٩])|ال\S+(?:\s+عشر[ةه]?)?)/iu;
const PART_RE = /\(?\s*(?:الجزء|جزء|part)\s*[:：]?\s*([\d٠-٩]{1,2}|ال\S+)\s*\)?/iu;

export function episodeNumberFromTitle(title = '') {
  const m = String(title).match(EPISODE_RE);
  if (m) { const n = wordToNumber(m[1]); if (n != null) return n; }
  const en = String(title).match(/\bS\d+\s*E(\d{1,3})\b/i);
  if (en) return parseInt(en[1], 10);
  return null;
}
export function seasonNumberFromTitle(title = '') {
  const m = String(title).match(SEASON_RE);
  if (m) { const n = wordToNumber(m[1]); if (n != null) return n; }
  const en = String(title).match(/\bS(\d+)\s*E\d{1,3}\b/i);
  if (en) return parseInt(en[1], 10);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Title parsing (per channel profile)
// ---------------------------------------------------------------------------------------------

// A dash with whitespace on at least one side (so hyphenated words survive), or a double dash.
const DASH = /\s+[-–—]+\s*|\s*[-–—]+\s+|\s*[-–—]{2,}\s*/;
const EP_NUM = /^(?:ep|episode|e)\.?\s*(\d{1,3})$/i;
const splitPipes = (t) => String(t).replace(/\s+/g, ' ').split(/\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
const stripBranding = (parts) => parts.filter((p) => !isBranding(p));
// NB: JS \b is ASCII-only, so Arabic words need explicit lookaheads.
const isEpisodePart = (p) => /^(الحلق[ةه]?|حلق[ةه]|ep|episode)(?=\s|$|[:：\d])/i.test(p.trim()) && (p.trim().length < 28);
const isSeasonPart = (p) => /^(الموسم|موسم|season)(?=\s|$|[:：\d])/i.test(p.trim()) && (p.trim().length < 24);

/**
 * "Show - Episode" / "Show- 2" (older uploads). Returns null when there is no clean dash split.
 */
function dashSplit(text) {
  const parts = text.split(DASH).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const show = parts[0];
  const rest = parts.slice(1).join(' - ');
  if (normalizeArabic(show).length < 3) return null;
  if (/^\d{1,3}$/.test(rest)) return { showTitle: show, episodeTitle: `الحلقة ${rest}` };
  const en = rest.match(EP_NUM);
  if (en) return { showTitle: show, episodeTitle: `الحلقة ${en[1]}` };
  return { showTitle: show, episodeTitle: rest };
}

// "Show: الحلقة 4" → show / episode.
function colonEpisodeSplit(text) {
  const m = text.match(/^(.{3,}?)\s*[:：]\s*(الحلق[ةه]\s+\S+.*)$/);
  return m ? { showTitle: m[1].trim(), episodeTitle: m[2].trim() } : null;
}

// Bilingual titles like "Lion Ranger -- EP2/ الأسد الحارس- 2": keep the segment with the most Arabic.
function preferArabicSegment(text) {
  if (!text.includes('/')) return text;
  const segs = text.split('/').map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return text;
  const arabicCount = (s) => (s.match(/[؀-ۿ]/g) || []).length;
  return segs.sort((a, b) => arabicCount(b) - arabicCount(a))[0];
}

/**
 * Remove the show/playlist name from an episode title and tidy numbering:
 * "I am NatGeo Photographer - EP 1 - أنا مصور" with playlist "I am NatGeo Photographer - أنا مصور" → "الحلقة 1".
 */
export function cleanEpisodeTitle(epTitle = '', showTitle = '') {
  const drop = new Set([showTitle, ...showTitle.split(DASH)].map((s) => normalizeArabic(s)).filter(Boolean));
  const segs = epTitle.split(DASH).map((s) => s.trim()).filter(Boolean)
    .filter((s) => !drop.has(normalizeArabic(s)) && !isBranding(s))
    .map((s) => {
      const m = s.match(EP_NUM);
      if (m) return `الحلقة ${m[1]}`;
      const tail = s.match(/^(.*?)\s*(?:ep|episode)\.?\s*(\d{1,3})$/i);
      if (tail && (!tail[1].trim() || drop.has(normalizeArabic(tail[1])))) return `الحلقة ${tail[2]}`;
      return s;
    });
  const out = segs.join(' - ').trim();
  return out || 'الحلقة الكاملة';
}

const FILM_EPISODE = 'الفيلم الكامل';

/** Nat Geo Abu Dhabi: "Episode | Show | ناشونال جيوغرافيك أبوظبي" (and older variants). */
function parseNatGeo(title, ctx) {
  const raw = String(title).replace(/\s+/g, ' ').trim();
  const parts = stripBranding(splitPipes(raw));
  const playlistTitle = ctx.playlistTitle || '';
  const generic = !playlistTitle || ctx.playlistGeneric;
  if (parts.length >= 2) {
    const [a, b] = parts;
    if (!generic && normalizeArabic(a) === normalizeArabic(playlistTitle)) return { episodeTitle: b, showTitle: a };
    return { episodeTitle: a, showTitle: b };
  }
  if (parts.length === 1) {
    const only = preferArabicSegment(parts[0]);
    const en = only.match(/^(.*?)\s+S(\d+)\s*(?:Ep|E)\.?\s*(\d+)\s*$/i);
    if (en) return { episodeTitle: `الموسم ${en[2]} - الحلقة ${en[3]}`, showTitle: en[1].trim(), season: parseInt(en[2], 10), number: parseInt(en[3], 10) };
    const playlistIsThisVideo = playlistTitle && normalizeArabic(playlistTitle) === normalizeArabic(parts[0]);
    if (generic || playlistIsThisVideo) {
      const split = colonEpisodeSplit(only) || dashSplit(only);
      if (split) return split;
    }
    if (!generic) return { episodeTitle: cleanEpisodeTitle(only, playlistTitle), showTitle: playlistTitle };
    return { episodeTitle: only, showTitle: null };
  }
  return { episodeTitle: raw || 'حلقة', showTitle: playlistTitle || null };
}

// Unnumbered words that still only mark the season ("موسم جديد", "موسم الأخير"), normalized.
const SEASON_WORD = /^(ال)?(اخير|جديد|حالي|قادم|مقبل|ماضي|سابق)[هة]?$/;

/** Asharq Discovery: "Show - Episode - الحلقة N - الموسم X | الشرق ديسكفري". */
function parseAsharq(title, ctx) {
  const raw = String(title).replace(/\s+/g, ' ').trim();
  const parts = stripBranding(splitPipes(raw));
  const main = (parts[0] || raw).replace(/^(فيلم وثائقي|وثائقي|وثائقيات)\s*[:：|\-–—]?\s*/u, '').trim() || (parts[0] || raw);
  const segs = main.split(DASH).map((s) => s.trim()).filter(Boolean);
  let number = null, season = null;
  const body = [];
  for (const s of segs) {
    if (isEpisodePart(s)) { number = wordToNumber(s.replace(/^(الحلق[ةه]|الحلق|حلق[ةه]|ep|episode)\s*/i, '')) ?? number; continue; }
    if (isSeasonPart(s)) {
      const rest = s.replace(/^(الموسم|موسم|season)\s*/i, '');
      const n = wordToNumber(rest);
      // A season segment is skipped as before ("الموسم الثالث", "الموسم الأخير", "Season Finale"),
      // except an unnumbered indefinite "موسم X": "موسم الرياح" ("the windy season") names the episode.
      // "موسم جديد" ("a new season") is still only a season marker.
      if (n != null || !/^موسم\s/.test(s) || SEASON_WORD.test(normalizeArabic(rest))) { season = n ?? season; continue; }
    }
    body.push(s);
  }
  const playlistTitle = ctx.playlistTitle || '';
  const generic = !playlistTitle || ctx.playlistGeneric;
  let showTitle = (body[0] || main).replace(/^الشرق\s+/, '').trim();
  let episodeTitle = body.slice(1).join(' - ').trim();
  if (body.length === 1 && !generic && number == null && season == null) {
    // Plain title inside a show playlist: the playlist is the show.
    showTitle = playlistTitle;
    episodeTitle = cleanEpisodeTitle(body[0], playlistTitle);
  }
  if (!episodeTitle) episodeTitle = number != null ? `الحلقة ${number}` : (body.length === 1 && generic ? FILM_EPISODE : 'الحلقة الكاملة');
  const kind = body.length === 1 && generic && number == null && season == null ? 'film' : 'series';
  return { showTitle, episodeTitle, number, season, kind };
}

/** DW Arabic: "وثائقي | Film title | وثائقية دي دبليو"; series live in "سلسلة وثائقيات | X" playlists. */
const DW_LABELS = /^(وثائقي(\s+قصير)?|مراسلون|ريبورتاج|تقرير|حوار|وثائقيات|سلسلة وثائقيات|فيلم وثائقي|documentary)$/i;
export function dwSeriesName(playlistTitle = '') {
  const parts = stripBranding(splitPipes(playlistTitle)).filter((p) => !DW_LABELS.test(p));
  return parts[0] || null;
}
function parseDW(title, ctx) {
  const raw = String(title).replace(/\s+/g, ' ').trim();
  const parts = stripBranding(splitPipes(raw));
  const labels = parts.filter((p) => DW_LABELS.test(p));
  const content = parts.filter((p) => !DW_LABELS.test(p));
  let main = (content[0] || raw).replace(/\s*\((إعادة|اعادة|مُعاد|معاد)\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const extra = content.slice(1).join(' | ');
  const label = labels[0] || null;
  const series = ctx.playlistTitle && /سلسلة/.test(ctx.playlistTitle) ? dwSeriesName(ctx.playlistTitle) : null;
  // "(2/3)" style part markers. DW Arabic writes them RTL-style ("(4/1)" = part 1 of 4), so the
  // smaller number is the part and the larger one the total.
  const frac = main.match(/\(\s*([\d٠-٩]{1,2})\s*\/\s*([\d٠-٩]{1,2})\s*\)/);
  const bare = !frac && main.match(/\(\s*([\d٠-٩]{1,2})\s*\)\s*$/);
  const pm = main.match(PART_RE);
  let partNo = null, partTotal = null;
  if (frac) { const a = wordToNumber(frac[1]), b = wordToNumber(frac[2]); partNo = Math.min(a, b); partTotal = Math.max(a, b); }
  else if (pm) partNo = wordToNumber(pm[1]);
  else if (bare) partNo = wordToNumber(bare[1]);
  if (series) {
    return { showTitle: series, episodeTitle: main, number: partNo ?? episodeNumberFromTitle(main), kind: 'series', label };
  }
  // Multi-part films: "فهم التوحد - الجزء الأول", "ماو تسي تونغ ... (الجزء 1)", "رايخ هتلر ... (4/4)", "طريق الحرير (2)"
  if (partNo != null) {
    const marker = frac ? frac[0] : pm ? PART_RE : bare[0];
    const showTitle = main.replace(marker, '').replace(/[\s\-–—ـ:،]+$/u, '').trim();
    const ep = partTotal ? `الجزء ${partNo} من ${partTotal}` : `الجزء ${partNo}`;
    if (normalizeArabic(showTitle).length >= 3) return { showTitle, episodeTitle: ep, number: partNo, kind: 'series', label };
  }
  return { showTitle: extra ? `${main} | ${extra}` : main, episodeTitle: FILM_EPISODE, number: null, kind: 'film', label };
}

/** Al Jazeera Documentary: "Series.. subtitle | الحلقة الرابعة" or plain film titles. */
// Strip "Show.. " / "Show - " / "Show: " from the start of an episode title.
function stripShowPrefix(text, showTitle) {
  if (!showTitle) return text;
  const n = normalizeArabic(showTitle);
  const m = text.match(/^(.{2,}?)\s*(\.\.+|[-–—:：]+)\s*(.+)$/);
  if (m && normalizeArabic(m[1]) === n) return m[3].trim();
  return text;
}

function parseAlJazeera(title, ctx) {
  // "\ الحلقة 19" and "/ الحلقة 3" are pipe-equivalents on this channel.
  const raw = String(title).replace(/\s+/g, ' ').replace(/\s*[\\/]\s*(?=الحلق[ةه]\s)/g, ' | ').trim();
  const parts = stripBranding(splitPipes(raw));
  const epPart = parts.find(isEpisodePart);
  const others = parts.filter((p) => p !== epPart);
  const main = others[0] || raw;
  const extra = others.slice(1).join(' | ');
  const number = epPart ? wordToNumber(epPart.replace(/^(الحلق[ةه]|حلق[ةه])\s*/i, '')) : null;
  const dots = main.match(/^(.{2,}?)\s*\.\.+\s*(.+)$/);
  const pre = dots ? dots[1].trim() : null;
  const post = dots ? dots[2].trim() : null;
  const playlistTitle = ctx.playlistTitle || '';
  // The catalogue decides whether a playlist is a real series (ctx.playlistSeries); without that
  // signal fall back to "dedicated playlist with 2+ videos".
  const seriesPlaylist = playlistTitle && !ctx.playlistGeneric && (ctx.playlistSeries ?? ((ctx.playlistSize || 0) >= 2));
  // "Show - 3 Episode" / "Show- Episode" (numbered dash style used by some AJ series)
  const dn = main.match(/^(.{3,}?)\s*[-–—]+\s*(\d{1,3})\s*[-–—:]?\s*(.*)$/);
  if (seriesPlaylist) {
    const dashSame = dn && normalizeArabic(dn[1]) === normalizeArabic(playlistTitle);
    let ep;
    if (normalizeArabic(main) === normalizeArabic(playlistTitle)) ep = extra || (number != null ? `الحلقة ${number}` : 'الحلقة الكاملة');
    else if (dashSame) ep = (dn[3] || `الحلقة ${dn[2]}`) + (extra ? ` | ${extra}` : '');
    else ep = stripShowPrefix(main, playlistTitle) + (extra ? ` | ${extra}` : '');
    return { showTitle: playlistTitle, episodeTitle: ep, number: number ?? (dashSame ? parseInt(dn[2], 10) : null), kind: 'series' };
  }
  if (number != null && pre) return { showTitle: pre, episodeTitle: post + (extra ? ` | ${extra}` : ''), number, kind: 'series' };
  if (number != null) {
    // "الرحالة - أوروبا | الحلقة 19" → show "الرحالة", episode "أوروبا"
    const segs = main.split(DASH).map((s) => s.trim()).filter(Boolean);
    if (segs.length >= 2 && normalizeArabic(segs[0]).length >= 3) return { showTitle: segs[0], episodeTitle: segs.slice(1).join(' - ') + (extra ? ` | ${extra}` : ''), number, kind: 'series' };
    const cs = main.match(/^(.{3,}?)\s*[:：]\s*(.+)$/);
    if (cs) return { showTitle: cs[1].trim(), episodeTitle: cs[2].trim() + (extra ? ` | ${extra}` : ''), number, kind: 'series' };
    return { showTitle: main, episodeTitle: extra || `الحلقة ${number}`, number, kind: 'series' };
  }
  if (dn && normalizeArabic(dn[1]).length >= 4) return { showTitle: dn[1].trim(), episodeTitle: (dn[3] || `الحلقة ${dn[2]}`) + (extra ? ` | ${extra}` : ''), number: parseInt(dn[2], 10), kind: 'series' };
  return { showTitle: extra ? `${main} | ${extra}` : main, episodeTitle: FILM_EPISODE, number: null, kind: 'film', prefix: pre };
}

/** Al Jazeera: is this playlist a real series (its videos reference it) or a topic collection? */
export function alJazeeraPlaylistIsSeries(playlistTitle, videoTitles = []) {
  if (!videoTitles.length) return false;
  const np = normalizeArabic(playlistTitle);
  let hits = 0;
  for (const t of videoTitles) {
    const parts = stripBranding(splitPipes(t));
    if (parts.some(isEpisodePart)) { hits++; continue; }
    const main = parts[0] || t;
    const pre = main.match(/^(.{2,}?)\s*(\.\.+|[-–—]+\s*\d{1,3})\s*/)?.[1];
    if (pre && (normalizeArabic(pre) === np || np.startsWith(normalizeArabic(pre)))) hits++;
  }
  return hits / videoTitles.length >= 0.5;
}

/** Unknown channels: pipes, dashes, playlist fallback. */
function parseGeneric(title, ctx) {
  const r = parseNatGeo(title, ctx);
  if (!r.showTitle) return { ...r, showTitle: r.episodeTitle, episodeTitle: FILM_EPISODE, kind: 'film' };
  return r;
}

// ---------------------------------------------------------------------------------------------
// Arabic channels sources.json gives a kind: 'ar-show' (named programmes: the Daheeh's channels AJ+
// كبريت, New Media Academy Life, Museum of The Future) and 'ar-films' (documentary-film channels).
// ---------------------------------------------------------------------------------------------

/** A channel's own name (sources.json brands) or a known broadcaster's: never a show. */
function isArBrand(part, brands = []) {
  const n = normalizeArabic(part);
  return !n || isBranding(part) || brands.some((b) => b && normalizeArabic(b) === n);
}
// Punctuation around a programme's name ("!الدحيح", "«الجهبذ»"); "+" stays ("المُخبر الاقتصادي+").
const NAME_EDGE = /^[\s!.،,:;؛|\-–—…"'«»“”()]+|[\s!.،,:;؛|\-–—…"'«»“”()]+$/gu;
const YEAR_TAIL = /\s+(?:19|20)\d{2}$/u;
/**
 * A programme's name as titles and playlists write it: edge punctuation, a trailing year ("السليط
 * الإخباري 2026": the season's year, not the name) and a leading "برنامج" ("برنامج روح") removed.
 */
export function arShowName(s = '') {
  const t = String(s ?? '').replace(/\s+/g, ' ').replace(NAME_EDGE, '').replace(YEAR_TAIL, '').replace(/^برنامج\s+/u, '');
  return t.replace(NAME_EDGE, '').trim();
}
// "الدحيح - الموسم الثامن - الحلقات الكاملة", "الدحيح-الموسم الثاني", "السليط الإخباري الموسم الثالث";
// the rest of the text after the season ("- الحلقات الكاملة") is dropped with it. "الموسم 2026" names
// the season by its year: dropped from the name too, but no season number (wordToNumber takes 1-3 digits).
const AR_PL_SEASON = /\s*[-–—|:،,(]?\s*(?:ال)?موسم\s*[:：]?\s*([\d٠-٩]{1,2}(?![\d٠-٩])|[\d٠-٩]{4}(?![\d٠-٩])|ال\S+(?:\s+عشر[ةه]?)?)/u;
const AR_FULL_EPISODES_TAIL = /\s*[-–—|:،]?\s*(?:(?:ال)?حلقات\s+(?:ال)?كامل[ةه]|كل الحلقات|جميع الحلقات)\s*$/u;
const tooShortAr = (s) => { const t = String(s ?? '').trim(); return t.length <= 1 || !normalizeArabic(t); };

/** A programme segment ("الدحيح - الموسم الثامن", "السليط الإخباري 2026") → { name, season }. */
function arShowSegment(seg = '') {
  let head = String(seg ?? '');
  let season = null;
  const m = head.match(AR_PL_SEASON);
  const n = m ? wordToNumber(m[1]) : null;
  // A number or a year: dropped ("موسم الهجرة إلى الشمال" is a name, kept).
  if (n != null || (m && /^[\d٠-٩]{4}$/u.test(m[1]))) { season = n; head = head.slice(0, m.index); }
  const name = arShowName(head.replace(AR_FULL_EPISODES_TAIL, ''));
  return { name: name && !tooShortAr(name) ? name : '', season };
}
const arShowKey = (s) => normalizeArabic(arShowSegment(s).name);
// A segment of emoji and symbols only ("😂"): no letters or digits, at least one pictograph.
const pictographic = (s) => /\p{Extended_Pictographic}/u.test(s) && !/[\p{L}\p{N}]/u.test(s);
// A segment that is only an episode, season or part marker ("الحلقة (49)", "الحلقة الأخيرة", "الموسم
// الثالث", "الجزء 2", "الحلقة 12 كاملة"): it names no programme. "حلقة وصل" is a name.
const MARKER_ONLY = /^(?:(?:ال)?حلق[ةه]|(?:ال)?موسم|(?:ال)?جزء|ep(?:isode)?|season|part)\.?\s*[:：]?\s*[(\[]?\s*(?:[\d٠-٩]{1,3}|ال\S+(?:\s+(?:عشر[ةه]?|و\S+))?)?\s*[)\]]?(?:\s+(?:ال)?كامل[ةه])?$/iu;
// A segment that reads like a programme's name: at most 3 words and 30 characters, without the
// sentence punctuation of an episode title (a question, an exclamation, a colon, dots or quotes),
// and more than a marker.
function nameLike(seg) {
  const s = arShowSegment(seg).name;
  if (!s || s.length > 30 || /[?؟!:：.…"«»“”]/u.test(s) || !/\p{L}/u.test(s) || MARKER_ONLY.test(s)) return false;
  return normalizeArabic(s).split(' ').length <= 3;
}

/**
 * An 'ar-show' playlist title → { name, season }: "الدحيح - الموسم الثامن - الحلقات الكاملة" → الدحيح,
 * season 8; "برنامج روح" → روح; "السليط الإخباري 2024" → السليط الإخباري. Brand segments are dropped;
 * `name` is '' when nothing else is left.
 */
export function arShowPlaylist(title = '', brands = []) {
  const parts = splitPipes(cleanTitle(String(title ?? ''))).filter((p) => !isArBrand(p, brands));
  return arShowSegment(parts[0] || '');
}

/**
 * The programmes of an 'ar-show' channel: names recurring (at least `min` times) as the first or last
 * " | " segment of its titles, or before the dash of "Show - Episode" titles; brand segments and
 * segments that read like episode titles do not count. Map of normalized name → count, for
 * parseTitle's ctx.showNames: it tells "Show | Episode" (AJ+ كبريت) from "Episode | Show" (New Media
 * Academy Life seasons 3-8) outside a show's playlist.
 */
export function arShowNames(titles = [], brands = [], min = 3) {
  const counts = new Map();
  for (const t of titles) {
    const parts = splitPipes(cleanTitle(String(t ?? ''))).filter((p) => !isArBrand(p, brands));
    const ends = new Set(parts.length >= 2 ? [parts[0], parts[parts.length - 1]] : []);
    if (parts.length === 1) { const d = parts[0].split(DASH).map((s) => s.trim()).filter(Boolean); if (d.length >= 2) ends.add(d[0]); }
    for (const p of ends) if (nameLike(p)) { const k = arShowKey(p); counts.set(k, (counts.get(k) || 0) + 1); }
  }
  return new Map([...counts].filter(([, n]) => n >= min));
}

/**
 * 'ar-show' titles name their programme on one side: "Show | Episode" ("الدحيح | طرابزون سبور: …",
 * "المُخبر الاقتصادي+ | …", "السليط الإخباري 2026 | …"), "Show - Episode" ("الدحيح - نُصك ملحد", AJ+
 * 2017-2020) or "Episode | Show" ("الحساسية | الدحيح"). The show is the side the playlist names, else
 * the side naming one of the channel's recurring programmes (ctx.showNames, arShowNames), else the side
 * that reads like a name (the first when both do); never a brand, never a bare episode or season
 * marker. A known name before the dash of a segment ("الجهبذ - عقدة النقص | الحلقة 12") is the show.
 * A title naming no programme in a show's playlist (one whose title reads like a name) is that show's
 * episode, also when a segment of it reads like a name ("قصة أغنية | من هو فيروز؟" in "الوتر الحساس");
 * elsewhere it is a standalone film. The playlist's season applies to its own show's episodes.
 */
function parseArShow(title, ctx) {
  const brands = ctx.brands || [];
  const raw = cleanTitle(String(title ?? '')).replace(/\s+/g, ' ').trim();
  // An episode titled with emoji only ("😂 | الدحيح") keeps it: no letters, but no brand either.
  const parts = splitPipes(raw).filter((p) => pictographic(p) || !isArBrand(p, brands));
  const pl = ctx.playlistTitle && !ctx.playlistGeneric ? arShowPlaylist(ctx.playlistTitle, brands) : null;
  const plKey = pl?.name ? normalizeArabic(pl.name) : '';
  const known = ctx.showNames instanceof Map ? ctx.showNames : ctx.showNames instanceof Set ? new Map([...ctx.showNames].map((k) => [k, 1])) : null;
  const score = (s) => (known && nameLike(s) ? known.get(arShowKey(s)) || 0 : 0);
  const pick = (segs) => {
    const ends = segs.length > 1 ? [0, segs.length - 1] : [0];
    let i = plKey ? segs.findIndex((s) => arShowKey(s) === plKey) : -1;
    if (i < 0) {
      const best = segs.map((s, k) => [k, score(s), ends.includes(k) ? 1 : 0]).filter(([, n]) => n > 0).sort((a, b) => b[2] - a[2] || b[1] - a[1])[0];
      i = best ? best[0] : -1;
    }
    return i;
  };
  // The show of segment i ("السليط الإخباري الموسم الثالث" → السليط الإخباري, season 3) and its episode:
  // the other segments without the show's name.
  const series = (i, segs, sep) => {
    const { name: show, season } = arShowSegment(segs[i]);
    const rest = segs.filter((_, k) => k !== i).join(sep).trim();
    const own = !!plKey && normalizeArabic(show) === plKey;
    const episodeTitle = pictographic(rest) ? rest : rest ? cleanEpisodeTitle(rest, show) : 'الحلقة الكاملة';
    return { showTitle: show, episodeTitle, season: own ? pl.season ?? season : season, kind: 'series' };
  };
  // The playlist reads like a programme's name ("الوتر الحساس", "الجهبذ"): a title naming none of the
  // channel's programmes is its episode. A topic playlist ("هتلر والحرب العالمية الثانية") is not.
  const plNamed = !!plKey && nameLike(pl.name);
  if (parts.length >= 2) {
    let i = pick(parts);
    if (i < 0) {
      // "الجهبذ - عقدة النقص | الحلقة 12": a known name before (or after) the dash of an end segment is
      // the show; the rest of that segment joins the other segments as the episode.
      for (const k of [0, parts.length - 1]) {
        const d = parts[k].split(DASH).map((s) => s.trim()).filter(Boolean);
        const j = d.length >= 2 ? pick(d) : -1;
        if (j >= 0) return series(j, [...d, ...parts.filter((_, n) => n !== k)], ' | ');
      }
      if (!plNamed) i = [0, parts.length - 1].find((k) => nameLike(parts[k])) ?? -1;
    }
    if (i >= 0) return series(i, parts, ' | ');
  }
  const only = parts.join(' | ') || raw;
  const dash = only.split(DASH).map((s) => s.trim()).filter(Boolean);
  if (dash.length >= 2) {
    // A known name (the playlist's or a recurring one) splits a dash title, and without recurring
    // names a one-word name before a single dash ("الدحيح - ميسي والكلب", "الإسبتالية - الولادة"):
    // "X - Y" is otherwise a title with a subtitle.
    let i = pick(dash);
    if (i < 0 && !known && dash.length === 2 && nameLike(dash[0]) && !arShowKey(dash[0]).includes(' ')) i = 0;
    if (i >= 0) return series(i, dash, ' - ');
  }
  if (pl?.name) return { showTitle: pl.name, episodeTitle: cleanEpisodeTitle(only, pl.name), season: pl.season, kind: 'series' };
  return { showTitle: only, episodeTitle: FILM_EPISODE, kind: 'film' };
}

// ---- 'ar-films' --------------------------------------------------------------------------------

// Words of the labels documentary-film channels add to titles ("فيلم وثائقي عن السفر بدقة 4K",
// "وثائقي سفر بدقة 4K", "فيلم وثائقي كامل", "وثائقي مدبلج", "دليل سياحي بدقة 4K", "دقة 4K"), normalized.
const FILM_LABEL_WORDS = new Set(('فيلم الفيلم افلام فيديو الفيديو وثايقي الوثايقي وثايقيه الوثايقيه وثايقيات عن حول للسفر السفر سفر '
  + 'سياحي سياحيه السياحه رحله دليل مغامره سافر بدقه دقه بجوده جوده عاليه فايقه الوضوح كامل الكامل كامله الكامله '
  + 'مدبلج مدبلجه مترجم مترجمه اجتماعي 4k 8k hd uhd').split(' '));
// A label has one of these words: "عن", "كامل" or a year alone is no label.
const FILM_LABEL_CORE = new Set('فيلم الفيلم افلام فيديو الفيديو وثايقي الوثايقي وثايقيه الوثايقيه وثايقيات للسفر السفر سفر سياحي سياحيه السياحه رحله دليل مغامره سافر بدقه دقه بجوده مدبلج مدبلجه مترجم مترجمه 4k 8k hd uhd'.split(' '));
// Words a label starts with when it is glued to the title ("… أقوى جيش في أوروبا؟ فيلم وثائقي كامل").
const FILM_LABEL_HEAD = new Set('فيلم الفيلم فيديو الفيديو وثايقي الوثايقي بدقه دقه 4k 8k'.split(' '));
const YEAR_WORD = /^(?:19|20)\d{2}$/;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu;
const isLabelWord = (w) => FILM_LABEL_WORDS.has(w) || YEAR_WORD.test(w);
const labelRun = (words) => words.length > 0 && words.every(isLabelWord) && words.some((w) => FILM_LABEL_CORE.has(w));
/** A title segment that is only a label ("فيلم وثائقي سياحي بدقة 4K", "وثائقي 4K", "4K", "فيديو سفر 2026"). */
export function isFilmLabel(seg = '') {
  return labelRun(normalizeArabic(String(seg).replace(EMOJI, ' ')).split(' ').filter(Boolean));
}
// DASH with the separators kept: [text, dash, text, …].
const DASH_SPLIT = /(\s+[-–—]+\s*|\s*[-–—]+\s+|\s*[-–—]{2,}\s*)/;
const GLUED_PIPE = '\u{F8FF}';
// Nouns and names starting with "ي" (normalized) that a title can open with after a label: not verbs.
const NOT_VERB = new Set('يهود يهودي يهوديه يوم يوميات يوسف يونس يعقوب يحيي يزيد يافا يثرب ينبع'.split(' '));
// Trailing ellipses, dots, dashes and commas left around a segment ("من صنعاء إلى أطلسي المغرب..").
const SEG_EDGE = /^[\s.…,،:;؛|\-–—]+|[\s.…,،;؛|\-–—]+$/gu;

/**
 * A segment without the label words glued to its start or end ("وثائقي برلين 1945: …", "الفيلم الوثائقي:
 * حرب فيتنام", "… أقوى جيش في أوروبا؟ فيلم وثائقي كامل", "هاواي  أخطر جنة  فيلم وثائقي للسفر بدقة 4K"),
 * the channel's name glued to its end ("… عمالقة الهندسة الغرب الوثائقية") and emoji. A "full
 * documentary" label between two phrases separates them ("سقوط فرنسا الفيلم الوثائقي الكامل كيف سيطر
 * هتلر…" → two segments). Returns the segments left.
 */
function stripFilmSegment(seg, brands) {
  let s = String(seg).replace(EMOJI, ' ').replace(/\s+/g, ' ').trim();
  // The channel's name at the end, after a space or dots ("… كامل .. الغرب الوثائقية").
  for (const b of brands) {
    const words = normalizeArabic(b).split(' ').filter(Boolean);
    if (words.length < 2) continue;
    const toks = s.split(' ');
    if (toks.length > words.length && normalizeArabic(toks.slice(-words.length).join(' ')) === words.join(' ')) s = toks.slice(0, -words.length).join(' ').replace(SEG_EDGE, '');
  }
  // "الفيلم الوثائقي: X", "وثائقي صادم: X", "فيلم وثائقي كامل: X", "الفيلم الوثائقي .. X": a label (and
  // one word qualifying it) before a colon or dots.
  const lead = s.match(/^(\S+(?:\s+\S+){0,3}?)\s*(?:[:：]|\.{1,}|…)\s*(\S.*)$/u);
  if (lead) {
    const words = normalizeArabic(lead[1]).split(' ');
    // "وثائقي صادم:" qualifies the documentary; "فيلم العدوان:" names the film.
    const label = words.slice(0, -1);
    const qualified = words.length >= 2 && labelRun(label) && label.some((w) => /^(ال)?وثايقي/.test(w));
    if (labelRun(words) || qualified) s = lead[2];
  }
  const toks = s.split(' ');
  const norm = toks.map((t) => normalizeArabic(t));
  // Glued at the start: the longest run of label words starting with "فيلم"/"وثائقي", when two words or
  // more are left ("وثائقي الحزب النازي: …", "الفيلم الوثائقي الكامل بولندا …", "فيلم سقوط بغداد: …"),
  // unless the label is the sentence's subject ("الوثائقي الذي يكشف …", "وثائقي يكشف كواليس …"; a word
  // starting with "ي" reads as a verb unless it is a noun or a name: "وثائقي يهود المغرب …").
  let a = 0;
  if (FILM_LABEL_HEAD.has(norm[0]) && !/^\d/.test(norm[0])) { while (a < norm.length && isLabelWord(norm[a])) a++; }
  const verb = /^(الذي|التي|الذين|اللذان|اللتان|اللواتي|ي\S{2,})$/.test(norm[a] || '') && !NOT_VERB.has(norm[a]);
  if (toks.length - a < 2 || verb) a = 0;
  // Glued at the end: from a head word on, label words only ("… فيلم وثائقي كامل", "… 4K").
  let z = toks.length;
  for (let k = toks.length - 1; k >= a + 1; k--) {
    if (!isLabelWord(norm[k])) break;
    if (FILM_LABEL_HEAD.has(norm[k]) && labelRun(norm.slice(k))) z = k;
  }
  const body = toks.slice(a, z);
  // "X الفيلم الوثائقي الكامل Y": a full-documentary label between two phrases splits them.
  const out = [];
  let cur = [];
  for (let k = 0; k < body.length; k++) {
    const n3 = body.slice(k, k + 3).map((t) => normalizeArabic(t)).join(' ');
    const m = /^(?:ال)?فيلم (?:ال)?وثايقي (?:ال)?كامل[ه]?$/.test(n3) ? 3 : 0;
    if (m && cur.length && k + m < body.length) { out.push(cur.join(' ')); cur = []; k += m - 1; continue; }
    cur.push(body[k]);
  }
  if (cur.length) out.push(cur.join(' '));
  return out.map((p) => p.replace(SEG_EDGE, '').trim()).filter((p) => p && !isFilmLabel(p) && !isArBrand(p, brands));
}

/**
 * An 'ar-films' title → its segments without labels and brands: " | " and dash segments that are only a
 * label ("فيلم وثائقي عن السفر بدقة 4K", "- 4K", "– فيلم وثائقي سياحي بدقة 4K") or the channel's name are
 * dropped, labels glued to a segment are cut off (stripFilmSegment). Descriptive subtitles stay.
 */
export function arFilmSegments(title = '', brands = []) {
  // A pipe inside a word ("إسر|ئيل", a censored spelling) is not a separator.
  const raw = cleanTitle(String(title ?? '')).replace(/\s+/g, ' ').trim().replace(/(?<=\p{L})\|(?=\p{L})/gu, GLUED_PIPE);
  const out = [];
  for (const part of splitPipes(raw).map((p) => p.replaceAll(GLUED_PIPE, '|'))) {
    if (isArBrand(part, brands) || isFilmLabel(part)) continue;
    // Dash segments: labels and brands at either end are dropped ("وثائقي - لغز …", "… – 4K"); the
    // dashes between the rest stay as written.
    const pieces = part.split(DASH_SPLIT);
    const drop = (p) => isFilmLabel(p) || isArBrand(p, brands);
    while (pieces.length > 2 && drop(pieces[pieces.length - 1])) pieces.splice(-2);
    while (pieces.length > 2 && drop(pieces[0])) pieces.splice(0, 2);
    out.push(...stripFilmSegment(pieces.join('').trim(), brands));
  }
  return out;
}

/**
 * An 'ar-films' playlist title → the series name it denotes ('' for none): "سلسلة #ملوك_اليمن_القديم" →
 * ملوك اليمن القديم, "وثائقي مصر في عهد السادات" → مصر في عهد السادات, "الوعد المزعوم | سلسلة تبحث …" →
 * الوعد المزعوم, "Nepal - نيبال" → نيبال, "الملوك التبابعة (ملوك اليمن السبعين)" → الملوك التبابعة.
 */
export function arFilmsPlaylistName(title = '', brands = []) {
  const parts = splitPipes(cleanTitle(String(title ?? '')).replace(EMOJI, ' ')).filter((p) => !isArBrand(p, brands) && !/^سلسل[ةه]\s+(?:تبحث|عن|حول)\s/u.test(p));
  let s = (parts[0] || '').replace(/#/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const dashes = s.split(DASH).map((x) => x.trim()).filter(Boolean);
  if (dashes.length === 2 && hasArabic(dashes.join('')) && dashes.some((d) => !hasArabic(d))) s = dashes.find((d) => hasArabic(d));
  s = s.replace(/^سلسل[ةه]\s+(?:(?:ال)?وثائقيات\s+)?/u, '');
  // "وثائقي مصر في عهد السادات" is a series; "فيلم وثائقي عن السفر حول العالم" says what its films are about.
  const unlabelled = s.replace(/^(?:(?:ال)?فيلم\s+)?(?:ال)?وثائقي[ةه]?\s+/u, '');
  if (unlabelled !== s && /^(?:عن|حول)\s/u.test(unlabelled)) return '';
  s = unlabelled;
  const bracket = s.match(/^(.+?)\s*\([^()]*\)$/u);
  if (bracket && normalizeArabic(bracket[1]).split(' ').length >= 2) s = bracket[1];
  s = s.replace(SEG_EDGE, '').trim();
  return s && !tooShortAr(s) && !isFilmLabel(s) ? s : '';
}

// A war or an event is numbered by its year or its ordinal, not by an episode: "حرب أكتوبر 73", "الحرب
// العالمية 2", "نكسة 67", "حرب الخليج (2)" name films (words as normalizeArabic writes them).
const EVENT_NOUN = /^(?:ال)?(?:حرب|حروب|ثوره|ثورات|نكسه|نكبه|معركه|معارك|غزو|غزوه|انتفاضه|حصار|ازمه|زلزال|انقلاب|مجزره|كارثه|احتلال|عدوان|هجمات|حريق|انفجار|مونديال|اولمبياد|كاس)$/u;
const datedEvent = (name) => normalizeArabic(name).split(' ').some((w) => EVENT_NOUN.test(w));
// The largest number a bare " name N | …" takes for an episode: "الجيش المصري 73 | القصة الكاملة" is a film.
const LOOSE_EPISODE_MAX = 40;

// "ملوك اليمن القديم(16) سيف بن ذي يزن: …", "تاريخ البربر الأمازيغ(4) …", "ملوك اليمن القديم7 | …", "تاريخ
// الفينيقيين 3 | …": a name of two words or more with an episode number in brackets, glued to its last
// word, or alone before a " | ". Not a dated event ("حرب أكتوبر 73 | القصة الكاملة", "الحرب العالمية 2 |
// كيف بدأت؟", "الحرب العالمية2: كيف بدأت؟") unless a "جزء" / "حلقة" marker says episode, and a bare number
// before the " | " only when it is small enough to be one.
function numberedTitle(segs) {
  const [first = '', ...more] = segs;
  // "(4)", "(جزء 2)", "(جزء3)", "(الحلقة 5)"
  const bracket = first.match(/^(.+?)\s*\(\s*((?:ال)?(?:جزء|حلق[ةه]))?\s*([\d٠-٩]{1,2})\s*\)\s*[:：\-–—]?\s*(.*)$/u);
  const glued = first.match(/^(.+?\p{L})([\d٠-٩]{1,2})(?:\s*[:：\-–—]\s*(.*)|\s*()$)/u);
  const loose = more.length ? first.match(/^(.+?)\s+([\d٠-٩]{1,2})$/u) : null;
  const tries = [
    bracket && { name: bracket[1], num: bracket[3], rest: bracket[4], part: /جزء/.test(bracket[2] || ''), marked: !!bracket[2] },
    glued && { name: glued[1], num: glued[2], rest: glued[3] },
    loose && { name: loose[1], num: loose[2], rest: '', loose: true },
  ];
  for (const t of tries) {
    if (!t) continue;
    const name = t.name.replace(SEG_EDGE, '').trim();
    if (normalizeArabic(name).split(' ').length < 2) continue;
    const n = wordToNumber(t.num);
    if (n == null) continue;
    if (!t.marked && datedEvent(name)) continue;
    if (t.loose && n > LOOSE_EPISODE_MAX) continue;
    return { name, number: n, part: !!t.part, rest: [(t.rest || '').trim(), ...more].filter(Boolean).join(' | ') };
  }
  return null;
}

// A series hashtag in a title: "… #سلسلة_عالم_الملكوت (3)", "… | #سلسلة_تاريخ_اليمن(2)", "… #سلسلة_تاريخ_اليمن
// (11 الأخير)". → { name, number, title } (title: the rest of the text), or null.
const SERIES_TAG = /\s*[|,،]?\s*#سلسل[ةه]_([\p{L}\p{N}_]+)\s*(?:\(\s*([\d٠-٩]{1,3})[^)]*\))?[\s.]*/u;
function seriesTag(text = '') {
  const m = String(text).match(SERIES_TAG);
  if (!m) return null;
  const before = text.slice(0, m.index).replace(SEG_EDGE, '').trim();
  const after = text.slice(m.index + m[0].length).replace(SEG_EDGE, '').trim();
  const name = m[1].replace(/_/g, ' ').trim();
  return { name, number: m[2] ? wordToNumber(m[2]) : null, title: [before, after].filter(Boolean).join(' | ') };
}

// What a series episode's title repeats of its series: "الحلقة الثامنة …" before it, "… الحلقة ١٢ :
// مسلسل السيرة النبوية" or "… | #سلسلة_تاريخ_اليمن (7)" after it. → { title, number }.
function seriesEpisodeTitle(text = '') {
  let t = String(text), number = null;
  const tag = seriesTag(t);
  if (tag && tag.title) { number = tag.number; t = tag.title; }
  const tail = t.match(/\s*[|:：\-–—]?\s*(?:ال)?حلق[ةه]\s*[:：]?\s*([\d٠-٩]{1,3}|ال\S+)\s*[:：]?\s*(?:مسلسل\s.*)?$/u);
  if (tail && tail.index > 0 && (tail[0].includes('مسلسل') || /^[\d٠-٩]/.test(tail[1]) || wordToNumber(tail[1]) != null || /^الاخير/.test(normalizeArabic(tail[1])))) {
    number ??= wordToNumber(tail[1]);
    t = t.slice(0, tail.index);
  }
  // A marker starting a segment ("الحلقة الثامنة ماحدث للسامري …", "الحلقة 3: حرب أكتوبر", "… | الحلقة 3 |
  // حرب أكتوبر"): the segment goes with it when nothing follows.
  const kept = [];
  for (const seg of splitPipes(t)) {
    const lead = seg.match(/^(?:ال)?حلق[ةه]\s*[:：]?\s*([\d٠-٩]{1,3}(?![\d٠-٩])|ال\S+(?:\s+عشر[ةه]?)?)\s*[:：\-–—]?\s*(.*)$/u);
    if (lead && wordToNumber(lead[1]) != null) { number ??= wordToNumber(lead[1]); if (lead[2].trim()) kept.push(lead[2].trim()); }
    else kept.push(seg);
  }
  t = kept.join(' | ');
  return { title: t.replace(SEG_EDGE, '').trim(), number };
}

/**
 * Is an 'ar-films' playlist a series rather than a topic collection ("شخصيات", "الحروب", "كوارث
 * طبيعية")? Its title says so ("سلسلة …"), or at least half of its videos' titles are numbered episodes
 * of it ("ملوك اليمن القديم(12) …", "الحلقة 3") or start with its name followed by a separator.
 */
export function arFilmsPlaylistIsSeries(playlistTitle = '', videoTitles = [], brands = []) {
  if (isGenericPlaylist(playlistTitle, brands)) return false;
  const name = arFilmsPlaylistName(playlistTitle, brands);
  if (!name) return false;
  if (splitPipes(cleanTitle(String(playlistTitle))).some((p) => /^سلسل[ةه]\s/u.test(p))) return true;
  if (!videoTitles.length) return false;
  const key = normalizeArabic(name);
  let hits = 0;
  for (const t of videoTitles) {
    const segs = arFilmSegments(t, brands);
    const nt = numberedTitle(segs);
    const head = segs[0] || '';
    if (nt && (normalizeArabic(nt.name) === key || similarity(nt.name, name) >= 0.8)) { hits++; continue; }
    if (seriesTag(segs.join(' | '))) { hits++; continue; }
    if (episodeNumberFromTitle(segs.join(' | ')) != null) { hits++; continue; }
    const m = head.match(/^(.{2,}?)\s*(?:[:：]|\.\.+|…|\s[-–—]+\s)/u);
    if ((m && normalizeArabic(m[1]) === key) || (segs.length >= 2 && normalizeArabic(segs[0]) === key)) hits++;
  }
  return hits / videoTitles.length >= 0.5;
}

/**
 * 'ar-films': every upload is a standalone film titled by its segments without labels and brands
 * (arFilmSegments; a descriptive subtitle stays: "الحياة في ليسوتو | كيف يعيش الناس في …"), except
 * - in a series playlist (a playlistTitle with playlistGeneric false and playlistSeries not false; the
 *   catalogue should pass one only when arFilmsPlaylistIsSeries holds): an episode of the playlist's
 *   series, without the series name, numbers and episode markers in its title;
 * - a series hashtag ("… #سلسلة_عالم_الملكوت (3)"): an episode of the series it names;
 * - a numbered title ("ملوك اليمن القديم(16) …", "تاريخ الأمازيغ (جزء 2) | …"): an episode of the series it names;
 * - a part of a multi-part film ("فهم التوحد - الجزء الأول"): a part of that film.
 */
function parseArFilms(title, ctx) {
  const brands = ctx.brands || [];
  const segs = arFilmSegments(title, brands);
  const text = segs.join(' | ') || cleanTitle(String(title ?? '')).trim();
  const numbered = numberedTitle(segs);
  const plName = ctx.playlistTitle && !ctx.playlistGeneric && ctx.playlistSeries !== false ? arFilmsPlaylistName(ctx.playlistTitle, brands) : '';
  if (plName) {
    const key = normalizeArabic(plName);
    let episodeTitle = text, number = null;
    if (numbered && (normalizeArabic(numbered.name) === key || similarity(numbered.name, plName) >= 0.8)) { episodeTitle = numbered.rest; number = numbered.number; }
    else {
      // "مصر في عهد السادات | الحلقة 3: حرب أكتوبر": the series name as a segment of its own.
      const rest = segs.length >= 2 ? segs.filter((s) => normalizeArabic(s) !== key).join(' | ') : text;
      episodeTitle = stripShowPrefix(rest, plName); number = numbered?.number ?? null;
    }
    const own = seriesEpisodeTitle(episodeTitle);
    episodeTitle = own.title;
    if (normalizeArabic(episodeTitle) === key) episodeTitle = '';
    number ??= own.number ?? episodeNumberFromTitle(episodeTitle);
    return { showTitle: plName, episodeTitle: episodeTitle || (number != null ? `الحلقة ${number}` : 'الحلقة الكاملة'), number, kind: 'series' };
  }
  // "غموض الأحلام: كيف يصنع الدماغ أحلامنا؟ #سلسلة_عالم_الملكوت (3)": the hashtag names the series.
  const tag = seriesTag(text);
  if (tag && tag.title && normalizeArabic(tag.name).split(' ').length >= 2) {
    return { showTitle: tag.name, episodeTitle: tag.title, number: tag.number, kind: 'series' };
  }
  if (numbered) {
    const label = numbered.part ? `الجزء ${numbered.number}` : `الحلقة ${numbered.number}`;
    return { showTitle: numbered.name, episodeTitle: numbered.rest || label, number: numbered.number, kind: 'series' };
  }
  // "تاريخ الأمازيغ (جزء 2) | الرحلة المنسية …", "فهم التوحد - الجزء الأول": the name before the marker.
  const pm = (segs[0] || '').match(/^(.+?)\s*[(\[]?\s*(?:الجزء|جزء)\s*[:：]?\s*([\d٠-٩]{1,2}|ال\S+)\s*[)\]]?\s*[:：\-–—]?\s*(.*)$/u);
  const partNo = pm ? wordToNumber(pm[2]) : null;
  const partName = pm ? pm[1].replace(/[\s\-–—ـ:،(]+$/u, '').trim() : '';
  if (partNo != null && normalizeArabic(partName).split(' ').length >= 2) {
    const rest = [pm[3].trim(), ...segs.slice(1)].filter(Boolean).join(' | ');
    return { showTitle: partName, episodeTitle: rest ? `الجزء ${partNo} - ${rest}` : `الجزء ${partNo}`, number: partNo, kind: 'series' };
  }
  return { showTitle: text, episodeTitle: FILM_EPISODE, number: null, kind: 'film' };
}

// ---------------------------------------------------------------------------------------------
// English channels
// ---------------------------------------------------------------------------------------------

const EN_BRANDS = [
  /^(national geographic|nat ?geo( wild)?|a national geographic youtube original series|national geographic youtube original series)$/i,
  /^(dw( documentary| news)?|deutsche welle)$/i,
  /^(frontline( pbs)?( \| official)?|frontline\/world|frontline \(pbs\)|pbs|frontline \+ @?associated press)$/i,
  /^(history|history channel|the history channel|a&e)$/i,
  /^(free docu?m\w*( -)?( history| nature)?|fd history|fd nature|free documentary history|history documentary)$/i,
  /^(vice( news)?|vice news tonight)$/i,
  /^(kurzgesagt( – in a nutshell)?|veritasium|fern|hoog|jcs(\s*-\s*criminal psychology)?)$/i,
  /^(nat ?geo (animals|wild)|curiosity ?stream(ing)?|discovery( channel)?|(season \d+\s+)?i?\s*welt( hd)?( documentary)?|welt)$/i,
  /^(c'est pas sorcier|it'?s not rocket science)$/i,
  /^(documentary special|documentary|full documentary|full episode|official series playlist|all episodes|all parts|official trailer)$/i,
];
const norm = (s) => String(s).replace(/[’'"“”]/g, "'").replace(/\s+/g, ' ').trim();
// YouTube serves localized titles for some English uploads; these Arabic segments are labels, not shows.
const AR_LABELS = /^(الحلق[ةه] الكامل[ةه]|حلق[ةه] كامل[ةه]|الفيلم الكامل|فيلم وثائقي( كامل)?|وثائقي( \S+)?|الجمعي[ةه] الجغرافي[ةه] الوطني[ةه]|المفضل[ةه])$/;
function isBrandingEn(part, brands = []) {
  const p = norm(String(part).replace(/[©®™]/g, '')).toLowerCase().replace(/[.,!]+$/, '');
  if (EN_BRANDS.some((re) => re.test(p))) return true;
  // "Curiosity Stream Original", "A National Geographic Original Series"
  const unbranded = p.replace(/^an?\s+/, '').replace(/\s+(youtube\s+)?originals?(\s+(series|documentary|film))?$/, '').trim();
  if (unbranded !== p && (EN_BRANDS.some((re) => re.test(unbranded)) || brands.some((b) => b && unbranded === norm(b).toLowerCase()))) return true;
  if (hasArabic(p) && (AR_LABELS.test(p.trim()) || isBranding(p))) return true;
  return brands.some((b) => b && p === norm(b).toLowerCase());
}
// Brand-like segments that are nevertheless the name of a show when a playlist or a title names them.
const SHOW_BRANDS = /^vice news tonight$/i;
const isChannelBrandEn = (part, brands = []) => isBrandingEn(part, brands) && !SHOW_BRANDS.test(norm(part).replace(/[.,!]+$/, ''));
// "VICE News Tonight (HBO)", "VICE News Tonight on HBO", "VICE News Tonight on VICE TV": the network is
// not part of the show name. "VICE on HBO" keeps it: without it the name is the channel.
const stripNetworkTag = (s) => {
  const t = String(s).replace(/\s*\(hbo\)\s*$/i, '').trim();
  const u = t.replace(/\s+on\s+(hbo|vice tv)$/i, '').trim();
  return u !== t && SHOW_BRANDS.test(u) ? u : t;
};
// The show a "<topic>: VICE News Tonight Full Episode (HBO)" title suffix names, or null.
function showBrandSuffix(part) {
  const t = stripNetworkTag(stripMarkers(String(part).replace(/\s*[(\[]\s*(full segment|segment|preview|hbo)\s*[)\]]\s*$/i, '')));
  return SHOW_BRANDS.test(t) ? t : null;
}
const EN_MARKERS = /\s*[\(\[]?\s*(?<![\p{L}\p{N}])(full (episodes?|documentar(?:y|ies)|films?|movies?|specials?|series)|mega episodes?|full ep\.?|complete (episodes?|documentar(?:y|ies))|hd|4k|official)(?![\p{L}\p{N}])\s*[\)\]]?\s*/giu;
// '(Official Clip)', '[Official Trailer]': 'official' qualifies the bracketed label, which stays ('(Clip)');
// removing it with the opening bracket alone left 'Clip)'.
const OFFICIAL_LABEL = /([([])\s*official\s+(?=[^)\]]*[\p{L}\p{N}][^)\]]*[)\]])/giu;
const stripMarkers = (s) => norm(String(s).replace(OFFICIAL_LABEL, '$1').replace(EN_MARKERS, ' ')).replace(/^[\s|:\-–—]+|[\s|:\-–—]+$/g, '').replace(/\(\s*\)|\[\s*\]/g, '').trim();
// Promotional title segments ("LIVESTREAM", "BRAND NEW SERIES", "New Episodes Tuesdays at 9/8c",
// "S1 MEGA EPISODE", "Season 1 Full Episodes", "MEGA EPISODE Compilation", "Mon Sep 4 9p",
// "Friday @ 9pm on Discovery") never name a show.
const EN_PROMO = /^(🔴\s*)?(live ?streams?|live|brand new( series| episodes?)?|all[- ]new( episodes?)?|new (drama )?(series|episodes?|season)\b.*|(series |season )?premieres?\b.*|(now )?streaming (now|on)\b.*|watch (now|more|the full|full)\b.*|coming soon\b.*|(mega episodes?|compilation)( compilation)?|((season|s)\s*\d{1,2}\s*)?(mega episodes?|full episodes?|episodes?)( compilation)?|.*\b\d{1,2}(:\d{2})?\s*\/\s*\d{1,2}(:\d{2})?\s*c\b.*|.*\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\b.*(\b|@\s*)\d{1,2}(:\d{2})?\s*(a|p)m?\b.*)$/i;
// Broadcast promos: a time slot, a premiere, new episodes.
const AIRING = /\b\d{1,2}(:\d{2})?\s*\/\s*\d{1,2}(:\d{2})?\s*c\b|\b\d{1,2}(:\d{2})?\s*(a|p)m?\b|\b(premieres?|premiering|airs|returns|finale|all[- ]new|new (episodes?|series|season))\b/i;
// "🔴 LIVE: Investigating the World's Biggest Sharks": the live tag is not part of the title.
const LIVE_PREFIX = /^(🔴\s*)?live\s*[:\-–—]\s*/i;
const isPromoEn = (part) => {
  const p = norm(part).replace(/[.,!]+$/, '').trim();
  return EN_PROMO.test(p) || !stripMarkers(p);
};
// Show names of 2 characters or fewer are parser leftovers ("s" from "MEGA Episodes", "s)"), never a
// real show ("Vs." is 3 and stays).
const tooShort = (s) => { const t = String(s ?? '').trim(); return t.length <= 2 || !normalizeArabic(t); };

// "S2 E5", "Season 2, Episode 5", "Season 2 Episode 5", "Episode 5", "Ep. 5", "Part 2", "(2/3)", "(S1)".
// The S must start a word ("Ships 100", "America's 10" carry no season) and numbers end at a non-digit.
function enNumbers(text) {
  const t = String(text);
  let season = null, number = null, total = null;
  let m;
  if ((m = t.match(/(?<![A-Za-z0-9'])S(?:eason)?\s*\.?\s*(\d{1,2})(?!\d)\s*[,:\-–—]?\s*(?:E(?:p(?:isode)?)?\.?\s*(\d{1,3})(?!\d))?/i))) { season = parseInt(m[1], 10); if (m[2]) number = parseInt(m[2], 10); }
  if (number == null && (m = t.match(/\b(?:Episode|Ep\.?|E)\s*(\d{1,3})\b/i))) number = parseInt(m[1], 10);
  if (number == null && (m = t.match(/\bPart\s*(\d{1,2})(?:\s*(?:of|\/)\s*(\d{1,2}))?\b/i))) { number = parseInt(m[1], 10); if (m[2]) total = parseInt(m[2], 10); }
  if (number == null && (m = t.match(/\(\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\)/))) { number = parseInt(m[1], 10); total = parseInt(m[2], 10); }
  return { season, number, total };
}
// Same markers, removed. "Season 3 of 'X'" loses the "of" too.
const EN_NUM_RE = /\s*[\(\[]?\s*(?:(?<![A-Za-z0-9'])S(?:eason)?\s*\.?\s*\d{1,2}(?!\d)(?:\s+of(?=\s+\D))?\s*[,:\-–—]?\s*(?:E(?:p(?:isode)?)?\.?\s*\d{1,3}(?!\d))?|(?<![A-Za-z0-9])(?:Episode|Ep\.?)\s*\d{1,3}(?!\d)\s*:?|(?<![A-Za-z0-9])Part\s*\d{1,2}(?!\d)(?:\s*(?:of|\/)\s*\d{1,2}(?!\d))?|\(\s*\d{1,2}\s*\/\s*\d{1,2}\s*\))\s*[\)\]]?\s*/gi;
const stripNumbers = (s) => norm(String(s).replace(EN_NUM_RE, ' ')).replace(/^[\s|:\-–—,]+|[\s|:\-–—,]+$/g, '').trim();
const FILM_EN = 'Full film';

// Compilations. Nat Geo glues "MEGA EPISODE" to the show ("Drain the Oceans MEGA Episode",
// "Tucci in Italy S1 MEGA Episode"); on its own ("S1 MEGA EPISODE", "MEGA EPISODE Season 1 Full
// Episodes") it is a promo segment. HISTORY glues "*Marathon*" to the episode ("Cosmic Clues Through
// Time *Marathon* | Ancient Aliens"), so that marker is only dropped.
const MEGA_SPLIT = /^(.*?)\s*(?<![\p{L}\p{N}])mega[- ]episodes?(?:\s+(?:compilation|special))?(?![\p{L}\p{N}])\s*(.*)$/iu;
// "Back to School Special", "24th Anniversary", "Documentary": a label, not a show.
const NOT_A_SHOW = /^(documentary|special|documentary special)$|\b(special|anniversary|edition)$/i;
/** { name, rest, bare } of a segment carrying a MEGA EPISODE marker, or null. */
function megaParts(part) {
  const m = String(part).match(MEGA_SPLIT);
  if (!m) return null;
  const name = stripNumbers(stripMarkers(m[1])).replace(/\s*\bcompilation$/i, '').trim();
  const sep = /^[:\-–—]/.test(m[2]);
  const after = stripNumbers(stripMarkers(m[2].replace(/^[\s:\-–—]+/, ''))).replace(/^(compilation|special)$/i, '').trim();
  if (!sep && after && name) return null; // "MEGA Episode" inside a longer phrase
  const named = !!name && !tooShort(name) && !NOT_A_SHOW.test(name) && !isPromoEn(name);
  return { name: named ? name : '', rest: sep ? after : '', bare: !named && !after };
}
const MARATHON = String.raw`(?:(?<![\p{L}\p{N}])(?:super|epic|mega|full[- ]episodes?|\d{1,2}[- ]hours?)[\s-]+)?(?<![\p{L}\p{N}])marathons?(?![\p{L}\p{N}])`;
// "*MARATHON*", "SUPER MARATHON", "2 HOUR MARATHON", "Full Episode Marathon"
const BARE_MARATHON = new RegExp(`^\\*?\\s*${MARATHON}\\s*\\*?$`, 'iu');
const MARATHON_TAIL = new RegExp(`\\s*(\\*?)\\s*(${MARATHON})\\s*\\*?\\s*$`, 'iu');
// Drops a marker closing a segment when it is starred, capitalised or qualified ("*Marathon*",
// "MARATHON", "2 Hour Marathon"); a plain "Marathon" only when another segment carries the show
// ("Christmas Day Marathon | The Incredible Dr. Pol"), so "Inside the Boston Marathon" stays.
function stripMarathon(part, multi) {
  const m = String(part).match(MARATHON_TAIL);
  if (!m || m.index === 0) return part;
  const marked = m[1] === '*' || /[\s-]/.test(m[2].trim()) || /^MARATHONS?$/.test(m[2].trim()) || multi;
  return marked ? part.slice(0, m.index).trim() : part;
}
// "Roadside Relics and Risky Big-Ticket Finds *Marathon* American Pickers": a starred marker between
// words works like a pipe.
const STARRED_BREAK = new RegExp(`\\s+(\\*\\s*${MARATHON}\\s*\\*)\\s+(?=\\S)`, 'giu');
// "Full Episode" alone says the video is an episode; unlike other promo segments it does not make
// the playlist less trustworthy as the show.
const BARE_FULL = /^[(\[]?\s*(full (episodes?|ep\.?)|complete episodes?)\s*[)\]]?$/i;

// A title that is only a number marker keeps its own wording ("Part 2 of 3", "Episode 4", "Season 8")
// instead of a made-up "Episode N".
function numberLabel(text, nums) {
  const t = norm(text || '');
  if (nums.number != null && /\bpart\b|\(\s*\d{1,2}\s*\/\s*\d{1,2}\s*\)/i.test(t)) return nums.total ? `Part ${nums.number} of ${nums.total}` : `Part ${nums.number}`;
  if (nums.number != null) return `Episode ${nums.number}`;
  return stripMarkers(t).replace(/^[(\[]\s*|\s*[)\]]$/g, '') || null;
}

const EN_SEASON_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const SEASON_NO = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const seasonNo = (s) => (/^\d+$/.test(s) ? parseInt(s, 10) : EN_SEASON_WORDS[s.toLowerCase()] ?? null);
// "X: Season: 8", "X (Season 11)", "X - Season 2", "X : Season One"
const PL_SEASON_TAIL = new RegExp(`\\s*[:\\-–—,(]?\\s*\\bseason\\s*[:#.]?\\s*${SEASON_NO}\\s*\\)?\\s*$`, 'i');
const PL_SEASON_ONLY = new RegExp(`^season\\s*[:#.]?\\s*${SEASON_NO}$`, 'i');
const PL_SEASON_PART = new RegExp(`^(.*?)[\\s:,\\-–—]*\\bseason\\s*[:#.]?\\s*${SEASON_NO}$`, 'i');
// "- Official Playlist", ": Official Series Playlist", ": Official Series"
const PL_OFFICIAL_TAIL = /\s*[-–—:]?\s*\bofficial(\s+series)?(\s+playlist)?\s*$/i;
// "X Full Episodes", "X: FULL EPISODES", "X - Full Episode", "X: Full Episode Marathons";
// "Full Episodes - X", "Full Episodes: X"
const PL_FULL_TAIL = /\s*[-–—:]?\s*\bfull episodes?( marathons?)?\s*$/i;
const PL_FULL_HEAD = /^full episodes?\s*[-–—:]\s*/i;
// "VICE News Tonight Segments (HBO)": clips of that show.
const PL_SEGMENTS_TAIL = /\s+(full )?segments?$/i;

/**
 * Playlist title → show name for English channels ("Tucci in Italy | National Geographic",
 * "X: Official Series Playlist | History", "The Curse of Oak Island: Season: 8 | New Episodes Tuesdays at 9/8c",
 * "Vikings: Season 2 - Official Playlist", "Season 6 | VICE on HBO", "VICE News Tonight Full Episodes (HBO)",
 * "VICE News Tonight on VICE TV"). The season a playlist is about is returned separately. `name` is ''
 * when the title names no show (brand, promo or collection segments only, or a leftover of 2
 * characters or fewer).
 */
export function englishPlaylistShow(playlistTitle = '', brands = []) {
  let parts = splitPipes(norm(cleanTitle(playlistTitle))).filter((p) => !isChannelBrandEn(p, brands) && !isPromoEn(p) && !isCollectionName(p, brands) && !LEAD_COLLECTION.test(p) && !BARE_MARATHON.test(p));
  let season = null;
  // "Season 6 | VICE on HBO": the season comes first, the series after it.
  const lead = parts[0] && parts[0].match(PL_SEASON_ONLY);
  if (lead) { season = seasonNo(lead[1]); parts = parts.slice(1); }
  let name = stripNetworkTag(parts[0] || '');
  name = name.replace(PL_OFFICIAL_TAIL, '').replace(PL_FULL_TAIL, '').replace(PL_FULL_HEAD, '');
  name = stripNetworkTag(name);
  if (SHOW_BRANDS.test(name.replace(PL_SEGMENTS_TAIL, ''))) name = name.replace(PL_SEGMENTS_TAIL, '');
  const tail = name.match(PL_SEASON_TAIL);
  if (tail) {
    const rest = name.slice(0, tail.index).replace(/[\s:\-–—,]+$/, '').trim();
    if (rest) { season = season ?? seasonNo(tail[1]); name = rest; }
  }
  name = name.replace(/:\s*(official series playlist|all episodes|all parts|full episodes|season \d+)\s*$/i, '').trim();
  name = name.replace(PL_OFFICIAL_TAIL, '').replace(/\s*\((documentary series|\d+-part documentary series|series)\)\s*$/i, '').trim();
  // "History's Greatest Mysteries | Season 2", "She's Running | VICE News : Season 1"
  if (season == null) {
    for (const p of parts.slice(1)) {
      const m = p.match(PL_SEASON_PART);
      if (m && (!m[1] || isBrandingEn(m[1], brands))) { season = seasonNo(m[2]); break; }
    }
  }
  if (!name || tooShort(name) || isPromoEn(name) || isCollectionName(name, brands) || isChannelBrandEn(name, brands)) name = '';
  return { name, season };
}

/**
 * The cleaned show name a playlist title denotes, or '' for collections, uploads/favourites lists and
 * brand-only titles. `src` is the channel source ({ lang, profile, brands, title, short }).
 * English: englishPlaylistShow (season, "Official Playlist", "Full Episodes" and "(HBO)" stripped).
 * Arabic: branding segments dropped; DW "سلسلة وثائقيات | X" series give X; 'ar-show' and 'ar-films'
 * playlists their programme (arShowPlaylist) or series name (arFilmsPlaylistName).
 */
export function playlistShowName(title = '', src = {}) {
  const t = cleanTitle(String(title ?? '')).replace(/\s+/g, ' ').trim();
  if (!t || /^__uploads__$/i.test(t)) return '';
  const brands = src?.brands || [src?.title, src?.short].filter(Boolean);
  if (splitPipes(t).some((p, i) => i <= 1 && isCollectionName(p, brands))) return '';
  if ((src?.lang || 'ar') === 'en' || EN_PROFILES.has(src?.profile)) {
    const { name } = englishPlaylistShow(t, brands);
    return name && !GENERIC_PLAYLIST.test(name) ? name : '';
  }
  if (GENERIC_PLAYLIST.test(t)) return '';
  // 'ar-show': "الدحيح - الموسم الثامن - الحلقات الكاملة" → الدحيح; 'ar-films': "سلسلة #ملوك_اليمن_القديم" → ملوك اليمن القديم.
  if (src?.profile === 'ar-show') return arShowPlaylist(t, brands).name;
  if (src?.profile === 'ar-films') return arFilmsPlaylistName(t, brands);
  const parts = stripBranding(splitPipes(t)).filter((p) => !DW_LABELS.test(p));
  const name = (src?.profile === 'dw' && /سلسلة/.test(t) ? dwSeriesName(t) : parts[0]) || '';
  return name && !tooShort(name) ? name : '';
}

/**
 * English "<Show> Full Episodes" playlists ("VICE News Tonight Full Episodes (HBO)", "Modern Marvels |
 * Full Episodes | History") read as generic by name; they are one show's episodes when the name is
 * not a channel brand and at least `share` of the videos' titles mention it (VICE News Tonight:
 * 375 of 398; "National Geographic Full Episodes" names no show).
 */
export function englishPlaylistIsSeries(playlistTitle = '', videoTitles = [], brands = [], share = 0.8) {
  const { name } = englishPlaylistShow(playlistTitle, brands);
  if (!name || !videoTitles.length || GENERIC_PLAYLIST.test(name)) return false;
  const key = normalizeArabic(name);
  if (key.length < 4) return false;
  const hits = videoTitles.filter((t) => ` ${normalizeArabic(decodeEntities(t || ''))} `.includes(` ${key} `)).length;
  return hits / videoTitles.length >= share;
}

// Discovery writes "Episode 🤔⛏️ Show | Discovery": an emoji run between words works like a pipe.
const EMOJI_RUN = /\s*(?:[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}‍️]+\s*)+/gu;
function emojiToPipes(s) {
  // ©®™ are Extended_Pictographic too, but they mark a name ("The HISTORY® Channel"), not a break.
  return s.replace(/[©®™]/g, '').replace(EMOJI_RUN, (m, offset, str) => (offset > 0 && offset + m.length < str.length ? ' | ' : ' ')).replace(/\s+/g, ' ').trim();
}
// "Night Class: Hitler Trailer - Thursday 11:30/10:30c", "X: New Episodes Tuesdays at 9/8c": a promo
// tail after a dash or colon is not part of the title.
function stripPromoTail(part) {
  const segs = String(part).split(/(\s+[-–—]+\s+|:\s+|\s+l\s+)/);
  let cut = false;
  while (segs.length >= 3 && isPromoEn(segs[segs.length - 1])) { segs.splice(-2); cut = true; }
  return cut ? segs.join('').trim() : part;
}
// "Premiere Episode of Naked And Afraid: Apocalypse", "Season 2 Premiere of X", "New Series: X": a
// promo phrase before the title is not part of it.
const PROMO_LEAD = /^(?:(?:the\s+)?(?:(?:series|season(?:\s+\d{1,2})?)\s+)?premiere(?:\s+episode)?\s+of|(?:all[- ]new|(?:brand\s+)?new)\s+(?:series|season|episodes?)\s*[:\-–—])\s+/i;
function stripPromoLead(part) {
  const rest = String(part).replace(PROMO_LEAD, '');
  return rest !== part && !tooShort(stripMarkers(rest)) ? rest : part;
}
// The text after a leading name, compared by `keyOf` (case, punctuation, markers and numbers do not
// count): "Swamp People: Serpent Invasion: DANGER (Season 2)" after "Swamp People: Serpent Invasion"
// is "DANGER (Season 2)", and '' when the text is only the name ("The Crux Episode 4": only the name
// and a number). null when the text does not start with the name, or when the name only begins a
// phrase ("Venezuela Is Losing Its War", "Titanic's Lookout"). With `spaced`, a plain space also ends
// the name: a two-part name is distinctive ("Genius: Aretha Chain of Fools Trailer").
const QUOTE = /['"“”‘’]/;
const TWO_PART = /[:：]|\s[-–—]\s/; // "Show: Subtitle", "Show - Subtitle"
const OPEN_OR_CLOSE_QUOTE = /(?<![\p{L}\p{N}])['"“”‘’]|['"“”‘’](?![\p{L}\p{N}])/gu; // not apostrophes
function afterName(text, nameKey, keyOf, spaced = false) {
  if (!nameKey) return null;
  const k = keyOf(text);
  if (k !== nameKey && !k.startsWith(`${nameKey} `)) return null;
  const word = /[\p{L}\p{N}]/u;
  for (let i = 1; i <= text.length; i++) {
    if (i < text.length && word.test(text[i]) && word.test(text[i - 1])) continue; // inside a word
    if (keyOf(text.slice(0, i)) !== nameKey) continue;
    let tail = text.slice(i);
    // The quote that closes a quoted name ("Season 3 of 'The Secret of Skinwalker Ranch'") is the name's.
    const closed = (text.slice(0, i).match(OPEN_OR_CLOSE_QUOTE) || []).length % 2 === 1 && QUOTE.test(tail.trim()[0] || '');
    if (closed) tail = tail.trim().slice(1);
    const gap = tail.match(/^[^\p{L}\p{N}]*/u)[0];
    const rest = tail.replace(/^[^\p{L}\p{N}(\['"“‘]+/u, '').trim()
      .replace(/^[(\[]([^()\[\]]*)[)\]]$/, '$1').trim(); // "Warlords of Tripoli (Trailer)" → "Trailer"
    if (!word.test(rest)) return '';
    if (closed || /[:|\-–—(\[,!?\/]/.test(gap) || (/^\s+$/.test(gap) && (spaced || !stripNumbers(rest)))) return rest;
  }
  return null;
}

/** Generic English: "Episode | Show | Brand" or film. Sub-variants tweak the details. */
function parseEnglish(title, ctx) {
  const raw = emojiToPipes(norm(decodeEntities(String(title ?? '')))).replace(STARRED_BREAK, ' | $1 | ');
  const brands = ctx.brands || [];
  const parts = splitPipes(raw).filter((p) => !isBrandingEn(p, brands));
  if (ctx.profile === 'dash-show') {
    // Single-show channels ("Why do we die if we don't breathe? - C'est pas sorcier"): every video
    // is an episode of the channel's show, unless a segment names another known show (e.g. the
    // English dub "It's Not Rocket Science"). Variants like "[Intégrale]", "(Best of)", "Repost"
    // and a trailing brand mention without a dash are stripped from the episode title.
    const shows = [...brands, "It's Not Rocket Science"].filter(Boolean);
    const canon = (s) => norm(s).replace(/\s*[\[\(][^\]\)]*[\]\)]\s*/g, ' ').replace(/\b(repost|intégrale|integrale|compilation|best of)\b/gi, ' ').replace(/[!?.]+$/, '').replace(/\s+/g, ' ').trim();
    const isShow = (s) => shows.find((b) => canon(b).toLowerCase() === canon(s).toLowerCase());
    const text = splitPipes(raw).join(' - ');
    const segs = text.split(DASH).map((s) => s.trim()).filter(Boolean);
    let show = null;
    const rest = [];
    for (const s of segs) { const b = isShow(s); if (b && !show) show = b; else rest.push(s); }
    if (!show) {
      // "Comment devenir skieur ? C'est pas sorcier" (brand glued to the question, no dash)
      for (const b of shows) {
        const re = new RegExp(`\\s*${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*!?\\s*(?:[\\[\\(][^\\]\\)]*[\\]\\)])?\\s*$`, 'i');
        if (rest.length && re.test(rest[rest.length - 1])) { rest[rest.length - 1] = rest[rest.length - 1].replace(re, '').trim(); show = b; break; }
      }
    }
    show = show || shows[0] || raw;
    const ep = rest.map((s) => s.replace(/\s*[\[\(](intégrale|integrale|compilation|best of|repost)[\]\)]\s*/gi, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' - ') || 'Full episode';
    return { showTitle: show, episodeTitle: ep, kind: 'series' };
  }
  const generic = !ctx.playlistTitle || ctx.playlistGeneric;
  const plShow = !generic ? englishPlaylistShow(ctx.playlistTitle, brands) : null;
  const pl = plShow && plShow.name ? plShow : null; // a playlist that names no show gives no context
  const profile = ctx.profile;
  const label = parts.find((p) => /^\(?(interview|full documentary|documentary special|trailer|preview|podcast|q&a)\)?$/i.test(p)) || null;
  const body = parts.filter((p) => p !== label);

  if (profile === 'creator') {
    // Every video is a standalone film; playlists are topic collections.
    return { showTitle: stripMarkers(body.join(' | ')) || raw, episodeTitle: FILM_EN, kind: 'film' };
  }

  if (profile === 'freedoc') {
    // "Show | Episode 3: Title | FD History"  /  "Title | Free Documentary History"  /  "Show | All Episodes | ..."
    const epPart = body.find((p) => /^(episode|ep\.?|part)\s*\d*\s*[:\-–—]?/i.test(p));
    if (epPart && body.length >= 2) {
      const nums = enNumbers(epPart);
      const show = body[0] === epPart ? body[1] : body[0];
      // "The Stuarts - A Bloody Reign | Episode 1 | James I": the episode's name is the next segment.
      const rest = body.filter((p) => p !== epPart && p !== show && !isPromoEn(p)).map((p) => stripNumbers(stripMarkers(p))).filter(Boolean).join(' - ');
      const ep = stripNumbers(epPart.replace(/^(episode|ep\.?|part)\s*\d*\s*[:\-–—]?\s*/i, '')) || rest || numberLabel(epPart, nums) || 'Episode';
      return { showTitle: stripMarkers(show), episodeTitle: ep, number: nums.number, season: nums.season, kind: 'series' };
    }
    if (pl && body.length >= 1 && /all (episodes|parts)/i.test(ctx.playlistTitle)) {
      const nums = enNumbers(body.join(' '));
      if (nums.number != null) return { showTitle: pl.name, episodeTitle: stripNumbers(body.join(' - ')) || numberLabel(body.join(' '), nums), number: nums.number, kind: 'series' };
    }
    return { showTitle: stripMarkers(body[0] || raw), episodeTitle: FILM_EN, kind: 'film' };
  }

  if (profile === 'dw-en') {
    const main = stripMarkers(body[0] || raw);
    const nums = enNumbers(main);
    if (pl && /\(.*series\)/i.test(ctx.playlistTitle)) return { showTitle: pl.name, episodeTitle: stripNumbers(main) || main, number: nums.number, kind: 'series' };
    if (nums.total || /\(\s*\d+\s*\/\s*\d+\s*\)|\bpart\s*\d/i.test(main)) {
      const show = stripNumbers(main);
      if (show.length >= 3) return { showTitle: show, episodeTitle: nums.total ? `Part ${nums.number} of ${nums.total}` : `Part ${nums.number}`, number: nums.number, kind: 'series' };
    }
    return { showTitle: main, episodeTitle: FILM_EN, kind: 'film' };
  }

  if (profile === 'frontline') {
    // Mostly films; a title may carry a subtitle part ("Inside the Fight | Hong Kong: Chasing the Virus").
    const main = stripMarkers(body.join(' — '));
    const lbl = label ? label.replace(/[()]/g, '').trim() : null;
    if (pl && /episodes?$/i.test(ctx.playlistTitle) === false && body.length >= 2 && norm(body[1]).toLowerCase() === pl.name.toLowerCase()) {
      return { showTitle: pl.name, episodeTitle: stripMarkers(body[0]), kind: 'series', label: lbl };
    }
    return { showTitle: main || raw, episodeTitle: FILM_EN, kind: 'film', label: lbl };
  }

  return unquoteShow(parseEnglishSeries(raw, body, pl, brands));
}

// "Season 3 of “The Secret of Skinwalker Ranch”" leaves the quotes around the show name.
const unquoteShow = (r) => (r && typeof r.showTitle === 'string' ? { ...r, showTitle: r.showTitle.replace(/^'([^']{3,})'$/, '$1') } : r);
const definedNums = (n) => Object.fromEntries(Object.entries(n).filter(([, v]) => v != null));

/**
 * natgeo-en, history, generic-en: "Episode | Show" with markers/numbers on either side. Promo and
 * collection segments ("LIVESTREAM", "BRAND NEW SERIES", "New Episodes Tuesdays at 9/8c",
 * "S1 MEGA EPISODE", "*MARATHON*", "National Geographic Documentary Films") never name the show;
 * they only lend their season number.
 */
function parseEnglishSeries(raw, body, pl, brands) {
  const isAux = (p) => isPromoEn(p) || isCollectionName(p, brands) || BARE_MARATHON.test(p) || !!megaParts(p)?.bare;
  const aux = body.filter(isAux);
  const allAux = aux.length === body.length;
  const kept = allAux ? body.slice(0, 1) : body.filter((p) => !isAux(p));
  let marathon = aux.some((p) => BARE_MARATHON.test(p));
  // Promo tails cut off a content segment: they follow the title.
  const tails = [];
  let leadPhrase = null;
  const content = kept.map((p, i) => {
    // Every segment is a promo: the first one is the title, without its leading promo phrase
    // ("Premiere Episode of Naked And Afraid: Apocalypse").
    const lead = allAux && i === 0 ? stripPromoLead(p) : p;
    if (lead !== p) leadPhrase = p.slice(0, p.length - lead.length).replace(/\s+of\s*$|[\s:\-–—]+$/gi, '');
    const cut = stripPromoTail(lead);
    if (cut !== lead) { aux.push(lead.slice(cut.length)); tails.push(lead.slice(cut.length)); }
    const plain = stripMarathon(cut, kept.length > 1);
    if (plain !== cut) marathon = true;
    return plain.replace(LIVE_PREFIX, '') || plain;
  });
  // A season in a compilation segment ("S1 MEGA EPISODE", "Season 1 Full Episodes") is the season of
  // the show the title names; one in a promo tail ("Season 2 Premieres April 21") is the season of
  // the show before the colon.
  const isCompilationAux = (p) => !!megaParts(p) || /\b(full episodes?|compilation)\b/i.test(p);
  const seasonOf = (list) => list.map((p) => enNumbers(p).season).find((s) => s != null) ?? null;
  const auxSeason = seasonOf(aux);
  const promoSeason = seasonOf(aux.filter((p) => !isCompilationAux(p)));
  // "Vikings: Bjorn Says Goodbye | The Ice Maiden Airs Jan. 15 at 10/9c": a broadcast promo for an
  // episode of the show before the colon. Only a promo after the title counts: one before it
  // ("New Series, New Survival Battles | Naked and Afraid: Global Showdown") announces the show the
  // whole title names, and a title that is itself the promo segment is not its own airing slot.
  const titleAt = body.indexOf(kept[0]);
  const airing = [...body.slice(titleAt + 1).filter(isAux), ...tails].some((p) => AIRING.test(p));
  const announcedBy = leadPhrase != null ? [leadPhrase] : body.slice(0, titleAt).filter((p) => isAux(p) && AIRING.test(p));
  // Such a promo is the only name an episode titled with just its show's name has.
  const promo = stripNumbers(stripMarkers(announcedBy.join(' - ')));
  // Compilations and promo segments are not the show's own episodes: the playlist then is only the
  // show when the title refers to it. A bare "Full Episode" segment does not count.
  const compilation = marathon || aux.some((p) => megaParts(p)) || content.some((p) => megaParts(p));
  const distrust = compilation || aux.some((p) => !BARE_FULL.test(p.replace(/^[\s:\-–—]+/, '').trim()));
  const key = (s) => normalizeArabic(stripNetworkTag(stripNumbers(stripMarkers(s))));
  const plKey = pl ? normalizeArabic(pl.name) : '';
  const same = (s) => !!pl && !!s && key(s) === plKey;
  const mentionsPl = (s) => !!pl && ` ${key(s)} `.includes(` ${plKey} `);

  if (content.length >= 2) {
    // "Who Made The Most Innovative Mash?! | Season 12 | Moonshiners | Discovery": a second segment
    // that is only a number marker lends its numbers, and the next segment names the show.
    const markerOnly = (p) => !stripNumbers(stripMarkers(p));
    const marker = content.length >= 3 && markerOnly(content[1]) && !markerOnly(content[2]) ? content[1] : null;
    const segs = marker ? [content[0], ...content.slice(2)] : content;
    let [epRaw, showRaw] = segs;
    const m0 = megaParts(epRaw), m1 = megaParts(showRaw);
    let showName = null;
    if (same(epRaw) && !same(showRaw)) [epRaw, showRaw] = [showRaw, epRaw]; // "Tucci in Italy | Episode" in that playlist
    else if (m0?.name && !m1 && stripNumbers(stripMarkers(showRaw)) && !mentionsPl(m0.name)) { [epRaw, showRaw] = [showRaw, epRaw]; showName = m0.name; } // "Show MEGA Episode | Episode"
    else if (m1?.name) showName = m1.name;
    const nums = { ...enNumbers(showRaw), ...definedNums(enNumbers(marker ?? '')), ...definedNums(enNumbers(epRaw)) };
    let showClean = showName ?? stripNetworkTag(stripNumbers(stripMarkers(showRaw)).replace(/\s*(compilation|mega episode|live ?stream)\s*$/i, ''));
    // "Deadliest Catch Discovery" in the "Deadliest Catch" playlist: the channel's name glued to the show's.
    const glued = pl && !showName ? afterName(showClean, plKey, key, true) : null;
    if (glued && isBrandingEn(glued, brands)) showClean = pl.name;
    if (/^(documentary special|documentary|special)$/i.test(showClean)) return { showTitle: stripNumbers(stripMarkers(epRaw)), episodeTitle: FILM_EN, kind: 'film' };
    if (showClean && !tooShort(showClean)) {
      const extra = segs.slice(2).map((p) => stripNumbers(stripMarkers(p))).filter(Boolean).join(' - ');
      const episodeTitle = stripNumbers(stripMarkers(epRaw)) || extra || numberLabel(epRaw, nums) || 'Full episode';
      return { showTitle: showClean, episodeTitle, number: nums.number, season: nums.season ?? auxSeason ?? pl?.season ?? null, kind: 'series' };
    }
    // "Episode | Season 2 | Brand": the second segment is only a number, read the title as one part.
  }
  const lead = content[0] || raw;
  const mega = megaParts(lead);
  const only = stripMarkers(lead);
  // "Show: Episode Season 2" / "Show: Episode"
  const colon = only.match(/^(.{3,60}?):\s+(.{3,})$/);
  const suffix = only.match(/^(.{3,}):\s+(.{3,})$/); // "Episode: Show (HBO)"
  const nums = { ...enNumbers(content.slice(1).join(' ')), ...definedNums(enNumbers(only)) };
  // "Opioid-Addicted Mothers & Iraq Peace: VICE News Tonight Full Episode (HBO)": the title names the show.
  const named = suffix && showBrandSuffix(suffix[2]);
  if (named) return { showTitle: named, episodeTitle: stripNumbers(suffix[1]) || 'Full episode', number: nums.number, season: nums.season ?? auxSeason, kind: 'series' };
  // "Kingdom of the Mummies S1 MEGA EPISODE Compilation", "Drain The Oceans MEGA EPISODE: Explore Europe".
  if (mega?.name) {
    const season = nums.season ?? auxSeason;
    if (mentionsPl(mega.name)) {
      // "Win or Die: Savage Kingdom MEGA EPISODE" in the Savage Kingdom playlist: the name before the
      // show is the episode's ("The Story of Us with Morgan Freeman MEGA EPISODE" has none).
      const left = key(mega.name).endsWith(` ${plKey}`) ? stripNumbers(mega.name.replace(new RegExp(`${pl.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), ' ')).replace(/^[\s:\-–—,]+|[\s:\-–—,]+$/g, '') : '';
      return { showTitle: pl.name, episodeTitle: mega.rest || (tooShort(left) ? '' : left) || 'Full episode', number: nums.number, season: season ?? pl.season, kind: 'series' };
    }
    if (mega.rest || season != null || pl) return { showTitle: mega.name, episodeTitle: mega.rest || 'Full episode', number: nums.number, season, kind: 'series' };
  }
  // A promo before the title announces the show the whole title names (below): in the parent's
  // playlist ("New Series, New Survival Battles | Naked and Afraid: Global Showdown" or "Premiere
  // Episode of Naked And Afraid: Apocalypse" in "Naked and Afraid") that show is a spin-off, not an
  // episode named after the colon. The playlist is still the show when the title is only its name
  // ("New Season Sneak Peek | Alaska: The Last Frontier" in that playlist) or ends with it.
  const announcedOther = !!pl && announcedBy.length > 0 && afterName(only, plKey, key, TWO_PART.test(pl.name)) !== ''
    && !(suffix && same(suffix[2]));
  if (pl && !announcedOther) {
    const ep = colon && same(colon[1]) ? colon[2] : suffix && same(suffix[2]) ? suffix[1] : null;
    // "Swamp People: Serpent Invasion: DANGER IN THE EVERGLADES" in "Swamp People: Serpent Invasion",
    // "Gordon Ramsay: Uncharted | S3 MEGA EPISODE" in "Gordon Ramsay: Uncharted": the title starts with
    // the playlist's whole name, so the episode is what follows it (nothing left: a full episode).
    const own = ep == null ? afterName(only, plKey, key, TWO_PART.test(pl.name)) : null;
    // A promo segment or a compilation marker stood where the show name belongs: only trust the
    // playlist when the title refers to it (topic collections such as "Lifestyle & Entertainment" or
    // "Ancient Civilizations" are not the show).
    // "Critter Fixers: Ready, Vet, Go | MEGA EPISODE" in "Critter Fixers: Country Vets" refers to it too:
    // the title shares the name before the colon and names its own episode after it.
    const prefixOfPl = own == null && colon && key(colon[1]).length >= 4 && plKey.startsWith(`${key(colon[1])} `);
    if (ep != null || own != null || !distrust || prefixOfPl || norm(body.join(' | ')).toLowerCase().includes(pl.name.toLowerCase())) {
      const text = ep ?? own ?? (prefixOfPl ? colon[2] : only);
      // Only a number after the name labels the episode; a season marker ("(Season 2)") is the season.
      const label = own == null ? numberLabel(text, nums) : nums.number != null ? numberLabel([own, ...content.slice(1)].join(' '), nums) : null;
      return { showTitle: pl.name, episodeTitle: stripNumbers(text) || label || promo || 'Full episode', number: nums.number, season: nums.season ?? auxSeason ?? pl.season, kind: 'series' };
    }
  }
  // "The Secret of Skinwalker Ranch Season 2: Title" → the show is "The Secret of Skinwalker Ranch";
  // "Ancient Aliens: Shocking Mysteries from Beyond *Marathon*" → "Ancient Aliens". Only the title's
  // own numbers count: "Erased: WW2's Heroes of Color | S1 MEGA EPISODE" is one show's season.
  if (colon && !tooShort(colon[1]) && (nums.number != null || nums.season != null || promoSeason != null || marathon || airing)) {
    const show = stripNumbers(colon[1]) || colon[1].trim();
    return { showTitle: show, episodeTitle: stripNumbers(colon[2]) || numberLabel(colon[2], nums) || 'Full episode', number: nums.number, season: nums.season ?? auxSeason, kind: 'series' };
  }
  // "Inside North Korea's Dynasty | S1 MEGA EPISODE", "Gordon Ramsay: Uncharted | S3 MEGA EPISODE":
  // a season compilation of the series the title names.
  // "Season 3 of 'The Secret of Skinwalker Ranch' - New Episodes Wednesdays at 9/8c": that season's promo.
  const season = auxSeason != null && promoSeason == null ? auxSeason : airing ? nums.season : null;
  if (season != null && nums.number == null && !tooShort(stripNumbers(only))) return { showTitle: stripNumbers(only), episodeTitle: 'Full episode', number: null, season, kind: 'series' };
  // "New Series, New Survival Battles | Naked and Afraid: Global Showdown", "Premiere Episode of Naked
  // And Afraid: Apocalypse": a promo before the title announces the series the whole title names.
  if (announcedBy.length && !tooShort(stripNumbers(only))) {
    return { showTitle: stripNumbers(only), episodeTitle: promo || numberLabel('', nums) || 'Full episode', number: nums.number, season: nums.season ?? auxSeason, kind: 'series' };
  }
  return { showTitle: stripNumbers(only) || only, episodeTitle: FILM_EN, kind: 'film' };
}

const PROFILES = {
  natgeo: parseNatGeo, asharq: parseAsharq, dw: parseDW, aljazeera: parseAlJazeera, generic: parseGeneric,
  // Arabic channels sources.json files by kind: named programmes, or documentary films (series only
  // in series playlists or numbered titles).
  'ar-show': parseArShow, 'ar-films': parseArFilms,
  'natgeo-en': parseEnglish, 'dw-en': parseEnglish, frontline: parseEnglish, history: parseEnglish, freedoc: parseEnglish, creator: parseEnglish, 'generic-en': parseEnglish, 'dash-show': parseEnglish,
};
export const EN_PROFILES = new Set(['natgeo-en', 'dw-en', 'frontline', 'history', 'freedoc', 'creator', 'generic-en', 'dash-show']);
export const FILM_EPISODE_TITLE_EN = FILM_EN;

/**
 * Parse a video title for a given channel profile.
 * @param {string} title
 * @param {{ profile?: string, playlistTitle?: string|null, playlistGeneric?: boolean, playlistSize?: number }} ctx
 * @returns {{ showTitle: string|null, episodeTitle: string, number?: number|null, season?: number|null, kind?: 'series'|'film', label?: string|null }}
 */
export function parseTitle(title, ctx = {}) {
  const fn = PROFILES[ctx.profile] || (ctx.lang === 'en' ? parseEnglish : parseGeneric);
  const r = fn(title, ctx) || {};
  const episodeTitle = r.episodeTitle || String(title);
  return {
    showTitle: r.showTitle ?? null,
    episodeTitle,
    number: r.number ?? episodeNumberFromTitle(episodeTitle),
    season: r.season ?? seasonNumberFromTitle(episodeTitle),
    kind: r.kind || 'series',
    label: r.label ?? null,
  };
}

// Backwards-compatible helper (Nat Geo behaviour).
export function parseVideoTitle(title = '', playlistTitle = '') {
  return parseTitle(title, { profile: 'natgeo', playlistTitle, playlistGeneric: isGenericPlaylist(playlistTitle) });
}

export const FILM_EPISODE_TITLE = FILM_EPISODE;

// ---------------------------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------------------------

// A hashtag: '#' that starts a word (line start, space, punctuation or an invisible mark before it) and
// whose tag has a letter. Entity text ("&#8216;", "&amp;#039;"), "C#" and ranks such as "#3" or "#10"
// inside prose are not hashtags.
const HASHTAG = /(?<![\p{L}\p{N}&_#;])#(?=[\p{N}_]*\p{L})[\p{L}\p{N}_]+/u;

// Boilerplate lines found in channel descriptions (Nat Geo AD, Asharq, DW, Al Jazeera).
const BOILERPLATE = [
  /يمكنكم مشاهدة/, /القناة رقم/, /اشتركوا/, /اشترك /, /subscribe/i, /suscr[ií]bete/i, /تابعونا/, /تابعوا /, /https?:\/\//i, /www\./i,
  /facebook/i, /instagram/i, /twitter/i, /\bx\.com/i, /tiktok/i, /youtube\.com/i, /snapchat/i, /telegram/i, /whatsapp/i, /threads/i,
  /نبذة عن ناشونال/, /ناشونال جيوغرافيك أبوظبي هي الوجهة/, /تنقلكم ناشونال/, /you can watch/i,
  /on etisalat/i, /on du\b/i, /on stc/i, /about national geographic/i, /national geographic is the/i,
  /nat geo ad gets you/i, /قوموا بزيارة/, /bit\.ly/i, /\bchannel\s*#\s*\d{2,}/i, /^على (اتصالات|دو|إس تي سي)/,
  /للحصول على آخر المعلومات/, /وسائل التواصل/, /^channel\s*#?\d+/i, /^\s*[-–—•*_=]+\s*$/,
  HASHTAG, /^ناشونال جيوغرافيك أبوظبي\s*$/, /شاهدوا الحلقات الكاملة/, /^ngad$/i,
  /\d{1,2}\s*(am|pm)\b/i, /\b(every|on)\b.*\bnational geographic\b/i, /\bksa\b|\buae\b/i, /بتوقيت (الإمارات|السعودية|أبوظبي|مكة|القاهرة|غرينتش)/,
  /^(الساعة|يوم|كل) .*(مساءً|صباحاً|مساء|صباحا)/, /حصرياً على/, /لا تفوتوا/, /شاهدوا .* (على|عبر) (ناشونال|قناة|الجزيرة|دي دبليو|الشرق)/,
  // DW
  /^وثائقية دي دبليو/, /دي دبليو.*(تقدم|قناة|يوتيوب)/, /للمزيد من (الفيديوهات|الوثائقيات|المعلومات)/, /^DW\b/, /deutsche welle/i,
  /^مرحباً بكم في/, /^أهلاً بكم في/, /المحتوى الوثائقي/, /نرحب بتعليقاتكم/, /نسعد بتعليقاتكم/,
  // Al Jazeera
  /^الجزيرة الوثائقية/, /الجزيرة الوثائقية\s*$/, /قناة الجزيرة الوثائقية/, /موقعنا الإلكتروني/, /^زوروا/, /لمتابعة /, /^الموقع الرسمي/,
  // Asharq
  /^الشرق ديسكفري/, /الشرق ديسكفري\s*$/, /^الشرق\s*$/, /منصة الشرق/, /تطبيق الشرق/, /حمّل التطبيق/, /حمل التطبيق/,
  /يمكنكم متابعة/, /قنواتنا المتخصصة/, /^الشرق\s*now/i, /^المزيد عن/, /^الشرق (ديسكفري|now|وثائقيات|بزنس|الوثائقية)/i, /asharq/i,
  // English channels
  /^(➡|→|►|▶|•|\*)\s*/, /\bsubscribe\b/i, /\bfollow (us|me|national geographic|frontline|history|dw)\b/i, /\bget more\b/i, /\bwatch (more|the full|all)\b/i,
  /about national geographic/i, /national geographic is the world/i, /nat geo (tv|wild)\b.*\b(episodes|watch)/i, /\bmerch\b/i, /\bpatreon\b/i, /\bnewsletter\b/i,
  /sign up/i, /\bdownload (the|our) app\b/i, /\bavailable (now|on)\b.*\b(hulu|disney|pbs|app)/i, /\bstream(ing)? (now|on)\b/i, /\bofficial (site|website|store)\b/i,
  /\bfunding for frontline\b/i, /\bfrontline is (made|supported)/i, /\bmajor support\b/i, /\bcorporation for public broadcasting\b/i, /\bpbs\.org/i, /\bthis program (is|was) (made|produced)/i,
  /\bhistory\.com/i, /\bfind out more\b/i, /\bcheck out\b/i, /\bshop\b.*\bhistory\b/i, /\bnewsletter\b/i, /\bcredits\b:?/i, /\bmusic by\b/i, /\bsources?\b:?\s*$/i,
  /\bdw documentary gives you\b/i, /\bfor more (visit|information|documentaries)\b/i, /\bwe kindly ask\b/i, /\bdocumentary channels?\b.*\b(dw|youtube)/i, /\bplease note\b/i,
  /\bfree documentary\b.*\b(subscribe|channel|facebook|instagram)/i, /\bfree documentary - history is dedicated\b/i, /^#(?!\d)/, /\bvice news\b.*\b(subscribe|more)/i, /\bcheck out vice\b/i,
  /\bkurzgesagt\b.*\b(shop|merch|patreon|newsletter|discord)/i, /\bsupport us\b/i, /\bthanks to\b.*\b(patrons|supporters)/i, /\bbecome a patron\b/i, /\bjoin (us|the)\b/i,
  /\bveritasium\b.*\b(support|patreon)/i, /\bspecial thanks\b/i, /\bwritten by\b/i, /\bedited by\b/i, /\banimation by\b/i, /\bfilmed by\b/i, /\bproduced by\b/i, /\bthumbnail by\b/i,
  /\breferences\b:?\s*$/i, /\bchapters?\b:?\s*$/i, /^\d{1,2}:\d{2}\b/, /\bwatch next\b/i, /\bprevious (video|episode)\b/i, /\btimestamps?\b/i,
];

export function cleanDescription(desc = '') {
  const lines = String(desc).split(/\r?\n/).map((l) => l.trim());
  const kept = [];
  for (const line of lines) {
    if (!line) continue;
    if (BOILERPLATE.some((re) => re.test(line))) continue;
    kept.push(line);
  }
  let text = kept.join('\n').replace(/\n{2,}/g, '\n').trim();
  // Promotional tails glued to the synopsis on the same line.
  const TAILS = [
    /لتصلك آخر المعلومات[\s\S]*$/, /سجل(وا)? على الموقع[\s\S]*$/, /(قم|قوموا) بزيارة موقعنا[\s\S]*$/,
    /للتعرف على مواعيد[\s\S]*$/, /شاهدوا الحلقات الكاملة[\s\S]*$/, /لمزيد من المعلومات[\s\S]*$/,
    /تابعونا[\s\S]*$/, /اشتركوا[\s\S]*$/, /للمزيد من الوثائقيات[\s\S]*$/, /يمكنكم متابعة[\s\S]*$/, /المزيد عن الشرق[\s\S]*$/,
    /\bsubscribe (to|for|now)\b[\s\S]*$/i, /\bfollow (us|frontline|national geographic|history|dw|kurzgesagt|veritasium)\b[\s\S]*$/i, /\bfor more (documentaries|videos|information|on)\b[\s\S]*$/i,
    /\bwatch (more|the full|full episodes)\b[\s\S]*$/i, /\bget more\b[\s\S]*$/i, /\babout national geographic\b[\s\S]*$/i, /\bdw documentary gives you\b[\s\S]*$/i,
    /\bfunding for frontline\b[\s\S]*$/i, /\bthis (video|episode|documentary) (was|is) (made|produced|sponsored)\b[\s\S]*$/i, /\bsources?\s*:[\s\S]*$/i, /\bchapters?\s*:[\s\S]*$/i,
  ];
  for (const re of TAILS) text = text.replace(re, '').trim();
  // Dangling punctuation / conjunctions left behind by the stripping.
  return text.replace(/(\s*[:：،,\-–—]+|\s+(أو|و|ثم|على|في|من|عن|مع))+\s*$/u, '').trim();
}

// Score a candidate synopsis: prefers longer Arabic prose, rejects title echoes.
export function synopsisQuality(text = '', showTitle = '', lang = 'ar') {
  if (!text) return 0;
  if (text.length < 30) return 0;
  if (normalizeArabic(text) === normalizeArabic(showTitle)) return 0;
  const letters = (text.match(/\p{L}/gu) || []).length;
  const arabic = (text.match(/[؀-ۿ]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const ratio = (lang === 'en' ? latin : arabic) / Math.max(1, letters); // share of the section's language
  if (ratio < 0.5) return 0; // mostly another language: not a usable synopsis for this section
  return Math.min(text.length, 500) * (0.15 + ratio * ratio);
}

// Dice coefficient over character bigrams of normalized strings.
export function similarity(a, b) {
  const na = normalizeArabic(a), nb = normalizeArabic(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
    return m;
  };
  const ga = grams(na), gb = grams(nb);
  let inter = 0;
  for (const [g, c] of ga) if (gb.has(g)) inter += Math.min(c, gb.get(g));
  const total = [...ga.values()].reduce((x, y) => x + y, 0) + [...gb.values()].reduce((x, y) => x + y, 0);
  return total ? (2 * inter) / total : 0;
}

// English / French listing text → approximate ms-ago. YouTube writes "3y ago", "5mo ago", "2w ago",
// "12 min ago", "Streamed 3y ago" (also "3 weeks ago", "Premiered 1 month ago", "an hour ago") and,
// in French, "il y a 3 a", "il y a 3 m." (months), "il y a 2 sem.", "il y a 4 j", "Diffusé il y a un an".
const DAY_MS = 864e5;
const unitTable = (rows) => Object.fromEntries(rows.flatMap(([ms, names]) => names.split(' ').map((n) => [n, ms])));
const EN_UNITS = unitTable([[1000, 's sec secs second seconds'], [60e3, 'm min mins minute minutes'], [3600e3, 'h hr hrs hour hours'],
  [DAY_MS, 'd day days'], [7 * DAY_MS, 'w wk wks week weeks'], [30 * DAY_MS, 'mo mos month months'], [365 * DAY_MS, 'y yr yrs year years']]);
const FR_UNITS = unitTable([[1000, 's sec seconde secondes'], [60e3, 'min mn minute minutes'], [3600e3, 'h heure heures'],
  [DAY_MS, 'j jour jours'], [7 * DAY_MS, 'sem semaine semaines'], [30 * DAY_MS, 'm mois'], [365 * DAY_MS, 'a an ans annee annees']]);
function latinRelativeToMs(text) {
  const t = String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const fr = /\bil y a\b/.test(t);
  if (!fr && !/\bago\b/.test(t)) return null; // "Premieres in 2 days", "Scheduled for…": not a past date
  const units = fr ? FR_UNITS : EN_UNITS;
  const one = fr ? /^(un|une)$/ : /^(a|an|one)$/;
  const tokens = (fr ? t.slice(t.search(/\bil y a\b/) + 6) : t).split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const glued = tokens[i].match(/^(\d+)([a-z]+)$/);
    if (glued) { if (units[glued[2]]) return parseInt(glued[1], 10) * units[glued[2]]; continue; }
    const n = /^\d+$/.test(tokens[i]) ? parseInt(tokens[i], 10) : one.test(tokens[i]) ? 1 : null;
    if (n != null && units[tokens[i + 1]]) return n * units[tokens[i + 1]];
  }
  return null;
}

// Relative date text ("قبل 3 أيام", "خلال 3 أشهر", "قبل شهر واحد", "3 weeks ago", "il y a 2 jours") → approximate ms-ago.
export function relativeToMs(text = '') {
  if (text && !hasArabic(String(text)) && /[a-z]/i.test(String(text))) return latinRelativeToMs(text);
  const n = normalizeArabic(text);
  if (!n) return null;
  const unitMs = (u) => {
    if (/ثاني/.test(u)) return 1000;
    if (/دقيق/.test(u)) return 60e3;
    if (/ساع/.test(u)) return 3600e3;
    if (/يوم|ايام/.test(u)) return 864e5;
    if (/اسبوع|اسابيع/.test(u)) return 7 * 864e5;
    if (/شهر|اشهر/.test(u)) return 30 * 864e5;
    if (/سن|عام|اعوام|سنوات/.test(u)) return 365 * 864e5;
    return 0;
  };
  if (/يومين/.test(n)) return 2 * 864e5;
  if (/اسبوعين/.test(n)) return 14 * 864e5;
  if (/شهرين/.test(n)) return 60 * 864e5;
  if (/سنتين|عامين/.test(n)) return 730 * 864e5;
  if (/ساعتين/.test(n)) return 7200e3;
  if (/دقيقتين/.test(n)) return 120e3;
  const m = n.match(/(\d+)\s*(\S+)/);
  if (m) { const u = unitMs(m[2]); if (u) return parseInt(m[1], 10) * u; }
  const u = unitMs(n);
  return u || null;
}
