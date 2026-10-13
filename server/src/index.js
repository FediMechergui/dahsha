// Movies & TV Shows Streaming API Server
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GENRES,
  fetchMovies,
  fetchSeries,
  searchContent,
  getTitleDetails,
  fetchHomeContent,
  fetchFullCatalog,
  resolveMyflixerStream,
  handleStreamProxy,
  handleEmbedPlayer,
} from './myflixer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4545);
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

const app = express();
app.disable('x-powered-by');
app.use(express.json());

// CORS for local dev / mobile testing
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// ---- REST API -----------------------------------------------------------------------------------
app.get('/api/genres', (_req, res) => res.json({ genres: GENRES }));

app.get('/api/home', async (_req, res) => {
  try {
    const data = await fetchHomeContent();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/movies', async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const perPage = Number(req.query.perPage || 24);
    const category = req.query.category || req.query.genre || null;
    const year = req.query.year || null;
    const search = req.query.q || req.query.search || null;
    const data = await fetchMovies({ page, perPage, category, year, search });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/series', async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const perPage = Number(req.query.perPage || 24);
    const category = req.query.category || req.query.genre || null;
    const year = req.query.year || null;
    const search = req.query.q || req.query.search || null;
    const data = await fetchSeries({ page, perPage, category, year, search });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q.trim()) return res.json({ items: [] });
    const items = await searchContent(q);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/title/:id', async (req, res) => {
  try {
    const details = await getTitleDetails(req.params.id);
    if (!details) return res.status(404).json({ error: 'Title not found' });
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Backwards-compatible /api/shows/:id route
app.get('/api/shows/:id', async (req, res) => {
  try {
    const details = await getTitleDetails(req.params.id);
    if (!details) return res.status(404).json({ error: 'Title not found' });
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stream/:id?', async (req, res) => {
  const host = req.headers?.host || `localhost:${PORT}`;
  const proto = req.protocol || 'http';
  const baseOrigin = `${proto}://${host}`;
  const streamPrefix = `${baseOrigin}/api/stream`;

  if (req.query?.proxy === '1') {
    const targetUrl = req.query?.url ? decodeURIComponent(req.query.url) : '';
    return handleStreamProxy(targetUrl, req, res, streamPrefix);
  }

  if (req.query?.embed === '1') {
    const embedId = decodeURIComponent(req.query?.id || req.params?.id || '');
    if (!embedId || !embedId.startsWith('mf:')) {
      return res.status(400).send('Invalid or missing stream ID');
    }
    return handleEmbedPlayer(embedId, req, res, streamPrefix);
  }

  const id = req.query.id || req.params.id;
  if (id && id.startsWith('mf:')) {
    try {
      const data = await resolveMyflixerStream(id, streamPrefix);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  res.status(404).json({ error: 'Stream not found' });
});

// Cached catalog for static fallback / offline apps
let catalogCache = null;
app.get('/api/catalog', async (_req, res) => {
  try {
    if (!catalogCache) {
      const catFile = path.resolve(__dirname, '../../client/public/data/catalog.json');
      if (fs.existsSync(catFile)) {
        catalogCache = JSON.parse(fs.readFileSync(catFile, 'utf8'));
      } else {
        catalogCache = await fetchFullCatalog({ pagesPerGenre: 1 });
      }
    }
    res.json(catalogCache);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', (_req, res) => {
  res.json({ ok: true, version: '1.0.0', service: 'flixer-api' });
});

// ---- static client ----------------------------------------------------------------------------
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: 'index.html', maxAge: '1h' }));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.type('text').send('Flixer API is running. Client not built. Run "npm run build" in /client or "npm run dev".'));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`[flixer] Server running at http://localhost:${PORT}`);
});
