import { resolveMyflixerStream, handleStreamProxy, handleEmbedPlayer } from '../server/src/myflixer.js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Proxy Mode: Streams master playlists, media playlists, and video chunks
  if (req.query?.proxy === '1') {
    const targetUrl = req.query?.url ? decodeURIComponent(req.query.url) : '';
    return handleStreamProxy(targetUrl, req, res, '/api/stream');
  }

  // 2. Embed Mode: Returns clean, self-contained player HTML for iframes
  if (req.query?.embed === '1') {
    const embedId = decodeURIComponent(req.query?.id || '');
    if (!embedId || !embedId.startsWith('mf:')) {
      return res.status(400).send('Invalid or missing stream ID');
    }
    return handleEmbedPlayer(embedId, req, res, '/api/stream');
  }

  // 3. Resolution Mode: Resolves metadata and stream URLs
  const rawId = req.query?.id || req.url?.split('?')[0]?.split('/').filter(Boolean).pop() || '';
  const id = decodeURIComponent(rawId);
  if (!id || !id.startsWith('mf:')) {
    return res.status(400).json({ error: 'Missing or invalid stream id (expected mf:* ID)' });
  }

  try {
    const data = await resolveMyflixerStream(id, '/api/stream');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Stream resolution failed' });
  }
}
