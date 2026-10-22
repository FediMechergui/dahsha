import { PRODUCT } from '../server/src/product.js';
import { unifiedSearch } from '../server/src/library-service.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  // Dahsha searches its static catalogue in the browser; a live search parsed the whole catalogue in
  // the function and counted against Vercel's Hobby CPU limit (team blocked on 2026-10-21).
  if (PRODUCT !== 'flixer') { res.setHeader('Cache-Control', 'public, s-maxage=86400'); return res.status(404).json({ error: 'Search the static catalogue' }); }

  try {
    const q = req.query.q || '';
    if (!q.trim()) return res.status(200).json({ items: [] });
    const items = await unifiedSearch(q);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
