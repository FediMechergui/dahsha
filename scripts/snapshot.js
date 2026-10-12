// Saves / restores the server's cached data (playlists, details, seen, catalog) as a GitHub Release
// asset, so CI refreshes are incremental instead of re-scanning ~30k videos from scratch.
//   node scripts/snapshot.js save      -> uploads server/data snapshot to release "data-snapshot"
//   node scripts/snapshot.js restore   -> downloads it into server/data (no-op if absent)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'server', 'data');
const TAG = 'data-snapshot';
const FILES = ['playlists.json', 'details.json', 'seen.json', 'catalog.json', 'artwork.json'];
const archive = path.join(root, 'data-snapshot.tar.gz');
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
const mode = process.argv[2];

if (mode === 'save') {
  const present = FILES.filter((f) => fs.existsSync(path.join(dataDir, f)));
  if (!present.length) { console.error('nothing to snapshot'); process.exit(1); }
  if (sh('tar', ['-czf', archive, '-C', dataDir, ...present]).status !== 0) process.exit(1);
  const exists = spawnSync('gh', ['release', 'view', TAG], { shell: process.platform === 'win32' }).status === 0;
  if (!exists && sh('gh', ['release', 'create', TAG, '--title', 'Data snapshot (auto)', '--notes', 'Cached YouTube metadata used by the refresh job. Updated automatically.', '--latest=false']).status !== 0) process.exit(1);
  if (sh('gh', ['release', 'upload', TAG, archive, '--clobber']).status !== 0) process.exit(1);
  fs.rmSync(archive, { force: true });
  console.log(`snapshot saved (${present.join(', ')})`);
} else if (mode === 'restore') {
  fs.mkdirSync(dataDir, { recursive: true });
  const r = sh('gh', ['release', 'download', TAG, '--pattern', 'data-snapshot.tar.gz', '--dir', root, '--clobber']);
  if (r.status !== 0 || !fs.existsSync(archive)) { console.log('no snapshot available - starting from scratch'); process.exit(0); }
  if (sh('tar', ['-xzf', archive, '-C', dataDir]).status !== 0) process.exit(1);
  fs.rmSync(archive, { force: true });
  console.log('snapshot restored');
} else {
  console.error('usage: node scripts/snapshot.js save|restore');
  process.exit(1);
}
