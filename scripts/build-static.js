import { configureMobile } from './configure-mobile.js';
// Builds the client in static mode (reads /data/*.json instead of the API).
//   node scripts/build-static.js [--out <dir>] [--data-base <url>] [--mobile]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const product = process.env.APP_PRODUCT || 'dahsha';
if (!['dahsha', 'flixer'].includes(product)) throw new Error('Invalid app product');
const outDir = opt('--out', product === 'dahsha' ? 'dist' : 'dist-flixer');
const dataBase = opt('--data-base', process.env.VITE_DATA_BASE || '');
const mobile = args.includes('--mobile');

const data = path.join(root, 'client', 'public', product === 'dahsha' ? 'data' : 'data-flixer', 'catalog.json');
if (!dataBase && !fs.existsSync(data)) {
  console.error('No exported data found. Run the matching export:dahsha or export:flixer command first, or pass --data-base <url>.');
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const apiBase = process.env.VITE_API_BASE || dataBase || '';
const env = { ...process.env, VITE_PRODUCT: product, VITE_STATIC: '1', VITE_DATA_BASE: dataBase, VITE_API_BASE: apiBase, VITE_MOBILE: mobile ? '1' : '' };
// --emptyOutDir: Vite refuses to clear an outDir outside its root (mobile/www) unless told to,
// which otherwise lets old hashed bundles pile up inside the APK.
const r = spawnSync(npm, ['run', 'build', '--', '--outDir', outDir, '--emptyOutDir', ...(mobile ? ['--base', './'] : [])], { cwd: path.join(root, 'client'), stdio: 'inherit', env, shell: process.platform === 'win32' });
if (r.status === 0 && mobile) configureMobile(product);
process.exit(r.status ?? 1);
