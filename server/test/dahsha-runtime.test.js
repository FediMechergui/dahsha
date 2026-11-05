import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { buildRuntimePublication, assertPublicationProgress } from '../src/dahsha-runtime-publication.js';
import { createRuntimeSource, validateRuntimeManifest, runtimeBucket, INDEX_BYTES } from '../src/dahsha-runtime-source.js';
import { planRuntimeCleanup } from '../src/dahsha-runtime-retention.js';
import { createCatalogueHandler } from '../../api/catalogue.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-runtime-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const date = '2026-11-05T08:00:00.000Z';
const catalog = () => ({
  product: 'dahsha', generatedAt: date, channels: [{ id: 'UCArabic', title: 'Arabic channel' }], tags: [{ id: 'nature' }],
  idAliases: { s_old: 's_ar', s_older: 's_old' },
  shows: [
    { id: 's_ar', title: 'رحلة الطبيعة', lang: 'ar', kind: 'series', channelId: 'UCArabic', episodeCount: 1, latestAt: date, synopsis: 'A full Arabic synopsis.', episodes: [{ id: 'abcdefghijk', title: 'حلقة جديدة', season: 2, number: 3, publishedAt: date }] },
    { id: 'fm:s:111', title: 'Nature', lang: 'en', kind: 'series', documentary: true, episodeCount: 2, latestAt: date, synopsis: 'A full English synopsis.', poster: { custom: 'https://example.com/poster.jpg' },
      offerings: [{ provider: 'hdtoday', id: 'hd:s:nature', documentary: true }], episodes: [
        { id: 'fm:e:111-1', title: 'Spring', season: 1, number: 1, offerings: [{ provider: 'hdtoday', id: 'hd:e:nature-1' }] },
        { id: 'fm:e:111-2', title: 'Summer', season: 2, number: 1, publishedAt: date }
      ], versions: [{ id: 'hd:m:version', title: 'Nature extended', lang: 'en', kind: 'film', documentary: true }] }
  ]
});
let serial = 0;
async function publication(value = catalog()) {
  const out = path.join(dir, String(serial++)), manifest = await buildRuntimePublication(value, out);
  const blobs = new Map(Object.values(manifest.files).map(file => [file.name, fs.readFileSync(path.join(out, file.name))]));
  return { out, manifest, blobs };
}
function sourceFor(bundle, options = {}) {
  const requests = [];
  const source = createRuntimeSource({ log: () => {}, root: 'https://example.test/', ...options, fetchImpl: async (url, init) => {
    const name = new URL(url).pathname.slice(1); requests.push(name);
    if (options.fetchImpl) return options.fetchImpl(name, init);
    const value = name === 'manifest.json' ? JSON.stringify(bundle.manifest) : bundle.blobs.get(name);
    return new Response(value || '', { status: value ? 200 : 404 });
  } });
  return { source, requests };
}

test('publication preserves Arabic/English guides, real recency, posters and metadata in bounded indexes', async () => {
  const { manifest, blobs } = await publication();
  assert.equal(manifest.count, 2); assert.equal(manifest.languages.ar.count, 1); assert.equal(manifest.languages.en.count, 1);
  assert.equal(manifest.catalog.shows, undefined); assert.equal(manifest.catalog.generatedAt, date);
  assert.equal(manifest.status.product, 'dahsha'); assert.equal(manifest.status.generatedAt, date);
  for (const lang of ['ar', 'en']) {
    const rows = manifest.languages[lang].parts.flatMap(key => {
      const file = manifest.files[key], raw = gunzipSync(blobs.get(file.name)), payload = JSON.parse(raw);
      assert.ok(raw.length <= INDEX_BYTES); assert.equal(raw.length, file.rawBytes);
      assert.equal(payload.lang, lang); assert.equal(payload.product, 'dahsha');
      assert.equal(createHash('sha256').update(blobs.get(file.name)).digest('hex'), file.sha256);
      return payload.shows;
    });
    assert.equal(rows.length, 1); assert.equal(rows[0].lang, lang);
    assert.equal(rows[0].latestAt, date);
    if (lang === 'en') { assert.equal(rows[0].episodes[1].season, 2); assert.equal(rows[0].poster.custom, 'https://example.com/poster.jpg'); }
    else assert.equal(rows[0].episodes[0].title, 'حلقة جديدة');
  }
});

test('new generations reuse unchanged index/title hashes instead of rewriting every record', async () => {
  const before = await publication(), value = catalog(); value.generatedAt = '2026-11-05T08:30:00.000Z';
  const after = await publication(value);
  assert.deepEqual(after.manifest.files, before.manifest.files);
  assert.notEqual(after.manifest.generatedAt, before.manifest.generatedAt);
});

test('index byte limits include the complete UTF-8 envelope and never split away episodes', async () => {
  const value = catalog(); value.shows[0].episodes[0].title = 'ع'.repeat(350000);
  const { manifest, blobs } = await publication(value);
  for (const key of manifest.languages.ar.parts) assert.ok(gunzipSync(blobs.get(manifest.files[key].name)).length <= INDEX_BYTES);
  value.shows[0].episodes[0].title = 'ع'.repeat(INDEX_BYTES);
  await assert.rejects(publication(value), /index response limit/);
});

test('publisher rejects cross-product, non-documentary, malformed-language, empty and duplicate catalogues', async () => {
  for (const change of [
    value => { value.product = 'flixer'; }, value => { value.shows = []; },
    value => { value.shows[0].lang = 'fr'; }, value => { value.shows[1].documentary = false; },
    value => { value.shows[1].documentary = undefined; }, value => { value.shows.push(value.shows[0]); }
  ]) { const value = catalog(); change(value); await assert.rejects(publication(value)); }
});

test('approved YouTube channel reports survive unrelated provider classification flags', async () => {
  const value = catalog(); value.shows[0].documentary = false;
  const { manifest } = await publication(value);
  assert.equal(manifest.languages.ar.count, 1);
});

test('publication refuses a lost language, missing episodes or an older generation', async () => {
  const { manifest } = await publication();
  for (const change of [
    value => { value.shows = value.shows.filter(row => row.lang === 'en'); },
    value => { value.generatedAt = '2026-10-01T00:00:00Z'; },
    value => { value.shows.forEach(row => { row.episodeCount = 0; row.episodes = []; }); }
  ]) {
    const value = catalog(); change(value); const next = (await publication(value)).manifest;
    assert.throws(() => assertPublicationProgress(next, manifest), /older|truncated/);
  }
  assert.doesNotThrow(() => assertPublicationProgress(manifest, manifest));
});

test('one title lookup resolves episodes, provider offerings, historical aliases and versions without a full catalogue download', async () => {
  const bundle = await publication(), { source, requests } = sourceFor(bundle);
  for (const id of ['fm:s:111', 'fm:e:111-2', 'hd:e:nature-1', 'hd:s:nature']) assert.equal((await source.title(id)).id, 'fm:s:111');
  for (const id of ['s_ar', 's_old', 's_older', 'abcdefghijk']) assert.equal((await source.title(id)).id, 's_ar');
  const version = await source.title('hd:m:version');
  assert.equal(version.id, 'hd:m:version'); assert.equal(version.episodes[0].id, 'hd:m:version');
  assert.equal((await source.title('s_ar')).synopsis, 'A full Arabic synopsis.');
  assert.equal((await source.title('s_ar'))._catalogueGeneratedAt, date);
  assert.equal(await source.title('nonexistent'), null);
  assert.equal(await source.title('../bad\u0000id'), null);
  assert.ok(!requests.some(name => name.includes('catalog.json')));
  for (const name of requests.filter(name => name.startsWith('data-'))) assert.ok(!bundle.manifest.languages.ar.parts.concat(bundle.manifest.languages.en.parts).some(key => bundle.manifest.files[key].name === name));
});

test('an ambiguous provider episode cannot be assigned to an unrelated title', async () => {
  const value = catalog(); value.shows[0].episodes.push({ id: 'fm:e:111-2', title: 'Conflicting source metadata' });
  const { source } = sourceFor(await publication(value));
  assert.equal(await source.title('fm:e:111-2'), null);
});

test('a client can finish an older immutable language index after a new manifest arrives', async () => {
  let clock = 0;
  const old = await publication(), value = catalog(); value.generatedAt = '2026-11-05T09:00:00Z'; value.shows[0].episodes.push({ id: 'lmnopqrstuv', title: 'Second' });
  const latest = await publication(value), oldKey = old.manifest.languages.ar.parts[0];
  const all = new Map([...old.blobs, ...latest.blobs]); let selected = old.manifest;
  const { source } = sourceFor(old, { now: () => clock, fetchImpl: async name => new Response(name === 'manifest.json' ? JSON.stringify(selected) : all.get(name)) });
  await source.check(); clock = 120001; selected = latest.manifest; await source.check();
  const rows = await source.part(oldKey, old.manifest.files[oldKey].sha256);
  assert.equal(rows.shows[0].episodes.length, 1);
  assert.equal((await source.part(oldKey)).shows[0].episodes.length, 2);
});

test('corrupt gzip bodies and mismatched declared sizes are never returned as a catalogue part', async () => {
  const bundle = await publication(), key = bundle.manifest.languages.ar.parts[0];
  const file = bundle.manifest.files[key];
  const corrupted = sourceFor(bundle, { fetchImpl: async name => new Response(name === 'manifest.json' ? JSON.stringify(bundle.manifest) : gzipSync('{}')) }).source;
  await assert.rejects(corrupted.part(key), /integrity/);
  const changed = structuredClone(bundle.manifest); changed.files[key].rawBytes--;
  const mismatch = sourceFor(bundle, { fetchImpl: async name => new Response(name === 'manifest.json' ? JSON.stringify(changed) : bundle.blobs.get(file.name)) }).source;
  await assert.rejects(mismatch.part(key), /size mismatch/);
});

test('pinned hashes cannot turn internal buckets or foreign language content into index responses', async () => {
  const bundle = await publication(), { source } = sourceFor(bundle);
  const arKey = bundle.manifest.languages.ar.parts[0], enKey = bundle.manifest.languages.en.parts[0];
  await assert.rejects(source.part('show-00'), /Unknown catalogue part/);
  await assert.rejects(source.part(arKey, bundle.manifest.files[enKey].sha256), /Invalid catalogue index/);
  await assert.rejects(source.part(arKey, '../anything'), /Invalid catalogue hash/);
});

test('manifest polling is coalesced, rate-bounded and retains its last valid version only within the stale window', async () => {
  const bundle = await publication(); let clock = 0, fail = false, calls = 0;
  const { source } = sourceFor(bundle, { now: () => clock, staleMs: 300000, fetchImpl: async name => {
    calls++; return new Response(fail ? '' : JSON.stringify(bundle.manifest), { status: fail ? 503 : 200 });
  } });
  const result = await Promise.all([source.check(), source.check(), source.check()]);
  assert.equal(calls, 1); assert.equal(result[0].generatedAt, date);
  clock = 120001; fail = true; assert.equal((await source.check()).generatedAt, date);
  clock = 300001; assert.equal(await source.check(), null);
  assert.equal(calls, 3);
});

test('a cold backend can use the previous manifest during the brief pointer rename gap', async () => {
  const bundle = await publication();
  const { source, requests } = sourceFor(bundle, { fetchImpl: async name => new Response(name === 'manifest.previous.json' ? JSON.stringify(bundle.manifest) : '', { status: name === 'manifest.previous.json' ? 200 : 404 }) });
  assert.equal((await source.check()).generatedAt, date);
  assert.deepEqual(requests, ['manifest.json', 'manifest.previous.json']);
});

test('a title fallback reports its actual older generation so clients cannot regress a fresh episode guide', async () => {
  const old = await publication(), value = catalog();
  value.generatedAt = '2026-11-05T09:00:00Z'; value.shows[0].episodes.push({ id: 'lmnopqrstuv', title: 'Fresh episode' });
  const latest = await publication(value), all = new Map([...old.blobs, ...latest.blobs]);
  const failed = latest.manifest.files[`show-${runtimeBucket('s_ar')}`].name;
  let clock = 0, selected = old.manifest;
  const { source } = sourceFor(old, { now: () => clock, fetchImpl: async name => {
    if (name === 'manifest.json') return new Response(JSON.stringify(selected));
    return new Response(name === failed ? '' : all.get(name), { status: name === failed ? 503 : 200 });
  } });
  await source.check(); clock = 120001; selected = latest.manifest;
  const row = await source.title('s_ar');
  assert.equal(row.episodes.length, 1);
  assert.equal(row._catalogueGeneratedAt, old.manifest.generatedAt);
  assert.equal(source.current().generatedAt, latest.manifest.generatedAt);
});

test('a bad update cannot replace a valid product, language count or bounded asset descriptor', async () => {
  const { manifest } = await publication();
  for (const change of [
    value => { value.product = 'flixer'; }, value => { value.languages.ar.count++; },
    value => { value.catalog.shows = []; }, value => { value.status.generatedAt = '2020-01-01'; },
    value => { value.files[value.languages.ar.parts[0]].rawBytes = INDEX_BYTES + 1; },
    value => { value.files[value.languages.ar.parts[0]].name = 'https://other-host/data.gz'; }
  ]) { const value = structuredClone(manifest); change(value); assert.throws(() => validateRuntimeManifest(value)); }
});

test('retention keeps current, backup and incoming data while reclaiming only old generated assets', async () => {
  const { manifest } = await publication(), now = Date.now(), file = Object.values(manifest.files)[0];
  const old = { id: 2, name: `data-${'a'.repeat(64)}.json.gz`, created_at: new Date(now - 3600000).toISOString() };
  const keep = [ { id: 1, name: file.name, created_at: old.created_at }, { id: 3, name: 'Dahsha.apk', created_at: old.created_at }, { id: 4, name: `data-${'b'.repeat(64)}.json.gz`, created_at: new Date(now).toISOString() } ];
  const plan = planRuntimeCleanup({ assets: [...keep, old], manifests: [manifest], now, limit: 5, headroom: 2 });
  assert.deepEqual(plan.remove, [old]);
  assert.throws(() => planRuntimeCleanup({ assets: keep, incoming: [{ name: 'new-file' }], now, limit: 3, headroom: 0 }), /no safe upload capacity/);
});

function response() {
  return { statusCode: 0, headers: {}, body: null, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
}

test('catalogue API returns fresh metadata and hash-pinned indexes with distinct cache policies', async () => {
  const { manifest } = await publication();
  const handler = createCatalogueHandler({ check: async () => manifest, part: async (key, sha) => ({ key, sha }), title: async () => catalog().shows[0] });
  for (const part of ['manifest', 'status']) {
    const res = response(); await handler({ method: 'GET', query: { part } }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.generatedAt, date); assert.match(res.headers['cache-control'], /s-maxage=120/);
  }
  const key = manifest.languages.ar.parts[0], sha = manifest.files[key].sha256, res = response();
  await handler({ method: 'GET', query: { part: key, sha } }, res);
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { key, sha }); assert.match(res.headers['cache-control'], /immutable/);
  assert.equal(res.headers['netlify-vary'], 'query=part|sha|id');
});

test('catalogue API rejects invalid queries, unsupported methods and unavailable data without caching errors', async () => {
  const handler = createCatalogueHandler({ check: async () => null, part: async () => assert.fail('Invalid query must not fetch data'), title: async () => null });
  for (const [method, query, status] of [['POST', {}, 405], ['GET', { part: 'show' }, 400], ['GET', { part: ['manifest'] }, 400], ['GET', { sha: '../file' }, 400], ['GET', { sha: ['a'.repeat(64)] }, 400], ['GET', { part: 'show-00' }, 400], ['GET', { part: 'show', id: 'unknown' }, 404], ['GET', { part: 'manifest' }, 503]]) {
    const res = response(); await handler({ method, query }, res); assert.equal(res.statusCode, status); assert.equal(res.headers['cache-control'], 'no-store');
  }
  const res = response(); await handler({ method: 'OPTIONS', query: {} }, res); assert.equal(res.statusCode, 204);
});
