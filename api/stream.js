import { validPlaybackId, unifiedStream } from '../server/src/library-service.js';
import { resolveMyflixerStream, handleStreamProxy, handleEmbedPlayer } from '../server/src/myflixer.js';
import { PRODUCT } from '../server/src/product.js';
import { exportedDocumentaryId } from '../server/src/documentary-playback.js';

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
    const targetUrl = typeof rawUrl === 'string' ? rawUrl : '';
    return handleStreamProxy(targetUrl, req, res, streamPrefix);
  }

  const id = req.query.id;
  if (!validPlaybackId(id)) return res.status(400).json({error:'Invalid stream ID'});
  try {
    const data = await unifiedStream(id, {showId:req.query.showId,source:req.query.source,prefix:streamPrefix});
    if (!data) return res.status(404).json({error:'Episode not found in this catalogue'});
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json(data);
  } catch(e) { return res.status(502).json({error:e.message}); }
}
