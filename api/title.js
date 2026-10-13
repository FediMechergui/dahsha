import { getTitleDetails } from '../server/src/myflixer.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const rawId = req.query.id || req.url?.split('?')[0]?.split('/').filter(Boolean).pop() || '';
  const id = decodeURIComponent(rawId);
  if (!id) return res.status(400).json({ error: 'Missing title ID' });

  try {
    const details = await getTitleDetails(id);
    if (!details) return res.status(404).json({ error: 'Title not found' });
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(details);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
