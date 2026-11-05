import { validateRuntimeManifest, runtimeAssets } from './dahsha-runtime-source.js';

// Never reclaim a current, previous or incoming content-addressed file.
export function planRuntimeCleanup({ assets, manifests = [], incoming = [], now = Date.now(), limit = 1000, headroom = 100, minAgeMs = 20 * 60000 } = {}) {
  if (!Array.isArray(assets) || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(headroom) || headroom < 0 || headroom >= limit) throw Error('Invalid runtime retention settings');
  const protectedNames = new Set(incoming.map(file => file.name));
  for (const manifest of manifests.filter(Boolean)) for (const file of runtimeAssets(validateRuntimeManifest(manifest))) protectedNames.add(file.name);
  const known = new Set(assets.map(asset => asset.name));
  const newNames = new Set(incoming.filter(file => !known.has(file.name)).map(file => file.name));
  let projected = assets.length + newNames.size + 1;
  const candidates = assets.filter(asset => /^(?:data-[a-f0-9]{64}\.json\.gz|manifest\.pending-\d+\.json)$/.test(asset.name) && !protectedNames.has(asset.name) && Number.isSafeInteger(asset.id) && asset.id > 0 && Number.isFinite(Date.parse(asset.created_at)) && now - Date.parse(asset.created_at) >= minAgeMs).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const remove = [];
  for (const asset of candidates) { if (projected <= limit - headroom) break; remove.push(asset); projected--; }
  if (projected > limit) throw Error('Runtime release has no safe upload capacity; keeping both published generations');
  return { remove, projected, protectedNames };
}
