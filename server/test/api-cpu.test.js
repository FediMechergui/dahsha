// Vercel blocked the Hobby team for serverless CPU on 2026-10-21: Dahsha's search and discovery run on
// the static catalogue, so their API routes answer at once without loading the catalogue or a provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fakeRes = () => {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
};

test('Dahsha /api/search and /api/discover answer 404 without doing any work', async (t) => {
  if ((process.env.APP_PRODUCT || 'dahsha') !== 'dahsha') return t.skip('Flixer build');
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('no network expected'); };
  t.after(() => { globalThis.fetch = realFetch; });
  for (const [name, query] of [['search', { q: 'nile' }], ['discover', { kind: 'film', page: '1' }]]) {
    const { default: handler } = await import(`../../api/${name}.js`);
    const res = fakeRes();
    const started = Date.now();
    await handler({ method: 'GET', query, headers: {} }, res);
    assert.equal(res.statusCode, 404, name);
    assert.match(res.headers['cache-control'], /s-maxage=86400/, `${name} is cached at the edge`);
    assert.ok(Date.now() - started < 200, `${name} returns at once`);
  }
});

test('the static client never calls the API for home, listings, search or discovery', () => {
  const src = fs.readFileSync(new URL('../../client/src/lib/api.js', import.meta.url), 'utf8');
  for (const route of ['home', 'movies', 'series', 'search', 'genres']) assert.ok(src.includes('live(`${API_BASE}/api/' + route), route);
  assert.ok(!src.includes('req(`${API_BASE}/api/search'), 'search never calls req directly');
  assert.ok(src.includes('if (STATIC) return Promise.resolve({ items: []'), 'discover');
  assert.match(fs.readFileSync(new URL('../../client/public/robots.txt', import.meta.url), 'utf8'), /^Disallow: \/api\/$/m);
});
