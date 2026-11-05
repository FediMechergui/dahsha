import { checkRuntimeManifest, readRuntimePart, getRuntimeTitle } from '../server/src/dahsha-runtime-source.js';

export function createCatalogueHandler({ check = checkRuntimeManifest, part = readRuntimePart, title = getRuntimeTitle } = {}) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    const query = req.query || {}, key = query.part || 'manifest';
    if (typeof key !== 'string' || query.sha !== undefined && (typeof query.sha !== 'string' || !/^[a-f0-9]{64}$/.test(query.sha)) || query.id !== undefined && (typeof query.id !== 'string' || !query.id || query.id.length > 350 || /[\x00-\x1f]/.test(query.id))) return res.status(400).json({ error: 'Invalid catalogue request' });
    try {
      let payload;
      if (key === 'manifest' || key === 'status') {
        const manifest = await check();
        if (!manifest) return res.status(503).json({ error: 'Catalogue temporarily unavailable' });
        payload = key === 'status' ? manifest.status : manifest;
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=120');
      } else if (key === 'show') {
        if (!query.id) return res.status(400).json({ error: 'Missing title ID' });
        payload = await title(query.id);
        if (!payload) return res.status(404).json({ error: 'Title not found' });
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=120');
      } else if (/^index-(ar|en)-\d{4}$/.test(key)) {
        payload = await part(key, query.sha);
        res.setHeader('Cache-Control', query.sha ? 'public, max-age=86400, s-maxage=86400, immutable' : 'public, max-age=0, s-maxage=120');
      } else return res.status(400).json({ error: 'Unknown catalogue part' });
      res.setHeader('Netlify-Vary', 'query=part|sha|id');
      return req.method === 'HEAD' ? res.status(200).end() : res.status(200).json(payload);
    } catch (error) {
      console.warn(`[catalogue] ${error.message}`);
      return res.status(503).json({ error: 'Catalogue temporarily unavailable' });
    }
  };
}

export default createCatalogueHandler();
