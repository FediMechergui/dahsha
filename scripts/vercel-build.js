// Vercel build: make the deployment self-sufficient even when triggered by a git push.
//   1. If client/public/data is missing, download the latest data snapshot (public GitHub release
//      asset maintained by the refresh workflow) into server/data and export the static JSON.
//   2. Build the client in static mode.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const product = process.env.APP_PRODUCT || 'dahsha';
const dataOut = path.join(root, 'client', 'public', product === 'dahsha' ? 'data' : 'data-flixer', 'catalog.json');
const serverData = path.join(root, 'server', 'data');
const SNAPSHOT_URL = process.env.DATA_SNAPSHOT_URL || 'https://github.com/FediMechergui/dahsha/releases/download/data-snapshot/data-snapshot.tar.gz';
// No shell: paths with spaces must reach the child process untouched.
const run = (cmd, args, opts = {}) => {
  const bin = cmd === 'node' ? process.execPath : (process.platform === 'win32' && !/\.exe$/i.test(cmd) ? `${cmd}.exe` : cmd);
  const r = spawnSync(bin, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) { console.error(`${cmd} ${args.join(' ')} failed (${r.error?.message || r.status})`); process.exit(r.status ?? 1); }
};

const exported = fs.existsSync(dataOut) && JSON.parse(fs.readFileSync(dataOut, 'utf8')).product === product;
if (!exported) {
  console.log('[vercel-build] no exported data - restoring snapshot from', SNAPSHOT_URL);
  const archive = path.join(root, 'data-snapshot.tar.gz');
  const res = await fetch(SNAPSHOT_URL, { redirect: 'follow' });
  if (!res.ok) { console.error(`[vercel-build] snapshot download failed: HTTP ${res.status}. Run "npm run snapshot:save" once.`); process.exit(1); }
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  fs.mkdirSync(serverData, { recursive: true });
  const listing = spawnSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-tzf', archive], { encoding: 'utf8' });
  const allowed = new Set(['playlists.json', 'details.json', 'seen.json', 'catalog.json', 'artwork.json', 'flixer-catalog.json', ...['dahsha','flixer'].flatMap(p=>[`providers-${p}.json`,`provider-aliases-${p}.json`,`provider-identities-${p}.json`,`provider-matches-${p}.json`])]);
  if (listing.status !== 0 || listing.stdout.trim().split(/\r?\n/).some(name => !allowed.has(name.replace(/^\.\//, '')))) throw new Error('Invalid snapshot archive entries');
  run('tar', ['-xzf', archive, '-C', serverData, '--no-same-owner', '--no-same-permissions']);
  fs.rmSync(archive, { force: true });
  run('node', [path.join(root, 'server', 'src', 'export.js'),'--cached'], {env:{...process.env,DATA_DIR:serverData}});
}

fs.copyFileSync(dataOut,path.join(root,'server',`deployment-${product}.json`));
run('node', [path.join(root, 'scripts', 'build-static.js')]);
