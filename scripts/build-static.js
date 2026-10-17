import { configureMobile } from './configure-mobile.js';
// Builds the client in static mode (reads /data/*.json instead of the API).
//   node scripts/build-static.js [--out <dir>] [--data-base <url>] [--mobile]
// A Dahsha --mobile build reads data and /api from the hosted site (MOBILE_DATA_BASE, default
// https://dahsha.vercel.app) unless --data-base is given: bundling would copy the whole exported
// catalogue into the APK, freeze it there, and point /api at a server the phone does not have.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MOBILE_DATA_BASE = 'https://dahsha.vercel.app';

export function resolveBases(args, env = process.env, product = 'dahsha') {
  const mobile = args.includes('--mobile');
  const i = args.indexOf('--data-base');
  let dataBase = i >= 0 ? (args[i + 1] ?? '') : (env.VITE_DATA_BASE || '');
  // An explicit --data-base (even an empty one) is respected; only the implicit default changes.
  if (mobile && product === 'dahsha' && i < 0 && !env.VITE_DATA_BASE) dataBase = env.MOBILE_DATA_BASE || MOBILE_DATA_BASE;
  return { mobile, dataBase, apiBase: env.VITE_API_BASE || dataBase || '' };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
  const product = process.env.APP_PRODUCT || 'dahsha';
  if (!['dahsha', 'flixer'].includes(product)) throw new Error('Invalid app product');
  const outDir = opt('--out', product === 'dahsha' ? 'dist' : 'dist-flixer');
  const { mobile, dataBase, apiBase } = resolveBases(args, process.env, product);
  if(product==='flixer'){
    const build=spawnSync(process.execPath,[path.join(root,'scripts/build-terrarium.js'),'--out',path.resolve(root,'client',outDir),'--data-base',dataBase,...(mobile?['--mobile']:[])],{cwd:root,env:process.env,stdio:'inherit'});
    process.exit(build.status ?? 1);
  }

  const data = path.join(root, 'client', 'public', product === 'dahsha' ? 'data' : 'data-flixer', 'catalog.json');
  if (!dataBase && !fs.existsSync(data)) {
    console.error('No exported data found. Run the matching export:dahsha or export:flixer command first, or pass --data-base <url>.');
    process.exit(1);
  }
  if (mobile) console.log(dataBase ? `[build] mobile build reads data and API from ${dataBase}` : '[build] mobile build bundles the exported catalogue (explicit empty --data-base)');

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const env = { ...process.env, VITE_PRODUCT: product, VITE_STATIC: '1', VITE_DATA_BASE: dataBase, VITE_API_BASE: apiBase, VITE_MOBILE: mobile ? '1' : '' };
  // --emptyOutDir: Vite refuses to clear an outDir outside its root (mobile/www) unless told to,
  // which otherwise lets old hashed bundles pile up inside the APK.
  const r = spawnSync(npm, ['run', 'build', '--', '--outDir', outDir, '--emptyOutDir', ...(mobile ? ['--base', './'] : [])], { cwd: path.join(root, 'client'), stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (r.status === 0 && mobile) configureMobile(product);
  process.exit(r.status ?? 1);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invoked) main();
