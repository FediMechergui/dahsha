import test from 'node:test';
import assert from 'node:assert/strict';

test('Flixer starts independently and accepts the same title URL as Vercel', async t => {
  process.env.APP_PRODUCT = 'flixer';
  const { app } = await import('../src/index.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.product, 'flixer');
  assert.equal((await fetch(`${base}/api/genres`)).status, 200);
  assert.equal((await fetch(`${base}/api/title?id=invalid`)).status, 404);
  assert.equal((await fetch(`${base}/api/title/invalid`)).status, 404);
  assert.equal((await fetch(`${base}/api/sources`)).status, 404);
});
