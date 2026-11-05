import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createRuntimeCatalogClient, isOlderGeneration, validateRuntimeManifest } from '../../client/src/lib/runtime-catalog.js';

const OLD = '2026-11-04T03:00:00.000Z', NEW = '2026-11-05T03:00:00.000Z';
function fixture({ date = NEW, parts = 3, lang = 'en', salt = 0 } = {}) {
  const catalog = { product: 'dahsha', generatedAt: date, tags: [], channels: [], idAliases: {} };
  const status = { product: 'dahsha', generatedAt: date, stats: { shows: parts } };
  const manifest = { format: 1, product: 'dahsha', generatedAt: date, count: parts, catalog, status, languages: { ar: { count: 0, parts: [] }, en: { count: 0, parts: [] } }, files: {} };
  const payloads = new Map();
  for (let i = 0; i < parts; i++) {
    const key = `index-${lang}-${String(i).padStart(4, '0')}`, sha256 = (i + 1 + salt).toString(16).padStart(64, '0');
    manifest.languages[lang].parts.push(key);
    manifest.files[key] = { name: `data-${sha256}.json.gz`, sha256, bytes: 100, rawBytes: 200 };
    payloads.set(key, { product: 'dahsha', lang, shows: [{ id: `title-${i}`, title: `Documentary ${i}`, lang, episodes: [{ id: `episode-${i}` }] }] });
  }
  manifest.languages[lang].count = parts;
  return { manifest, payloads };
}
const query = url => new URL(url, 'https://dahsha.example').searchParams;
const tick = () => new Promise(resolve => setImmediate(resolve));

test('runtime manifest validates product, language totals and immutable part descriptors', () => {
  const { manifest } = fixture();
  assert.equal(validateRuntimeManifest(manifest), manifest);
  for (const alter of [m => { m.product = 'flixer'; }, m => { m.count++; }, m => { m.languages.ar = null; }, m => { m.catalog.shows = []; }, m => { m.status.generatedAt = OLD; }, m => { m.files['index-en-0000'].rawBytes = 2 * 1024 * 1024; }, m => { m.files['index-en-0000'].name = 'other.json.gz'; }, m => { m.languages.en.parts.push(m.languages.en.parts[0]); }]) {
    const copy = structuredClone(manifest); alter(copy);
    assert.throws(() => validateRuntimeManifest(copy), { code: 'RUNTIME_CATALOG_INVALID' });
  }
});

test('runtime assembles one complete language in source order with bounded parallel downloads', async () => {
  const { manifest, payloads } = fixture({ parts: 8 });
  let active = 0, maximum = 0;
  const requested = [];
  const client = createRuntimeCatalogClient({ request: async url => {
    const p = query(url), key = p.get('part');
    if (key === 'manifest') return manifest;
    requested.push([key, p.get('sha')]);
    active++; maximum = Math.max(maximum, active);
    await tick(); active--;
    return payloads.get(key);
  } });
  const catalog = await client.catalog('en');
  assert.equal(maximum, 3);
  assert.deepEqual(catalog.shows.map(s => s.id), [...payloads.values()].map(p => p.shows[0].id));
  assert.equal(catalog.lang, 'en');
  assert.equal(catalog.generatedAt, NEW);
  for (const [key, sha] of requested) assert.equal(sha, manifest.files[key].sha256);
  assert.deepEqual((await client.catalog('ar')).shows, []);
});

test('a failed part never publishes a partial language and can be retried using verified cached parts', async () => {
  const { manifest, payloads } = fixture({ parts: 5 });
  let broken = true;
  const calls = new Map();
  const client = createRuntimeCatalogClient({ concurrency: 1, request: async url => {
    const key = query(url).get('part');
    if (key === 'manifest') return manifest;
    calls.set(key, (calls.get(key) || 0) + 1);
    if (broken && key === 'index-en-0001') throw Object.assign(new Error('temporary part failure'), { status: 503 });
    return payloads.get(key);
  } });
  await assert.rejects(client.catalog('en'), /temporary part failure/);
  assert.deepEqual([...calls.keys()], ['index-en-0000', 'index-en-0001'], 'stop scheduling after the failed part');
  broken = false;
  assert.equal((await client.catalog('en')).shows.length, 5);
  assert.equal(calls.get('index-en-0000'), 1);
  assert.equal(calls.get('index-en-0001'), 2);
});

test('a publication reuses unchanged hashes and fetches changed parts even when keys stay the same', async () => {
  let time = 0;
  const first = fixture({ date: OLD, parts: 2 }), second = fixture({ date: NEW, parts: 2 });
  second.manifest.files['index-en-0001'] = fixture({ salt: 40 }).manifest.files['index-en-0001'];
  second.payloads.get('index-en-0001').shows[0].episodes.push({ id: 'new-episode' });
  let source = first;
  const calls = [];
  const client = createRuntimeCatalogClient({ now: () => time, request: async url => {
    const p = query(url), key = p.get('part');
    if (key === 'manifest') return source.manifest;
    if (key === 'status') return source.manifest.status;
    calls.push(key); return source.payloads.get(key);
  } });
  await client.catalog('en');
  source = second; time = 130000;
  await client.status();
  const updated = await client.catalog('en', { version: NEW });
  assert.deepEqual(calls, ['index-en-0000', 'index-en-0001', 'index-en-0001']);
  assert.equal(updated.shows[1].episodes.at(-1).id, 'new-episode');
});

test('part cache enforces both its byte budget and item limit', async () => {
  for (const limits of [{ maxCacheBytes: 300, maxCacheParts: 10 }, { maxCacheBytes: 10000, maxCacheParts: 1 }]) {
    const { manifest, payloads } = fixture({ parts: 2 });
    const calls = [];
    const client = createRuntimeCatalogClient({ ...limits, concurrency: 1, request: async url => {
      const key = query(url).get('part');
      if (key === 'manifest') return manifest;
      calls.push(key); return payloads.get(key);
    } });
    await client.catalog('en'); await client.catalog('en');
    assert.deepEqual(calls, ['index-en-0000', 'index-en-0001', 'index-en-0000'], 'reuse the retained part before a new download evicts it');
    await client.catalog('en');
    assert.deepEqual(calls, ['index-en-0000', 'index-en-0001', 'index-en-0000', 'index-en-0001'], 'only one part remained cached');
  }
});

test('wrong-language, mixed-product, duplicate and truncated chunks are rejected', async () => {
  for (const alter of [p => { p.lang = 'ar'; }, p => { p.product = 'flixer'; }, p => { p.shows[0].lang = 'ar'; }, p => { p.shows = []; }, p => { p.shows.push(p.shows[0]); }]) {
    const { manifest, payloads } = fixture({ parts: 1 });
    const payload = payloads.get('index-en-0000'); alter(payload);
    const client = createRuntimeCatalogClient({ request: async url => query(url).get('part') === 'manifest' ? manifest : payload });
    await assert.rejects(client.catalog('en'), { code: 'RUNTIME_CATALOG_INVALID' });
  }
});

test('an older server or static snapshot cannot roll back an observed update', async () => {
  const older = fixture({ date: OLD });
  let status = { ...older.manifest.status, generatedAt: NEW };
  const client = createRuntimeCatalogClient({ request: async url => query(url).get('part') === 'status' ? status : older.manifest });
  await client.status();
  await assert.rejects(client.catalog('en'), { code: 'RUNTIME_CATALOG_STALE' });
  assert.throws(() => client.acceptBootstrap(older.manifest.catalog), { code: 'RUNTIME_CATALOG_STALE' });
  status = older.manifest.status;
  await assert.rejects(client.status(), { code: 'RUNTIME_CATALOG_STALE' });
  assert.equal(client.observedVersion, NEW);
  assert.equal(isOlderGeneration(null, NEW), true);
  assert.equal(isOlderGeneration(OLD, NEW), true);
  assert.equal(isOlderGeneration(NEW, NEW), false);
  assert.equal(isOlderGeneration(NEW, null), false);
});

test('title lookup uses the backend owner mapping, including aliased episode IDs', async () => {
  let requested;
  const row = { id: 'canonical', title: 'Documentary', episodes: [{ id: 'episode' }] };
  const client = createRuntimeCatalogClient({ request: async url => { requested = query(url); return row; } });
  assert.equal(await client.show('episode'), row);
  assert.equal(requested.get('part'), 'show');
  assert.equal(requested.get('id'), 'episode');
});

test('an older backend title fallback cannot replace a newer loaded episode guide', async () => {
  let marker = OLD;
  const client = createRuntimeCatalogClient({ request: async () => ({ id: 'canonical', title: 'Documentary', episodes: [], _catalogueGeneratedAt: marker }) });
  await assert.rejects(client.show('canonical', { version: NEW }), { code: 'RUNTIME_CATALOG_STALE' });
  marker = NEW;
  assert.equal((await client.show('canonical', { version: NEW }))._catalogueGeneratedAt, NEW);
  marker = OLD;
  await assert.rejects(client.show('canonical'), { code: 'RUNTIME_CATALOG_STALE' });
});

test('live title validation applies the same requested and observed generation floors as saved details', () => {
  const client = createRuntimeCatalogClient({ request: async () => assert.fail('Validation must not fetch') });
  const row = { id: 'canonical', title: 'Documentary', episodes: [], _catalogueGeneratedAt: OLD };
  assert.throws(() => client.acceptTitle(row, { version: NEW }), { code: 'RUNTIME_CATALOG_STALE' });
  assert.equal(client.acceptTitle({ ...row, _catalogueGeneratedAt: NEW })._catalogueGeneratedAt, NEW);
  assert.throws(() => client.acceptTitle(row), { code: 'RUNTIME_CATALOG_STALE' });
  assert.throws(() => client.acceptTitle({ ...row, _catalogueGeneratedAt: undefined }), { code: 'RUNTIME_CATALOG_STALE' });
  assert.throws(() => client.acceptTitle({ ...row, episodes: {} }), { code: 'RUNTIME_CATALOG_INVALID' });
  assert.equal(client.observedVersion, NEW);
});

test('the frontend consumes the actual publisher format with Arabic episodes and provider posters intact', async () => {
  const { buildRuntimePublication } = await import('../src/dahsha-runtime-publication.js');
  const tempRoot = path.resolve(os.tmpdir()), dir = fs.mkdtempSync(path.join(tempRoot, 'dahsha-client-contract-'));
  try {
    const input = { product: 'dahsha', generatedAt: NEW, channels: [], tags: [], idAliases: { old: 's_ar' }, shows: [
      { id: 's_ar', title: 'وثائقي الطبيعة', lang: 'ar', kind: 'series', episodes: [{ id: 'abcdefghijk', title: 'حلقة جديدة', season: 2, number: 4, publishedAt: NEW }] },
      { id: 'fm:m:1', title: 'Nature documentary', lang: 'en', kind: 'film', documentary: true, portrait: 'https://example.com/poster.jpg', poster: { custom: 'https://example.com/poster.jpg' }, episodes: [] },
    ] };
    const manifest = await buildRuntimePublication(input, dir);
    const client = createRuntimeCatalogClient({ request: async url => {
      const p = query(url), key = p.get('part');
      if (key === 'manifest') return manifest;
      const file = manifest.files[key];
      assert.equal(p.get('sha'), file.sha256);
      return JSON.parse(gunzipSync(fs.readFileSync(path.join(dir, file.name))));
    } });
    const ar = await client.catalog('ar'), en = await client.catalog('en');
    assert.equal(ar.shows[0].episodes[0].title, 'حلقة جديدة');
    assert.equal(ar.shows[0].episodes[0].season, 2);
    assert.equal(ar.idAliases.old, 's_ar');
    assert.equal(en.shows[0].portrait, input.shows[1].portrait);
    assert.equal(ar.shows.length + en.shows.length, manifest.count);
  } finally {
    assert.ok(path.resolve(dir).startsWith(tempRoot + path.sep) && path.basename(dir).startsWith('dahsha-client-contract-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Exercise the real API module with its build-time constants, without a browser or a network.
// The imported helpers remain the production modules; only import.meta.env/product are supplied.
let apiInstance = 0;
async function staticApi() {
  const url = new URL('../../client/src/lib/api.js', import.meta.url);
  let source = fs.readFileSync(url, 'utf8').replace("import { DOCUMENTARIES, PRODUCT } from './product.js';", "const PRODUCT = 'dahsha', DOCUMENTARIES = true;");
  source = source.replaceAll('import.meta.env', JSON.stringify({ VITE_STATIC: '1', VITE_API_BASE: 'https://dahsha.example', VITE_DATA_BASE: 'https://dahsha.example' }));
  source = source.replace(/from '([^']+)'/g, (_, relative) => `from '${new URL(relative, url).href}'`);
  return (await import(`data:text/javascript;base64,${Buffer.from(source + `\n// instance ${apiInstance++}`).toString('base64')}`)).api;
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('static API bootstraps during an initial runtime outage and stops reading old files after runtime updates', async () => {
  const originalFetch = globalThis.fetch;
  const old = fixture({ date: OLD, parts: 1 }), fresh = fixture({ date: NEW, parts: 1 });
  let online = false, failedPart = false;
  const requested = [];
  globalThis.fetch = async url => {
    const target = new URL(url), key = target.searchParams.get('part'); requested.push(target.pathname + target.search);
    if (target.pathname === '/data/status.json') return response(old.manifest.status);
    if (target.pathname === '/data/catalog.en.json') return response({ ...old.manifest.catalog, lang: 'en', shows: old.payloads.get('index-en-0000').shows });
    if (!online || (failedPart && key?.startsWith('index-'))) return response({ error: 'temporarily unavailable' }, 503);
    if (key === 'manifest') return response(fresh.manifest);
    if (key === 'status') return response(fresh.manifest.status);
    return response(fresh.payloads.get(key));
  };
  try {
    const api = await staticApi();
    assert.equal((await api.status()).generatedAt, OLD);
    assert.equal((await api.catalog('en', { version: OLD })).generatedAt, OLD);
    online = true; failedPart = true;
    assert.equal((await api.status()).generatedAt, NEW);
    const fileReads = requested.filter(p => p.startsWith('/data/catalog.')).length;
    await assert.rejects(api.catalog('en', { version: NEW }), /temporarily unavailable/);
    assert.equal(requested.filter(p => p.startsWith('/data/catalog.')).length, fileReads, 'do not download the old static catalogue after a failed runtime part');
    failedPart = false;
    assert.equal((await api.catalog('en', { version: NEW })).generatedAt, NEW);
    online = false;
    await assert.rejects(api.status(), { code: 'RUNTIME_CATALOG_STALE' });
  } finally { globalThis.fetch = originalFetch; }
});

test('stream API requests direct transport and keeps its title/source identity', async () => {
  const originalFetch = globalThis.fetch;
  let requested;
  globalThis.fetch = async url => { requested = new URL(url); return response({ servers: [] }); };
  try {
    const api = await staticApi();
    await api.stream('mf:e:example', { showId: 'canonical', source: 'https://source.example/title' });
    assert.equal(requested.searchParams.get('transport'), 'direct');
    assert.equal(requested.searchParams.get('showId'), 'canonical');
    assert.equal(requested.searchParams.get('source'), 'https://source.example/title');
  } finally { globalThis.fetch = originalFetch; }
});

test('the API keeps the loaded guide when runtime details explicitly report an older generation', async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  const requests = [];
  globalThis.window = { location: { search: '' } };
  globalThis.fetch = async url => {
    requests.push(new URL(url));
    return response({ id: 'fm:m:1', title: 'Old title', episodes: [], _catalogueGeneratedAt: OLD });
  };
  try {
    const api = await staticApi();
    await assert.rejects(api.show('fm:m:1', { version: NEW }), { code: 'RUNTIME_CATALOG_STALE' });
    assert.equal(requests.length, 1, 'do not fall back to an older static file or the title API');
    assert.equal(requests[0].searchParams.get('part'), 'show');
  } finally { globalThis.fetch = originalFetch; if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; }
});

test('a runtime detail outage cannot fall through an older bootstrap into the live title endpoint', async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  globalThis.window = { location: { search: '' } };
  try {
    for (const observeNewStatus of [false, true]) {
      const requests = []; let liveStatus = false;
      globalThis.fetch = async url => {
        const target = new URL(url); requests.push(target);
        if (target.pathname === '/data/status.json') return response({ product: 'dahsha', generatedAt: OLD });
        if (target.searchParams.get('part') === 'status' && liveStatus) return response({ product: 'dahsha', generatedAt: NEW });
        if (target.pathname === '/api/title') return response({ id: 'fm:m:1', title: 'Old live title', episodes: [], _catalogueGeneratedAt: OLD });
        return response({ error: 'temporary outage' }, 503);
      };
      const api = await staticApi();
      assert.equal((await api.status()).generatedAt, OLD);
      if (observeNewStatus) { liveStatus = true; await api.status(); }
      await assert.rejects(api.show('fm:m:1', { version: NEW }), { code: 'RUNTIME_CATALOG_STALE' });
      assert.equal(requests.some(url => url.pathname === '/api/title'), false);
      assert.equal(requests.some(url => url.pathname.startsWith('/data/shows/')), false);
    }
  } finally { globalThis.fetch = originalFetch; if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; }
});

test('a live response also cannot downgrade details when both runtime and static requests fail', async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  const requests = [];
  globalThis.window = { location: { search: '' } };
  globalThis.fetch = async url => {
    const target = new URL(url); requests.push(target);
    return target.pathname === '/api/title'
      ? response({ id: 'fm:m:1', title: 'Old cached title', episodes: [], _catalogueGeneratedAt: OLD })
      : response({ error: 'temporary outage' }, 503);
  };
  try {
    const api = await staticApi();
    await assert.rejects(api.show('fm:m:1', { version: NEW }), { code: 'RUNTIME_CATALOG_STALE' });
    assert.equal(requests.at(-1).pathname, '/api/title');
  } finally { globalThis.fetch = originalFetch; if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; }
});

test('a fresh saved title is retained when optional live hydration returns stale metadata', async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  const current = { id: 'fm:m:1', title: 'Fresh documentary title', synopsis: 'Fresh synopsis', episodes: [{ id: 'fm:m:1', title: 'Fresh episode' }], _catalogueGeneratedAt: NEW };
  const requested = [];
  globalThis.window = { location: { search: '' } };
  globalThis.fetch = async url => {
    const target = new URL(url); requested.push(target);
    return response(target.pathname === '/api/title' ? { ...current, title: 'Stale title', synopsis: 'Stale synopsis', episodes: [], _catalogueGeneratedAt: OLD } : current);
  };
  try {
    const api = await staticApi(), show = await api.show('fm:m:1', { version: NEW });
    assert.deepEqual(show, current);
    assert.equal(requested.length, 2);
    assert.equal(requested[1].pathname, '/api/title');
  } finally { globalThis.fetch = originalFetch; if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; }
});
