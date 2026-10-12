// Runs the API server and the Vite dev server together (no extra dependency needed).
// PORT (if set by a launcher) is the UI port; the API always uses API_PORT (default 4545).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const API_PORT = process.env.API_PORT || '4545';
const UI_PORT = process.env.PORT || '5173';

function run(name, cwd, args, color, env) {
  const p = spawn(npm, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', env: { ...process.env, FORCE_COLOR: '1', ...env } });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream) => stream.on('data', (d) => process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => tag + l).join('\n') + '\n'));
  pipe(p.stdout); pipe(p.stderr);
  p.on('exit', (code) => { console.log(`${tag}exited (${code})`); process.exit(code ?? 0); });
  return p;
}

const server = run('api', path.join(root, 'server'), ['run', 'dev'], '33', { PORT: API_PORT });
const client = run('web', path.join(root, 'client'), ['run', 'dev'], '36', { PORT: UI_PORT, API_PORT });

const stop = () => { server.kill(); client.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
