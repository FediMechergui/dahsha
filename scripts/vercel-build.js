// Vercel build. Both production deploy paths run it:
//   - the CI workflows (refresh.yml, poll.yml) export fresh data, run scripts/check-regression.js and
//     then `vercel build`; they set REGRESSION_CHECKED=1 so the guard below is not repeated.
//   - a git push to main (or `npm run publish`) builds on Vercel. With no exported data it restores
//     the latest data snapshot (the release asset the workflows maintain), rebuilds the catalogue
//     from the cached rows with this commit's code (so title/grouping fixes apply now), exports it
//     and refuses to ship a catalogue that is smaller than production or built from an older
//     snapshot than production. Override with REGRESSION_FORCE=1 in the Vercel environment.
//     If production cannot be reached the build continues and says so.
// Every build writes data/deploy.json (catalogue fingerprint + snapshot generation) so the next
// build and the hourly poll can tell what production serves.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVE, extractArchive, readManifest } from './snapshot.js';
import {
  LIVE_BASE, DEFAULT_THRESHOLD, compareGeneration, countCatalog, deployMarker, evaluate, fetchJson, formatReport, isTruthy, readJsonFile,
} from './check-regression.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const product = process.env.APP_PRODUCT || 'dahsha';
const dataDir = path.join(root, 'client', 'public', product === 'dahsha' ? 'data' : 'data-flixer');
const dataOut = path.join(dataDir, 'catalog.json');
const serverData = path.join(root, 'server', 'data');
const SNAPSHOT_URL = process.env.DATA_SNAPSHOT_URL || `https://github.com/FediMechergui/dahsha/releases/download/data-snapshot/${ARCHIVE}`;
// No shell: paths with spaces must reach the child process untouched.
const run = (cmd, args, opts = {}) => {
  const bin = cmd === 'node' ? process.execPath : (process.platform === 'win32' && !/\.exe$/i.test(cmd) ? `${cmd}.exe` : cmd);
  const r = spawnSync(bin, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) { console.error(`${cmd} ${args.join(' ')} failed (${r.error?.message || r.status})`); process.exit(r.status ?? 1); }
};
const fail = (message) => { console.error(`[vercel-build] ${message}`); process.exit(1); };
const serverEnv = { ...process.env, DATA_DIR: serverData };

async function restoreSnapshot() {
  console.log('[vercel-build] no exported data - restoring snapshot from', SNAPSHOT_URL);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-snapshot-'));
  try {
    const res = await fetch(SNAPSHOT_URL, { redirect: 'follow' });
    if (!res.ok) fail(`snapshot download failed: HTTP ${res.status}. The snapshot is written by the "Refresh catalogue & deploy" workflow; run it from GitHub Actions (do not upload a local snapshot).`);
    const archive = path.join(work, ARCHIVE);
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    const { manifest } = extractArchive(archive, serverData);
    console.log(`[vercel-build] restored snapshot generation ${manifest.generation}${manifest.savedAt ? ` (saved ${manifest.savedAt})` : ''}`);
    return manifest;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function guard({ generation, restoredCounts }) {
  const force = isTruthy(process.env.REGRESSION_FORCE);
  // Preview builds never reach production, so they only report.
  const enforce = process.env.VERCEL_ENV ? process.env.VERCEL_ENV === 'production' : true;
  const threshold = Number(process.env.REGRESSION_THRESHOLD ?? DEFAULT_THRESHOLD);
  const nextStatus = readJsonFile(path.join(dataDir, 'status.json'));
  const nextCatalog = readJsonFile(dataOut);
  const [live, liveMarker] = await Promise.all([fetchJson(`${LIVE_BASE}/data/status.json`), fetchJson(`${LIVE_BASE}/data/deploy.json`)]);
  if (live.error) console.warn(`[vercel-build] production status unreachable (${live.error}) - deploying without the size comparison`);
  const result = evaluate({ previous: live.value, previousLabel: 'live deploy', restored: restoredCounts, nextStatus, nextCatalogCounts: restoredCounts ? countCatalog(nextCatalog) : null, threshold, force });
  console.log(formatReport(result, { title: 'Dahsha build regression check' }));
  const age = compareGeneration(liveMarker.value, generation);
  if (!age.known) console.warn(`[vercel-build] snapshot generation comparison skipped (production ${age.live ?? liveMarker.error ?? 'has no marker'}, this build ${age.mine ?? 'unknown'})`);
  const problems = [
    ...result.regressions.map((r) => `${r.metric} drops from ${r.previous} to ${r.next} (vs ${r.check})`),
    ...(age.older ? [`production was built from snapshot generation ${age.live}, this build has generation ${age.mine}`] : []),
  ];
  if (!problems.length) return nextCatalog;
  if (force) { console.warn(`[vercel-build] REGRESSION_FORCE set - deploying despite: ${problems.join('; ')}`); return nextCatalog; }
  if (!enforce) { console.warn(`[vercel-build] preview build - would refuse production: ${problems.join('; ')}`); return nextCatalog; }
  fail(`refusing to deploy a smaller or older catalogue: ${problems.join('; ')}. Run the "Refresh catalogue & deploy" workflow, or set REGRESSION_FORCE=1 if this is intended.`);
}

const exported = fs.existsSync(dataOut) && readJsonFile(dataOut)?.product === product;
let generation = readManifest(serverData)?.generation ?? null;
let restoredCounts = null;
if (!exported) {
  generation = (await restoreSnapshot()).generation;
  if (product === 'dahsha') {
    restoredCounts = countCatalog(readJsonFile(path.join(serverData, 'catalog.json')));
    // Same export as the workflows, minus network: rebuild from cached rows, then export.
    run('node', [path.join(root, 'server', 'src', 'cli.js'), 'build'], { env: serverEnv });
  }
  run('node', [path.join(root, 'server', 'src', 'export.js'), '--cached'], { env: serverEnv });
}

let checkedCatalog = null;
if (product === 'dahsha' && process.env.REGRESSION_CHECKED !== '1') checkedCatalog = await guard({ generation, restoredCounts });

fs.copyFileSync(dataOut, path.join(root, 'server', `deployment-${product}.json`));
run('node', product === 'flixer'
  ? [path.join(root, 'scripts/build-terrarium.js'), '--out', 'client/dist-flixer']
  : [path.join(root, 'scripts/build-static.js')]);

if (product === 'dahsha') {
  // The workflows save the snapshot after deploying, so their data becomes generation + 1.
  const dataGeneration = generation === null ? null : generation + (process.env.DEPLOY_SNAPSHOT_PENDING === '1' ? 1 : 0);
  const builtBy = process.env.GITHUB_ACTIONS === 'true' ? `workflow:${process.env.GITHUB_WORKFLOW || 'unknown'}` : process.env.VERCEL ? 'vercel-git' : 'local';
  const marker = deployMarker({
    catalog: checkedCatalog || readJsonFile(dataOut),
    status: readJsonFile(path.join(dataDir, 'status.json')),
    generation: dataGeneration,
    builtBy,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || null,
  });
  const markerDir = path.join(root, 'client', 'dist', 'data');
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(path.join(markerDir, 'deploy.json'), JSON.stringify(marker));
  console.log(`[vercel-build] deploy marker: generation ${marker.dataGeneration ?? 'unknown'}, fingerprint ${marker.fingerprint.slice(0, 12)}`);
}
