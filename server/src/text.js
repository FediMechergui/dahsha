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
export function isGenericPlaylist(title = '') {
  return GENERIC_PLAYLIST.test(String(title).trim());
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

const EPISODE_RE = /(?:^|\s)(?:الحلق[ةه]|الحلق|حلقة|حلقه|ep|episode|e)\.?\s*[:：]?\s*([\d٠-٩]{1,3}|ال\S+(?:\s+(?:عشر[ةه]?|و\S+))?)/iu;
const SEASON_RE = /(?:^|\s)(?:الموسم|موسم|season|s)\.?\s*[:：]?\s*([\d٠-٩]{1,2}|ال\S+(?:\s+عشر[ةه]?)?)/iu;
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
    if (isSeasonPart(s)) { season = wordToNumber(s.replace(/^(الموسم|موسم|season)\s*/i, '')) ?? season; continue; }
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
// English channels
// ---------------------------------------------------------------------------------------------

const EN_BRANDS = [
  /^(national geographic|nat ?geo( wild)?|a national geographic youtube original series|national geographic youtube original series)$/i,
  /^(dw( documentary| news)?|deutsche welle)$/i,
  /^(frontline( pbs)?( \| official)?|frontline\/world|frontline \(pbs\)|pbs|frontline \+ @?associated press)$/i,
  /^(history|history channel|the history channel|a&e)$/i,
  /^(free documentary( -)?( history| nature)?|fd history|fd nature|free documentary history)$/i,
  /^(vice( news)?|vice news tonight)$/i,
  /^(kurzgesagt( – in a nutshell)?|veritasium|fern|hoog|jcs(\s*-\s*criminal psychology)?)$/i,
  /^(nat ?geo (animals|wild)|curiosity ?stream(ing)?|discovery( channel)?|(season \d+\s+)?i?\s*welt( hd)?( documentary)?|welt)$/i,
  /^(c'est pas sorcier|it'?s not rocket science)$/i,
  /^(documentary special|documentary|full documentary|full episode|official series playlist|all episodes|all parts|official trailer)$/i,
];
const norm = (s) => String(s).replace(/[’'"“”]/g, "'").replace(/\s+/g, ' ').trim();
function isBrandingEn(part, brands = []) {
  const p = norm(part).toLowerCase().replace(/[.,!]+$/, '');
  if (EN_BRANDS.some((re) => re.test(p))) return true;
  return brands.some((b) => b && p === norm(b).toLowerCase());
}
const EN_MARKERS = /\s*[\(\[]?\s*(full (episode|documentary|film|movie|special)|mega episode|full ep\.?|complete (episode|documentary)|hd|4k|official)\s*[\)\]]?\s*/gi;
const stripMarkers = (s) => norm(String(s).replace(EN_MARKERS, ' ')).replace(/^[\s|:\-–—]+|[\s|:\-–—]+$/g, '').trim();

// "S2 E5", "Season 2, Episode 5", "Season 2 Episode 5", "Episode 5", "Ep. 5", "Part 2", "(2/3)", "(S1)"
function enNumbers(text) {
  const t = String(text);
  let season = null, number = null, total = null;
  let m;
  if ((m = t.match(/\bS(?:eason)?\s*\.?\s*(\d{1,2})\s*[,:\-–—]?\s*(?:E(?:p(?:isode)?)?\.?\s*(\d{1,3}))?/i))) { season = parseInt(m[1], 10); if (m[2]) number = parseInt(m[2], 10); }
  if (number == null && (m = t.match(/\b(?:Episode|Ep\.?|E)\s*(\d{1,3})\b/i))) number = parseInt(m[1], 10);
  if (number == null && (m = t.match(/\bPart\s*(\d{1,2})(?:\s*(?:of|\/)\s*(\d{1,2}))?\b/i))) { number = parseInt(m[1], 10); if (m[2]) total = parseInt(m[2], 10); }
  if (number == null && (m = t.match(/\(\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\)/))) { number = parseInt(m[1], 10); total = parseInt(m[2], 10); }
  return { season, number, total };
}
const EN_NUM_RE = /\s*[\(\[]?\s*(?:S(?:eason)?\s*\.?\s*\d{1,2}\s*[,:\-–—]?\s*(?:E(?:p(?:isode)?)?\.?\s*\d{1,3})?|(?:Episode|Ep\.?)\s*\d{1,3}\s*:?|Part\s*\d{1,2}(?:\s*(?:of|\/)\s*\d{1,2})?|\(\s*\d{1,2}\s*\/\s*\d{1,2}\s*\))\s*[\)\]]?\s*/gi;
const stripNumbers = (s) => norm(String(s).replace(EN_NUM_RE, ' ')).replace(/^[\s|:\-–—,]+|[\s|:\-–—,]+$/g, '').trim();
const FILM_EN = 'Full film';

/** Playlist title → show name for English channels ("Tucci in Italy | National Geographic", "X: Official Series Playlist | History"). */
export function englishPlaylistShow(playlistTitle = '', brands = []) {
  let parts = splitPipes(norm(playlistTitle)).filter((p) => !isBrandingEn(p, brands));
  let name = (parts[0] || norm(playlistTitle)).replace(/:\s*(official series playlist|all episodes|all parts|full episodes|season \d+)\s*$/i, '').trim();
  const seasonM = name.match(/[:\-–—,]?\s*Season\s*(\d{1,2})\s*$/i);
  const season = seasonM ? parseInt(seasonM[1], 10) : null;
  name = name.replace(/[:\-–—,]?\s*Season\s*\d{1,2}\s*$/i, '').replace(/\s*\((documentary series|\d+-part documentary series|series)\)\s*$/i, '').trim();
  return { name, season };
}

// Discovery writes "Episode 🤔⛏️ Show | Discovery": an emoji run between words works like a pipe.
const EMOJI_RUN = /\s*(?:[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}‍️]+\s*)+/gu;
function emojiToPipes(s) {
  return s.replace(EMOJI_RUN, (m, offset, str) => (offset > 0 && offset + m.length < str.length ? ' | ' : ' ')).replace(/\s+/g, ' ').trim();
}

/** Generic English: "Episode | Show | Brand" or film. Sub-variants tweak the details. */
function parseEnglish(title, ctx) {
  const raw = emojiToPipes(norm(title));
  const brands = ctx.brands || [];
  const parts = splitPipes(raw).filter((p) => !isBrandingEn(p, brands));
  if (ctx.profile === 'dash-show') {
    // "Why do we die if we don't breathe? - C'est pas sorcier": the show is the LAST dash segment.
    const segs = (parts[0] || raw).split(DASH).map((s) => s.trim()).filter(Boolean);
    if (segs.length >= 2) return { showTitle: segs[segs.length - 1], episodeTitle: segs.slice(0, -1).join(' - '), kind: 'series' };
    return { showTitle: ctx.playlistTitle && !ctx.playlistGeneric ? englishPlaylistShow(ctx.playlistTitle, brands).name : (parts[0] || raw), episodeTitle: parts[0] || raw, kind: 'series' };
  }
  const generic = !ctx.playlistTitle || ctx.playlistGeneric;
  const pl = !generic ? englishPlaylistShow(ctx.playlistTitle, brands) : null;
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
      const ep = stripNumbers(epPart.replace(/^(episode|ep\.?|part)\s*\d*\s*[:\-–—]?\s*/i, '')) || (nums.number != null ? `Episode ${nums.number}` : 'Episode');
      return { showTitle: stripMarkers(show), episodeTitle: ep, number: nums.number, season: nums.season, kind: 'series' };
    }
    if (pl && body.length >= 1 && /all (episodes|parts)/i.test(ctx.playlistTitle)) {
      const nums = enNumbers(body.join(' '));
      if (nums.number != null) return { showTitle: pl.name, episodeTitle: stripNumbers(body.join(' - ')) || `Episode ${nums.number}`, number: nums.number, kind: 'series' };
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

  // natgeo-en, history, generic-en: "Episode | Show" with markers/numbers on either side.
  if (body.length >= 2) {
    const epRaw = body[0];
    let showRaw = body[1];
    const nums = { ...enNumbers(showRaw), ...Object.fromEntries(Object.entries(enNumbers(epRaw)).filter(([, v]) => v != null)) };
    const showClean = stripNumbers(stripMarkers(showRaw)).replace(/\s*(compilation|mega episode)\s*$/i, '').trim();
    if (/^(documentary special|documentary|special)$/i.test(showClean)) return { showTitle: stripNumbers(stripMarkers(epRaw)), episodeTitle: FILM_EN, kind: 'film' };
    if (pl && pl.name && norm(showClean).toLowerCase() !== pl.name.toLowerCase() && norm(pl.name).toLowerCase().startsWith(norm(showClean).toLowerCase())) showRaw = pl.name;
    return { showTitle: showClean || pl?.name || showRaw, episodeTitle: stripNumbers(stripMarkers(epRaw)) || (nums.number != null ? `Episode ${nums.number}` : 'Full episode'), number: nums.number, season: nums.season ?? pl?.season ?? null, kind: 'series' };
  }
  const only = stripMarkers(body[0] || raw);
  // "Show: Episode Season 2" / "Show: Episode"
  const colon = only.match(/^(.{3,60}?):\s+(.{3,})$/);
  const nums = enNumbers(only);
  if (pl) {
    const ep = colon && norm(colon[1]).toLowerCase() === pl.name.toLowerCase() ? colon[2] : only;
    return { showTitle: pl.name, episodeTitle: stripNumbers(ep) || `Episode ${nums.number ?? ''}`.trim(), number: nums.number, season: nums.season ?? pl.season, kind: 'series' };
  }
  if (colon && (nums.number != null || nums.season != null)) return { showTitle: colon[1].trim(), episodeTitle: stripNumbers(colon[2]) || `Episode ${nums.number}`, number: nums.number, season: nums.season, kind: 'series' };
  return { showTitle: stripNumbers(only) || only, episodeTitle: FILM_EN, kind: 'film' };
}

const PROFILES = {
  natgeo: parseNatGeo, asharq: parseAsharq, dw: parseDW, aljazeera: parseAlJazeera, generic: parseGeneric,
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

// Boilerplate lines found in channel descriptions (Nat Geo AD, Asharq, DW, Al Jazeera).
const BOILERPLATE = [
  /يمكنكم مشاهدة/, /القناة رقم/, /اشتركوا/, /اشترك /, /subscribe/i, /تابعونا/, /تابعوا /, /https?:\/\//i, /www\./i,
  /facebook/i, /instagram/i, /twitter/i, /\bx\.com/i, /tiktok/i, /youtube\.com/i, /snapchat/i, /telegram/i, /whatsapp/i, /threads/i,
  /نبذة عن ناشونال/, /ناشونال جيوغرافيك أبوظبي هي الوجهة/, /تنقلكم ناشونال/, /you can watch/i,
  /on etisalat/i, /on du\b/i, /on stc/i, /about national geographic/i, /national geographic is the/i,
  /nat geo ad gets you/i, /قوموا بزيارة/, /bit\.ly/i, /#\d{2,}/, /^على (اتصالات|دو|إس تي سي)/,
  /للحصول على آخر المعلومات/, /وسائل التواصل/, /^channel\s*#?\d+/i, /^\s*[-–—•*_=]+\s*$/,
  /#[\p{L}\p{N}_]+/u, /^ناشونال جيوغرافيك أبوظبي\s*$/, /شاهدوا الحلقات الكاملة/, /^ngad$/i,
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
  /\bfree documentary\b.*\b(subscribe|channel|facebook|instagram)/i, /\bfree documentary - history is dedicated\b/i, /^#/, /\bvice news\b.*\b(subscribe|more)/i, /\bcheck out vice\b/i,
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

// Relative Arabic date text ("قبل 3 أيام", "خلال 3 أشهر", "قبل شهر واحد") → approximate ms-ago.
export function relativeToMs(text = '') {
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
