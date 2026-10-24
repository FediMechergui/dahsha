// The site and its data moved to Netlify after Vercel blocked the Hobby team (2026-10-21); the
// serverless API (provider titles and playback) stays on Vercel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveBases, MOBILE_DATA_BASE, MOBILE_API_BASE } from '../../scripts/build-static.js';
import { LIVE_BASE } from '../../scripts/check-regression.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the Android app reads data from Netlify and calls the API on Vercel', () => {
  assert.equal(MOBILE_DATA_BASE, 'https://dahsha.netlify.app');
  assert.equal(MOBILE_API_BASE, 'https://dahsha.vercel.app');
  assert.deepEqual(resolveBases(['--mobile'], {}), { mobile: true, dataBase: MOBILE_DATA_BASE, apiBase: MOBILE_API_BASE });
  // android.yml passes the hosted base explicitly; it still gets the Vercel API.
  assert.equal(resolveBases(['--mobile', '--data-base', 'https://dahsha.netlify.app/'], {}).apiBase, MOBILE_API_BASE);
  // Any other data host keeps serving its own /api, and explicit settings win.
  assert.equal(resolveBases(['--mobile', '--data-base', 'http://10.0.2.2:4545'], {}).apiBase, 'http://10.0.2.2:4545');
  assert.equal(resolveBases(['--mobile'], { VITE_API_BASE: 'https://api.example' }).apiBase, 'https://api.example');
  // The web build serves its own data; CI points its API at Vercel with VITE_API_BASE.
  assert.deepEqual(resolveBases([], {}), { mobile: false, dataBase: '', apiBase: '' });
  assert.equal(resolveBases([], { VITE_API_BASE: MOBILE_API_BASE }).apiBase, MOBILE_API_BASE);
});

test('production checks and the freshness alert read the Netlify site', () => {
  assert.equal(LIVE_BASE, process.env.DAHSHA_LIVE_URL || 'https://dahsha.netlify.app');
  assert.match(read('.github/workflows/keepalive.yml'), /SITE_URL: https:\/\/dahsha\.netlify\.app/);
  assert.match(read('.github/workflows/android.yml'), /vars\.DATA_BASE \|\| 'https:\/\/dahsha\.netlify\.app'/);
});

test('the workflows deploy to Netlify and keep the API on Vercel', () => {
  for (const name of ['refresh.yml', 'poll.yml']) {
    const text = read(`.github/workflows/${name}`);
    assert.match(text, /- name: Build & deploy to Netlify/, name);
    assert.match(text, /NETLIFY_AUTH_TOKEN: \$\{\{ secrets\.NETLIFY_AUTH_TOKEN \}\}/, name);
    assert.match(text, /VITE_API_BASE: https:\/\/dahsha\.vercel\.app/, name);
    assert.match(text, /netlify-cli@\d+\.\d+\.\d+ deploy --prod --no-build --dir client\/dist/, name);
    assert.doesNotMatch(text, /vercel deploy|VERCEL_TOKEN/, name);
  }
});

test('the Netlify build carries the SPA rewrite and the data headers', () => {
  const redirects = read('client/public/_redirects');
  assert.match(redirects, /^\/\*\s+\/index\.html\s+200$/m);
  assert.match(redirects, /^\/api\/\*\s+https:\/\/dahsha\.vercel\.app\/api\/:splat\s+302$/m);
  const headers = read('client/public/_headers');
  assert.match(headers, /^\/data\/\*\n {2}Access-Control-Allow-Origin: \*$/m, 'the Android WebView reads /data cross-origin');
  for (const file of ['catalog.json', 'catalog.ar.json', 'catalog.en.json']) assert.match(headers, new RegExp(`^/data/${file.replace(/\./g, '\\.')}\\n {2}Cache-Control: public, max-age=600`, 'm'));
  assert.match(read('client/vite.config.js'), /'robots\.txt', '_headers', '_redirects'\]/, 'copied into client/dist');
});
