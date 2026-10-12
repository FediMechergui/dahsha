// Builds the client in static mode (reads /data/*.json instead of the API).
//   node scripts/build-static.js [--out <dir>] [--data-base <url>] [--mobile]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const outDir = opt('--out', 'dist');
const dataBase = opt('--data-base', process.env.VITE_DATA_BASE || '');
const mobile = args.includes('--mobile');

const data = path.join(root, 'client', 'public', 'data', 'catalog.json');
if (!dataBase && !fs.existsSync(data)) {
  console.error('No exported data found (client/public/data/catalog.json). Run "npm run export" first, or pass --data-base <url>.');
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = { ...process.env, VITE_STATIC: '1', VITE_DATA_BASE: dataBase, VITE_MOBILE: mobile ? '1' : '' };
// --emptyOutDir: Vite refuses to clear an outDir outside its root (mobile/www) unless told to,
// which otherwise lets old hashed bundles pile up inside the APK.
const r = spawnSync(npm, ['run', 'build', '--', '--outDir', outDir, '--emptyOutDir', ...(mobile ? ['--base', './'] : [])], { cwd: path.join(root, 'client'), stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
