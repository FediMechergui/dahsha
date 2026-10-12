// Per-channel accent colours (by parsing profile, then by stable hash for unknown channels).
const BY_PROFILE = { natgeo: '#ffcc00', asharq: '#38bdf8', dw: '#5b8def', aljazeera: '#f6a21d' };
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
export function contentLangBadge(show, uiLang) {
  const cl = show?.contentLang;
  if (!cl || cl === (show.lang || 'ar')) return null;
  const n = LANG_NAMES[cl] || { ar: cl.toUpperCase(), en: cl.toUpperCase(), short: cl.toUpperCase() };
  return { short: n.short, label: n[uiLang] || n.en };
}
