// Render-side text hygiene (C9). Catalogue builds decode entities in the titles they produce
// (server/src/catalog.js, merge-library.js), but the client also shows text no fresh build has
// touched: sections exported by older builds and still cached (those decoded only crawled
// FMovies/HDToday rows, so Myflixer titles kept &#038; and &#8216;), live title API rows, and
// synopses copied from source descriptions (&amp;amp;). So every title and synopsis the client
// shows goes through these helpers; on already-clean text they change nothing.
// Pure module (no import.meta / DOM) so node tests can import it.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '',
  hellip: '…', mdash: '—', ndash: '–', minus: '−', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', prime: '′', Prime: '″', times: '×', divide: '÷', middot: '·', bull: '•',
  copy: '©', reg: '®', trade: '™', deg: '°', para: '¶', sect: '§', euro: '€', pound: '£', yen: '¥', cent: '¢', frac12: '½', frac14: '¼', frac34: '¾',
  aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä', atilde: 'ã', aring: 'å', aelig: 'æ', ccedil: 'ç',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï', ntilde: 'ñ',
  oacute: 'ó', ograve: 'ò', ocirc: 'ô', ouml: 'ö', otilde: 'õ', oslash: 'ø', oelig: 'œ', uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', yuml: 'ÿ', szlig: 'ß', Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Auml: 'Ä', Ccedil: 'Ç', Eacute: 'É', Egrave: 'È', Ecirc: 'Ê',
  Iacute: 'Í', Ntilde: 'Ñ', Oacute: 'Ó', Ouml: 'Ö', Uacute: 'Ú', Uuml: 'Ü', OElig: 'Œ',
};
// Windows-1252 code points that WordPress-style sources emit as numeric references (&#146; etc).
const CP1252 = { 128: '€', 130: '‚', 132: '„', 133: '…', 134: '†', 135: '‡', 139: '‹', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—', 153: '™', 155: '›' };
const ENTITY = /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g;

function decodeOnce(text) {
  return text.replace(ENTITY, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (CP1252[code]) return CP1252[code];
      if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return String.fromCodePoint(code);
    }
    const named = NAMED[body] ?? NAMED[body.toLowerCase()];
    return named ?? whole;
  });
}

/** Decode numeric, hex and common named HTML entities, including double-encoded ones (&amp;#038;). */
export function decodeEntities(value) {
  if (value == null) return '';
  let text = String(value);
  for (let i = 0; i < 3 && text.includes('&'); i += 1) {
    const next = decodeOnce(text);
    if (next === text) break;
    text = next;
  }
  return text;
}

/** Decoded, single-spaced, trimmed title. */
export function cleanTitle(value) {
  const text = decodeEntities(value);
  return /\s{2}|^\s|\s$|[\n\t ]/.test(text) ? text.replace(/[\s ]+/g, ' ').trim() : text;
}

const DIGITS = '[0-9٠-٩۰-۹]+';
const AR_ORDINAL_F = '(?:الأولى|الاولى|الثانية|الثالثة|الرابعة|الخامسة|السادسة|السابعة|الثامنة|التاسعة|العاشرة|الأخيرة|الاخيرة)';
const AR_ORDINAL_M = '(?:الأول|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|الأخير|الاخير)';
const SEP = '\\s*[-–—:،,|.•·]?\\s*';
const SEASON_EPISODE = [
  new RegExp(`^(?:ال)?موسم\\s*${DIGITS}${SEP}(?:ال)?حلقة\\s*${DIGITS}$`),
  new RegExp(`^(?:season|series|s)\\s*${DIGITS}${SEP}(?:episode|ep\\.?|e)\\s*${DIGITS}$`, 'i'),
];
// IMDb-style placeholders from Myflixer ('Episode #24.1' = season 24, episode 1). The numbers often
// disagree with the season/number the app shows (S23E81 'Episode #24.1'), so the title is replaced.
const IMDB_PLACEHOLDER = new RegExp(`^(?:é|e)pisode\\s*#\\s*${DIGITS}\\s*\\.\\s*${DIGITS}$`, 'i');
const NUMBERED = [
  new RegExp(`^(?:ال)?حلقة(?:\\s*(?:رقم\\s*)?${DIGITS}|\\s+${AR_ORDINAL_F})$`),
  new RegExp(`^(?:é|e)pisode\\s*(?:no\\.?\\s*|#\\s*)?${DIGITS}(?:\\s*\\.\\s*${DIGITS})?$`, 'i'),
  new RegExp(`^ep\\.?\\s*${DIGITS}$`, 'i'),
];
const GENERIC = [
  ...SEASON_EPISODE, ...NUMBERED,
  /^(?:ال)?حلقة\s+(?:ال)?كاملة$/,
  /^(?:ال)?فيلم\s+(?:ال)?(?:كامل|وثائقي\s+(?:ال)?كامل)$/,
  /^(?:ال)?وثائقي\s+(?:ال)?كامل$/,
  new RegExp(`^(?:ال)?جزء\\s*(?:${DIGITS}|${AR_ORDINAL_M})(?:\\s*من\\s*${DIGITS})?$`),
  /^full\s+(?:episode|film|movie|documentary|doc)$/i,
  new RegExp(`^(?:part|pt\\.?|chapter)\\s*${DIGITS}(?:\\s*(?:of|/)\\s*${DIGITS})?$`, 'i'),
  new RegExp(`^s${DIGITS}\\s*e${DIGITS}$`, 'i'),
];
const EDGE = /^[\s\-–—:|•·.()[\]«»"'’‘“”]+|[\s\-–—:|•·.()[\]«»"'’‘“”]+$/g;
const core = (title) => cleanTitle(title).replace(EDGE, '');

/** Placeholder episode titles ('الحلقة الكاملة', 'الجزء 2', 'Full episode', 'Episode 3', 'S2 E4'...). */
export function isGenericEpisodeTitle(title) {
  const t = core(title);
  return !t || GENERIC.some((re) => re.test(t));
}
/** 'الحلقة 3' / 'Episode 3' forms that only repeat the episode number badge. */
export const isNumberedEpisodeTitle = (title) => { const t = core(title); return !!t && NUMBERED.some((re) => re.test(t)); };
const isSeasonEpisodeTitle = (title) => { const t = core(title); return !!t && SEASON_EPISODE.some((re) => re.test(t)); };

const comparable = (s) => cleanTitle(s).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
export const sameTitle = (a, b) => { const x = comparable(a); return !!x && x === comparable(b); };

/** Drop a leading copy of the show title ('Show – Season 1 Episode 2: Name' → 'Season 1 Episode 2: Name'). */
export function stripShowPrefix(episodeTitle, showTitle) {
  const ep = cleanTitle(episodeTitle), show = cleanTitle(showTitle);
  if (!show || ep.length <= show.length + 1 || !ep.toLowerCase().startsWith(show.toLowerCase())) return ep;
  const rest = ep.slice(show.length);
  if (!/^\s*[-–—:|،,]\s*/.test(rest)) return ep;
  const out = rest.replace(/^\s*[-–—:|،,]\s*/, '').trim();
  return out.length >= 2 ? out : ep;
}

/** Titles that carry nothing of their own and are rebuilt from the episode number: empty, 'Episode #24.1'. */
export const isPlaceholderEpisodeTitle = (title) => { const t = core(title); return !t || IMDB_PLACEHOLDER.test(t); };

const int = (n) => (Number.isInteger(n) && n >= 0 ? n : null);
/** 'Episode 3' / 'الحلقة 3' from a number; null without one. */
export function episodeLabel(number, lang = 'ar') {
  const n = int(number);
  if (n == null) return null;
  return lang === 'en' ? `Episode ${n}` : `الحلقة ${n}`;
}

/** Compact season/episode label: 'S3 · E1' / 'الموسم 3 · الحلقة 1'. */
export function episodeCode(episode, lang = 'ar') {
  const s = int(episode?.season);
  const n = int(episode?.number);
  if (n == null) return null;
  if (lang === 'en') return s != null ? `S${s} · E${n}` : `Episode ${n}`;
  return s != null ? `الموسم ${s} · الحلقة ${n}` : `الحلقة ${n}`;
}

/**
 * What an episode card should headline. With the show title available (rows, search, My List) a
 * generic episode title never leads: the show title becomes the headline and the generic label the
 * secondary line. Films always headline the show title.
 * An empty or IMDb-style placeholder title ('Episode #24.1') is replaced by 'Episode N' / 'الحلقة N'
 * built from episode.number, or from `number` (the list position) when the episode has none.
 */
export function episodeHeadline(show, episode, { lang = 'ar', withShow = false, number = null } = {}) {
  const showTitle = cleanTitle(show?.title);
  const raw = cleanTitle(episode?.title);
  if (show?.kind === 'film') return { title: showTitle || raw, sub: null, generic: false, film: true };
  const epTitle = stripShowPrefix(raw, showTitle);
  const placeholder = isPlaceholderEpisodeTitle(epTitle);
  const generic = placeholder || isGenericEpisodeTitle(epTitle) || sameTitle(epTitle, showTitle);
  const numbered = episodeLabel(int(episode?.number) ?? number, lang);
  if (!withShow) return { title: (placeholder ? numbered || epTitle : epTitle) || episodeCode(episode, lang) || showTitle, sub: null, generic, film: false };
  if (!generic) return { title: epTitle, sub: showTitle || null, generic: false, film: false };
  const code = episodeCode(episode, lang) || numbered;
  const label = epTitle && !placeholder && !sameTitle(epTitle, showTitle) ? epTitle : null;
  const sub = (label && isSeasonEpisodeTitle(label) && code) || label || code || (placeholder ? epTitle : null);
  return { title: showTitle || epTitle || code || '', sub: sub && !sameTitle(sub, showTitle) ? sub : null, generic: true, film: false };
}

const NETWORK_STATUS = {
  running: { en: 'Still airing', ar: 'ما زال يُعرض' },
  ended: { en: 'Ended', ar: 'انتهى عرضه' },
  'to be determined': { en: 'Status to be confirmed', ar: 'مصيره غير محسوم' },
  'in development': { en: 'In development', ar: 'قيد التطوير' },
};
/**
 * TVmaze network metadata (show.tvm = { id, svc, c, st, ... } from server/src/service-metadata.js)
 * as display parts: { name, country, status, url } or null when there is no network name.
 */
export function networkInfo(tvm, lang = 'ar') {
  const svc = tvm && typeof tvm === 'object' && typeof tvm.svc === 'string' ? cleanTitle(tvm.svc) : '';
  if (!svc) return null;
  // TVmaze names the UK's Channel 5 just '5'; a bare number does not read as a network.
  const name = /^\d{1,2}$/.test(svc) ? (lang === 'en' ? `Channel ${svc}` : `القناة ${svc}`) : svc;
  let country = null;
  if (typeof tvm.c === 'string' && /^[A-Z]{2}$/i.test(tvm.c)) {
    try { country = new Intl.DisplayNames([lang === 'en' ? 'en' : 'ar'], { type: 'region' }).of(tvm.c.toUpperCase()) || null; } catch { country = tvm.c.toUpperCase(); }
  }
  const status = typeof tvm.st === 'string' ? NETWORK_STATUS[tvm.st.trim().toLowerCase()]?.[lang === 'en' ? 'en' : 'ar'] || null : null;
  const id = Number.isInteger(tvm.id) && tvm.id > 0 ? tvm.id : null;
  return { name, country, status, url: id ? `https://www.tvmaze.com/shows/${id}` : null };
}

// Wraps interpolated titles in first-strong isolates so mixed-script toasts read correctly.
export const isolate = (text) => `⁨${text}⁩`;

/**
 * One-line toast body for a single new episode, as episode cards headline it: '<episode> — <show>',
 * or '<show> — S1 · E2' / '<show>' when the episode title is empty or generic (Myflixer placeholders
 * are exported as ''), then ' (<channel>)'. Each part is bidi-isolated.
 */
export function newEpisodeLine(show, episode, { lang = 'ar', channel = null } = {}) {
  const head = episodeHeadline(show, episode, { lang, withShow: true });
  const line = [head.title, head.sub].filter(Boolean).map(isolate).join(' — ');
  return channel ? `${line} (${channel})` : line;
}

// Provider posters are 2:3 (myflixer *_medium.jpg, TMDB /t/p/w342 etc.).
export const isPortraitUrl = (url) => typeof url === 'string' && /(_medium\.(?:jpe?g|webp)(?:\?|$))|\/t\/p\/w(?:92|154|185|342|500)\//i.test(url);
