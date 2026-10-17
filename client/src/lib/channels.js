// Per-channel accent colours (by parsing profile, then by stable hash for unknown channels).
const BY_PROFILE = { natgeo: '#ffcc00', asharq: '#38bdf8', dw: '#5b8def', aljazeera: '#f6a21d', myflixer: '#06b6d4' };
const PALETTE = ['#7ab87a', '#d66fa0', '#8b7fd6', '#4aa89a', '#d97a4a', '#c9a24a'];

export function channelColor(channel) {
  if (!channel) return '#999';
  if (BY_PROFILE[channel.profile]) {
    // Two channels can share a profile (Asharq, Asharq Wildlife): shade the second one.
    if (channel.profile === 'asharq' && /wild|حياة برية/i.test(channel.title || '')) return '#4ade80';
    return BY_PROFILE[channel.profile];
  }
  let h = 0;
  for (const ch of channel.id || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export const kindLabel = (kind) => (kind === 'film' ? 'فيلم وثائقي' : 'مسلسل وثائقي');

// Spoken language of the content when it differs from its section (e.g. French shows in the English section).
const LANG_NAMES = {
  fr: { ar: 'بالفرنسية', en: 'In French', short: 'FR' },
  en: { ar: 'بالإنجليزية', en: 'In English', short: 'EN' },
  ar: { ar: 'بالعربية', en: 'In Arabic', short: 'AR' },
  de: { ar: 'بالألمانية', en: 'In German', short: 'DE' },
  es: { ar: 'بالإسبانية', en: 'In Spanish', short: 'ES' },
};
const displayNames = new Map();
function languageName(code, uiLang) {
  try {
    if (!displayNames.has(uiLang)) displayNames.set(uiLang, new Intl.DisplayNames([uiLang === 'en' ? 'en' : 'ar'], { type: 'language', fallback: 'none' }));
    return displayNames.get(uiLang).of(code) || null;
  } catch { return null; }
}
/** True for a real ISO 639-1 code; provider card labels such as 'hd' or 'tv' are not languages. */
export function isLanguageCode(code) {
  if (typeof code !== 'string' || !/^[a-z]{2}$/.test(code)) return false;
  if (LANG_NAMES[code]) return true;
  return !!languageName(code, 'en');
}
export function contentLangBadge(show, uiLang) {
  const cl = typeof show?.contentLang === 'string' ? show.contentLang.toLowerCase() : null;
  if (!cl || cl === (show.lang || 'ar') || !isLanguageCode(cl)) return null;
  const n = LANG_NAMES[cl];
  if (n) return { short: n.short, label: n[uiLang] || n.en };
  const name = languageName(cl, uiLang);
  return { short: cl.toUpperCase(), label: name ? (uiLang === 'en' ? `In ${name}` : `بال${name.replace(/^ال/, '')}`) : cl.toUpperCase() };
}
