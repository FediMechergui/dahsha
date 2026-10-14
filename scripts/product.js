// Cross-platform product commands without shell-specific environment assignments.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [product, command, ...args] = process.argv.slice(2);
if (!['dahsha', 'flixer'].includes(product)) throw new Error('Choose dahsha or flixer');
const env = { ...process.env, APP_PRODUCT: product, VITE_PRODUCT: product };
const run = (file, extra = []) => {
  const result = spawnSync(process.execPath, [path.join(root, file), ...extra], { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
switch (command) {
  case 'dev': run('scripts/dev.js', args); break;
  case 'start':
    run('client/node_modules/vite/bin/vite.js', ['build', '--config', 'client/vite.config.js', 'client']);
    run('server/src/index.js', args); break;
  case 'server': run('server/src/index.js', args); break;
  case 'export': run('server/src/export.js', args); break;
  case 'build': run('scripts/build-static.js', args); break;
  case 'vercel': run('scripts/vercel-build.js', args); break;
  case 'mobile-web': run('scripts/build-static.js', ['--mobile', '--out', '../mobile/www', ...args]); break;
  default: throw new Error(`Unknown product command: ${command}`);
}
