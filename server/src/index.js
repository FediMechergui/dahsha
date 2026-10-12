// HTTP API + Server-Sent Events + static hosting of the built client.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Catalogue } from './scheduler.js';
import { readJson, writeJson } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4545);
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

const app = express();
app.disable('x-powered-by');
app.use(express.json());

const catalogue = new Catalogue();

// ---- SSE ------------------------------------------------------------------------------------
const clients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}
catalogue.on('status', (s) => broadcast('status', s));
catalogue.on('update', (u) => broadcast('update', u));
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25e3).unref();

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: status\ndata: ${JSON.stringify(catalogue.getStatus())}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// ---- REST -----------------------------------------------------------------------------------
app.get('/api/status', (_req, res) => res.json(catalogue.getStatus()));

import { resolveMyflixerStream } from './myflixer.js';

// The catalogue list is served in a lean form (thumbnail URLs are derived from ids on the client,
// synopses are truncated, per-episode synopses omitted). /api/shows/:id returns everything.
const slimEpisode = ({ fullTitle, playlistIds, viewsText, publishedApprox, addedAt, ...e }) => e;
const slimShow = ({ key, promos, playlistIds, posterVideoId, ...s }) => ({ ...s, episodes: s.episodes.map(slimEpisode) });
const liteEpisode = (e) => ({
  id: e.id,
  title: e.title,
  number: e.number,
  season: e.season,
  durationSec: e.durationSec,
  publishedAt: e.publishedAt,
  views: e.views,
  thumbs: e.thumbs?.custom ? e.thumbs : undefined,
  sourceUrl: e.sourceUrl || undefined,
  embedUrl: e.embedUrl || undefined,
});
const liteShow = (s) => ({
  id: s.id, title: s.title, kind: s.kind, channelId: s.channel?.id, lang: s.lang, contentLang: s.contentLang, tags: s.tags, primaryTag: s.primaryTag,
  episodeCount: s.episodeCount, posterId: s.posterVideoId, latestAt: s.latestAt, firstAt: s.firstAt, totalViews: s.totalViews,
  totalDurationSec: s.totalDurationSec, seasons: s.seasons, synopsisGenerated: s.synopsisGenerated,
  poster: s.poster?.custom ? s.poster : undefined, portrait: s.portrait || undefined, tmdbId: s.tmdbId || undefined,
  blurb: (s.synopsis || '').length > 220 ? `${s.synopsis.slice(0, 220).replace(/\s+\S*$/, '')}…` : s.synopsis,
  altTitles: (s.altTitles || []).slice(0, 3), episodes: s.episodes.map(liteEpisode),
});

// One cached (and gzipped) lean payload per language section, plus "all".
const liteCache = new Map(); // key → { generatedAt, json, gz }
function liteCatalog(lang) {
  const c = catalogue.getCatalog();
  if (!c) return null;
  const key = lang || 'all';
  const hit = liteCache.get(key);
  if (hit && hit.generatedAt === c.generatedAt) return hit;
  const shows = lang ? c.shows.filter((s) => (s.lang || 'ar') === lang) : c.shows;
  const channels = lang ? c.channels.filter((ch) => (ch.lang || 'ar') === lang) : c.channels;
  const json = Buffer.from(JSON.stringify({ ...c, lite: true, lang: lang || null, channels, shows: shows.map(liteShow) }));
  const entry = { generatedAt: c.generatedAt, json, gz: zlib.gzipSync(json, { level: 6 }) };
  liteCache.set(key, entry);
  return entry;
}

app.get('/api/catalog', (req, res) => {
  const lang = /^(ar|en)$/.test(req.query.lang || '') ? req.query.lang : null;
  const lc = liteCatalog(lang);
  if (!lc) return res.status(503).json({ building: true, status: catalogue.getStatus() });
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Vary', 'Accept-Encoding');
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) { res.setHeader('Content-Encoding', 'gzip'); return res.end(lc.gz); }
  res.end(lc.json);
});

app.get('/api/shows/:id', (req, res) => {
  const s = catalogue.getShow(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(slimShow(s));
});

app.get('/api/stream/:id?', async (req, res) => {
  const id = req.query.id || req.params.id;
  if (id && id.startsWith('mf:')) {
    try {
      const data = await resolveMyflixerStream(id);
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  res.status(404).json({ error: 'not supported' });
});

app.post('/api/refresh', async (req, res) => {
  const full = req.query.full === '1' || req.body?.full === true;
  if (catalogue.status.refreshing) return res.status(202).json({ ok: true, alreadyRunning: true });
  catalogue.refresh({ full }).catch(() => {});
  res.status(202).json({ ok: true });
});

app.get('/api/sources', (_req, res) => res.json({ sources: catalogue.sources }));
app.post('/api/sources', async (req, res) => {
  try {
    const src = await catalogue.addSource(String(req.body?.url || ''));
    res.status(201).json(src);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/sources/:id', (req, res) => {
  try { catalogue.removeSource(req.params.id); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});

// Manual curation: tags / synopsis / title / poster per show, persisted to overrides.json.
app.get('/api/overrides', (_req, res) => res.json(catalogue.overrides));
app.put('/api/overrides/shows/:id', (req, res) => {
  const ov = readJson('overrides.json', catalogue.overrides);
  ov.shows = ov.shows || {};
  const patch = {};
  for (const k of ['title', 'synopsis', 'tags', 'poster', 'hidden']) if (k in (req.body || {})) patch[k] = req.body[k];
  ov.shows[req.params.id] = { ...(ov.shows[req.params.id] || {}), ...patch };
  writeJson('overrides.json', ov);
  catalogue.rebuild();
  res.json(ov.shows[req.params.id]);
});

// ---- static client ----------------------------------------------------------------------------
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: 'index.html', maxAge: '1h' }));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.type('text').send('Client not built. Run "npm run build" in /client, or use "npm run dev" for the Vite dev server.'));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
  catalogue.start();
});
