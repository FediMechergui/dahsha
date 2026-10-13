import { resolveMyflixerStream, handleStreamProxy, handleEmbedPlayer } from '../server/src/myflixer.js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const host = req.headers?.['x-forwarded-host'] || req.headers?.host || 'dahsha.vercel.app';
  const proto = req.headers?.['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  const baseOrigin = `${proto}://${host}`;
  const streamPrefix = `${baseOrigin}/api/stream`;

  // 1. Proxy Mode: Streams master playlists, media playlists, and video chunks
  if (req.query?.proxy === '1') {
    const rawUrl = req.query?.url || '';
    const targetUrl = typeof rawUrl === 'string' ? decodeURIComponent(rawUrl) : '';
    return handleStreamProxy(targetUrl, req, res, streamPrefix);
  }

  // 2. Embed Mode: Returns clean, self-contained player HTML for iframes
  if (req.query?.embed === '1') {
    const rawEmbedId = req.query?.id || '';
    const embedId = typeof rawEmbedId === 'string' ? decodeURIComponent(rawEmbedId) : '';
    if (!embedId || !embedId.startsWith('mf:')) {
      return res.status(400).send('Invalid or missing stream ID');
    }
    return handleEmbedPlayer(embedId, req, res, streamPrefix);
  }

  // 3. Resolution Mode: Resolves metadata and stream URLs
  const rawId = req.query?.id || req.url?.split('?')[0]?.split('/').filter(Boolean).pop() || '';
  const id = decodeURIComponent(rawId);
  if (!id || !id.startsWith('mf:')) {
    return res.status(400).json({ error: 'Missing or invalid stream id (expected mf:* ID)' });
  }

  try {
    const data = await resolveMyflixerStream(id, streamPrefix);
    // Never cache dynamic tokenized streams on CDN; always serve fresh session URLs
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Stream resolution failed' });
  }
}
