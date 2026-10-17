// Saves / restores the server's cached data (playlists, details, seen, catalog, artwork, provider
// caches) as the GitHub Release asset "data-snapshot", so CI refreshes are incremental instead of
// re-scanning ~30k videos from scratch.
//   node scripts/snapshot.js restore   -> downloads it into server/data. Only a missing release means
//                                         "start from scratch"; a failed download or extract fails.
//   node scripts/snapshot.js save      -> uploads server/data. Refuses outside CI unless --force,
//                                         refuses when the published snapshot is newer than the one
//                                         restored here (--overwrite-newer), and refuses when the
//                                         caches would shrink sharply (--force).
// Every snapshot carries snapshot-manifest.json: a generation counter, who saved it and cache counts.
// A copy is published as data-snapshot.json so save can compare generations without the archive.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countCatalog } from './check-regression.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TAG = 'data-snapshot';
export const ARCHIVE = 'data-snapshot.tar.gz';
export const MANIFEST = 'snapshot-manifest.json';
export const MANIFEST_ASSET = 'data-snapshot.json';
export const FILES = [
  'playlists.json', 'details.json', 'seen.json', 'catalog.json', 'artwork.json',
  'providers-dahsha.json', 'provider-aliases-dahsha.json', 'provider-identities-dahsha.json', 'provider-matches-dahsha.json',
  'artwork-rejects.json', // reject list for artwork matches (may also be committed; see PREFER_CHECKOUT)
  'deploy-baseline.json', // last export that passed scripts/check-regression.js (C8 fallback)
];
// Service/network metadata cache (TVmaze networks); its exact name belongs to service-metadata.js.
export const FILE_PATTERNS = [/^service-metadata[\w.-]*\.json$/];
// When the checkout already has these, git is the source of truth and the snapshot copy is ignored,
// so a reject removed in a commit is not resurrected by an older snapshot.
export const PREFER_CHECKOUT = new Set(['artwork-rejects.json']);
// Largest drop of a cache count, against the published manifest, that save accepts without --force.
// These caches are keyed maps that normally only grow.
export const SHRINK_LIMITS = { details: 0.1, seen: 0.1, playlistVideos: 0.2, artworkMatched: 0.25 };

// No shell: paths with spaces (OneDrive folders) must reach tar/gh untouched. Windows resolves
// gh/tar through PATH without a shell as long as we name the executable.
const exe = (cmd) => (process.platform === 'win32' ? `${cmd}.exe` : cmd);
const repo = () => process.env.SNAPSHOT_REPO || 'FediMechergui/dahsha';
const gh = (args, opts = {}) => spawnSync(exe('gh'), [...args, '--repo', repo()], { encoding: 'utf8', ...opts });
export const dataDirectory = () => path.resolve(process.env.DATA_DIR || path.join(root, 'server', 'data'));
export const isCi = (env = process.env) => env.CI === 'true' || env.GITHUB_ACTIONS === 'true';

export function isAllowedEntry(name) {
  if (typeof name !== 'string' || !name || /[\\/]/.test(name) || name.startsWith('.')) return false;
  return name === MANIFEST || FILES.includes(name) || FILE_PATTERNS.some((re) => re.test(name));
}

export function snapshotEntries(dataDir) {
  const names = new Set(FILES.filter((name) => fs.existsSync(path.join(dataDir, name))));
  for (const name of fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []) if (FILE_PATTERNS.some((re) => re.test(name))) names.add(name);
  return [...names].filter((name) => fs.statSync(path.join(dataDir, name)).isFile());
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
export const readManifest = (dataDir) => readJson(path.join(dataDir, MANIFEST));

/** Counts that reveal a rolled-back or emptied cache. Files are read one at a time to bound memory. */
export function cacheCounts(dataDir) {
  const read = (name) => readJson(path.join(dataDir, name));
  const keys = (value) => (value && typeof value === 'object' ? Object.keys(value).length : null);
  const counts = {};
  counts.details = keys(read('details.json'));
  counts.seen = keys(read('seen.json'));
  const playlists = read('playlists.json');
  counts.playlists = keys(playlists);
  counts.playlistVideos = playlists ? Object.values(playlists).reduce((sum, list) => sum + (Array.isArray(list?.videos) ? list.videos.length : 0), 0) : null;
  const artwork = read('artwork.json');
  counts.artworkMatched = artwork ? Object.values(artwork).filter((entry) => entry?.source).length : null;
  counts.providerItems = read('providers-dahsha.json')?.items?.length ?? null;
  const catalog = read('catalog.json');
  const catalogCounts = catalog?.shows ? countCatalog(catalog) : null;
  counts.catalogShows = catalogCounts?.shows ?? null;
  counts.youtubeShows = catalogCounts?.bySource.youtube.shows ?? null;
  counts.youtubeEpisodes = catalogCounts?.bySource.youtube.episodes ?? null;
  return counts;
}

/**
 * Decides whether a save may replace the published snapshot.
 * restored: manifest found in the data dir (written by restore); remote: { exists, manifest }.
 */
export function planSave({ ci, force = false, overwriteNewer = false, restored = null, remote = { exists: false }, local = {}, limits = SHRINK_LIMITS }) {
  const problems = [];
  if (!ci && !force) problems.push('snapshot save is reserved for the CI workflows; pass --force to upload from this machine');
  const restoredGeneration = Number(restored?.generation) || 0;
  const remoteGeneration = Number(remote?.manifest?.generation) || 0;
  if (remote?.exists) {
    if (!restored && !force) problems.push(`this data directory was not restored from the snapshot (no ${MANIFEST}); run "npm run snapshot:restore" first`);
    if (remoteGeneration > restoredGeneration && !overwriteNewer) {
      const by = remote.manifest?.runUrl ? ` by ${remote.manifest.runUrl}` : '';
      problems.push(`the published snapshot (generation ${remoteGeneration}, saved ${remote.manifest?.savedAt || 'at an unknown time'}${by}) is newer than the one restored here (generation ${restoredGeneration}); restore it again, or pass --overwrite-newer to replace it`);
    }
    if (!force) {
      for (const [key, limit] of Object.entries(limits)) {
        const before = remote.manifest?.counts?.[key];
        const after = local?.[key] ?? 0;
        if (typeof before === 'number' && before > 0 && (before - after) / before > limit) problems.push(`${key} would shrink from ${before} to ${after} (more than ${Math.round(limit * 100)}%); pass --force if this is intended`);
      }
    }
  }
  return { ok: !problems.length, problems, generation: Math.max(restoredGeneration, remoteGeneration) + 1 };
}

function tar(args, cwd) {
  const result = spawnSync(exe('tar'), args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`tar ${args[0]} failed: ${(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout;
}

/** Writes <dataDir>/data-snapshot.tar.gz with the given names; tar runs in dataDir with relative names. */
export function createArchive(dataDir, names) {
  const bad = names.filter((name) => !isAllowedEntry(name));
  if (bad.length) throw new Error(`refusing to archive ${bad.join(', ')}`);
  tar(['-czf', ARCHIVE, ...names], dataDir);
  return path.join(dataDir, ARCHIVE);
}

/**
 * Extracts a snapshot archive into dataDir. Entries are validated before extraction, extracted into
 * a sibling staging folder, checked to be regular files and then moved in. Returns the manifest
 * (generation 0 / legacy for archives made before manifests existed) with restoredAt added.
 */
export function extractArchive(archiveFile, dataDir, { now = new Date() } = {}) {
  dataDir = path.resolve(dataDir);
  const stage = `${dataDir}.restore-${randomUUID()}`;
  const files = path.join(stage, 'files');
  fs.mkdirSync(files, { recursive: true });
  try {
    fs.copyFileSync(archiveFile, path.join(stage, ARCHIVE));
    const names = tar(['-tzf', ARCHIVE], stage).split(/\r?\n/).map((name) => name.trim().replace(/^\.\//, '')).filter(Boolean);
    const bad = names.filter((name) => !isAllowedEntry(name));
    if (!names.length || bad.length) throw new Error(`invalid snapshot archive entries: ${(bad.length ? bad : ['(empty)']).slice(0, 5).join(', ')}`);
    tar(['-xzf', path.join('..', ARCHIVE), '--no-same-owner', '--no-same-permissions'], files);
    fs.mkdirSync(dataDir, { recursive: true });
    const placed = [], kept = [];
    for (const name of names.filter((n) => n !== MANIFEST)) {
      const source = path.join(files, name);
      if (!fs.lstatSync(source).isFile()) throw new Error(`snapshot entry ${name} is not a regular file`);
      const target = path.join(dataDir, name);
      if (PREFER_CHECKOUT.has(name) && fs.existsSync(target)) { kept.push(name); continue; }
      fs.renameSync(source, target);
      placed.push(name);
    }
    const stored = names.includes(MANIFEST) ? readJson(path.join(files, MANIFEST)) : null;
    const manifest = { ...(stored || { version: 1, generation: 0, legacy: true }), restoredAt: now.toISOString() };
    fs.writeFileSync(path.join(dataDir, MANIFEST), JSON.stringify(manifest, null, 1));
    return { manifest, placed, kept };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/** Reads the release: { exists:false } only when GitHub says it does not exist; other errors throw. */
function remoteState(work) {
  const view = gh(['release', 'view', TAG, '--json', 'assets']);
  if (view.status !== 0) {
    if (/release not found/i.test(view.stderr || '')) return { exists: false };
    throw new Error(`cannot read release ${TAG}: ${(view.stderr || view.error?.message || `exit ${view.status}`).trim()}`);
  }
  const assets = (JSON.parse(view.stdout).assets || []).map((asset) => asset.name);
  let manifest = null;
  if (assets.includes(MANIFEST_ASSET)) {
    const download = gh(['release', 'download', TAG, '--pattern', MANIFEST_ASSET, '--dir', work, '--clobber']);
    manifest = download.status === 0 ? readJson(path.join(work, MANIFEST_ASSET)) : null;
    if (!manifest) throw new Error(`cannot read ${MANIFEST_ASSET} from release ${TAG}: ${(download.stderr || '').trim()}`);
  }
  return { exists: true, hasArchive: assets.includes(ARCHIVE), manifest };
}

const describe = (counts) => Object.entries(counts).filter(([, v]) => v !== null).map(([k, v]) => `${k} ${v}`).join(', ');

function restore(dataDir) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-snapshot-'));
  try {
    const remote = remoteState(work);
    if (!remote.exists) { console.log(`no "${TAG}" release - starting from scratch`); return 0; }
    if (!remote.hasArchive) throw new Error(`release ${TAG} exists but has no ${ARCHIVE}; refusing to start from scratch`);
    const download = gh(['release', 'download', TAG, '--pattern', ARCHIVE, '--dir', work, '--clobber'], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (download.status !== 0 || !fs.existsSync(path.join(work, ARCHIVE))) throw new Error(`downloading ${ARCHIVE} failed`);
    const { manifest, kept } = extractArchive(path.join(work, ARCHIVE), dataDir);
    console.log(`snapshot restored: generation ${manifest.generation}${manifest.legacy ? ' (made before manifests)' : `, saved ${manifest.savedAt}${manifest.runUrl ? ` by ${manifest.runUrl}` : ''}`}`);
    if (kept.length) console.log(`kept the checked-out ${kept.join(', ')}`);
    // Logged so a rolled-back cache is visible at the top of the run, not only in later stages.
    console.log(`restored caches: ${describe(cacheCounts(dataDir))}`);
    return 0;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function save(dataDir, { force, overwriteNewer }) {
  const ci = isCi();
  if (!ci && !force) {
    console.error('snapshot save refused: the data snapshot is written by the CI workflows (Refresh catalogue & deploy / Poll YouTube feeds). Run one of them from GitHub Actions, or pass --force if you really mean to upload this machine\'s data.');
    return 1;
  }
  const entries = snapshotEntries(dataDir);
  if (!entries.length) { console.error('nothing to snapshot'); return 1; }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-snapshot-'));
  try {
    const restored = readManifest(dataDir);
    const remote = remoteState(work);
    const local = cacheCounts(dataDir);
    const plan = planSave({ ci, force, overwriteNewer, restored, remote, local });
    if (!plan.ok) {
      for (const problem of plan.problems) console.error(`snapshot save refused: ${problem}`);
      return 1;
    }
    const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
    const manifest = {
      version: 1,
      generation: plan.generation,
      savedAt: new Date().toISOString(),
      restoredGeneration: Number(restored?.generation) || 0,
      restoredAt: restored?.restoredAt || null,
      by: ci ? 'ci' : 'local',
      workflow: process.env.GITHUB_WORKFLOW || null,
      runId: process.env.GITHUB_RUN_ID || null,
      runUrl: process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY ? `${server}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
      sha: process.env.GITHUB_SHA || null,
      counts: local,
      files: entries,
    };
    fs.writeFileSync(path.join(dataDir, MANIFEST), JSON.stringify(manifest, null, 1));
    fs.writeFileSync(path.join(work, MANIFEST_ASSET), JSON.stringify(manifest, null, 1));
    const archive = createArchive(dataDir, [...entries, MANIFEST]);
    try {
      if (!remote.exists) {
        const created = gh(['release', 'create', TAG, '--title', 'Data snapshot (auto)', '--notes', 'Cached Dahsha catalogue metadata used by this repository. Updated automatically by the CI workflows; do not upload by hand.', '--latest=false']);
        if (created.status !== 0) throw new Error(`creating release ${TAG} failed: ${(created.stderr || '').trim()}`);
      }
      // Archive first, manifest second: a reader never sees a manifest newer than the archive.
      const upload = gh(['release', 'upload', TAG, ARCHIVE, '--clobber'], { cwd: dataDir, stdio: ['ignore', 'inherit', 'inherit'] });
      if (upload.status !== 0) throw new Error(`uploading ${ARCHIVE} failed`);
      const uploadManifest = gh(['release', 'upload', TAG, MANIFEST_ASSET, '--clobber'], { cwd: work, stdio: ['ignore', 'inherit', 'inherit'] });
      if (uploadManifest.status !== 0) throw new Error(`uploading ${MANIFEST_ASSET} failed`);
    } finally {
      fs.rmSync(archive, { force: true });
    }
    console.log(`snapshot saved: generation ${manifest.generation} (${entries.join(', ')})`);
    console.log(`saved caches: ${describe(local)}`);
    return 0;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export function main(argv = process.argv.slice(2)) {
  const [mode, ...flags] = argv;
  const dataDir = dataDirectory();
  if (mode === 'restore') return restore(dataDir);
  if (mode === 'save') return save(dataDir, { force: flags.includes('--force'), overwriteNewer: flags.includes('--overwrite-newer') });
  console.error('usage: node scripts/snapshot.js restore | save [--force] [--overwrite-newer]');
  return 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invoked) {
  try { process.exitCode = main(); } catch (error) { console.error(`snapshot ${process.argv[2] || ''} failed: ${error.message}`); process.exitCode = 1; }
}
