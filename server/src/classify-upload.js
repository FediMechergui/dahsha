// Conservative, explainable metadata classification; this does not inspect video content.
const VALID = new Set(['documentary', 'non-documentary', 'uncertain']);
const DOCUMENTARY = /\bdocumentar(?:y|ies)\b|وثائقي|وثائقية/i;
const FORMATS = [
  ['trailer', /\b(?:official\s+)?(?:trailer|teaser)\b|إعلان تشويقي|اعلان تشويقي/i],
  ['community', /\bq\s*&\s*a\b|\b(?:giveaway|channel update|unboxing)\b|أسئلة وأجوبة/i],
  ['production', /\b(?:behind the scenes|making[- ]of)\b|كواليس/i],
  ['conversation', /\b(?:podcast|livestream|live stream|reaction video)\b/i],
];

export function classifyUpload(video, details = {}, source = {}, overrides = {}) {
  const title = video.title || details.title || '';
  const rules = overrides.uploadClassification || {};
  let forced = rules.videos?.[video.id];
  if (!forced) forced = (rules.patterns || []).find(rule =>
    (!rule.channelId || rule.channelId === source.id) &&
    typeof rule.titleIncludes === 'string' && rule.titleIncludes.trim() &&
    title.toLocaleLowerCase().includes(rule.titleIncludes.toLocaleLowerCase()))?.status;
  if (VALID.has(forced)) return { status: forced, score: null, reasons: ['manual-override'], version: 1 };

  let score = 0;
  const reasons = [];
  const signal = (reason, weight) => { reasons.push(reason); score += weight; };
  if (source.documentaryUploads === true) signal('curated-documentary-source', 2);
  if (DOCUMENTARY.test(title)) signal('documentary-title', 3);
  if (DOCUMENTARY.test((details.keywords || []).join(' '))) signal('documentary-keywords', 2);
  // Channel boilerplate at the end of descriptions is weak evidence.
  if (DOCUMENTARY.test((details.description || '').slice(0, 700))) signal('documentary-description', 1);
  const category = String(details.category || '');
  if (/education|science|travel|pets|news|film/i.test(category)) signal('factual-category', 1);
  if (/gaming|music|comedy|sports|howto/i.test(category)) signal('other-category', -2);
  const duration = details.durationSec || video.durationSec || 0;
  if (duration >= 1200) signal('long-form', 1);
  for (const [name, pattern] of FORMATS) if (pattern.test(title)) signal(`format-${name}`, -13);
  if (/\b(?:interview with|director interview|best of|compilation|mega episode)\b/i.test(title)) signal('ambiguous-format', -3);
  if (details.isLive || details.isLiveContent || video.isLive) signal('live', -4);
  const status = score <= -3 ? 'non-documentary' : score >= 3 ? 'documentary' : 'uncertain';
  return { status, score, reasons, version: 1 };
}
