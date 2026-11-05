import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const RUNTIME_ROOT = 'https://github.com/FediMechergui/dahsha/releases/download/catalogue-runtime/';
export const INDEX_BYTES = 1024 * 1024;
export const SHOW_BYTES = 4 * 1024 * 1024;
export const BUCKET_BYTES = 32 * 1024 * 1024;
const MANIFEST_BYTES = 512 * 1024;
const hashOf = value => createHash('sha256').update(value).digest('hex');
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 350 && !/[\x00-\x1f]/.test(value);
export const runtimeBucket = id => (parseInt(hashOf(id).slice(0, 2), 16) & 252).toString(16).padStart(2, '0');
export const runtimeAssets = manifest => Object.values(manifest?.files || {});

export function validateRuntimeManifest(value) {
  if (!record(value) || value.format !== 1 || value.product !== 'dahsha' || !Number.isSafeInteger(value.count) || value.count < 1 || !Number.isFinite(Date.parse(value.generatedAt)) || value.showBucketBits !== 6 || !record(value.catalog) || value.catalog.product !== 'dahsha' || value.catalog.generatedAt !== value.generatedAt || Object.hasOwn(value.catalog, 'shows') || !record(value.status) || value.status.product !== 'dahsha' || value.status.generatedAt !== value.generatedAt || !record(value.languages) || !record(value.files) || Object.keys(value.files).length > 2304) throw Error('Invalid Dahsha runtime manifest');
  let total = 0;
  const parts = new Set();
  for (const lang of ['ar', 'en']) {
    const section = value.languages[lang];
    if (!record(section) || !Number.isSafeInteger(section.count) || section.count < 0 || !Array.isArray(section.parts) || section.parts.length > 1024 || (!!section.count !== !!section.parts.length)) throw Error('Invalid Dahsha language index');
    total += section.count;
    for (const key of section.parts) {
      if (typeof key !== 'string' || !new RegExp(`^index-${lang}-\\d{4}$`).test(key) || !value.files[key] || parts.has(key)) throw Error('Incomplete Dahsha language index');
      parts.add(key);
    }
  }
  if (total !== value.count) throw Error('Dahsha language counts do not match');
  for (const [key, file] of Object.entries(value.files)) {
    const index = /^index-(?:ar|en)-\d{4}$/.test(key);
    if (!(index || /^(?:show|owner)-[a-f0-9]{2}$/.test(key)) || !record(file) || !/^[a-f0-9]{64}$/.test(file.sha256) || file.name !== `data-${file.sha256}.json.gz` || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > BUCKET_BYTES || !Number.isSafeInteger(file.rawBytes) || file.rawBytes < 1 || file.rawBytes > (index ? INDEX_BYTES : BUCKET_BYTES) || index && !parts.has(key)) throw Error('Invalid Dahsha runtime asset');
  }
  if (!Object.keys(value.files).some(key => key.startsWith('show-'))) throw Error('Missing Dahsha title buckets');
  return value;
}

async function boundedBody(response, limit) {
  if (!response.ok) { await response.body?.cancel(); throw Error(`Catalogue source HTTP ${response.status}`); }
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw Error('Catalogue asset too large'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw Error('Catalogue asset too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createRuntimeSource({ fetchImpl = fetch, now = Date.now, pollMs = 120000, retryMs = 15000, staleMs = 6 * 3600e3, root = RUNTIME_ROOT, log = console.warn } = {}) {
  let manifest = null, previous = null, checkedAt = -Infinity, confirmedAt = -Infinity, checking = null;
  const cache = new Map(), loading = new Map(), waiters = [];
  let cacheBytes = 0, downloads = 0;
  const releaseSlot = () => { if (waiters.length) waiters.shift()(); else downloads--; };
  const current = () => now() - confirmedAt <= staleMs ? manifest : null;

  async function loadManifest(name) {
    const body = await boundedBody(await fetchImpl(`${root}${name}?v=${Math.floor(now() / pollMs)}`, { signal: AbortSignal.timeout(8000), cache: 'no-store' }), MANIFEST_BYTES);
    return validateRuntimeManifest(JSON.parse(body.toString('utf8')));
  }

  async function check() {
    if (checking) return checking;
    // A cold instance without a usable manifest must recover promptly after a
    // transient GitHub failure. Successful manifests keep the normal poll cadence.
    const interval=current()?pollMs:Math.min(pollMs,Math.max(1,Math.min(15000,retryMs)));
    if (now() - checkedAt < interval) return current();
    checkedAt = now();
    checking = (async () => {
      try {
        let next;
        try { next = await loadManifest('manifest.json'); }
        catch (error) { if (manifest) throw error; next = await loadManifest('manifest.previous.json'); }
        if (!manifest || Date.parse(next.generatedAt) > Date.parse(manifest.generatedAt)) { previous = manifest; manifest = next; }
        if (next.generatedAt === manifest.generatedAt) confirmedAt = now();
      } catch (error) { log(`[dahsha-runtime] Keeping the last complete manifest: ${error.message}`); }
      return current();
    })().finally(() => { checkedAt = now(); checking = null; });
    return checking;
  }

  async function readHash(sha, maxBytes, expected) {
    if (!/^[a-f0-9]{64}$/.test(sha)) throw Error('Invalid catalogue hash');
    const unwrap = entry => {
      if (entry.rawBytes > maxBytes || expected && (entry.rawBytes !== expected.rawBytes || entry.bytes !== expected.bytes)) throw Error('Catalogue asset size mismatch');
      return entry.value;
    };
    if (cache.has(sha)) { const entry = cache.get(sha); cache.delete(sha); cache.set(sha, entry); return unwrap(entry); }
    if (loading.has(sha)) return unwrap(await loading.get(sha));
    const request = (async () => {
      if (downloads < 4) downloads++; else await new Promise(resolve => waiters.push(resolve));
      try {
        const body = await boundedBody(await fetchImpl(`${root}data-${sha}.json.gz`, { signal: AbortSignal.timeout(15000) }), Math.min(maxBytes + 65536, BUCKET_BYTES));
        if (hashOf(body) !== sha) throw Error('Catalogue asset integrity check failed');
        const raw = gunzipSync(body, { maxOutputLength: maxBytes });
        const entry = { value: JSON.parse(raw.toString('utf8')), rawBytes: raw.length, bytes: body.length };
        unwrap(entry);
        if (raw.length <= 16 * 1024 * 1024) {
          cache.set(sha, entry); cacheBytes += raw.length;
          while (cache.size > 16 || cacheBytes > 16 * 1024 * 1024) { const key = cache.keys().next().value; cacheBytes -= cache.get(key).rawBytes; cache.delete(key); }
        }
        return entry;
      } finally { releaseSlot(); }
    })().finally(() => loading.delete(sha));
    loading.set(sha, request);
    return unwrap(await request);
  }

  async function part(key, sha) {
    const match = /^index-(ar|en)-\d{4}$/.exec(String(key));
    if (!match) throw Error('Unknown catalogue part');
    // A pinned immutable hash already identifies the exact bytes requested. Cold
    // instances must not wait on two mutable manifest downloads before serving
    // each index part; the hash, decompression limit and language still validate it.
    const target = sha ? current() : await check(), file = target?.files[key];
    // Older clients can finish the immutable generation they started even if
    // a newer publication removed this section from the current manifest.
    const hash = sha || file?.sha256;
    if (!hash) throw Error('Catalogue unavailable');
    const payload = await readHash(hash, INDEX_BYTES, file?.sha256 === hash ? file : null);
    if (payload?.product !== 'dahsha' || payload.lang !== match[1] || !Array.isArray(payload.shows) || payload.shows.some(row => !validId(row?.id) || row.lang !== match[1])) throw Error('Invalid catalogue index');
    return payload;
  }

  async function titleAt(id, target, followOwner = true) {
    const file = target.files[`show-${runtimeBucket(id)}`];
    if (file) {
      const payload = await readHash(file.sha256, BUCKET_BYTES, file);
      if (payload?.product !== 'dahsha' || !record(payload.shows)) throw Error('Invalid title bucket');
      if (Object.hasOwn(payload.shows, id)) {
        const row = payload.shows[id];
        if (row?.id !== id || Buffer.byteLength(JSON.stringify(row)) > SHOW_BYTES) throw Error('Invalid title record');
        return row;
      }
    }
    if (!followOwner) return null;
    const ownerFile = target.files[`owner-${runtimeBucket(id)}`];
    if (!ownerFile) return null;
    const payload = await readHash(ownerFile.sha256, BUCKET_BYTES, ownerFile);
    if (payload?.product !== 'dahsha' || !record(payload.owners)) throw Error('Invalid title owner bucket');
    const owner = Object.hasOwn(payload.owners, id) ? payload.owners[id] : null;
    return validId(owner) && owner !== id ? titleAt(owner, target, false) : null;
  }

  async function title(id) {
    if (!validId(id)) return null;
    const target = await check();
    if (!target) throw Error('Catalogue unavailable');
    const stamped = (row, generation) => row ? { ...row, _catalogueGeneratedAt: generation } : null;
    try { return stamped(await titleAt(id, target), target.generatedAt); }
    catch (error) {
      if (!previous) throw error;
      log(`[dahsha-runtime] Title update unavailable; using its previous generation: ${error.message}`);
      return stamped(await titleAt(id, previous), previous.generatedAt);
    }
  }

  return { check, part, title, current };
}

export const runtimeSource = createRuntimeSource();
export const checkRuntimeManifest = () => runtimeSource.check();
export const readRuntimePart = (key, sha) => runtimeSource.part(key, sha);
export const getRuntimeTitle = id => runtimeSource.title(id);
