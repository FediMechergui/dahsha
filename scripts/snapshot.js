// Saves / restores the server's cached data (playlists, details, seen, catalog, artwork, provider
// caches) as the GitHub Release asset "data-snapshot", so CI refreshes are incremental instead of
// re-scanning ~30k videos from scratch.
//   node scripts/snapshot.js restore   -> downloads it into server/data. Only a missing release means
//                                         "start from scratch"; a failed download or extract fails.
//                                         Warns when the restored counts are below the published
//                                         manifest's (a stale or hand-uploaded archive).
//   node scripts/snapshot.js save      -> uploads server/data. Every save is compared with the published
//                                         manifest first, and each refusal lists the counts it would lose.
//                                         Refused: outside CI (--force overrides only this), when the
//                                         published snapshot is newer than the one restored here
//                                         (--overwrite-newer), and when a cache would shrink (any drop
//                                         outside CI, SHRINK_LIMITS in CI; only --allow-shrink skips it).
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
  'show-ids.json', // show id state beside catalog.json (show-ids.js), used when catalog.json is missing
];
// Service/network metadata cache (TVmaze networks); its exact name belongs to service-metadata.js.
export const FILE_PATTERNS = [/^service-metadata[\w.-]*\.json$/];
// When the checkout already has these, git is the source of truth and the snapshot copy is ignored,
// so a reject removed in a commit is not resurrected by an older snapshot.
export const PREFER_CHECKOUT = new Set(['artwork-rejects.json']);
// Largest drop of a cache count, against the published manifest, that a CI save accepts. These caches
// are keyed maps that normally only grow, so an upload from anywhere else may not lower them at all
// (local copies are the usual clobber source: in October a stale local artwork.json with 8 matches
// replaced the 1,600+ the release held).
// Only an explicit --allow-shrink skips these limits; --force does not.
export const SHRINK_LIMITS = { details: 0.1, seen: 0.1, playlistVideos: 0.2, artworkMatched: 0.25 };
export const LOCAL_SHRINK_LIMITS = Object.fromEntries(Object.keys(SHRINK_LIMITS).map((key) => [key, 0]));
// Raw cache counts checked after a restore (catalogue counts depend on the counting code's version).
export const CACHE_KEYS = ['details', 'seen', 'playlists', 'playlistVideos', 'artworkMatched', 'providerItems'];

// No shell: paths with spaces (OneDrive folders) must reach tar/gh untouched. Windows resolves
// gh/tar through PATH without a shell as long as we name the executable.
const exe = (cmd) => (process.platform === 'win32' ? `${cmd}.exe` : cmd);
const repo = () => process.env.SNAPSHOT_REPO || 'FediMechergui/dahsha';
// save/restore take the runner as a parameter so tests can stand in for gh without touching the release.
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
  // Informational only (never guarded): a counting error must not block a save or a restore.
  let catalogCounts = null;
  try { catalogCounts = catalog?.shows ? countCatalog(catalog) : null; } catch { catalogCounts = null; }
  counts.catalogShows = catalogCounts?.shows ?? null;
  counts.youtubeShows = catalogCounts?.bySource?.youtube?.shows ?? null;
  counts.youtubeEpisodes = catalogCounts?.bySource?.youtube?.episodes ?? null;
  return counts;
}

/** Every count that is lower in `after` than in `before` (a missing count counts as 0). */
export function countLosses(before, after, keys = Object.keys(before || {})) {
  return keys.filter((key) => typeof before?.[key] === 'number' && before[key] > (after?.[key] ?? 0)).map((key) => ({ key, before: before[key], after: after?.[key] ?? 0 }));
}
export const describeLosses = (losses) => losses.map(({ key, before, after }) => `${key} ${before} -> ${after}`).join(', ');

/**
 * Decides whether a save may replace the published snapshot. Refusals never name a bypass flag.
 * restored: manifest found in the data dir (written by restore); remote: { exists, hasArchive, manifest }
 * (plus error when it could not be read); local: cacheCounts() of the data dir. The returned message
 * lists every count the upload would lose against the published manifest.
 */
export function planSave({ ci, force = false, overwriteNewer = false, allowShrink = false, restored = null, remote = { exists: false }, local = {}, limits = ci ? SHRINK_LIMITS : LOCAL_SHRINK_LIMITS }) {
  const problems = [];
  if (!ci && !force) problems.push('snapshot save is reserved for the CI workflows (Refresh catalogue & deploy, Poll YouTube feeds); run one of them from GitHub Actions instead of uploading this machine\'s data');
  const published = remote?.exists ? remote.manifest || null : null;
  const restoredGeneration = Number(restored?.generation) || 0;
  const remoteGeneration = Number(published?.generation) || 0;
  if (remote?.exists && !overwriteNewer) {
    const by = published?.runUrl ? ` by ${published.runUrl}` : '';
    if (!restored) problems.push(`this data directory was not restored from the published snapshot (no ${MANIFEST}); run "npm run snapshot:restore" and redo the changes on top of it`);
    else if (remoteGeneration > restoredGeneration) problems.push(`the published snapshot (generation ${remoteGeneration}, saved ${published?.savedAt || 'at an unknown time'}${by}) is newer than the one restored here (generation ${restoredGeneration}); restore it again and redo the changes on top of it`);
  }
  if (remote?.exists && !allowShrink) {
    for (const [key, limit] of Object.entries(limits)) {
      const before = published?.counts?.[key];
      const after = local?.[key] ?? 0;
      if (typeof before === 'number' && before > 0 && (before - after) / before > limit) problems.push(`${key} would shrink from ${before} to ${after}${limit > 0 ? ` (more than ${Math.round(limit * 100)}%)` : ''}`);
    }
    // Outside CI an unverifiable upload is refused: without counts nothing shows what it would replace.
    if (!ci && remote.hasArchive !== false && !published?.counts) problems.push(`the published snapshot has no cache counts to compare with, so this upload cannot be checked for lost data`);
  }
  const losses = published?.counts ? countLosses(published.counts, local) : [];
  const against = `the published snapshot (generation ${remoteGeneration})`;
  const lost = remote?.error ? `the published snapshot could not be read to compare counts (${remote.error})`
    : !remote?.exists ? 'there is no published snapshot to compare with'
    : !published?.counts ? `${against} records no counts`
    : losses.length ? `replacing ${against} would lose: ${describeLosses(losses)}`
    : `no count is lower than in ${against}`;
  const message = problems.length ? ['snapshot save refused:', ...problems.map((p) => `- ${p}`), `Counts: ${lost}.`].join('\n') : '';
  return { ok: !problems.length, problems, losses, message, generation: Math.max(restoredGeneration, remoteGeneration) + 1 };
}

/** Problems with a just-restored snapshot, judged against the published manifest (warnings only). */
export function restoreWarnings(published, manifest, counts) {
  if (!published) return [`the release has no ${MANIFEST_ASSET}, so the restored counts cannot be checked`];
  const warnings = [];
  const pubGen = Number(published.generation) || 0, gotGen = Number(manifest?.generation) || 0;
  if (pubGen !== gotGen) warnings.push(`the archive holds generation ${gotGen}${manifest?.savedAt ? ` (saved ${manifest.savedAt})` : ''} but the published manifest is generation ${pubGen}${published.savedAt ? ` (saved ${published.savedAt})` : ''}`);
  const losses = countLosses(published.counts, counts, CACHE_KEYS);
  if (losses.length) warnings.push(`restored caches are below the published manifest (generation ${pubGen}): ${describeLosses(losses)}`);
  return warnings;
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
function remoteState(work, run = gh) {
  const view = run(['release', 'view', TAG, '--json', 'assets']);
  if (view.status !== 0) {
    if (/release not found/i.test(view.stderr || '')) return { exists: false };
    throw new Error(`cannot read release ${TAG}: ${(view.stderr || view.error?.message || `exit ${view.status}`).trim()}`);
  }
  const assets = (JSON.parse(view.stdout).assets || []).map((asset) => asset.name);
  let manifest = null;
  if (assets.includes(MANIFEST_ASSET)) {
    const download = run(['release', 'download', TAG, '--pattern', MANIFEST_ASSET, '--dir', work, '--clobber']);
    manifest = download.status === 0 ? readJson(path.join(work, MANIFEST_ASSET)) : null;
    if (!manifest) throw new Error(`cannot read ${MANIFEST_ASSET} from release ${TAG}: ${(download.stderr || '').trim()}`);
  }
  return { exists: true, hasArchive: assets.includes(ARCHIVE), manifest };
}

const describe = (counts) => Object.entries(counts).filter(([, v]) => v !== null).map(([k, v]) => `${k} ${v}`).join(', ');
// GitHub Actions turns ::warning:: / ::error:: lines on stdout into annotations on the run.
function annotate(env, out, level, title, text) {
  if (env.GITHUB_ACTIONS === 'true') out.log(`::${level} title=${title}::${text.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
  else out[level === 'error' ? 'error' : 'warn'](`${level}: ${text}`);
}

export function restore(dataDir, { env = process.env, run = gh, out = console } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-snapshot-'));
  try {
    const remote = remoteState(work, run);
    if (!remote.exists) { out.log(`no "${TAG}" release - starting from scratch`); return 0; }
    if (!remote.hasArchive) throw new Error(`release ${TAG} exists but has no ${ARCHIVE}; refusing to start from scratch`);
    const download = run(['release', 'download', TAG, '--pattern', ARCHIVE, '--dir', work, '--clobber'], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (download.status !== 0 || !fs.existsSync(path.join(work, ARCHIVE))) throw new Error(`downloading ${ARCHIVE} failed`);
    const { manifest, kept } = extractArchive(path.join(work, ARCHIVE), dataDir);
    out.log(`snapshot restored: generation ${manifest.generation}${manifest.legacy ? ' (made before manifests)' : `, saved ${manifest.savedAt}${manifest.runUrl ? ` by ${manifest.runUrl}` : ''}`}`);
    if (kept.length) out.log(`kept the checked-out ${kept.join(', ')}`);
    // Logged so a rolled-back cache is visible at the top of the run, not only in later stages.
    const counts = cacheCounts(dataDir);
    out.log(`restored caches: ${describe(counts)}`);
    for (const warning of restoreWarnings(remote.manifest, manifest, counts)) annotate(env, out, 'warning', 'Snapshot restore', warning);
    return 0;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export function save(dataDir, { force = false, overwriteNewer = false, allowShrink = false } = {}, { env = process.env, run = gh, out = console } = {}) {
  const ci = isCi(env);
  const entries = snapshotEntries(dataDir);
  if (!entries.length) { out.error('snapshot save refused: nothing to snapshot'); return 1; }
  if (ci && force) out.log('note: --force only lets a save run outside CI; the generation and cache checks still apply');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-snapshot-'));
  try {
    const restored = readManifest(dataDir);
    let remote;
    // Outside CI without --force the save is refused anyway; the release is read only to report the losses.
    try { remote = remoteState(work, run); } catch (error) { if (ci || force) throw error; remote = { exists: false, error: error.message }; }
    const local = cacheCounts(dataDir);
    const plan = planSave({ ci, force, overwriteNewer, allowShrink, restored, remote, local });
    if (!plan.ok) { annotate(env, out, 'error', 'Snapshot save refused', plan.message); return 1; }
    const server = env.GITHUB_SERVER_URL || 'https://github.com';
    const manifest = {
      version: 1,
      generation: plan.generation,
      savedAt: new Date().toISOString(),
      restoredGeneration: Number(restored?.generation) || 0,
      restoredAt: restored?.restoredAt || null,
      by: ci ? 'ci' : 'local',
      overrides: [force && 'force', overwriteNewer && 'overwrite-newer', allowShrink && 'allow-shrink'].filter(Boolean),
      workflow: env.GITHUB_WORKFLOW || null,
      runId: env.GITHUB_RUN_ID || null,
      runUrl: env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
      sha: env.GITHUB_SHA || null,
      counts: local,
      files: entries,
    };
    const manifestFile = path.join(dataDir, MANIFEST);
    const previous = fs.existsSync(manifestFile) ? fs.readFileSync(manifestFile) : null;
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
    fs.writeFileSync(path.join(work, MANIFEST_ASSET), JSON.stringify(manifest, null, 1));
    let archive = null;
    try {
      archive = createArchive(dataDir, [...entries, MANIFEST]);
      if (!remote.exists) {
        const created = run(['release', 'create', TAG, '--title', 'Data snapshot (auto)', '--notes', 'Cached Dahsha catalogue metadata used by this repository. Updated automatically by the CI workflows; do not upload by hand.', '--latest=false']);
        if (created.status !== 0) throw new Error(`creating release ${TAG} failed: ${(created.stderr || '').trim()}`);
      }
      // Archive first, manifest second: a reader never sees a manifest newer than the archive.
      const upload = run(['release', 'upload', TAG, ARCHIVE, '--clobber'], { cwd: dataDir, stdio: ['ignore', 'inherit', 'inherit'] });
      if (upload.status !== 0) throw new Error(`uploading ${ARCHIVE} failed`);
      const uploadManifest = run(['release', 'upload', TAG, MANIFEST_ASSET, '--clobber'], { cwd: work, stdio: ['ignore', 'inherit', 'inherit'] });
      if (uploadManifest.status !== 0) throw new Error(`uploading ${MANIFEST_ASSET} failed`);
    } catch (error) {
      // The data dir keeps describing what it was restored from, so a retry plans the same generation.
      if (previous) fs.writeFileSync(manifestFile, previous); else fs.rmSync(manifestFile, { force: true });
      throw error;
    } finally {
      if (archive) fs.rmSync(archive, { force: true });
    }
    out.log(`snapshot saved: generation ${manifest.generation} (${entries.join(', ')})`);
    out.log(`saved caches: ${describe(local)}`);
    return 0;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const SAVE_FLAGS = { '--force': 'force', '--overwrite-newer': 'overwriteNewer', '--allow-shrink': 'allowShrink' };

export function main(argv = process.argv.slice(2), deps = {}) {
  const [mode, ...flags] = argv;
  const dataDir = dataDirectory();
  const unknown = flags.filter((flag) => mode !== 'save' || !SAVE_FLAGS[flag]);
  if (mode === 'restore' && !unknown.length) return restore(dataDir, deps);
  if (mode === 'save' && !unknown.length) return save(dataDir, Object.fromEntries(flags.map((flag) => [SAVE_FLAGS[flag], true])), deps);
  console.error('usage: node scripts/snapshot.js restore | save [--force] [--overwrite-newer] [--allow-shrink]');
  return 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invoked) {
  try { process.exitCode = main(); } catch (error) { console.error(`snapshot ${process.argv[2] || ''} failed: ${error.message}`); process.exitCode = 1; }
}
