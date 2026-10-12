import { resolveMyflixerStream } from '../server/src/myflixer.js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Extract ID from query or URL
  const rawId = req.query?.id || req.url?.split('?')[0]?.split('/').filter(Boolean).pop() || '';
  const id = decodeURIComponent(rawId);
  if (!id || !id.startsWith('mf:')) {
    return res.status(400).json({ error: 'Missing or invalid stream id (expected mf:* ID)' });
  }

  try {
    const data = await resolveMyflixerStream(id);
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Stream resolution failed' });
  }
}
