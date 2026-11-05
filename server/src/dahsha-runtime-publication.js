import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { leanCatalog, exportedShow, versionEpisodes, exportStatus } from './export-catalog.js';
import { INDEX_BYTES, SHOW_BYTES, BUCKET_BYTES, runtimeBucket, validateRuntimeManifest } from './dahsha-runtime-source.js';

const ordered = entries => Object.fromEntries([...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 350 && !/[\x00-\x1f]/.test(value);

export function assertPublicationProgress(next, previous) {
  validateRuntimeManifest(next);
  if (!previous) return;
  validateRuntimeManifest(previous);
  if (Date.parse(next.generatedAt) < Date.parse(previous.generatedAt)) throw Error('Refusing an older catalogue publication');
  for (const lang of ['ar', 'en']) if (next.languages[lang].count < previous.languages[lang].count * .95) throw Error(`Refusing a truncated ${lang} catalogue publication`);
  const before = previous.status.stats?.episodes, after = next.status.stats?.episodes;
  if (Number.isFinite(before) && before > 0 && (!Number.isFinite(after) || after < before * .95)) throw Error('Refusing a truncated episode catalogue publication');
}

export async function buildRuntimePublication(catalog, outDir) {
  if (catalog?.product !== 'dahsha' || !catalog.shows?.length || !Number.isFinite(Date.parse(catalog.generatedAt))) throw Error('A complete Dahsha catalogue is required');
  outDir = path.resolve(outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const files = {}, groups = new Map(), rowsById = new Map(), owners = new Map();
  const cardIds = new Set(catalog.shows.map(row => row?.id));
  if (cardIds.size !== catalog.shows.length) throw Error('Duplicate catalogue title IDs');

  function write(key, value, limit) {
    const raw = Buffer.from(JSON.stringify(value));
    if (raw.length > limit) throw Error(`Runtime ${key} exceeds its size limit`);
    const body = gzipSync(raw, { level: 6 }), sha256 = createHash('sha256').update(body).digest('hex');
    const name = `data-${sha256}.json.gz`;
    fs.writeFileSync(path.join(outDir, name), body);
    files[key] = { name, sha256, bytes: body.length, rawBytes: raw.length };
  }

  const ownerOf = (id, owner) => {
    if (!validId(id) || id === owner) return;
    if (!owners.has(id)) owners.set(id, owner);
    else if (owners.get(id) !== owner) owners.set(id, null);
  };
  for (const show of catalog.shows) {
    // Curated YouTube programmes already passed Dahsha's channel/classification
    // rules; a provider metadata flag must not drop those approved reports.
    if (!validId(show?.id) || !['ar', 'en'].includes(show.lang) || /^(fm|hd):/.test(show.id) && show.documentary !== true) throw Error(`Invalid or non-documentary Dahsha title: ${show?.id} (language=${show?.lang}, documentary=${show?.documentary})`);
    for (const entry of [show, ...(show.versions || []).filter(row => validId(row?.id) && !cardIds.has(row.id))]) {
      const row = entry === show ? exportedShow(show) : exportedShow({ ...entry, episodes: versionEpisodes(entry) });
      if (rowsById.has(row.id)) continue;
      if (Buffer.byteLength(JSON.stringify(row)) > SHOW_BYTES) throw Error(`Title ${row.id} exceeds the playback response limit`);
      rowsById.set(row.id, row);
      for (const source of row.offerings || []) ownerOf(source.id, row.id);
      for (const episode of row.episodes || []) for (const id of [episode.id, ...(episode.offerings || []).map(source => source.id)]) ownerOf(id, row.id);
    }
  }
  // Persist canonical historical aliases without chains. An ambiguous episode
  // or provider ID is not assigned to an arbitrary show.
  for (const [alias, target] of Object.entries(catalog.idAliases || {})) {
    let id = target; const seen = new Set([alias]);
    while (validId(id) && !rowsById.has(id) && Object.hasOwn(catalog.idAliases, id) && !seen.has(id)) { seen.add(id); id = catalog.idAliases[id]; }
    if (validId(alias) && rowsById.has(id) && !rowsById.has(alias)) owners.set(alias, id);
  }
  for (const [id, row] of rowsById) {
    const key = `show-${runtimeBucket(id)}`;
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key).set(id, row);
  }
  for (const [id, owner] of owners) if (owner && !rowsById.has(id)) {
    const key = `owner-${runtimeBucket(id)}`;
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key).set(id, owner);
  }
  for (const [key, rows] of groups) write(key, { product: 'dahsha', [key.startsWith('show-') ? 'shows' : 'owners']: ordered(rows) }, BUCKET_BYTES);
  groups.clear(); rowsById.clear(); owners.clear();

  const lean = leanCatalog(catalog, 'dahsha'), languages = {};
  for (const lang of ['ar', 'en']) {
    const shows = lean.shows.filter(row => row.lang === lang), parts = [];
    // Arabic has a smaller index. Fewer fixed groups reduce initial mobile
    // round trips while an update still replaces only its affected groups.
    const shardCount = lang === 'ar' ? 16 : 32, sectionsPerShard = 1024 / shardCount;
    const shards = new Map();
    for (const row of shows) {
      const shard = Math.floor(parseInt(runtimeBucket(row.id), 16) / (256 / shardCount));
      if (!shards.has(shard)) shards.set(shard, []);
      shards.get(shard).push(row);
    }
    for (const [shard, members] of [...shards].sort(([a], [b]) => a - b)) {
      let rows = [], bytes = Buffer.byteLength(JSON.stringify({ product: 'dahsha', lang, shows: [] })), section = 0;
      const flush = () => {
        if (!rows.length) return;
        if (section >= sectionsPerShard) throw Error('Dahsha index shard exceeds its section limit');
        const key = `index-${lang}-${String(shard * sectionsPerShard + section++).padStart(4, '0')}`;
        write(key, { product: 'dahsha', lang, shows: rows }, INDEX_BYTES); parts.push(key);
        rows = []; bytes = Buffer.byteLength(JSON.stringify({ product: 'dahsha', lang, shows: [] }));
      };
      for (const row of members.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        const size = Buffer.byteLength(JSON.stringify(row));
        if (bytes + size + (rows.length ? 1 : 0) > INDEX_BYTES) flush();
        if (bytes + size > INDEX_BYTES) throw Error(`Title ${row.id} exceeds the index response limit`);
        bytes += size + (rows.length ? 1 : 0); rows.push(row);
      }
      flush();
    }
    languages[lang] = { count: shows.length, parts };
  }
  const { shows, ...metadata } = lean;
  const manifest = validateRuntimeManifest({ format: 1, product: 'dahsha', generatedAt: catalog.generatedAt, count: shows.length, catalog: metadata, status: exportStatus(catalog, 'dahsha'), languages, showBucketBits: 6, files });
  if (Buffer.byteLength(JSON.stringify(manifest)) > 512 * 1024) throw Error('Dahsha manifest exceeds its response limit');
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}
