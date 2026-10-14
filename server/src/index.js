import { libraryHome, discoverLibrary, validPlaybackId, unifiedTitle, unifiedSearch, unifiedStream, readLibrary, libraryPage, setLiveLibrary } from './library-service.js';
import { refreshProviders } from './provider-sync.js';
// Movies & TV Shows Streaming API Server
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { leanCatalog } from './export-catalog.js';
import { PRODUCT } from './product.js';
import { readJson, writeJson, DEFAULT_OVERRIDES } from './store.js';
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
const CLIENT_DIST = path.resolve(__dirname, PRODUCT === 'dahsha' ? '../../client/dist' : '../../client/dist-flixer');
const catalogue = PRODUCT === 'dahsha' ? new (await import('./scheduler.js')).Catalogue() : null;

if (catalogue) setLiveLibrary(() => catalogue.getCatalog());
export const app = express();
app.disable('x-powered-by');
app.use(express.json());

// CORS for local dev / mobile testing
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

app.get('/api/discover', async (req,res) => res.json(await discoverLibrary({kind:req.query.kind || 'film',page:req.query.page,genre:req.query.genre,year:req.query.year,latest:req.query.latest})));

// Dahsha's catalogue and source management never use Flixer's all-genre feed.
if (catalogue) {
  let cachedSource, cachedPayload;
  const sections = new Map();
  app.get('/api/catalog', (req, res) => {
    const catalog = catalogue.getCatalog();
    if (!catalog) return res.status(503).json({ error: 'Catalogue is being built', status: catalogue.getStatus() });
    if (catalog !== cachedSource) { cachedSource = catalog; cachedPayload = leanCatalog(catalog, 'dahsha'); sections.clear(); }
    const lang = ['ar', 'en'].includes(req.query.lang) ? req.query.lang : '';
    if (!sections.has(lang)) {
      const section = lang ? { ...cachedPayload, lang, shows: cachedPayload.shows.filter(s => s.lang === lang) } : cachedPayload;
      const json = JSON.stringify(section);
      sections.set(lang, { json, gzip: gzipSync(json) });
    }
    const payload = sections.get(lang);
    res.vary('Accept-Encoding'); res.type('application/json');
    if (req.acceptsEncodings('gzip')) { res.setHeader('Content-Encoding', 'gzip'); return res.send(payload.gzip); }
    return res.send(payload.json);
  });
  app.get('/api/shows/:id', async (req, res) => {
    const show = await unifiedTitle(req.params.id, { source: req.query.source });
    return show ? res.json(show) : res.status(404).json({ error: 'Show not found' });
  });
  app.get('/api/search', async (req, res) => res.json({ items: await unifiedSearch(req.query.q || '') }));
  app.get('/api/title', async (req, res) => { const show = await unifiedTitle(req.query.id, { source: req.query.source }); return show ? res.json(show) : res.status(404).json({error:'Title not found'}); });
  app.get('/api/status', (_req, res) => res.json({ ...catalogue.getStatus(), product: PRODUCT }));
  app.get('/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    const status = data => send('status', data);
    const update = data => send('update', data);
    status(catalogue.getStatus());
    catalogue.on('status', status); catalogue.on('update', update);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
    req.on('close', () => { clearInterval(heartbeat); catalogue.off('status', status); catalogue.off('update', update); });
  });
  // Admin writes are same-origin by default; a configured token also permits remote administration.
  const admin = (req, res, next) => {
    const token = process.env.ADMIN_TOKEN;
    if (token && req.headers.authorization === `Bearer ${token}`) return next();
    const origin = req.headers.origin;
    let localOrigin = !origin;
    try { localOrigin ||= ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname); } catch { /* invalid origin */ }
    if (!token && localOrigin && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return next();
    return res.status(403).json({ error: 'Administration requires ADMIN_TOKEN or a local same-origin request' });
  };
  app.post('/api/refresh', admin, (req, res) => {
    catalogue.refresh({ full: req.query.full === '1' }).catch(console.error);
    res.status(202).json(catalogue.getStatus());
  });
  app.get('/api/sources', (_req, res) => res.json({ sources: catalogue.getCatalog()?.sources || catalogue.sources }));
  app.post('/api/sources', admin, async (req, res) => res.status(201).json(await catalogue.addSource(req.body.url)));
  app.delete('/api/sources/:id', admin, (req, res) => { catalogue.removeSource(req.params.id); res.json({ ok: true }); });
  app.put('/api/overrides/shows/:id', admin, (req, res) => {
    const overrides = readJson('overrides.json', DEFAULT_OVERRIDES);
    overrides.shows = { ...overrides.shows, [req.params.id]: req.body };
    writeJson('overrides.json', overrides); catalogue.rebuild(); res.json({ ok: true });
  });
  app.use('/api', (req, res, next) => req.path.startsWith('/stream') ? next() : res.status(404).json({ error: 'Unknown Dahsha endpoint' }));
}

// ---- REST API -----------------------------------------------------------------------------------
app.get('/api/genres', (_req, res) => res.json({ genres: GENRES }));

app.get('/api/home', async (_req, res) => {
  try {
    const data = libraryHome();
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
    const data = libraryPage(readLibrary(), { kind: 'film', page, perPage, genre: category, year, search });
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
    const data = libraryPage(readLibrary(), { kind: 'series', page, perPage, genre: category, year, search });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q.trim()) return res.json({ items: [] });
    const items = await unifiedSearch(q);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(['/api/title', '/api/title/:id'], async (req, res) => {
  try {
    const details = await unifiedTitle(req.params.id || req.query.id, { source: req.query.source });
    if (!details) return res.status(404).json({ error: 'Title not found' });
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Backwards-compatible /api/shows/:id route
app.get('/api/shows/:id', async (req, res) => {
  try {
    const details = await unifiedTitle(req.params.id || req.query.id, { source: req.query.source });
    if (!details) return res.status(404).json({ error: 'Title not found' });
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(['/api/stream', '/api/stream/:id'], async (req, res) => {
  const host = req.headers?.host || `localhost:${PORT}`;
  const proto = req.protocol || 'http';
  const baseOrigin = `${proto}://${host}`;
  const streamPrefix = `${baseOrigin}/api/stream`;

  if (req.query?.proxy === '1') {
    const targetUrl = typeof req.query?.url === 'string' ? req.query.url : '';
    return handleStreamProxy(targetUrl, req, res, streamPrefix);
  }

  const id = req.query.id || req.params.id;
  if (!validPlaybackId(id)) return res.status(400).json({error:'Invalid stream ID'});
  try {
    const data = await unifiedStream(id, { showId:req.query.showId, source:req.query.source, prefix:streamPrefix });
    if (!data) return res.status(404).json({error:'Episode not found in this catalogue'});
    res.setHeader('Cache-Control','no-store');
    return res.json(data);
  } catch (e) { return res.status(502).json({error:e.message}); }
});

// Cached catalog for static fallback / offline apps
let catalogCache = null;
app.get('/api/catalog', (_req,res) => res.json(leanCatalog(readLibrary(),PRODUCT)));

app.get('/api/status', (_req, res) => {
  res.json({ ok: true, version: '1.0.0', service: `${PRODUCT}-api`, product: PRODUCT, generatedAt: readLibrary()?.generatedAt || null });
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = app.listen(PORT, () => {
    console.log(`[${PRODUCT}] Server running at http://localhost:${server.address().port}`);
    if (catalogue && process.env.SKIP_REFRESH !== '1') catalogue.start().catch(console.error);
    if (!catalogue && process.env.SKIP_REFRESH !== '1') {
      const tick = () => refreshProviders({product:'flixer'}).catch(console.error);
      tick(); const timer = setInterval(tick,15*60e3); server.on('close',()=>clearInterval(timer));
    }
  });
  const stop = () => { catalogue?.stop(); server.close(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
