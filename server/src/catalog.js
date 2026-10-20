import { classifyUpload } from './classify-upload.js';
// Builds the show catalogue from raw playlist/uploads data + per-video details.
import {
  normalizeArabic, shortHash, parseTitle, isGenericPlaylist, isBranding, cleanDescription,
  synopsisQuality, similarity, relativeToMs, episodeNumberFromTitle, seasonNumberFromTitle, wordToNumber, hasArabic,
  FILM_EPISODE_TITLE, FILM_EPISODE_TITLE_EN, alJazeeraPlaylistIsSeries, englishPlaylistIsSeries, isAutoPlaylistId,
  decodeEntities, cleanTitle, cleanSynopsis, tidyCase, playlistShowName, arFilmsPlaylistIsSeries, arShowNames,
} from './text.js';
import { tagShow, allTagDefs, genreTopicTags } from './tagger.js';
import { assignShowIds, buildIdAliases, previousEpisodeIds } from './show-ids.js';
import { siteDate } from './documentaries.js';
import { playlistWanted, uploadWanted, playlistSeason } from './source-filters.js';

const FUZZY_MERGE = 0.9;
const isYouTubeId = (id) => /^[\w-]{11}$/.test(id || '');
// Myflixer gives no runtime and no view count. Rows cached by older code carry made-up ones (films
// 1:30:00 and 75,000 views, episodes 50:00 and 50,000 views); they read as unknown, as rows stored
// since do (contract 4: an unknown duration is 0).
const INVENTED_SECONDS = { 'mf:m:': 5400, 'mf:e:': 3000 };
const INVENTED_VIEWS = new Set([50000, 75000]);
const knownSeconds = (id, sec) => {
  const n = Number(sec) > 0 ? Number(sec) : 0;
  return n && INVENTED_SECONDS[String(id).slice(0, 5)] === n ? 0 : n;
};
const knownViews = (id, n) => (String(id).startsWith('mf:') && INVENTED_VIEWS.has(Number(n)) ? null : n || null);
const isoOrNull = (value) => { const t = Date.parse(value || ''); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
// Recency of an episode: its publish date, or for a provider episode the later date it was added to a
// series already listed (contract 4: Myflixer rows' addedAt). YouTube addedAt is a first-seen stamp.
const recencyOf = (e) => (!isYouTubeId(e.id) && e.addedAt && (!e.publishedAt || e.addedAt > e.publishedAt) ? e.addedAt : e.publishedAt);
// Alternative titles are told apart by their normalized form ("Drain The Oceans" = "Drain the Oceans").
const uniqueTitles = (titles, except = []) => {
  const seen = new Set(except.map((t) => normalizeArabic(t)));
  return titles.filter((t) => { const k = t && normalizeArabic(t); if (!k || seen.has(k)) return false; seen.add(k); return true; });
};
const FULL_EPISODE = { en: 'Full episode', ar: 'الحلقة الكاملة' };
const GENERIC_LABEL = /^(?:full episode|episode \d+|part \d+|الحلقة الكاملة|الحلقة \d+|الجزء \d+)$/i;
const FILM_TITLES = new Set([FILM_EPISODE_TITLE, FILM_EPISODE_TITLE_EN]);
const sectionLang = (src) => (src.lang === 'en' ? 'en' : 'ar');

// ---- Part, episode and sequel markers ------------------------------------------------------------
// "X, Part One", "X (Pt 2)", "X - Part 3 - Subtitle", "X (1/3)", "X (2)", "X.. الجزء الثاني", "X ج.2",
// "X- الحلقة الثانية عشر"; Arabic sources also "X 2". Parts of one film are grouped into a series by these.
// Volumes ("Vol. 2", "Vol.II") are sequels, not parts: they only keep keys apart (markersDiffer).
const NUM_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';
const EN_NUMBERS = Object.fromEntries(NUM_WORDS.split('|').map((w, i) => [w, i + 1]));
const ROMAN_NUMBERS = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const END = String.raw`(?![\p{L}\p{N}])`;
const PART_MARKERS = [
  { kind: 'part', re: new RegExp(String.raw`(^|[\s,:;(\[|\-–—])\(?\s*(?:part|pt\.?|chapter)\s*(\d{1,2}|${NUM_WORDS}|i{1,3}|iv|vi{0,3}|ix|x)${END}(?:\s*(?:of|\/)\s*(?:\d{1,2}|${NUM_WORDS})${END})?\s*\)?`, 'iu') },
  { kind: 'episode', re: new RegExp(String.raw`(^|[\s,:;(\[|\-–—])\(?\s*(?:episode|ep\.?)\s*(\d{1,2}|${NUM_WORDS})${END}\s*\)?`, 'iu') },
  { kind: 'part', re: /(^|\s)\((\d{1,2})\)(?=\s*(?:$|[|:\-–—]))/u },
  { kind: 'part', re: /(^|[\s(])(\d)\s*\/\s*([1-8])(?=\s*(?:$|[)|:\-–—]))/u, ok: (m) => +m[2] <= +m[3] },
  { kind: 'part', re: /(^|[\s.|:\-–—(])(?:ال)?جزء\s*[:：]?\s*(\d{1,2}|ال\S+(?:\s+عشر[ةه]?)?)/u },
  { kind: 'part', re: /(^|\s)ج\s*\.?\s*(\d{1,2})(?![\p{L}\p{N}])/u },
  { kind: 'episode', re: /(^|[\s.|:\-–—(])(?:ال)?حلق[ةه]\s+(\d{1,2}|ال\S+(?:\s+عشر[ةه]?)?)/u },
];
const TRAILING_NUMBER = /(^|\s)(\d)\s*$/u;
function markerNumber(raw = '') {
  const w = String(raw).trim().toLowerCase();
  if (/^\d{1,2}$/.test(w)) return parseInt(w, 10);
  if (w in EN_NUMBERS) return EN_NUMBERS[w];
  if (w in ROMAN_NUMBERS) return ROMAN_NUMBERS[w];
  return normalizeArabic(w) === 'التاني' ? 2 : wordToNumber(w); // a common misspelling of الثاني
}
const trimEnd = (s) => s.replace(/[\s,:;|\-–—.(\[]+$/u, '').trim();
const trimStart = (s) => s.replace(/^[\s,:;|\-–—.)\]]+/u, '').trim();
/** The part/episode marker of a title: { n, kind, before, after } (text around the marker), or null. */
export function partOf(title = '', lang = 'en') {
  const t = String(title || '');
  for (const { kind, re, ok } of PART_MARKERS) {
    const m = t.match(re);
    if (!m || (ok && !ok(m))) continue;
    const n = markerNumber(m[2]);
    if (n == null || n < 1) continue;
    const start = m.index + m[1].length;
    return { n, kind, before: trimEnd(t.slice(0, start)), after: trimStart(t.slice(m.index + m[0].length)) };
  }
  const m = lang === 'ar' ? t.match(TRAILING_NUMBER) : null;
  if (m && +m[2] >= 1) return { n: +m[2], kind: 'num', before: trimEnd(t.slice(0, m.index + m[1].length)), after: '' };
  return null;
}
// Tokens that make two near-identical keys different works: numbers, roman numerals, number words
// and part/volume words ("fahrenheit 9 11" / "11 9", "generation iron" / "2", "الجزء الاول" / "الثاني").
const MARKER_WORDS = new Set(['part', 'pt', 'vol', 'volume', 'chapter', 'episode', 'ep', 'جزء', 'الجزء', 'ج', 'الحلقه', 'حلقه']);
const ROMAN_TOKEN = /^(?:ii|iii|iv|vi|vii|viii|ix|xi|xii|xiii|xiv|xv|xx|xl)$/;
// "12", "s2", "e14", "3rd", "xii", "two", "part", "الثالث" (memoized: wordToNumber normalizes).
const numberToken = (w) => /^[\d٠-٩]+$/.test(w) || /^(?:s|e|ep|s\d+e)\d+$/.test(w) || /^\d+(?:st|nd|rd|th)$/.test(w) || ROMAN_TOKEN.test(w) || w in EN_NUMBERS || MARKER_WORDS.has(w) || (w.startsWith('ال') && wordToNumber(w) != null);
const numberTokens = new Map();
const isNumberToken = (w) => {
  if (!numberTokens.has(w)) { if (numberTokens.size > 50000) numberTokens.clear(); numberTokens.set(w, numberToken(w)); }
  return numberTokens.get(w);
};
function tokenDiff(a, b) {
  const count = (s) => s.split(' ').reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
  const ca = count(a), cb = count(b), out = [];
  for (const [w, n] of ca) if ((cb.get(w) || 0) !== n) out.push(w);
  for (const [w, n] of cb) if ((ca.get(w) || 0) !== n) out.push(w);
  return out;
}
/** Two normalized keys differ in a number, part or sequel marker. `romanOnly`: only roman numerals and part/volume words count. */
export function markersDiffer(a, b, { romanOnly = false } = {}) {
  const marker = (w) => (romanOnly ? ROMAN_TOKEN.test(w) || MARKER_WORDS.has(w) : isNumberToken(w));
  // The same numbers in another order are another title too ("fahrenheit 9 11" / "11 9").
  const sequence = (k) => k.split(' ').filter(marker).join(' ');
  return tokenDiff(a, b).some(marker) || sequence(a) !== sequence(b);
}

// ---- A video's own episode label (when parsed films end up in one series) ------------------------
const FULL_LABEL = /^\(?\s*(?:full (?:episode|documentary|film|movie)s?|documentary|الحلقة الكاملة|الفيلم الكامل|فيلم وثائقي)\s*\)?$/i;
const COMPILATION = /^(?:all episodes|full series|all parts|complete series|the complete series)$/i;
const COMPILATION_LABEL = { en: 'All episodes', ar: 'كل الحلقات' };
const MARKER_STRIP = [
  /(?:^|[\s,|\-–—:])(?:season|series)\s*\d{1,2}(?![\p{L}\p{N}])\s*[,:\-–—|]?/giu,
  /(?:^|[\s,|\-–—:(])(?:ep\.?|episode)\s*#?\d{1,3}(?![\p{L}\p{N}])\s*\)?\s*[,:\-–—|]?/giu,
  new RegExp(String.raw`(?:^|[\s,|\-–—:(])(?:part|pt\.?)\s*(?:\d{1,2}|${NUM_WORDS})${END}(?:\s*(?:of|\/)\s*\d{1,2})?\s*\)?\s*[,:\-–—|]?`, 'giu'),
  /(?:^|[\s.|:\-–—])(?:ال)?(?:حلق[ةه]|موسم|جزء)\s+(?:[\d٠-٩]{1,3}|ال\S+(?:\s+عشر[ةه]?)?)/gu,
];
/** Drop a leading copy of `key` (a normalized show title) from text, at a word boundary. */
function stripKeyPrefix(text, key) {
  if (!key) return text;
  if (normalizeArabic(text) === key) return '';
  const re = /[\s:：|\-–—,.]+/g;
  let m;
  while ((m = re.exec(text))) {
    const head = normalizeArabic(text.slice(0, m.index));
    if (head === key) return text.slice(m.index + m[0].length).trim();
    if (head.length > key.length) break;
  }
  return text;
}
/**
 * Number, season and title a full video title gives an episode once the show name, branding and
 * "Full Episode" labels are removed: "World War Weird | Season 2, Ep. 5: Plague Bombs | Free
 * Documentary" → { season 2, number 5, title 'Plague Bombs' }; "The Vietnam War | All Episodes" →
 * 'All episodes'. title is '' when nothing but markers is left.
 */
export function ownEpisodeInfo(fullTitle, showTitle, src = {}) {
  const key = normalizeArabic(showTitle);
  const brands = [...(src.brands || []), src.title, src.short].filter(Boolean).map(normalizeArabic);
  const segs = cleanTitle(fullTitle || '').replace(/\s+/g, ' ').split(/\s*\|\s*/)
    .map((p) => p.replace(/\s*\(\s*full (?:episode|documentary|film|movie)\s*\)\s*/gi, ' ').trim())
    .filter((p) => { const n = normalizeArabic(p); return n && n !== key && !isBranding(p) && !brands.includes(n) && !FULL_LABEL.test(p); });
  // A channel name after a dash ("Title - الشرق ديسكفري") is branding too.
  const rest = stripKeyPrefix(segs.join(' | '), key)
    .replace(/\s+[-–—]\s+([^-–—|]+)$/u, (m, tail) => (isBranding(tail) || brands.includes(normalizeArabic(tail)) ? '' : m));
  const lang = sectionLang(src);
  const season = seasonNumberFromTitle(rest);
  if (COMPILATION.test(rest)) return { number: null, season: null, title: COMPILATION_LABEL[lang], label: true };
  // "Savage Kingdom Season 3 MEGA EPISODE Compilation": the channel's own name for a compilation.
  if (/\bmega episodes?\b/i.test(rest)) return { number: null, season, title: 'MEGA Episode', label: true };
  const part = partOf(rest, lang);
  const number = episodeNumberFromTitle(rest) ?? (part && part.kind !== 'num' ? part.n : null);
  let title = MARKER_STRIP.reduce((t, re) => t.replace(re, ' '), ` ${rest} `).replace(/\s+/g, ' ');
  title = trimStart(trimEnd(title));
  if (normalizeArabic(title) === key || FULL_LABEL.test(title)) title = '';
  return { number, season, title };
}

// Description cleaning is regex-heavy; descriptions rarely change, so cache per video.
// Entities are decoded first: '&#8216;' would otherwise read as a '#hashtag' boilerplate line.
const cleanCache = new Map();
function cleanedDescription(videoId, description) {
  description = description || '';
  const hit = cleanCache.get(videoId);
  if (hit && hit.len === description.length) return hit.text;
  const text = cleanDescription(isYouTubeId(videoId) ? decodeEntities(description) : cleanSynopsis(description));
  if (cleanCache.size > 50000) cleanCache.clear();
  cleanCache.set(videoId, { len: description.length, text });
  return text;
}

// Provider (Myflixer) episode titles repeat what season/number already carry: "Show – Season 1
// Episode 2: Name", "Show Season 1 Episode 2", "Show – S1995E1 – Name", "Show: Name", "Episode #1.3".
// Only a real subtitle is kept; placeholders become '' (the client labels them from the number).
const EP_MARKER_PREFIX = /^.*?\b(?:season\s*\d+\s*,?\s*episode\s*\d+|S\d+\s*E\d+)\b\s*[:\-–—|]?\s*/i;
const EP_NUMBER_PREFIX = /^(?:episode|ep\.?)\s*#?\d+\s*[:\-–—|]\s*(?=\S{2})/i;
const PLACEHOLDER_EPISODE = /^(?:(?:season|series)\s*\d+\s*[,:\-–—]?\s*)?(?:episode|ep\.?)\s*(?:#\s*)?(?:\d+(?:\.\d+)?|[ivx]{1,5}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/i;
export function cleanProviderEpisodeTitle(title, showTitle = '') {
  let t = cleanTitle(title || '');
  t = t.replace(EP_MARKER_PREFIX, '').trim();
  const show = cleanTitle(showTitle || '');
  if (show && t.length > show.length + 2 && t.toLowerCase().startsWith(show.toLowerCase())) {
    const rest = t.slice(show.length).match(/^\s*[-–—:|]\s*(\S.+)$/);
    if (rest) t = rest[1].trim();
  }
  t = t.replace(EP_NUMBER_PREFIX, '').trim();
  return PLACEHOLDER_EPISODE.test(t) ? '' : t;
}

// tidyCase keeps a trailing minor word lower-case ('SOUTH KOREA IS OVER' → '… Is over'); English
// title case capitalizes the last word. Only words tidyCase itself lowered can end up lower-case.
function displayCase(title, lang) {
  const out = tidyCase(title, { lang });
  if (out === title || lang === 'fr') return out;
  return out.replace(/(\s)(\p{Ll})(\p{Ll}*)([^\p{L}\p{N}]*)$/u, (m, sp, first, rest, tail) => sp + first.toUpperCase() + rest + tail);
}

/**
 * A listing row made display-ready once, so parsing, show keys, episode titles, fullTitle,
 * classification and tagging all see the same text: entities decoded (provider rows also lose
 * escaped quotes and markup), and English-source YouTube rows still carrying a hl=ar Arabic
 * localization (cached uploads listings are only re-listed from the newest page) take the original
 * title from /player details. Details titles are fetched once and can be stale, so they are used only
 * when the listing title is in the wrong script.
 */
function normalizeVideo(raw, srcLang, details) {
  const yt = isYouTubeId(raw.id);
  let title = yt ? decodeEntities(raw.title) : cleanTitle(raw.title);
  if (yt && srcLang !== 'ar' && hasArabic(title)) {
    const original = details[raw.id]?.title;
    if (original && !hasArabic(original)) title = decodeEntities(original);
  }
  const preset = !!raw.parsed?.showTitle;
  let parsed = raw.parsed;
  if (preset) {
    const showTitle = cleanTitle(parsed.showTitle) || parsed.showTitle;
    const episodeTitle = parsed.kind === 'film' ? cleanTitle(parsed.episodeTitle) : cleanProviderEpisodeTitle(parsed.episodeTitle, showTitle);
    parsed = { ...parsed, showTitle, episodeTitle };
  }
  const showTitle = raw.showTitle ? cleanTitle(raw.showTitle) || raw.showTitle : raw.showTitle;
  const same = title === raw.title && parsed === raw.parsed && showTitle === raw.showTitle;
  return { v: same ? raw : { ...raw, title, showTitle, ...(preset ? { parsed } : {}) }, preset };
}

function thumbUrls(videoId) {
  return {
    max: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    sd: `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    hq: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    mq: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
  };
}

function templatedSynopsis(show) {
  const n = show.episodes.length;
  const channel = show.channel?.short || show.channel?.title || '';
  // Titles are decoded at candidate creation. Placeholders ('', 'Episode 3', 'الحلقة الكاملة') are not quoted.
  const named = show.episodes.filter((e) => e.title && !GENERIC_LABEL.test(e.title)).slice(0, 3);
  // An unknown length (0: Myflixer gives none) is left out rather than printed as "0-minute".
  const minutes = Math.round((show.episodes[0]?.durationSec || 0) / 60);
  if (show.lang === 'en') {
    if (show.kind === 'film') return `A ${minutes ? `${minutes}-minute ` : ''}documentary from ${channel || 'the channel'}: "${show.title}".`;
    const names = named.map((e) => `"${e.title}"`).join(', ');
    return `${show.title}${channel ? ` from ${channel}` : ''}. ${n} full episode${n === 1 ? '' : 's'}${names ? `, including ${names}` : ''}.`;
  }
  if (show.kind === 'film') return `فيلم وثائقي من ${channel || 'المصدر'} بعنوان «${show.title}»${minutes ? `، مدته ${minutes} دقيقة` : ''}.`;
  const names = named.map((e) => `«${e.title}»`).join('، ');
  const count = n === 1 ? 'حلقة كاملة واحدة' : n === 2 ? 'حلقتان كاملتان' : n <= 10 ? `${n} حلقات كاملة` : `${n} حلقة كاملة`;
  return `${show.title}${channel ? ` من ${channel}` : ''}. يضم هذا العرض ${count}${names ? `، من بينها ${names}` : ''}.`;
}

// Sort episodes, pick synopsis + poster, compute aggregates and tags. Mutates the show.
// `art` is an optional TMDB match ({ poster, backdrop, overview, overviewLang }).
function finalizeShow(show, art) {
  const ov = show._ov || {};
  const synopsisCandidates = show._syn || [];
  delete show._ov; delete show._syn; delete show.rawTitle; delete show._variant;
  const episodes = show.episodes;
  if (ov.contentLang) show.contentLang = ov.contentLang;
  // Shouting all-caps YouTube titles get display casing (French: sentence case). fullTitle keeps the
  // original; provider (Myflixer) titles and curated override titles are left as they are.
  if (show.profile !== 'myflixer') {
    const caseLang = show.contentLang === 'fr' ? 'fr' : 'en';
    if (!ov.title) show.title = displayCase(show.title, caseLang);
    for (const e of episodes) if (isYouTubeId(e.id)) e.title = displayCase(e.title, caseLang);
  }
  // A lone unnumbered 'Full episode' is a one-off special, not a one-episode series. This runs after
  // the 3b folding step, which relies on that title.
  if (episodes.length === 1 && episodes[0].number == null && episodes[0].season == null) {
    if (episodes[0].title === FULL_EPISODE.ar) episodes[0].title = FILM_EPISODE_TITLE;
    else if (episodes[0].title === FULL_EPISODE.en) episodes[0].title = FILM_EPISODE_TITLE_EN;
  }

  // An era group (seasonLabel, labelEras) sorts between the numbered seasons around its first episode.
  episodes.sort((a, b) => {
    const sa = ERA_RANK.get(a) ?? a.season ?? 0, sb = ERA_RANK.get(b) ?? b.season ?? 0;
    if (sa !== sb) return sa - sb;
    if (a.number != null && b.number != null && a.number !== b.number) return a.number - b.number;
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : Infinity;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : Infinity;
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title, 'ar');
  });
  show.episodeCount = episodes.length;
  show.kind = episodes.length === 1 && (episodes[0].title === FILM_EPISODE_TITLE || episodes[0].title === FILM_EPISODE_TITLE_EN) ? 'film' : 'series';
  show.altTitles = uniqueTitles(show.altTitles, [show.title]);
  show.playlistIds = [...new Set(show.playlistIds)];
  show.seasons = [...new Set(episodes.map((e) => e.season).filter((s) => s != null))].sort((a, b) => a - b);

  // Synopsis: override → best episode description → best promo description → template.
  let synopsis = ov.synopsis || '';
  if (!synopsis) {
    const best = synopsisCandidates.filter((c) => c.q > 0).sort((a, b) => (b.isEpisode - a.isEpisode) * 0 + (b.q - a.q))[0];
    synopsis = best?.text || '';
  }
  show.synopsis = synopsis || null;
  show.synopsisGenerated = false;
  // TMDB overview (in the section's language) beats a templated fallback.
  if (!show.synopsis && art?.overview && art.overviewLang === (show.lang === 'en' ? 'en' : 'ar')) show.synopsis = cleanSynopsis(art.overview) || null;
  if (!show.synopsis) { show.synopsis = templatedSynopsis(show); show.synopsisGenerated = true; }

  // Poster = override → TMDB backdrop (16:9, matches the cards) → most-viewed episode's thumbnail.
  const cover = [...episodes].sort((a, b) => (b.views || 0) - (a.views || 0))[0];
  show.posterVideoId = cover.id;
  // Only non-YouTube items (ids that are not 11-char video ids) carry their own absolute poster URL;
  // YouTube listing thumbnails are signed and expire, so YouTube shows always use the plain CDN set.
  const isYouTube = /^[\w-]{11}$/.test(cover.id);
  const customCover = !isYouTube ? (cover.thumbs?.custom || (cover.thumb?.startsWith('http') ? cover.thumb : null)) : null;
  show.poster = ov.poster ? { custom: ov.poster } : art?.backdrop ? { custom: art.backdrop, ...(isYouTube ? thumbUrls(cover.id) : {}) } : customCover ? { custom: customCover } : thumbUrls(cover.id);
  // 2:3 poster for the show page. A provider's own cover beats a looked-up one, so the page shows the
  // card's art; an explicit empty override (portrait: '') turns looked-up artwork off.
  show.portrait = ov.portrait || customCover || ('portrait' in ov ? null : art?.poster) || null;
  if (art?.tmdbId) show.tmdbId = art.tmdbId;
  show.latestAt = episodes.reduce((m, e) => { const at = recencyOf(e); return at && (!m || at > m) ? at : m; }, null);
  show.firstAt = episodes.reduce((m, e) => (e.publishedAt && (!m || e.publishedAt < m) ? e.publishedAt : m), null);
  show.totalViews = episodes.reduce((a, e) => a + (e.views || 0), 0);
  show.totalDurationSec = episodes.reduce((a, e) => a + e.durationSec, 0);

  const classifications = episodes.map(e => e.classification).filter(Boolean);
  if (classifications.length) {
    show.classification = classifications.find(c => c.status === 'uncertain') || classifications[0];
    show.documentary = show.classification.status === 'documentary';
    if (!show.documentary && show.synopsisGenerated) show.synopsis = show.lang === 'en'
      ? `An upload from ${show.channel?.short || show.channel?.title || 'the channel'}: "${show.title}".`
      : `فيديو من ${show.channel?.short || show.channel?.title || 'المصدر'} بعنوان «${show.title}».`;
  }
  const tagged = tagShow({ ...show, topics: show._topics || [] });
  // Provider genre slugs ('comedy', 'people', 'horror') go through the same mapping as FMovies/HDToday
  // rows (unknown ones are dropped), and as there the catch-all 'documentary' comes after any topic.
  const extraTags = genreTopicTags(show._extraTags || []);
  const tags = [...new Set([...tagged.tags, ...extraTags])];
  show.tags = ov.tags?.length ? ov.tags : [...tags.filter((t) => t !== 'documentary'), ...tags.filter((t) => t === 'documentary')];
  show.primaryTag = ov.tags?.length ? ov.tags[0] : show.tags[0];
  delete show._extraTags; delete show._topics;
  // Content in another language than its section (e.g. French shows in the English section) gets a language tag.
  if (show.contentLang && show.contentLang !== show.lang) show.tags = [...show.tags.filter((t) => !t.startsWith('lang-')), `lang-${show.contentLang}`];
  return show;
}

const LANG_TAGS = {
  fr: { label: 'بالفرنسية', labelEn: 'In French', color: '#6c8cff' },
  en: { label: 'بالإنجليزية', labelEn: 'In English', color: '#6c8cff' },
  ar: { label: 'بالعربية', labelEn: 'In Arabic', color: '#6c8cff' },
  de: { label: 'بالألمانية', labelEn: 'In German', color: '#6c8cff' },
  es: { label: 'بالإسبانية', labelEn: 'In Spanish', color: '#6c8cff' },
};

const durationOf = (c, details) => knownSeconds(c.v.id, details[c.v.id]?.durationSec) || knownSeconds(c.v.id, c.v.durationSec);
// Rows that can become episodes: not private, removed or non-embeddable, not an upload classified as
// non-documentary (1a), and for YouTube not promo-length (a trailer or clip). Unknown provider
// durations (0) still count.
const listedRow = (c, details, minSec) => {
  const d = details[c.v.id];
  return !d?.isPrivate && d?.unavailable !== true && d?.embeddable !== false && c.classification?.status !== 'non-documentary'
    && (!isYouTubeId(c.v.id) || durationOf(c, details) >= minSec);
};
/**
 * Order of the YouTube copies of one work (re-uploads, re-posted parts); the first becomes the episode,
 * the others its offerings. Stable keys only: a copy the previous catalogue listed as an episode
 * (`listedBefore`), then the first posted, then the smaller id. View counts are re-read every run, so
 * ranking by them would swap a near-tied pair's episode id, date and thumbnail between builds and
 * announce the swapped-in copy as a new episode.
 */
const copyOrder = (details, listedBefore) => {
  const posted = (c) => Date.parse(details[c.v.id]?.publishedAt || '') || Infinity;
  return (a, b) => listedBefore.has(b.v.id) - listedBefore.has(a.v.id) || posted(a) - posted(b) || (a.v.id < b.v.id ? -1 : a.v.id > b.v.id ? 1 : 0);
};
// YouTube copies of one video: lengths within 3% (re-uploads differ by a few seconds of intro/outro).
const sameLength = (a, b, details) => {
  const x = durationOf(a, details), y = durationOf(b, details);
  return x > 0 && y > 0 && Math.abs(x - y) <= 0.03 * Math.max(x, y);
};
// Words of a video title that say nothing about which episode it is.
const TITLE_FILLER = new Set([
  'full', 'episode', 'episodes', 'documentary', 'documentaries', 'film', 'official', 'video', 'videos', 'integrale', 'intégrale', 'repost',
  'with', 'from', 'that', 'this', 'what', 'when', 'where', 'which', 'they', 'their', 'there', 'your', 'about', 'into', 'over', 'after',
  'before', 'inside', 'under', 'than', 'then', 'them', 'these', 'those', 'have', 'will', 'were', 'been', 'does', 'more', 'most', 'just',
  'like', 'also', 'only', 'very', 'here', 'dans', 'pour', 'avec', 'sont', 'comment', 'الحلقه', 'الكامله', 'الموسم', 'وثايقي',
  'the', 'and', 'for', 'les', 'des', 'une', 'est', 'pas', 'ils', 'who', 'how', 'why', 'are', 'was', 'not', 'all', 'out', 'its', 'our',
  'you', 'has', 'had', 'can', 'did', 'que', 'qui', 'par', 'sur', 'aux', 'son', 'ses', 'nos', 'vos', 'علي', 'الي', 'عبر', 'بين',
]);
// Strong separators inside a title: "X.. Y", "X | Y", "X - Y", "X: Y".
const SEGMENT_BREAK = /\s*(?:\.{2,}|\||\s[-–—]\s|:\s)\s*/gu;
function segmentEnds(text) {
  const ends = [];
  let m;
  SEGMENT_BREAK.lastIndex = 0;
  while ((m = SEGMENT_BREAK.exec(text))) if (m.index > 0) ends.push(m.index);
  return [...ends, text.length];
}

/**
 * 1c) Parts of one film. YouTube film candidates of one channel whose titles differ only in a part or
 * episode marker ("X, Part One" / "X, Part Two", "X.. Y | الجزء الأول" / "X.. Z | الجزء الثاني")
 * become one series: number = the part, title = the part's own subtitle or 'Part N' / 'الجزء N'
 * ('Full episode' for an episode marker, later 'Episode N'). Groups need two distinct numbers; a
 * number given twice is only accepted for re-posts (same subtitle and length), which become one
 * work, its first copy by copyOrder being the episode. The base title without a marker joins as part 1
 * when part 1 is otherwise missing. Rows that never become episodes (trailers, clips, private videos,
 * non-documentary uploads) take no part.
 */
function groupParts(candidates, { aliasMap, details, minSec = 0, rank = copyOrder(details, new Set()) }) {
  const marked = [], plain = new Map();
  for (const c of candidates) {
    if (c.parsed.kind !== 'film' || c.preset || !isYouTubeId(c.v.id) || !c.showName) continue;
    if (!listedRow(c, details, minSec)) continue;
    const p = partOf(c.showName, c.src.lang || 'ar');
    if (!p) { const k = `${c.src.id}|${normalizeArabic(c.showName)}`; if (!plain.has(k)) plain.set(k, c); continue; }
    if (p.before) marked.push({ c, ...p, ends: segmentEnds(p.before) });
  }
  if (!marked.length) return 0;
  const label = (m, lang) => (m.kind === 'episode' ? FULL_EPISODE[lang] : lang === 'en' ? `Part ${m.n}` : `الجزء ${m.n}`);
  const longEnough = (key) => key.split(' ').length >= 2 || key.length >= 8;
  let grouped = 0;
  const level = (keyOf, { withPlain = false } = {}) => {
    const groups = new Map();
    for (const m of marked) {
      if (m.done) continue;
      const g = keyOf(m);
      if (!g || !longEnough(g.key)) continue;
      const k = `${m.c.src.id}|${g.key}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ m, ...g });
    }
    for (const [k, members] of groups) {
      if (withPlain && !members.some((x) => x.m.n === 1) && plain.has(k)) {
        const c = plain.get(k);
        members.push({ m: { c, n: 1, kind: members[0].m.kind }, key: members[0].key, display: c.showName, title: '' });
      }
      const byNumber = new Map();
      for (const x of members) byNumber.set(x.m.n, [...(byNumber.get(x.m.n) || []), x]);
      if (byNumber.size < 2) continue;
      // Re-posts of one part: the first by copyOrder is the episode (not the first listed: an uploads
      // listing puts the newest re-post first).
      for (const xs of byNumber.values()) xs.sort((a, b) => rank(a.m.c, b.m.c));
      if ([...byNumber.values()].some((xs) => xs.some((x) => !sameLength(x.m.c, xs[0].m.c, details) || normalizeArabic(x.title) !== normalizeArabic(xs[0].title)))) continue;
      if (withPlain) plain.delete(k);
      members.sort((a, b) => a.m.n - b.m.n || rank(a.m.c, b.m.c));
      const display = members[0].display;
      const key = aliasMap.get(normalizeArabic(display)) || normalizeArabic(display);
      for (const x of members) {
        const { c } = x.m, lang = sectionLang(c.src);
        c.showName = display;
        c.key = key;
        c.parsed = { ...c.parsed, kind: 'series', showTitle: display, episodeTitle: x.title || label(x.m, lang), number: x.m.n, season: null };
        const copies = byNumber.get(x.m.n);
        if (copies[0].m.c !== c) { c.work = copies[0].m.c.v.id; c.workRank = copies.indexOf(x); }
        x.m.done = true;
        grouped++;
      }
    }
  };
  // The whole title without its marker first ("X, Part One"), then shorter heads ("X.. Y | الجزء الأول" → X).
  level((m) => ({ key: normalizeArabic(`${m.before} ${m.after}`), display: m.before, title: '' }), { withPlain: true });
  const depth = Math.max(...marked.map((m) => m.ends.length));
  for (let d = depth; d >= 1; d--) {
    level((m) => {
      if (m.ends.length < d) return null;
      const head = trimEnd(m.before.slice(0, m.ends[d - 1]));
      const rest = trimStart(m.before.slice(m.ends[d - 1]));
      return { key: normalizeArabic(head), display: head, title: [rest, m.after].filter(Boolean).join(' | ') };
    });
  }
  return grouped;
}

/**
 * 1d) Works. Copies of one video or film under one show key are one work: one episode, the other
 * copies become its offerings. YouTube: lengths within 3% and the same title, the same numbered
 * episode, or the same set of the episode's own words with no differing number marker. Myflixer
 * films: the same title and the same year, or near-identical synopses (a re-post often carries the
 * WordPress post date instead of the release date).
 * Different works under one key are then told apart: Myflixer films always get a card of their own
 * (as do films named like a Myflixer series); YouTube films too, unless every one of them carries
 * its own episode number. The work posted first keeps the plain key, and so the show id.
 * `rank` orders the YouTube copies of one work (copyOrder).
 */
function assignWorks(candidates, details, minSec = 0, rank = copyOrder(details, new Set())) {
  const buckets = new Map();
  for (const c of candidates) {
    if (!c.key) continue;
    const k = `${c.src.id}|${c.key}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(c);
  }
  const yearOf = (c) => /^\d{4}/.exec(details[c.v.id]?.publishedAt || '')?.[0] || null;
  const synopsisOf = (c) => normalizeArabic(cleanSynopsis(details[c.v.id]?.description || ''));
  const publishedOf = (c) => Date.parse(details[c.v.id]?.publishedAt || '') || Infinity;
  const slugRank = (a, b) => a.v.id.length - b.v.id.length || a.v.id.localeCompare(b.v.id);
  // Re-titled re-uploads of a numbered episode: "X | Name (الحلقة الثانية)" and "X - 2 Name".
  const named = (c) => { const t = normalizeArabic(c.parsed.episodeTitle || ''); return t && t !== c.key && !GENERIC_LABEL.test(c.parsed.episodeTitle) && !FILM_TITLES.has(c.parsed.episodeTitle) ? t : ''; };
  const sameEpisode = (a, b) => a.parsed.number != null && a.parsed.number === b.parsed.number && (a.parsed.season ?? null) === (b.parsed.season ?? null) && !!named(a) && named(a) === named(b);
  let variants = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const myflixer = list[0].src.profile === 'myflixer';
    // Rows that will not become episodes take no part.
    const pool = list.filter((c) => (myflixer ? c.v.id.startsWith('mf:m:') : isYouTubeId(c.v.id)) && listedRow(c, details, minSec));
    if (!pool.length) continue;
    // Copies are clustered by complete linkage (a row joins a work only if it is a copy of every
    // row in it), so near-identical titles cannot chain distinct episodes into one work.
    let same, order;
    if (myflixer) {
      same = (a, b) => (yearOf(a) && yearOf(a) === yearOf(b)) || similarity(synopsisOf(a), synopsisOf(b)) >= 0.8;
      order = [...pool].sort(slugRank);
    } else {
      const own = new Map(), words = new Map();
      const ownOf = (c) => { if (!own.has(c)) own.set(c, normalizeArabic(c.v.title)); return own.get(c); };
      // The title without its branding segments ("… | ناشيونال جيوغرافيك أبوظبي", "… - DW Documentary").
      const unbranded = (c) => normalizeArabic(c.v.title.split(/\s*\|\s*|\s+[-–—]\s+/).filter((p) => !isBranding(p)).join(' '));
      const src = pool[0].src;
      const stem = (w) => w.replace(/(?<=\p{L}{3})s$/u, '');
      const drop = new Set([...list[0].key.split(' '), ...[...(src.brands || []), src.title, src.short].filter(Boolean).flatMap((b) => normalizeArabic(b).split(' '))].map(stem));
      const wordsOf = (c) => {
        if (!words.has(c)) words.set(c, new Set(unbranded(c).split(' ').filter((w) => w.length >= 3 && !TITLE_FILLER.has(w) && !isNumberToken(w)).map(stem).filter((w) => !drop.has(w))));
        return words.get(c);
      };
      // Part markers (Part/Pt/Chapter, (N), N/M, الجزء): "… (S1, E1) | PART 1" and "… | PART 2" share their
      // number, season and name, and parts of one episode can be within 3% of each other's length.
      const parts = new Map();
      const partNo = (c) => { if (!parts.has(c)) { const p = partOf(c.v.title, c.src.lang === 'ar' ? 'ar' : 'en'); parts.set(c, p?.kind === 'part' ? p.n : null); } return parts.get(c); };
      same = (a, b) => {
        if (!sameLength(a, b, details)) return false;
        if (partNo(a) != null && partNo(b) != null && partNo(a) !== partNo(b)) return false;
        if (ownOf(a) === ownOf(b) || sameEpisode(a, b)) return true;
        // Otherwise the words that are the episode's own must be the same set: a re-upload changes
        // branding, order, case, plurals, a "(S1)" or "[Intégrale]" tag ("Le cirque, tous en
        // piste !" / "TOUS EN PISTE (le cirque)"), but "Scams" / "Cocaine", "SABLE : …" / "CAFE : …"
        // or "Peur des araignées" / "La peur des araignées : Un danger justifié ?" stay apart.
        const x = wordsOf(a), y = wordsOf(b);
        return x.size > 0 && x.size === y.size && [...x].every((w) => y.has(w)) && !markersDiffer(ownOf(a), ownOf(b));
      };
      order = pool.filter((c) => !c.work).sort((a, b) => durationOf(a, details) - durationOf(b, details));
    }
    const clusters = [];
    let from = 0; // YouTube rows come shortest first: clusters whose shortest row is too short are past
    for (const c of order) {
      if (!myflixer) while (from < clusters.length && durationOf(clusters[from][0], details) < durationOf(c, details) && !sameLength(clusters[from][0], c, details)) from++;
      let home = null;
      for (let i = from; i < clusters.length && !home; i++) if (clusters[i].every((m) => same(c, m))) home = clusters[i];
      if (home) home.push(c); else clusters.push([c]);
    }
    const works = new Map(clusters.map((members) => [members[0], members]));
    const clustered = new Set(order);
    for (const c of pool) if (!clustered.has(c)) works.set(c, [c]);
    // A copy parsed as a series episode names the episode; then copyOrder (stable keys, not views).
    const priority = myflixer ? slugRank : (a, b) => (a.parsed.kind === 'film') - (b.parsed.kind === 'film') || rank(a, b);
    const all = [...works.values()].map((members) => members.sort(priority));
    for (const members of all) {
      if (members.length < 2) continue;
      members.forEach((c, i) => { if (!c.work) { c.work = members[0].v.id; c.workRank = i; } });
    }
    // Different works under one key.
    const films = all.filter((members) => members.every((c) => c.parsed.kind === 'film'));
    const hasSeries = list.some((c) => c.parsed.kind !== 'film');
    let apart = [];
    if (myflixer) apart = hasSeries ? films : films.length > 1 ? films : [];
    else if (!hasSeries && films.length > 1) {
      const numbered = films.map((members) => ownEpisodeInfo(members[0].v.title, members[0].showName, members[0].src));
      const codes = numbered.map((i) => (i.number == null ? null : `${i.season ?? ''}x${i.number}`));
      if (codes.some((x) => x == null) || new Set(codes).size < codes.length) apart = films;
    }
    if (!apart.length) continue;
    const firstPosted = (members) => Math.min(...members.map(publishedOf));
    const ordered = myflixer ? [...apart].sort((a, b) => slugRank(a[0], b[0]))
      : [...apart].sort((a, b) => firstPosted(a) - firstPosted(b) || a[0].v.id.localeCompare(b[0].v.id));
    // A Myflixer series keeps the plain key; otherwise the first film does.
    for (const members of myflixer && hasSeries ? ordered : ordered.slice(1)) {
      const tag = members.map((c) => c.v.id).sort()[0];
      for (const c of members) c.variant = tag;
      variants++;
    }
  }
  return variants;
}

/**
 * The display name among [name, count] entries: a name in the section's script first (Arabic in the
 * Arabic section, non-Arabic in the English one), then the most used; the first such entry on a tie.
 */
export function rankNames(entries, lang = 'ar') {
  const arabicSection = lang === 'ar';
  const fits = (name) => hasArabic(name) === arabicSection;
  return [...entries].sort((a, b) => (fits(b[0]) - fits(a[0])) || (b[1] - a[1]))[0]?.[0];
}

// Profiles detectProfile (youtube.js) gives by a broadcaster's name: the channels of one are that
// broadcaster's (National Geographic / Nat Geo Animals, Discovery الشرق / its wildlife channel), so they
// are sister channels. Catch-all profiles (generic, generic-en, creator) and the kinds of channel
// sources.json names (ar-films, ar-show) are shared by unrelated channels, and 'history' is given to
// any channel whose name says history; their channels are sisters only when sources.json gives them
// one `family`.
const BROADCASTER_PROFILES = new Set(['natgeo', 'natgeo-en', 'asharq', 'dw', 'dw-en', 'aljazeera', 'frontline', 'freedoc']);
/**
 * The sister-channel family of a source: its `family` (false: none; `showGroup` is read as the same
 * key), else its broadcaster profile.
 */
export function sisterFamily(src) {
  const family = src?.family ?? src?.showGroup;
  if (!src || src.profile === 'myflixer' || family === false) return null;
  if (typeof family === 'string' && family.trim()) return `family:${family.trim()}`;
  return BROADCASTER_PROFILES.has(src.profile) ? `profile:${src.profile}` : null;
}
/**
 * The programme group of a source (sources.json `showGroup`): channels that each publish part of one
 * programme (الدحيح on AJ+ كبريت, New Media Academy Life and Museum of The Future). Unlike sister
 * channels, which re-upload each other's shows, their same-named shows are one show whatever they share.
 */
export const showGroupOf = (src) => (src && src.profile !== 'myflixer' && typeof src.showGroup === 'string' && src.showGroup.trim()) || null;
const PLACEHOLDER_TITLES = new Set([...FILM_TITLES, FULL_EPISODE.en, FULL_EPISODE.ar].map((t) => normalizeArabic(t)));

// ---- One programme across channels (showGroup) -----------------------------------------------------
/**
 * The episodes the previous catalogue, or its id state (show-ids.js showIdState), listed under a show
 * id: per episode, its id and its copies' (offerings). [] when the id was not a show.
 */
function previousUnitsOf(previous, id) {
  if (Array.isArray(previous?.units?.[id])) return previous.units[id].filter(Array.isArray);
  const ids = (xs) => xs.filter((x) => typeof x === 'string' && x);
  return (Array.isArray(previous?.shows) ? previous.shows : []).filter((s) => s?.id === id)
    .flatMap((s) => (Array.isArray(s.episodes) ? s.episodes : []).map((e) => ids([e?.id, ...(Array.isArray(e?.offerings) ? e.offerings.map((o) => o?.id) : [])])));
}
// Sort keys of era groups (labelEras), read by finalizeShow; episodes without one sort by season.
const ERA_RANK = new WeakMap();
const ERA_GAP_MS = 3 * 365.25 * 864e5;
const utcYear = (t) => new Date(t).getUTCFullYear();
/**
 * Era groups in a show of one programme group: the episodes of a channel that numbers none of its own,
 * in a show other channels give seasons, are split where three years or more pass between two of them, and
 * each run is labelled with the channel and its years (seasonLabel "AJ+ كبريت 2017–2020", "AJ+ كبريت
 * 2026"). A run sorts after the last numbered season begun by its first episode (before the first
 * season when none is). Episodes left without a season or a label (undated, or a numbering channel's
 * specials) sort last, where the show page lists them ("Other episodes").
 */
function labelEras(show, sourceById) {
  const seasonStart = new Map();
  for (const e of show.episodes) {
    if (e.season == null) continue;
    const t = Date.parse(e.publishedAt || '');
    seasonStart.set(e.season, Math.min(seasonStart.get(e.season) ?? Infinity, Number.isFinite(t) ? t : Infinity));
  }
  if (!seasonStart.size) return;
  const seasons = [...seasonStart.keys()].sort((a, b) => a - b);
  const byChannel = new Map();
  for (const e of show.episodes) { if (!byChannel.has(e.channelId)) byChannel.set(e.channelId, []); byChannel.get(e.channelId).push(e); }
  for (const [channelId, eps] of byChannel) {
    if (!channelId || eps.some((e) => e.season != null)) continue;
    const src = sourceById.get(channelId);
    const name = src?.short || src?.title || channelId;
    const dated = eps.map((e) => [e, Date.parse(e.publishedAt || '')]).filter(([, t]) => Number.isFinite(t)).sort((a, b) => a[1] - b[1]);
    const runs = [];
    for (const x of dated) {
      const run = runs.at(-1);
      if (run && x[1] - run.at(-1)[1] < ERA_GAP_MS) run.push(x); else runs.push([x]);
    }
    for (const run of runs) {
      const from = utcYear(run[0][1]), to = utcYear(run.at(-1)[1]);
      const label = `${name} ${from === to ? from : `${from}–${to}`}`;
      const begun = seasons.filter((s) => seasonStart.get(s) <= run[0][1]);
      const rank = begun.length ? Math.max(...begun) + 0.5 : seasons[0] - 0.5;
      for (const [e] of run) { e.seasonLabel = label; ERA_RANK.set(e, rank); }
    }
  }
  for (const e of show.episodes) if (e.season == null && !e.seasonLabel) ERA_RANK.set(e, seasons.at(-1) + 1);
}

/** 3c) See buildCatalog. Mutates `shows`; returns { absorbedId: keptId }. */
function mergeSisterShows(shows, sourceIndex, sourceById) {
  const groups = new Map();
  for (const s of shows) {
    const family = s._variant ? null : sisterFamily(sourceById.get(s.channel.id));
    if (!family) continue;
    const k = `${family}|${s.lang}|${s.key}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  // Copies of one episode: the same title and lengths within 60 s. A placeholder title ('Full film',
  // 'Full episode') says nothing about which episode it is, so the number and season must agree too
  // (generic headlines replace numbered 'Full episode' titles only after this step).
  const sameEpisode = (k, e) => {
    if (Math.abs((k.durationSec || 0) - (e.durationSec || 0)) > 60) return false;
    const title = normalizeArabic(e.title);
    if (normalizeArabic(k.title) !== title) return false;
    return !PLACEHOLDER_TITLES.has(title) || ((k.number ?? null) === (e.number ?? null) && (k.season ?? null) === (e.season ?? null));
  };
  const firstAt = (s) => s.episodes.reduce((m, e) => (e.publishedAt && e.publishedAt < m ? e.publishedAt : m), '9999');
  const absorbed = {};
  for (const list of groups.values()) {
    if (new Set(list.map((s) => s.channel.id)).size < 2) continue;
    // One programme group (showGroup): every same-named show joins the first source's, which keeps its
    // id and presents it whatever the episode counts and whichever channel posted last (a new upload on
    // another channel never moves the show, and its episode count, away from the first source, which the
    // per-source regression guard would read as a loss); each episode keeps its own channel (channelId).
    const group = showGroupOf(sourceById.get(list[0].channel.id));
    const whole = !!group && list.every((s) => showGroupOf(sourceById.get(s.channel.id)) === group);
    list.sort(whole ? (a, b) => sourceIndex.get(a.channel.id) - sourceIndex.get(b.channel.id)
      : (a, b) => b.episodes.length - a.episodes.length || firstAt(a).localeCompare(firstAt(b)) || sourceIndex.get(a.channel.id) - sourceIndex.get(b.channel.id));
    const keep = list[0];
    if (whole) for (const e of keep.episodes) e.channelId ??= keep.channel.id;
    let joined = false;
    for (const other of list.slice(1)) {
      if (other.channel.id === keep.channel.id) continue;
      const taken = new Set();
      const pairs = other.episodes.map((e) => {
        const match = keep.episodes.find((k) => !taken.has(k) && sameEpisode(k, e));
        if (match) taken.add(match);
        return [e, match];
      });
      const matched = pairs.filter(([, m]) => m).length;
      if (!whole && matched * 2 < Math.min(other.episodes.length, keep.episodes.length)) continue;
      if (whole) { joined = true; for (const e of other.episodes) e.channelId ??= other.channel.id; }
      for (const [e, m] of pairs) {
        if (m) {
          const offering = (x) => ({ provider: isYouTubeId(x.id) ? 'youtube' : 'myflixer', id: x.id, ...(x.sourceUrl ? { sourceUrl: x.sourceUrl } : {}) });
          m.offerings = [...(m.offerings || [offering(m)]), ...(e.offerings || [offering(e)])];
        } else {
          e.showId = keep.id;
          keep.episodes.push(e);
        }
      }
      keep.promos.push(...other.promos);
      keep.playlistIds.push(...other.playlistIds);
      keep.altTitles.push(...other.altTitles, other.title);
      keep._syn.push(...other._syn);
      keep._extraTags.push(...(other._extraTags || []));
      keep._topics.push(...other._topics);
      shows.splice(shows.indexOf(other), 1);
      absorbed[other.id] = keep.id;
    }
    if (joined) labelEras(keep, sourceById);
  }
  return absorbed;
}

/**
 * 3d) Documentary-film channels ('ar-films') upload a film again under a new subtitle, on the same
 * channel or another one ("الكونغو | في قلب أكثر مناطق أفريقيا بريةً وغموضًا" on Discovery Travel,
 * "الكونغو | أكثر دول أفريقيا بريةً وغموضًا" on آفاق). Films of an hour or more that name the same
 * place or subject before their first separator and whose lengths are within 3% of each other (complete
 * linkage, as in assignWorks) are one work: one card, whose episode lists the other uploads as
 * offerings. The card is the upload `rank` (copyOrder) puts first: the one the previous catalogue
 * listed, else the first posted, so its id stays. Mutates `shows`; returns { absorbedId: keptId }.
 */
const REUPLOAD_MIN_SEC = 3600;
function mergeReuploadedFilms(shows, rank) {
  const head = (title) => normalizeArabic(String(title || '').split(/\s*\|\s*/)[0].split(/\s*[:：]\s*|\s+[-–—]\s+/)[0]);
  const buckets = new Map();
  for (const s of shows) {
    if (s.profile !== 'ar-films' || s.episodes.length !== 1) continue;
    const [e] = s.episodes;
    if (e.title !== FILM_EPISODE_TITLE || !isYouTubeId(e.id) || !(e.durationSec >= REUPLOAD_MIN_SEC)) continue;
    const k = head(s.title);
    if (k.length < 2) continue;
    const bk = `${s.lang}|${k}`;
    if (!buckets.has(bk)) buckets.set(bk, []);
    buckets.get(bk).push(s);
  }
  const within = (a, b) => { const x = a.episodes[0].durationSec, y = b.episodes[0].durationSec; return Math.abs(x - y) <= 0.03 * Math.max(x, y); };
  const byRank = (a, b) => rank({ v: { id: a.episodes[0].id } }, { v: { id: b.episodes[0].id } });
  const offering = (x) => ({ provider: 'youtube', id: x.id, ...(x.sourceUrl ? { sourceUrl: x.sourceUrl } : {}) });
  const absorbed = {};
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.episodes[0].durationSec - b.episodes[0].durationSec || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const clusters = [];
    for (const s of list) {
      const home = clusters.find((members) => members.every((m) => within(m, s)));
      if (home) home.push(s); else clusters.push([s]);
    }
    for (const members of clusters) {
      if (members.length < 2) continue;
      const [keep, ...rest] = members.sort(byRank);
      const ep = keep.episodes[0];
      ep.offerings = [...(ep.offerings || [offering(ep)])];
      for (const other of rest) {
        const o = other.episodes[0];
        ep.offerings.push(...(o.offerings || [offering(o)]));
        ep.playlistIds = [...new Set([...ep.playlistIds, ...o.playlistIds])];
        keep.promos.push(...other.promos);
        keep.playlistIds.push(...other.playlistIds);
        keep.altTitles.push(...other.altTitles, other.title);
        keep._syn.push(...other._syn);
        keep._extraTags.push(...(other._extraTags || []));
        keep._topics.push(...other._topics);
        shows.splice(shows.indexOf(other), 1);
        absorbed[other.id] = keep.id;
      }
    }
  }
  return absorbed;
}

/**
 * @param {object} args
 * @param {Record<string, object>} args.playlists raw playlists (and UPLOADS:* pseudo-playlists) keyed by id
 * @param {Record<string, object>} args.details per-video details keyed by video id
 * @param {Record<string, string>} args.seen video id → first-seen ISO date
 * @param {object} args.overrides
 * @param {object[]} args.sources
 * @param {object|null} [args.previous] the previous catalogue, or its showIdState(): shows keep its ids
 *   (contract 2) and copies of one work the episode it listed
 * @param {Record<string, string>} [args.idSeed] committed {oldId: newId} aliases (show-id-aliases.json)
 */
/**
 * stats.bySource (contract 3): {[sourceId]: {title, shows, episodes}} for every configured source. A
 * show counts for its channel; an episode for the channel that uploaded it (its channelId, set in a
 * programme group's show, else the show's channel), so the shares of الدحيح carried by New Media
 * Academy Life and Museum of The Future are their own counts although AJ+ كبريت presents the show.
 */
export function countBySource(sources, shows) {
  const counts = Object.fromEntries(sources.map((src) => [src.id, { title: src.title || src.short || src.id, shows: 0, episodes: 0 }]));
  for (const show of shows) {
    const own = counts[show.channel?.id];
    if (own) own.shows++;
    for (const e of show.episodes || []) {
      const row = (e.channelId && counts[e.channelId]) || own;
      if (row) row.episodes++;
    }
  }
  return counts;
}

export function buildCatalog({ playlists, details, seen, overrides, sources, artwork = {}, previous = null, idSeed = {} }) {
  const minSec = overrides?.minEpisodeSeconds ?? 420;
  const aliasMap = new Map(Object.entries(overrides?.aliases || {}).map(([a, b]) => [normalizeArabic(a), normalizeArabic(b)]));
  const aliasDisplay = new Map(Object.values(overrides?.aliases || {}).map((b) => [normalizeArabic(b), b]));
  // "3 weeks ago" counts from when the listing was read: the row's own listedAt when the scheduler
  // stamps one; else a playlist is listed again whole (its fetchedAt), while a cached uploads row keeps
  // the text of its first listing (first seen). Anchored to these stored dates rather than the build
  // time, a rebuild without new data gives the same dates.
  const listedAt = (c) => {
    const at = c.v.listedAt || (c.pl.isUploads ? seen[c.v.id] || c.pl.fetchedAt : c.pl.fetchedAt || seen[c.v.id]);
    const t = Date.parse(at || details[c.v.id]?.fetchedAt || '');
    return Number.isFinite(t) ? t : null;
  };
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const channelInfo = (src) => src ? { id: src.id, title: src.title, short: src.short || src.title, lang: src.lang || 'ar', contentLang: src.contentLang || src.lang || 'ar', profile: src.profile || 'generic', url: src.url } : null;

  // 1) Candidates: every video of every playlist, parsed with its channel profile.
  //    A video can sit in several playlists; keep ONE candidate per video, preferring a dedicated
  //    show playlist over generic collections / the uploads tab.
  const byVideo = new Map();
  let scanned = 0;
  // 'ar-show' titles name their programme on either side ("الدحيح | X", "X | الدحيح"): the names that
  // recur across the channel's wanted titles (text.js arShowNames) tell the sides apart, once per source.
  const showNamesBySource = new Map();
  const showNamesOf = (src) => {
    if (!showNamesBySource.has(src.id)) {
      const titles = Object.values(playlists).filter((p) => p && !p.error && p.sourceId === src.id && playlistWanted(src, p))
        .flatMap((p) => (p.videos || []).filter((v) => !p.isUploads || uploadWanted(src, v, details)).map((v) => decodeEntities(v.title || '')));
      showNamesBySource.set(src.id, arShowNames(titles, src.brands || [src.title, src.short].filter(Boolean)));
    }
    return showNamesBySource.get(src.id);
  };
  for (const rawPl of Object.values(playlists)) {
    if (!rawPl || rawPl.error) continue;
    // A playlist whose channel was removed from sources.json (CI restores playlists.json from the
    // snapshot) is skipped, not filed under another channel.
    const src = sourceById.get(rawPl.sourceId);
    if (!src) continue;
    const plTitle = decodeEntities(rawPl.title);
    const pl = plTitle === rawPl.title ? rawPl : { ...rawPl, title: plTitle };
    // Playlists and uploads the source's title filters (sources.json; source-filters.js) leave out.
    if (!playlistWanted(src, pl)) continue;
    const profile = src.profile || 'generic';
    const lang = src.lang || 'ar';
    const brands = src.brands || [src.title, src.short].filter(Boolean);
    const rows = (pl.videos || []).filter((raw) => !pl.isUploads || uploadWanted(src, raw, details)).map((raw) => normalizeVideo(raw, src.contentLang || lang, details));
    // Generic: the uploads tab, favourites/likes lists, the Myflixer pseudo-playlist (its title is the
    // source's name, not a show's), collection titles, creator channels.
    const titleGeneric = isGenericPlaylist(pl.title, brands);
    const enCollection = lang === 'en' && /\b(shorts|trailers?|clips?|best of|top \d+|compilation|playlist of the week|most (watched|popular|streamed)|interviews?)\b/i.test(pl.title);
    let generic = pl.isUploads || isAutoPlaylistId(pl.id) || profile === 'myflixer' || String(pl.id).startsWith('MYFLIXER:')
      || titleGeneric || profile === 'creator' || src.playlistsGeneric === true || enCollection;
    // "VICE News Tonight Full Episodes (HBO)" reads as a collection by name, but it is one show's
    // playlist when the name is not a brand and most of its videos mention it.
    if (generic && titleGeneric && lang === 'en' && !pl.isUploads && !isAutoPlaylistId(pl.id) && profile !== 'creator' && profile !== 'myflixer'
      && src.playlistsGeneric !== true && !enCollection && englishPlaylistIsSeries(pl.title, rows.map((r) => r.v.title), brands)) generic = false;
    let playlistSeries;
    if (!generic && profile === 'aljazeera') {
      // Topic collections ("المغرب", "سيرة ذاتية") are not series: only playlists whose videos
      // reference the playlist name (or carry episode numbers) group their videos.
      playlistSeries = alJazeeraPlaylistIsSeries(pl.title, rows.map((r) => r.v.title));
      if (!playlistSeries) generic = true;
    }
    if (!generic && profile === 'ar-films') {
      // Documentary-film channels file standalone films by topic ("شخصيات", "العراق"); only a series
      // playlist ("سلسلة #ملوك_اليمن_القديم", or one whose videos are numbered episodes of it) makes its
      // videos episodes (text.js arFilmsPlaylistIsSeries). playlistsGeneric: true keeps every one a collection.
      playlistSeries = arFilmsPlaylistIsSeries(pl.title, rows.map((r) => r.v.title), brands);
      if (!playlistSeries) generic = true;
    }
    const ctx = { profile, lang, brands, playlistTitle: generic ? null : pl.title, playlistGeneric: generic, playlistSize: rows.length, playlistSeries, showNames: profile === 'ar-show' ? showNamesOf(src) : undefined };
    // sources.json playlistSeasons: the season of this playlist's episodes whose titles carry none.
    const season = pl.isUploads ? null : playlistSeason(src, pl.id);
    for (const { v, preset } of rows) {
      scanned++;
      let parsed = preset ? v.parsed : parseTitle(v.title, ctx);
      if (season && !preset && parsed.season == null) parsed = { ...parsed, season };
      const showName = v.showTitle || parsed.showTitle || (generic ? null : pl.title) || parsed.episodeTitle;
      let key = normalizeArabic(showName);
      if (aliasMap.has(key)) key = aliasMap.get(key);
      const cand = { v, parsed, preset, showName, key, pl, generic, src, playlistIds: new Set([pl.id]) };
      const prev = byVideo.get(v.id);
      if (!prev) byVideo.set(v.id, cand);
      else {
        prev.playlistIds.add(pl.id);
        if (prev.generic && !generic) { cand.playlistIds = prev.playlistIds; byVideo.set(v.id, cand); }
      }
    }
  }
  const candidates = [...byVideo.values()];

  // 1a) Uploads with no real playlist membership that parse as standalone films are classified
  //     (classify-upload.js) here, before 1b/1c group films into series by their titles: being grouped
  //     does not make an upload a documentary. Non-documentary ones never become episodes, so they take
  //     no part in grouping (listedRow); an uncertain part makes its show uncertain (finalizeShow).
  //     Every playlist has been read by now, so a video the channel files in one is not classified.
  for (const c of candidates) {
    if (c.parsed.kind === 'film' && c.pl.isUploads && [...c.playlistIds].every((pid) => playlists[pid]?.isUploads)) {
      c.classification = classifyUpload(c.v, details[c.v.id] || {}, c.src, overrides);
    }
  }

  // 1b) Prefix clustering (DW, Al Jazeera): standalone films whose titles share a prefix such as
  //     "صراع البوارج.. X" / "حكاية أغنية - X" at least 3 times in the same channel are a series.
  const prefixOf = (title) => {
    const m = title.match(/^(.{3,}?)\s*(?:\.\.+|\s[-–—]+\s|[:：]\s)\s*(.{2,})$/);
    if (!m) return null;
    const pre = m[1].trim();
    if (normalizeArabic(pre).split(' ').length < 2 && !/\.\./.test(title)) return null; // one-word dash/colon prefixes are too ambiguous
    return { pre, rest: m[2].trim() };
  };
  const prefixCounts = new Map();
  for (const c of candidates) {
    if (c.parsed.kind !== 'film' || !['dw', 'aljazeera'].includes(c.src.profile)) continue;
    const p = prefixOf(c.showName);
    if (!p) continue;
    const k = `${c.src.id}|${normalizeArabic(p.pre)}`;
    prefixCounts.set(k, (prefixCounts.get(k) || 0) + 1);
  }
  for (const c of candidates) {
    if (c.parsed.kind !== 'film' || !['dw', 'aljazeera'].includes(c.src.profile)) continue;
    const p = prefixOf(c.showName);
    if (!p) continue;
    const k = `${c.src.id}|${normalizeArabic(p.pre)}`;
    if ((prefixCounts.get(k) || 0) < 3) continue;
    c.showName = p.pre;
    c.key = aliasMap.get(normalizeArabic(p.pre)) || normalizeArabic(p.pre);
    c.parsed = { ...c.parsed, showTitle: p.pre, episodeTitle: p.rest, kind: 'series', number: c.parsed.number ?? episodeNumberFromTitle(p.rest) };
  }

  // Copies of one work keep the episode the previous catalogue listed (copyOrder).
  const rank = copyOrder(details, previousEpisodeIds(previous));
  groupParts(candidates, { aliasMap, details, minSec, rank });
  assignWorks(candidates, details, minSec, rank);

  // 2) Group by canonical key within each channel (exact, then fuzzy). Deterministic order → stable ids.
  //    The fuzzy pass never joins Myflixer items (they are keyed by work), two film-only keys (re-posts
  //    are found by assignWorks, parts by groupParts) or keys that differ in a number/part/sequel marker
  //    when one side is a film ("Titanic: 20 Years Later" / "25 Years Later"); two series keys only
  //    stay apart on roman numerals and part/volume words ("Shark Week 2013" / "2015" is one show).
  const scoped = (c) => `${c.src.id}|${c.key}`;
  const keysByChannel = new Map();
  const seriesKeys = new Set(); // scoped keys with at least one non-film candidate
  for (const c of candidates) {
    if (!c.key || c.variant) continue;
    if (!keysByChannel.has(c.src.id)) keysByChannel.set(c.src.id, new Set());
    keysByChannel.get(c.src.id).add(c.key);
    if (c.parsed.kind !== 'film') seriesKeys.add(scoped(c));
  }
  const canonical = new Map(); // scopedKey → canonical scopedKey
  for (const [chId, keys] of keysByChannel) {
    if (sourceById.get(chId)?.profile === 'myflixer') continue;
    const isFilmKey = (k) => !seriesKeys.has(`${chId}|${k}`);
    const apart = (a, b) => {
      const fa = isFilmKey(a), fb = isFilmKey(b);
      if (fa && fb) return true;
      return markersDiffer(a, b, { romanOnly: !fa && !fb });
    };
    // Near-identical keys (Dice ≥ 0.9) share their first word, so compare within first-word buckets
    // only; this keeps the pass linear-ish for channels with thousands of film titles.
    const buckets = new Map();
    for (const k of [...keys].sort()) {
      const b = k.split(' ')[0];
      if (!buckets.has(b)) buckets.set(b, []);
      const canonicalKeys = buckets.get(b);
      let target = null;
      for (const ck of canonicalKeys) if (Math.abs(ck.length - k.length) <= 6 && similarity(k, ck) >= FUZZY_MERGE && !apart(k, ck)) { target = ck; break; }
      if (!target) { canonicalKeys.push(k); target = k; }
      canonical.set(`${chId}|${k}`, `${chId}|${target}`);
    }
  }

  const showsByKey = new Map();
  const playlistNames = new Map(); // playlist id → the cleaned show name its title denotes ('' for none)
  const playlistName = (c) => {
    if (!playlistNames.has(c.pl.id)) playlistNames.set(c.pl.id, playlistShowName(c.pl.title, c.src));
    return playlistNames.get(c.pl.id);
  };
  for (const c of candidates) {
    if (!c.key) continue;
    // A work told apart from others of the same title gets its own group ("…|key#mf:m:penguins-2").
    const sk = c.variant ? `${scoped(c)}#${c.variant}` : canonical.get(scoped(c)) || scoped(c);
    let show = showsByKey.get(sk);
    if (!show) {
      show = { scopedKey: sk, key: sk.slice(sk.indexOf('|') + 1).replace(/#.*$/, ''), variant: !!c.variant, src: c.src, names: new Map(), altNames: new Set(), topicNames: new Set(), playlistTitles: new Map(), playlistIds: new Set(), videos: new Map() };
      showsByKey.set(sk, show);
    }
    show.names.set(c.showName, (show.names.get(c.showName) || 0) + 1);
    // "Also known as": the names the show's videos go by. A playlist title is one only when the show
    // name came from it, and then in its cleaned form ("Branching Out | National Geographic" → "Branching
    // Out"); topic collections a video also sits in ("Arts & Culture") are not names of the show.
    const alt = !c.generic && c.showName === c.pl.title ? playlistName(c) : c.showName;
    if (alt) show.altNames.add(alt);
    if (!c.generic) {
      // The rest of its playlists are the channel's topic filing: a tagging hint (tagShow topics).
      if (playlistName(c)) show.topicNames.add(playlistName(c));
      show.playlistTitles.set(c.pl.title, (show.playlistTitles.get(c.pl.title) || 0) + 1);
      show.playlistIds.add(c.pl.id);
    }
    show.videos.set(c.v.id, c);
  }

  // 3) Materialize shows and episodes.
  const shows = [];
  const usedIds = new Map(); // id → scopedKey (collision guard across channels)
  const plainTaken = new Set(); // plain scoped keys whose title id is in use
  const sourceIndex = new Map(sources.map((s, i) => [s.id, i]));
  const ordered = [...showsByKey.values()].sort((a, b) => (sourceIndex.get(a.src.id) - sourceIndex.get(b.src.id)) || a.key.localeCompare(b.key) || a.variant - b.variant || a.scopedKey.localeCompare(b.scopedKey));
  // Contract 2: a show keeps the previous catalogue's id whose episodes it mostly holds (show-ids.js),
  // so a re-title does not re-key it. Settled before overrides and artwork are looked up by id. The
  // title id of a work told apart from a same-titled one stays with the work owning the title.
  const plainGroups = new Set(ordered.filter((s) => !s.variant).map((s) => s.scopedKey));
  const titleIdOf = (s) => `s_${shortHash(s.key)}`;
  // The same-named groups of one programme group (showGroup) become one show (3c) and count as one here:
  // each lists all their videos, so the first source's group holds the merged show's previous id
  // whichever channel lists most of its episodes (the first listing holds a video, show-ids.js).
  const programmeKey = (s) => { const group = !s.variant && showGroupOf(s.src); return group ? `${group}|${s.src.lang || 'ar'}|${s.key}` : null; };
  const programmes = new Map();
  for (const s of ordered) { const k = programmeKey(s); if (k) programmes.set(k, [...(programmes.get(k) || []), s]); }
  const listedVideos = (s) => [...s.videos.values()].filter((c) => listedRow(c, details, minSec)).map((c) => c.v.id);
  const videosOf = (s) => (programmeKey(s) ? programmes.get(programmeKey(s)).flatMap(listedVideos) : listedVideos(s));
  // A previous catalogue that listed a programme's shows apart (before its showGroup) offers the
  // programme every one of their ids, which show-ids.js settles by episodes held: the show would take the
  // id of whichever channel listed most of it. The programme's title id (the id a cold build gives, the
  // first source's when it was listed apart) wins instead whenever it is a candidate, i.e. the previous
  // show of that id mostly sits in the programme (the strict majority of show-ids.js, over the groups
  // first listing each of its episodes' ids). A programme listed before under another id (a re-title)
  // keeps it, as any show does.
  const holderOf = new Map(); // video id → the programme (key) or group first listing it
  for (const s of ordered) for (const v of videosOf(s)) if (!holderOf.has(v)) holderOf.set(v, programmeKey(s) || s);
  const titleWins = new Set();
  for (const [key, members] of programmes) {
    let held = 0, total = 0;
    for (const ids of previousUnitsOf(previous, titleIdOf(members[0]))) {
      const h = ids.map((v) => holderOf.get(v)).find((x) => x !== undefined);
      if (h === undefined) continue;
      total++;
      if (h === key) held++;
    }
    if (held * 2 > total) titleWins.add(key);
  }
  const stable = assignShowIds(ordered, previous, {
    videosOf,
    keyOf: (s) => s.scopedKey,
    preferredOf: (s) => `s_${shortHash(s.variant ? s.scopedKey : s.key)}`,
    mayReuse: (s, prevId) => !(s.variant && prevId === titleIdOf(s) && plainGroups.has(s.scopedKey.replace(/#.*$/, '')))
      && !(programmeKey(s) && titleWins.has(programmeKey(s)) && prevId !== titleIdOf(s)),
  });
  for (const [s, id] of stable.reused) usedIds.set(id, s.scopedKey);
  for (const s of ordered) {
    const titleFromPlaylist = rankNames(s.playlistTitles.entries(), sectionLang(s.src));
    const titleFromNames = rankNames(s.names.entries(), sectionLang(s.src));
    // 'ar-show' episodes name their programme the way the channel spells it in titles ("المُخبر
    // الاقتصادي+ | …"), which its playlist may not ("+ المُخبر الاقتصادي", "برنامج روح").
    const title = aliasDisplay.get(s.key)
      || (s.src.profile !== 'ar-show' && titleFromPlaylist && normalizeArabic(titleFromPlaylist) === s.key ? titleFromPlaylist : null)
      || titleFromNames || titleFromPlaylist;
    const altTitles = uniqueTitles([...s.altNames], [title]);
    const topics = uniqueTitles([...s.topicNames], [title, ...altTitles]);
    // A work told apart from a same-titled one (assignWorks) hashes its scoped key, so the plain
    // title id stays with the series or the work posted first; it takes the plain id only when that
    // group lists no episode. Its id is settled once its episodes are known.
    const plainKey = s.scopedKey.replace(/#.*$/, '');
    let id = null, ov = {};
    const settle = () => {
      id = stable.reused.get(s);
      if (!id) {
        const taken = (x) => usedIds.has(x) && usedIds.get(x) !== s.scopedKey && !(s.variant && usedIds.get(x) === plainKey);
        id = `s_${shortHash(s.variant && plainTaken.has(plainKey) ? s.scopedKey : s.key)}`;
        if (taken(id)) id = `s_${shortHash(s.scopedKey)}`;
        id = stable.claim(s, id, taken); // unchanged without a previous catalogue
      }
      usedIds.set(id, s.scopedKey);
      ov = overrides?.shows?.[id] || overrides?.shows?.[title] || {};
    };
    if (!s.variant) { settle(); if (ov.hidden) continue; }

    const episodes = [];
    const promos = [];
    const synopsisCandidates = [];
    // Films that ended up in a group of several works (a series they fuzzy-joined, or numbered
    // uploads parsed as films) read their number and title from their own video title.
    const multi = new Set([...s.videos.values()].filter((c) => listedRow(c, details, minSec)).map((c) => c.work || c.v.id)).size > 1;
    const workEpisode = new Map(); // work id → its episode; further copies become offerings
    const derived = [];
    const isCopy = (c) => !!c.work && c.work !== c.v.id;
    const members = [...s.videos.values()].sort((a, b) => isCopy(a) - isCopy(b) || (a.workRank ?? 0) - (b.workRank ?? 0));
    for (const c of members) {
      const d = details[c.v.id];
      // Contract 1: YouTube confirmed it removed or private, or its embedding is off (Dahsha plays
      // YouTube through the embed only). Neither an episode nor a promo.
      if (d?.isPrivate || d?.unavailable === true || d?.embeddable === false) continue;
      const durationSec = durationOf(c, details);
      const cleaned = d ? cleanedDescription(c.v.id, d.description) : '';
      const q = cleaned ? synopsisQuality(cleaned, title, s.src.lang || 'ar') : 0;
      // A provider item of unknown length (0) is not a clip; a YouTube video without one is.
      if (durationSec < minSec && (durationSec > 0 || isYouTubeId(c.v.id))) {
        if (cleaned) synopsisCandidates.push({ text: cleaned, q, isEpisode: false });
        promos.push(c.v.id); continue;
      }
      // Uploads classified in 1a (only those with no real playlist membership: the next refresh
      // restores playlist treatment when the channel files the video).
      const classification = c.classification || null;
      if (classification?.status === 'non-documentary') continue;
      const workId = c.work || c.v.id;
      const primary = workEpisode.get(workId);
      if (primary) {
        // Another copy of an episode already listed: playable as an alternative, not a second episode.
        const offering = (e) => ({ provider: isYouTubeId(e.id) ? 'youtube' : 'myflixer', id: e.id, ...(e.sourceUrl ? { sourceUrl: e.sourceUrl } : {}) });
        primary.offerings = [...(primary.offerings || [offering(primary)]), offering({ id: c.v.id, sourceUrl: d?.sourceUrl || c.v.sourceUrl || null })];
        primary.playlistIds = [...new Set([...primary.playlistIds, ...c.playlistIds])];
        continue;
      }
      if (cleaned) synopsisCandidates.push({ text: cleaned, q, isEpisode: true });
      // Myflixer dates without an offset (caches written before documentaries.js siteDate) are site-local
      // time, not the build machine's: read through siteDate, so a build gives the same dates in any zone.
      const yt = isYouTubeId(c.v.id);
      let publishedAt = d?.publishedAt ? (yt ? new Date(d.publishedAt).toISOString() : siteDate(d.publishedAt)) : yt ? isoOrNull(c.v.published) : siteDate(c.v.published);
      let approx = false;
      if (!publishedAt && c.v.relative) {
        const ago = relativeToMs(c.v.relative);
        const at = ago != null ? listedAt(c) : null;
        if (at != null) { publishedAt = new Date(at - ago).toISOString(); approx = true; }
      }
      // Provider episodes keep an emptied placeholder title ('' = "label me from the number").
      let epTitle = c.preset && c.parsed.kind !== 'film' ? c.parsed.episodeTitle || '' : (c.parsed.episodeTitle || c.v.title);
      let number = c.parsed.number, season = c.parsed.season;
      const nEp = normalizeArabic(epTitle);
      if (c.parsed.kind !== 'film' && nEp && (nEp === s.key || nEp === normalizeArabic(title))) {
        epTitle = c.preset && c.parsed.number != null ? '' : FULL_EPISODE[sectionLang(s.src)];
      }
      // In a group of several works, a film placeholder or an unnumbered 'Full episode' takes its
      // number, season and subtitle from the video's own title when it has them.
      let own = null;
      const film = FILM_TITLES.has(epTitle);
      if (multi && isYouTubeId(c.v.id) && (film || (epTitle === FULL_EPISODE[sectionLang(s.src)] && number == null))) {
        own = ownEpisodeInfo(c.v.title, title, s.src);
        if (own.title || own.number != null || film) epTitle = own.title || FULL_EPISODE[sectionLang(s.src)];
        number = number ?? own.number;
        season = season ?? own.season;
      }
      const episode = {
        id: c.v.id,
        ...(classification ? { classification } : {}),
        showId: id,
        title: epTitle,
        fullTitle: c.v.title,
        number: number ?? episodeNumberFromTitle(epTitle),
        season: season ?? null,
        label: c.parsed.label ?? null,
        durationSec,
        views: knownViews(c.v.id, d?.viewCount),
        viewsText: knownViews(c.v.id, c.v.views),
        publishedAt,
        publishedApprox: approx,
        // YouTube: first seen. Provider episodes: only the scheduler's discovery date (contract 4); the
        // first-seen stamp of a bulk import is not one.
        addedAt: isYouTubeId(c.v.id) ? seen[c.v.id] || null : isoOrNull(c.v.addedAt),
        synopsis: q > 0 ? cleaned : '',
        thumbs: /^[\w-]{11}$/.test(c.v.id) ? thumbUrls(c.v.id) : (c.v.thumb?.startsWith('http') ? { custom: c.v.thumb } : thumbUrls(c.v.id)),
        sourceUrl: d?.sourceUrl || c.v.sourceUrl || null,
        embedUrl: d?.embedUrl || c.v.embedUrl || null,
        playlistIds: [...c.playlistIds],
      };
      episodes.push(episode);
      workEpisode.set(workId, episode);
      if (own?.title && !own.label) derived.push(episode);
    }
    if (!episodes.length) continue;
    if (s.variant) { settle(); if (ov.hidden) continue; for (const e of episodes) e.showId = id; }
    // (A plain group keeping a previous id holds the title too: a later work does not take its title id.)
    if (id === `s_${shortHash(s.key)}` || (!s.variant && stable.reused.has(s))) plainTaken.add(plainKey);
    // A subtitle every derived episode shares ("تغطية خاصة لدراما رمضان 2024") names the show, not
    // the episode: those episodes are labelled from their number instead.
    const repeated = new Map();
    for (const e of derived) { const k = normalizeArabic(e.title); repeated.set(k, (repeated.get(k) || 0) + 1); }
    for (const e of derived) if (repeated.get(normalizeArabic(e.title)) > 1) e.title = FULL_EPISODE[sectionLang(s.src)];
    const extraTags = [...new Set(Array.from(s.videos.values()).flatMap((cand) => cand.v.tags || []))];
    shows.push({
      id, key: s.key, title: ov.title || title, rawTitle: title, altTitles, episodes, promos,
      channel: channelInfo(s.src), lang: s.src.lang || 'ar', contentLang: s.src.contentLang || s.src.lang || 'ar', profile: s.src.profile || 'generic',
      playlistIds: [...s.playlistIds], _ov: ov, _syn: synopsisCandidates, _extraTags: extraTags, _topics: topics, ...(s.variant ? { _variant: true } : {}),
    });
  }

  // 3b) Nat Geo / generic only: fold "Show: Episode" single-video entries into the parent show and
  //     re-file pipe-less "KnownShow: Episode" videos that sat in another show's playlist.
  const byKey = new Map(shows.filter((s) => !s._variant).map((s) => [`${s.channel.id}|${s.key}`, s]));
  const lookup = (show, name) => byKey.get(`${show.channel.id}|${normalizeArabic(name)}`);
  for (const sub of [...shows]) {
    if (!['natgeo', 'generic'].includes(sub.profile)) continue;
    if (sub.episodes.length !== 1 || sub.episodes[0].title !== 'الحلقة الكاملة') continue;
    const m = sub.rawTitle.match(/^(.+?)\s*[:：]\s*(.+)$/);
    if (!m) continue;
    const base = lookup(sub, m[1]);
    if (!base || base === sub) continue;
    const ep = sub.episodes[0];
    ep.title = m[2].trim();
    ep.showId = base.id;
    ep.number = episodeNumberFromTitle(ep.title);
    base.episodes.push(ep);
    base.promos.push(...sub.promos);
    base.playlistIds.push(...sub.playlistIds);
    // sub.title ("Show: Episode") names the episode, which keeps it as fullTitle; it is no alt title.
    base._syn.push(...sub._syn);
    base._topics.push(...sub._topics);
    shows.splice(shows.indexOf(sub), 1);
    byKey.delete(`${sub.channel.id}|${sub.key}`);
  }
  for (const show of shows) {
    if (!['natgeo', 'generic'].includes(show.profile)) continue;
    for (const ep of [...show.episodes]) {
      const segs = ep.fullTitle.replace(/\s+/g, ' ').split(/\s*\|\s*/).map((p) => p.trim()).filter((p) => p && !isBranding(p));
      if (segs.length !== 1) continue;
      const raw = segs[0];
      const m = raw.match(/^(.+?)\s*[:：]\s*(.+)$/);
      let target = null, newTitle = null;
      if (m && lookup(show, m[1])) { target = lookup(show, m[1]); newTitle = m[2].trim(); }
      else if (lookup(show, raw)) { target = lookup(show, raw); newTitle = 'الحلقة الكاملة'; }
      if (!target || target === show) continue;
      ep.title = newTitle;
      ep.showId = target.id;
      ep.number = episodeNumberFromTitle(newTitle);
      target.episodes.push(ep);
      show.episodes.splice(show.episodes.indexOf(ep), 1);
    }
  }
  for (const show of [...shows]) if (!show.episodes.length) { shows.splice(shows.indexOf(show), 1); }

  // 3c) Sister channels (one broadcaster or a declared family, and one section: e.g. Discovery الشرق
  //     and its wildlife channel; see sisterFamily) re-upload whole shows. Same-titled shows merge when
  //     at least half of the smaller one's episodes match by title and length (within 60 s); its copies
  //     become offerings. Channels of one programme group (showGroup) carry one show between them: its
  //     same-titled shows always merge (the copies still become offerings), presented by the first of
  //     them in sources.json, with era groups for a channel that numbers no season (labelEras).
  mergeSisterShows(shows, sourceIndex, sourceById);
  // 3d) Re-uploads of one documentary film under other subtitles ('ar-films' channels).
  mergeReuploadedFilms(shows, rank);

  // Generic headlines (after 3b, which matches on 'الحلقة الكاملة'): a numbered episode reads
  // 'Episode N' / 'الحلقة N' rather than 'Full episode' / 'الحلقة الكاملة', or 'Part N' / 'الجزء N'
  // when its own title numbers it as a part ("The War Against Boko Haram (Part 2)").
  for (const show of shows) for (const ep of show.episodes) {
    if (ep.number == null || (ep.title !== FULL_EPISODE.en && ep.title !== FULL_EPISODE.ar)) continue;
    const part = partOf(ep.fullTitle || '', show.lang === 'ar' ? 'ar' : 'en');
    const isPart = part?.kind === 'part' && part.n === ep.number;
    if (ep.title === FULL_EPISODE.en) ep.title = isPart ? `Part ${ep.number}` : `Episode ${ep.number}`;
    else ep.title = isPart ? `الجزء ${ep.number}` : `الحلقة ${ep.number}`;
  }

  for (const show of shows) finalizeShow(show, artwork[show.id]);
  // Contract 2: ids of the previous catalogue that are gone point to the show holding their episodes.
  const idAliases = buildIdAliases(previous, shows, idSeed);

  shows.sort((a, b) => (b.latestAt || '').localeCompare(a.latestAt || '') || a.title.localeCompare(b.title, 'ar'));

  const tagCounts = new Map();
  for (const s of shows) for (const t of s.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const tagCountsByLang = { ar: new Map(), en: new Map() };
  for (const s of shows) for (const t of s.tags) { const m = tagCountsByLang[s.lang === 'en' ? 'en' : 'ar']; m.set(t, (m.get(t) || 0) + 1); }
  const langTagDefs = Object.entries(LANG_TAGS).map(([code, d]) => ({ id: `lang-${code}`, ...d }));
  const tags = [...allTagDefs(), ...langTagDefs]
    .map((t) => ({ id: t.id, label: t.label, labelEn: t.labelEn || t.label, color: t.color, count: tagCounts.get(t.id) || 0, countAr: tagCountsByLang.ar.get(t.id) || 0, countEn: tagCountsByLang.en.get(t.id) || 0 }))
    .filter((t) => t.count > 0);

  const showsOf = new Map(sources.map((s) => [s.id, []]));
  for (const x of shows) showsOf.get(x.channel.id)?.push(x);
  const channels = sources.map((s) => {
    const mine = showsOf.get(s.id);
    return {
      id: s.id, title: s.title, short: s.short || s.title, url: s.url, lang: s.lang || 'ar', profile: s.profile || 'generic',
      shows: mine.length, series: mine.filter((x) => x.kind === 'series').length, films: mine.filter((x) => x.kind === 'film').length,
      episodes: mine.reduce((a, x) => a + x.episodeCount, 0),
      latestAt: mine.reduce((m, x) => (x.latestAt && (!m || x.latestAt > m) ? x.latestAt : m), null),
    };
  }).filter((c) => c.shows > 0);

  return {
    generatedAt: new Date().toISOString(),
    minEpisodeSeconds: minSec,
    sources: sources.map((s) => ({ type: s.type, id: s.id, title: s.title, short: s.short, url: s.url, lang: s.lang, profile: s.profile })),
    channels,
    langs: [...new Set(shows.map((s) => s.lang))],
    stats: {
      shows: shows.length,
      series: shows.filter((s) => s.kind === 'series').length,
      films: shows.filter((s) => s.kind === 'film').length,
      episodes: shows.reduce((a, s) => a + s.episodeCount, 0),
      channels: channels.length,
      playlists: Object.values(playlists).filter((p) => !p.isUploads).length,
      videosScanned: scanned,
      totalHours: Math.round(shows.reduce((a, s) => a + s.totalDurationSec, 0) / 3600),
      // Contract 3: every configured source (0 when it has no show, so a source going empty shows),
      // each episode counted for the channel that uploaded it (its channelId in a programme group's
      // show, else the show's channel, so the per-source guard follows a channel's own uploads),
      // and the shows built from classified uploads.
      bySource: countBySource(sources, shows),
      classification: {
        documentary: shows.filter((s) => s.classification?.status === 'documentary').length,
        uncertain: shows.filter((s) => s.classification?.status === 'uncertain').length,
      },
    },
    tags,
    shows,
    idAliases,
  };
}

/** Compare two catalogues and describe what is new. */
export function diffCatalog(prev, next) {
  if (!prev) return { newShows: [], newEpisodes: [], initial: true };
  const prevEp = new Set(prev.shows.flatMap((s) => s.episodes.map((e) => e.id)));
  const prevShows = new Set(prev.shows.map((s) => s.id));
  const newShows = next.shows.filter((s) => !prevShows.has(s.id)).map((s) => ({ id: s.id, title: s.title }));
  const newEpisodes = [];
  for (const s of next.shows) for (const e of s.episodes) if (!prevEp.has(e.id)) newEpisodes.push({ id: e.id, title: e.title, season: e.season ?? null, number: e.number ?? null, kind: s.kind, showId: s.id, showTitle: s.title, channel: s.channel?.short });
  return { newShows, newEpisodes, initial: false };
}
