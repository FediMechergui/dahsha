// Offline deployment preflight. Uses the installed CLI's own config normalizer
// and packager; `netlify functions:build` currently ignores netlify.toml.
// Usage: node scripts/check-netlify-build.mjs <path-to-netlify-cli-package>
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliDirectory = process.argv[2] || process.env.NETLIFY_CLI_DIR;
if (!cliDirectory) throw Error('Pass the installed netlify-cli package directory, or set NETLIFY_CLI_DIR. No download or deployment is performed.');
const cli = path.resolve(cliDirectory);
const requireCLI = createRequire(path.join(cli, 'package.json'));
const { name, version } = JSON.parse(await fs.readFile(path.join(cli, 'package.json'), 'utf8'));
assert.equal(name, 'netlify-cli', 'Expected an installed netlify-cli package');
const load = name => import(pathToFileURL(requireCLI.resolve(name)).href);
const [{ resolveConfig }, { zipFunctions }, { normalizeFunctionsConfig }] = await Promise.all([
  load('@netlify/config'), load('@netlify/zip-it-and-ship-it'),
  import(pathToFileURL(path.join(cli, 'dist/lib/functions/config.js')).href),
]);
const { config } = await resolveConfig({ cwd: root, repositoryRoot: root, config: path.join(root, 'netlify.toml'), context: 'production', offline: true, buffer: true });
const functionsConfig = normalizeFunctionsConfig({ functionsConfig: config.functions, projectRoot: root, siteEnv: {} });
assert.match(functionsConfig['*'].nodeBundler, /^esbuild/, 'The production configuration must select esbuild');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dahsha-netlify-check-'));
try {
  const results = await zipFunctions(path.join(root, 'netlify/functions'), path.join(temp, 'bundles'), {
    basePath: root, config: functionsConfig,
    configFileDirectories: [path.join(root, '.netlify/functions-internal')],
  });
  assert.equal(results.length, 1, 'Expected only the lightweight Dahsha API');
  const result = results[0];
  assert.equal(result.name, 'dahsha-api');
  assert.equal(result.runtimeAPIVersion, 2, 'Request/Response handler requires API v2');
  assert.ok(result.routes?.some(route => route.pattern === '/api/*'), 'The function must own /api/*');
  const StreamZip = requireCLI('node-stream-zip');
  const archive = new StreamZip.async({ file: result.path });
  const extracted = path.join(temp, 'extracted');
  await fs.mkdir(extracted);
  let totalBytes = 0;
  try {
    const entries = Object.values(await archive.entries());
    for (const entry of entries) {
      const name = entry.name.replaceAll('\\', '/');
      assert.ok(!/(^|\/)(?:server\/data|client\/public\/data[^/]*|client\/dist[^/]*|client-terrarium\/data)(?:\/|$)|(^|\/)server\/deployment-[^/]+\.json$/.test(name), `Legacy catalogue included in function: ${name}`);
      totalBytes += entry.size;
    }
    assert.ok(totalBytes <= 20 * 1024 * 1024, `Function expanded to ${totalBytes} bytes`);
    await archive.extract(null, extracted);
  } finally { await archive.close(); }
  const entry = path.join(extracted, 'dahsha-api.mjs');
  await execute(process.execPath, ['--check', entry], { timeout: 30000 });
  const smoke = `
    import assert from 'node:assert/strict';
    globalThis.fetch = () => { throw Error('Health must not contact any upstream'); };
    const api = await import(${JSON.stringify(pathToFileURL(entry).href)});
    const response = await api.default(new Request('https://dahsha.netlify.app/api/health'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {ok:true,service:'dahsha-api',product:'dahsha',hosting:'netlify',catalogue:'independent-publication'});
    assert.equal((await api.default(new Request('https://dahsha.netlify.app/api/unknown'))).status, 404);
  `;
  await execute(process.execPath, ['--input-type=module', '-e', smoke], {
    cwd: extracted, timeout: 30000,
    env: { ...process.env, APP_PRODUCT: 'dahsha', AWS_LAMBDA_FUNCTION_NAME: 'dahsha-api', DATA_DIR: path.join(temp, 'runtime-cache') },
  });
  console.log(JSON.stringify({ ok: true, cliVersion: version, configuredBundler: functionsConfig['*'].nodeBundler, actualBundler: result.nodeBundler, archiveBytes: (await fs.stat(result.path)).size, expandedBytes: totalBytes, runtimeAPIVersion: result.runtimeAPIVersion, routes: result.routes, syntax: 'passed', health: 'passed without upstream requests', legacyCatalogues: 'excluded' }, null, 2));
} finally {
  // This path is created here by mkdtemp, never supplied by a caller.
  assert.ok(path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('dahsha-netlify-check-'));
  await fs.rm(temp, { recursive: true, force: true });
}
