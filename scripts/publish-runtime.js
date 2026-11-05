import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildRuntimePublication, assertPublicationProgress } from '../server/src/dahsha-runtime-publication.js';
import { validateRuntimeManifest, runtimeAssets } from '../server/src/dahsha-runtime-source.js';
import { planRuntimeCleanup } from '../server/src/dahsha-runtime-retention.js';
import { deleteRuntimeAsset, uploadRuntimeAsset, verifyRuntimeAsset, verifyRuntimeRelease } from '../server/src/runtime-release.js';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'FediMechergui/dahsha', tag = 'catalogue-runtime';
const dir = path.join(project, 'artifacts/runtime-publication');
const gh = process.platform === 'win32' ? 'gh.exe' : 'gh', run = promisify(execFile);
const call = args => execFileSync(gh, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024, timeout: 120000 });
const json = args => JSON.parse(call(args));

// Use the just-validated export. scheduler's base cache need not include the
// latest merged provider rows, while each exported show has its full guide.
const dataDir = path.join(project, 'client/public/data');
const catalog = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8'));
if (catalog.product !== 'dahsha') throw Error('Only Dahsha can publish to this runtime release');
catalog.shows = catalog.shows.map(row => {
  const full = JSON.parse(fs.readFileSync(path.join(dataDir, 'shows', `${encodeURIComponent(row.id)}.json`), 'utf8'));
  if (full.id !== row.id) throw Error('Exported title identity mismatch');
  return full;
});
const manifest = await buildRuntimePublication(catalog, dir);
console.log(`[runtime] built ${manifest.count} documentary titles; ar=${manifest.languages.ar.count}, en=${manifest.languages.en.count}`);
if (process.argv.includes('--build-only')) process.exit(0);
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== repo) throw Error('Dahsha runtime publication is reserved for this repository’s GitHub workflows');

let release;
try { release = json(['api', `repos/${repo}/releases/tags/${tag}`]); }
catch (error) {
  if (!/\b404\b/.test(String(error.stderr))) throw error;
  call(['release', 'create', tag, '--repo', repo, '--title', 'Live documentary catalogue', '--notes', 'Versioned Arabic and English documentary catalogue. Data updates do not redeploy the website or backend.', '--latest=false']);
  release = json(['api', `repos/${repo}/releases/tags/${tag}`]);
}
const list = () => json(['api', '--paginate', '--slurp', `repos/${repo}/releases/${release.id}/assets?per_page=100`]).flat();
let assets = list();
const known = new Map(assets.map(asset => [asset.name, asset]));
const old = known.get('manifest.json'), oldBackup = known.get('manifest.previous.json');
const readManifest = asset => asset ? validateRuntimeManifest(json(['api', '-H', 'Accept: application/octet-stream', `repos/${repo}/releases/assets/${asset.id}`])) : null;
const previous = readManifest(old), backupManifest = readManifest(oldBackup);
assertPublicationProgress(manifest, previous || backupManifest);
const incoming = [...new Map(runtimeAssets(manifest).map(file => [file.name, file])).values()];
const publishedNames = new Set([previous, backupManifest].filter(Boolean).flatMap(runtimeAssets).map(file => file.name));
const missing = incoming.filter(file => {
  const asset = known.get(file.name);
  if (asset?.state === 'starter' && asset.size === 0 && !publishedNames.has(file.name)) return true;
  if (asset) verifyRuntimeAsset(asset, file);
  return !asset;
});
let nextMutation = Date.now();
const mutate = async args => {
  const delay = Math.max(0, nextMutation - Date.now());
  nextMutation = Math.max(nextMutation, Date.now()) + 1000;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  return run(gh, args, { windowsHide: true, maxBuffer: 1024 * 1024, timeout: 120000 });
};
const remove = id => deleteRuntimeAsset({ repo, id, mutate });
const inspect = () => {
  const current = verifyRuntimeRelease(json(['api', `repos/${repo}/releases/tags/${tag}`]), { id: release.id, tag });
  return { ...current, assets: list() };
};
const removeIncomplete = asset => {
  if (publishedNames.has(asset.name)) throw Error('Refusing to remove a published catalogue asset');
  return remove(asset.id);
};
const upload = file => uploadRuntimeAsset({ repo, tag, releaseId: release.id, file: { ...file, path: path.join(dir, file.name) }, mutate, inspect, removeIncomplete });
const cleanup = planRuntimeCleanup({ assets, manifests: [previous, backupManifest, manifest], incoming });
console.log(`[runtime] ${missing.length} new immutable files; ${cleanup.remove.length} unreferenced assets to retire`);
for (const asset of cleanup.remove) await remove(asset.id);
let cursor = 0, completed = 0, uploadError;
await Promise.all(Array.from({ length: Math.min(4, missing.length) }, async () => {
  while (!uploadError && cursor < missing.length) {
    const file = missing[cursor++];
    try { await upload(file); } catch (error) { uploadError ||= error; return; }
    if (++completed % 20 === 0) console.log(`[runtime] uploaded ${completed} of ${missing.length}`);
  }
}));
if (uploadError) throw uploadError;

const pendingName = `manifest.pending-${Date.now()}.json`, pending = path.join(dir, pendingName);
fs.copyFileSync(path.join(dir, 'manifest.json'), pending);
const pendingFile = { name: pendingName, bytes: fs.statSync(pending).size, sha256: createHash('sha256').update(fs.readFileSync(pending)).digest('hex') };
await upload(pendingFile);
assets = inspect().assets;
const finished = new Map(assets.map(asset => [asset.name, asset]));
for (const file of incoming) verifyRuntimeAsset(finished.get(file.name), file);
const uploaded = verifyRuntimeAsset(finished.get(pendingName), pendingFile);
const rename = (id, name) => call(['api', `repos/${repo}/releases/assets/${id}`, '--method', 'PATCH', '-f', `name=${name}`]);
const backup = assets.find(asset => asset.name === 'manifest.previous.json');
if (old && backup) await remove(backup.id);
if (old) rename(old.id, 'manifest.previous.json');
try { rename(uploaded.id, 'manifest.json'); }
catch (error) { if (old) rename(old.id, 'manifest.json'); throw error; }
console.log(`[runtime] published ${manifest.generatedAt}; no hosting deployment requested`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Documentary catalogue published\n\n- Generated: ${manifest.generatedAt}\n- Arabic titles: ${manifest.languages.ar.count}\n- English titles: ${manifest.languages.en.count}\n- Changed data files: ${missing.length}\n- Website/backend deployments: 0\n`);
