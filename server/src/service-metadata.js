import { readJson, writeJson } from './store.js';
import { titleKey } from './merge-library.js';

// Networks are title metadata, never inferred from the streaming player host.
// Lookups (hits and misses) are kept per show id in server/data/service-metadata-<product>.json;
// mergeCachedProviders (provider-sync.js) re-applies them on every rebuild and export, and only
// missing or stale (> 30 days) series are queried again.
const RECHECK_DAYS = 30;
const TIMEOUT_MS = 10000;
const MAX_429_RETRIES = 3;
const realSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const serviceMetadataFile = (product = 'dahsha') => `service-metadata-${product}.json`;

async function fetchTvmaze(url, { sleep = realSleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status === 429 && attempt < MAX_429_RETRIES) {
      const after = Number(response.headers.get('retry-after'));
      await sleep(Math.min(30e3, after > 0 ? after * 1000 : 2000 * 2 ** attempt));
      continue;
    }
    if (!response.ok) throw new Error(`TVmaze HTTP ${response.status}`);
    return response.json();
  }
}

const tvmOf = row => ({ id: row.id, w: row.weight || 0, r: row.rating?.average || 0, svc: row.webChannel?.name || row.network?.name || null, img: row.image?.medium, st: row.status, c: row.webChannel?.country?.code || row.network?.country?.code });
// A cached answer belongs to the title it was looked up with; a renamed show is looked up again.
// Entries written before titleKey decoded entities and read '&' as 'and' carry the older key.
const legacyKey = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const sameTitle = (entry, show) => !!entry && typeof entry === 'object' && (entry.key === titleKey(show.title) || entry.key === legacyKey(show.title));
const isFresh = (entry, show, now) => sameTitle(entry, show) && now - (Date.parse(entry.checkedAt || '') || 0) <= RECHECK_DAYS * 86400e3;

/** Copy cached TVmaze metadata onto the shows it was looked up for. Returns how many received tvm. */
export function applyServiceMetadata(shows, cache) {
  let applied = 0;
  for (const show of shows || []) {
    const entry = cache?.[show.id];
    if (!show?.title || !sameTitle(entry, show)) continue;
    if (entry.tvm && typeof entry.tvm === 'object') { show.tvm = entry.tvm; applied++; }
    if (entry.checkedAt) show.serviceCheckedAt = entry.checkedAt;
  }
  return applied;
}

/** Restores cached network metadata, then queries TVmaze for at most `limit` uncached or stale series. */
export async function enrichServices(catalog, { limit = 100, product = catalog?.product || 'dahsha', fetchJson = fetchTvmaze, now = Date.now(), delayMs = 200, log = console.log } = {}) {
  const file = serviceMetadataFile(product);
  const stored = readJson(file, {});
  const cache = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const shows = catalog?.shows || [];
  applyServiceMetadata(shows, cache);
  const provider = show => Number(/^(fm|hd):/.test(show.id));
  const freshness = show => Date.parse(show.latestAt || show.firstSeenAt || '') || 0;
  // Shows whose tvm came from elsewhere (not this cache) are left alone.
  const candidates = shows.filter(show => show.kind === 'series' && show.title && (!show.tvm || sameTitle(cache[show.id], show)) && !isFresh(cache[show.id], show, now));
  // Never-checked first, then provider series (the ones TVmaze knows best), newest first.
  candidates.sort((a, b) => Number(!!cache[a.id]) - Number(!!cache[b.id]) || provider(b) - provider(a) || freshness(b) - freshness(a));
  const queue = candidates.slice(0, limit);
  let matched = 0, checked = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const show = queue.shift();
      try {
        const results = await fetchJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(show.title)}`);
        const exact = (Array.isArray(results) ? results : []).map(row => row?.show).filter(row => row?.name && titleKey(row.name) === titleKey(show.title) && (!show.year || Number(String(row.premiered || '').slice(0, 4)) === Number(show.year)));
        const found = exact.length === 1 ? tvmOf(exact[0]) : null;
        if (found) { show.tvm = found; matched++; }
        // A later miss (search results shift) does not erase an earlier verified match.
        const previous = sameTitle(cache[show.id], show) ? cache[show.id].tvm : null;
        show.serviceCheckedAt = new Date(now).toISOString();
        cache[show.id] = { key: titleKey(show.title), year: show.year || null, tvm: found || previous || null, checkedAt: show.serviceCheckedAt };
        checked++;
      } catch { /* Not cached, so this candidate is retried on the next run. */ }
      if (delayMs) await realSleep(delayMs);
    }
  }));
  if (checked) writeJson(file, cache);
  const total = shows.filter(show => show.tvm).length;
  log(`[services] checked ${checked} of ${candidates.length} due series (${matched} new matches); ${total} series carry network metadata (${file})`);
  return total;
}
