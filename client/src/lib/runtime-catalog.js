const PRODUCT = 'dahsha';
const LANGUAGES = ['ar', 'en'];
const MAX_INDEX_BYTES = 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => typeof value === 'string' && value ? Date.parse(value) : NaN;

/** A failed or stale update must never replace a complete catalogue already on screen. */
export function isOlderGeneration(next, previous) {
  const before = timestamp(previous);
  const after = timestamp(next);
  return Number.isFinite(before) && (!Number.isFinite(after) || after < before);
}

const invalid = message => Object.assign(new Error(message), { code: 'RUNTIME_CATALOG_INVALID' });
function generation(value) {
  if (!object(value) || value.product !== PRODUCT || !Number.isFinite(timestamp(value.generatedAt))) throw invalid('Invalid Dahsha catalogue generation');
  return value;
}

export function validateRuntimeManifest(value) {
  generation(value);
  if (value.format !== 1 || !Number.isSafeInteger(value.count) || value.count < 1 || !object(value.files) || !object(value.languages) || !object(value.catalog) || 'shows' in value.catalog) throw invalid('Invalid Dahsha catalogue manifest');
  generation(value.catalog);
  generation(value.status);
  if (value.catalog.generatedAt !== value.generatedAt || value.status.generatedAt !== value.generatedAt) throw invalid('Mixed catalogue generations');
  const seen = new Set();
  let count = 0;
  for (const lang of LANGUAGES) {
    const section = value.languages[lang];
    if (!object(section) || !Number.isSafeInteger(section.count) || section.count < 0 || !Array.isArray(section.parts) || section.parts.length > 1024 || (section.count > 0 && section.parts.length === 0)) throw invalid('Invalid catalogue language section');
    count += section.count;
    for (const key of section.parts) {
      const file = value.files[key];
      if (typeof key !== 'string' || !new RegExp(`^index-${lang}-\\d{4}$`).test(key) || seen.has(key) || !object(file) || !/^[a-f0-9]{64}$/.test(file.sha256) || file.name !== `data-${file.sha256}.json.gz` || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_INDEX_BYTES + 1024 || !Number.isSafeInteger(file.rawBytes) || file.rawBytes < 1 || file.rawBytes > MAX_INDEX_BYTES) throw invalid('Invalid catalogue part descriptor');
      seen.add(key);
    }
  }
  if (count !== value.count) throw invalid('Catalogue language counts do not match');
  return value;
}

function validatePart(value, lang) {
  if (!object(value) || value.product !== PRODUCT || value.lang !== lang || !Array.isArray(value.shows)) throw invalid('Invalid catalogue part');
  for (const row of value.shows) if (!object(row) || typeof row.id !== 'string' || !row.id || row.lang !== lang || typeof row.title !== 'string') throw invalid('Invalid catalogue title');
  return value;
}

/** All requests go to the same-origin backend; release URLs never reach the WebView. */
export function createRuntimeCatalogClient({ request, base = '', now = Date.now, maxCacheBytes = 16 * 1024 * 1024, maxCacheParts = 32, concurrency = 3, manifestTtl = 120000 } = {}) {
  if (typeof request !== 'function') throw new TypeError('A JSON request function is required');
  const endpoint = `${base.replace(/\/$/, '')}/api/catalogue`;
  const url = params => `${endpoint}?${new URLSearchParams(params)}`;
  let currentManifest = null, manifestAt = 0, pendingManifest = null, observedVersion = null, cacheBytes = 0;
  const cache = new Map(), pendingParts = new Map();
  const newer = (a, b) => isOlderGeneration(a, b) ? b : a || b;
  const requireVersion = (value, minimum = observedVersion) => {
    generation(value);
    if (isOlderGeneration(value.generatedAt, minimum)) throw Object.assign(new Error('The server returned an older catalogue; keeping the loaded version'), { code: 'RUNTIME_CATALOG_STALE' });
    return value;
  };
  const remember = value => { requireVersion(value); observedVersion = newer(value.generatedAt, observedVersion); return value; };

  async function manifest({ minimum } = {}) {
    const floor = newer(minimum, observedVersion);
    if (currentManifest && now() - manifestAt < manifestTtl && !isOlderGeneration(currentManifest.generatedAt, floor)) return currentManifest;
    if (!pendingManifest) pendingManifest = (async () => {
      const fresh = validateRuntimeManifest(await request(url({ part: 'manifest' }), { timeout: 20000, cache: 'no-cache' }));
      remember(fresh);
      currentManifest = fresh;
      manifestAt = now();
      return fresh;
    })().finally(() => { pendingManifest = null; });
    return requireVersion(await pendingManifest, floor);
  }

  const cachedPart = (key, file) => {
    const cacheKey = `${key}:${file.sha256}`;
    if (cache.has(cacheKey)) {
      const item = cache.get(cacheKey);
      cache.delete(cacheKey); cache.set(cacheKey, item);
      return item.value;
    }
    return null;
  };

  async function part(key, file, lang) {
    const cacheKey = `${key}:${file.sha256}`;
    const cached = cachedPart(key, file);
    if (cached) return cached;
    if (pendingParts.has(cacheKey)) return pendingParts.get(cacheKey);
    const pending = (async () => {
      // The backend checks the compressed SHA-256 before decoding. Pinning this query
      // to the manifest hash also prevents mixing parts across a concurrent publication.
      const value = validatePart(await request(url({ part: key, sha: file.sha256 }), { timeout: 60000, stall: 20000 }), lang);
      if (file.rawBytes <= maxCacheBytes && maxCacheParts > 0) {
        cache.set(cacheKey, { value, bytes: file.rawBytes });
        cacheBytes += file.rawBytes;
        while (cache.size > maxCacheParts || cacheBytes > maxCacheBytes) {
          const oldest = cache.keys().next().value;
          cacheBytes -= cache.get(oldest).bytes;
          cache.delete(oldest);
        }
      }
      return value;
    })().finally(() => pendingParts.delete(cacheKey));
    pendingParts.set(cacheKey, pending);
    return pending;
  }

  const acceptTitle = (row, { version } = {}) => {
    if (!object(row) || typeof row.id !== 'string' || !row.id || typeof row.title !== 'string' || (row.episodes !== undefined && !Array.isArray(row.episodes))) throw invalid('Invalid title details');
    if (isOlderGeneration(row._catalogueGeneratedAt, newer(version, observedVersion))) throw Object.assign(new Error('Title details are from an older catalogue; keeping the current guide'), { code: 'RUNTIME_CATALOG_STALE' });
    if (row._catalogueGeneratedAt) remember({ product: PRODUCT, generatedAt: row._catalogueGeneratedAt });
    return row;
  };

  return {
    manifest,
    acceptTitle,
    get observedVersion() { return observedVersion; },
    acceptBootstrap(value) { return remember(value); },
    async status() {
      return remember(await request(url({ part: 'status' }), { timeout: 15000, cache: 'no-cache' }));
    },
    async catalog(lang = 'ar', { version } = {}) {
      if (!LANGUAGES.includes(lang)) throw invalid('Unsupported catalogue language');
      const published = await manifest({ minimum: version });
      const section = published.languages[lang], chunks = new Array(section.parts.length);
      // Take references to every reusable part before new downloads evict LRU entries.
      // Otherwise a catalogue larger than the cache would churn through it on every update.
      const missing = [];
      section.parts.forEach((key, index) => {
        const cached = cachedPart(key, published.files[key]);
        if (cached) chunks[index] = cached; else missing.push(index);
      });
      let cursor = 0, failure = null;
      await Promise.all(Array.from({ length: Math.min(Math.max(1, Math.min(4, concurrency)), missing.length) }, async () => {
        while (!failure && cursor < missing.length) {
          const index = missing[cursor++], key = section.parts[index];
          try { chunks[index] = await part(key, published.files[key], lang); }
          catch (error) { failure ||= error; }
        }
      }));
      if (failure) throw failure;
      const shows = [], seen = new Set();
      for (const chunk of chunks) for (const row of chunk.shows) {
        if (seen.has(row.id)) throw invalid('Duplicate title in the catalogue update');
        seen.add(row.id); shows.push(row);
      }
      if (shows.length !== section.count) throw invalid('Incomplete catalogue update');
      // A status check may have observed a newer generation while these parts loaded.
      // The complete pinned generation remains usable; the next poll picks up the newer one.
      return { ...published.catalog, product: PRODUCT, generatedAt: published.generatedAt, lang, shows };
    },
    async show(id, { version } = {}) {
      if (typeof id !== 'string' || !id) throw invalid('Missing title ID');
      const row = await request(url({ part: 'show', id }), { timeout: 25000, cache: 'no-cache' });
      return acceptTitle(row, { version });
    },
  };
}
