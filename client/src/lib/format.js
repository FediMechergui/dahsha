// Locale-aware formatting. Every helper takes the active lang ('ar' | 'en'); Arabic uses Latin digits.
const LOCALES = { ar: 'ar-AE-u-nu-latn', en: 'en-GB' };
const cache = new Map();
function fmt(kind, lang, opts) {
  const key = `${kind}|${lang}|${JSON.stringify(opts || {})}`;
  let f = cache.get(key);
  if (!f) {
    const loc = LOCALES[lang] || LOCALES.ar;
    f = kind === 'n' ? new Intl.NumberFormat(loc, opts) : kind === 'd' ? new Intl.DateTimeFormat(loc, opts) : new Intl.RelativeTimeFormat(lang === 'en' ? 'en' : 'ar', { numeric: 'auto' });
    cache.set(key, f);
  }
  return f;
}

export const fmtNumber = (n, lang = 'ar') => (n == null ? '' : fmt('n', lang).format(n));
export const fmtCompact = (n, lang = 'ar') => (n == null ? '' : fmt('n', lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n));

export function fmtDuration(sec = 0, lang = 'ar') {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  const H = lang === 'en' ? 'h' : 'س', M = lang === 'en' ? 'min' : 'د';
  if (h && m) return `${h} ${H} ${m} ${M}`;
  if (h) return `${h} ${H}`;
  return `${m} ${M}`;
}

export function fmtClock(sec = 0) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function fmtDate(iso, lang = 'ar', { short = false } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return fmt('d', lang, short ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

export function fmtRelative(iso, lang = 'ar') {
  if (!iso) return '';
  const rtf = fmt('r', lang);
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86400 * 365)), 'year');
}

export function isNew(iso, days = 14) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < days * 864e5;
}

export function episodesLabel(n, lang = 'ar') {
  if (lang === 'en') return n === 1 ? '1 episode' : `${n} episodes`;
  if (n === 1) return 'حلقة واحدة';
  if (n === 2) return 'حلقتان';
  if (n >= 3 && n <= 10) return `${n} حلقات`;
  return `${n} حلقة`;
}

export function titlesLabel(n, lang = 'ar') {
  if (lang === 'en') return n === 1 ? '1 title' : `${fmtNumber(n, lang)} titles`;
  if (n === 1) return 'عنوان واحد';
  if (n === 2) return 'عنوانان';
  if (n >= 3 && n <= 10) return `${n} عناوين`;
  return `${fmtNumber(n, lang)} عنواناً`;
}

export function yearOf(iso) {
  if (!iso) return null;
  const y = new Date(iso).getFullYear();
  return Number.isNaN(y) ? null : y;
}
