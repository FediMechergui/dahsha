// Vercel build: make the deployment self-sufficient even when triggered by a git push.
//   1. If client/public/data is missing, download the latest data snapshot (public GitHub release
//      asset maintained by the refresh workflow) into server/data and export the static JSON.
//   2. Build the client in static mode.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataOut = path.join(root, 'client', 'public', 'data', 'catalog.ar.json');
const serverData = path.join(root, 'server', 'data');
const SNAPSHOT_URL = process.env.DATA_SNAPSHOT_URL || 'https://github.com/FediMechergui/dahsha/releases/download/data-snapshot/data-snapshot.tar.gz';
// No shell: paths with spaces must reach the child process untouched.
const run = (cmd, args, opts = {}) => {
  const bin = cmd === 'node' ? process.execPath : (process.platform === 'win32' && !/\.exe$/i.test(cmd) ? `${cmd}.exe` : cmd);
  const r = spawnSync(bin, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) { console.error(`${cmd} ${args.join(' ')} failed (${r.error?.message || r.status})`); process.exit(r.status ?? 1); }
};

if (!fs.existsSync(dataOut)) {
  console.log('[vercel-build] no exported data - restoring snapshot from', SNAPSHOT_URL);
  const archive = path.join(root, 'data-snapshot.tar.gz');
  const res = await fetch(SNAPSHOT_URL, { redirect: 'follow' });
  if (!res.ok) { console.error(`[vercel-build] snapshot download failed: HTTP ${res.status}. Run "npm run snapshot:save" once.`); process.exit(1); }
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  fs.mkdirSync(serverData, { recursive: true });
  run('tar', ['-xzf', archive, '-C', serverData]);
  fs.rmSync(archive, { force: true });
  run('node', [path.join(root, 'server', 'src', 'export.js')]);
}

run('node', [path.join(root, 'scripts', 'build-static.js')]);
