import { PRODUCT } from '../server/src/product.js';
import { GENRES } from '../server/src/myflixer.js';

export default async function handler(req, res) {
  if (PRODUCT !== 'flixer') return res.status(404).json({ error: 'This endpoint belongs to Flixer' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  return res.status(200).json({ genres: GENRES });
}
