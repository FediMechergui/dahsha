import { PRODUCT } from '../server/src/product.js';
import { libraryHome } from '../server/src/library-service.js';

export default async function handler(req, res) {
  if (PRODUCT !== 'flixer') return res.status(404).json({ error: 'This endpoint belongs to Flixer' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const data = libraryHome();
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
