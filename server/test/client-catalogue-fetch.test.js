import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithCatalogueTransport } from '../../client/src/lib/catalogue-fetch.js';

const apiBase = 'https://dahsha.netlify.app';
const fixture = () => {
  const calls = [];
  const scope = {
    location: { href: 'https://localhost/', origin: 'https://localhost' },
    Capacitor: { isNativePlatform: () => true },
    fetch(url, options) { assert.equal(this, scope); calls.push({ transport: 'native', url, options }); return Promise.resolve('native'); },
    CapacitorWebFetch(url, options) { assert.equal(this, scope); calls.push({ transport: 'browser', url, options }); return Promise.resolve('browser'); },
  };
  return { scope, calls };
};

test('native catalogue requests stream through browser fetch with options and hash pin unchanged', async () => {
  const { scope, calls } = fixture();
  const signal = new AbortController().signal;
  const url = `${apiBase}/api/catalogue?part=index-en-0000&sha=${'a'.repeat(64)}`;
  const options = { signal, cache: 'no-cache', headers: { Accept: 'application/json' } };
  assert.equal(await fetchWithCatalogueTransport(url, options, { apiBase, scope }), 'browser');
  assert.deepEqual(calls.map(x => x.transport), ['browser']);
  assert.equal(calls[0].url, url);
  assert.equal(calls[0].options, options);
  assert.equal(calls[0].options.signal, signal);
});

test('provider, playback, other origin and write requests retain their existing transport', async () => {
  const { scope, calls } = fixture();
  const cases = [
    [`${apiBase}/api/stream?id=episode`],
    [`${apiBase}/api/title?id=title`],
    ['https://f-movies.org/api/catalogue'],
    ['https://dahsha.netlify.app.example/api/catalogue'],
    ['https://dahsha.netlify.app:444/api/catalogue'],
    ['https://account@dahsha.netlify.app/api/catalogue'],
    ['http://dahsha.netlify.app/api/catalogue'],
    [`${apiBase}/api/catalogue/extra`],
    [`${apiBase}/api/catalogue`, { method: 'POST' }],
  ];
  for (const [url, options] of cases) assert.equal(await fetchWithCatalogueTransport(url, options, { apiBase, scope }), 'native');
  assert.equal(calls.length, cases.length);
  assert.ok(calls.every(x => x.transport === 'native'));
});

test('web browsers, older native clients and other products keep ordinary fetch', async () => {
  const url = `${apiBase}/api/catalogue?part=manifest`;
  const browser = fixture(); browser.scope.Capacitor.isNativePlatform = () => false;
  assert.equal(await fetchWithCatalogueTransport(url, {}, { apiBase, scope: browser.scope }), 'native');
  const older = fixture(); delete older.scope.CapacitorWebFetch;
  assert.equal(await fetchWithCatalogueTransport(url, {}, { apiBase, scope: older.scope }), 'native');
  const disabled = fixture();
  assert.equal(await fetchWithCatalogueTransport(url, {}, { apiBase, enabled: false, scope: disabled.scope }), 'native');
});

test('browser abort and network failures propagate without duplicate native requests', async () => {
  for (const error of [new DOMException('Aborted', 'AbortError'), new TypeError('Network unavailable')]) {
    const { scope, calls } = fixture();
    scope.CapacitorWebFetch = () => Promise.reject(error);
    await assert.rejects(fetchWithCatalogueTransport(`${apiBase}/api/catalogue?part=manifest`, {}, { apiBase, scope }), actual => actual === error);
    assert.equal(calls.length, 0, 'a failed catalogue request must not be silently retried through another transport');
  }
});

test('streaming responses are returned unchanged for the existing body reader and stall timer', async () => {
  const { scope } = fixture();
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"product":"dahsha"}')); controller.close(); } }), { status: 200 });
  scope.CapacitorWebFetch = async () => response;
  const actual = await fetchWithCatalogueTransport(`${apiBase}/api/catalogue?part=status`, {}, { apiBase, scope });
  assert.equal(actual, response);
  assert.deepEqual(await actual.json(), { product: 'dahsha' });
});
