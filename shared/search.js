// Search normalization is deliberately separate from catalogue identity matching.
export function normalizeSearch(value='') {
  return String(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
    .replace(/&amp;/g,'&').replace(/&/g,' and ').replace(/['’‘]/g,'')
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
export function matchesSearch(value,query) {
  const text=normalizeSearch(value), terms=normalizeSearch(query).split(/\s+/).filter(Boolean);
  return terms.length>0 && terms.every(term=>text.includes(term));
}
