import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { writeCatalog } from '../src/export-catalog.js';

test('static title URLs resolve encoded filenames and the index omits full synopses', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flixer-static-'));
  const id = 'mf:m:example-title';
  writeCatalog(path.join(dir, 'data'), { shows: [{ id, kind: 'film', title: 'Example', synopsis: 'Full synopsis', episodes: [{ id, title: 'Example', synopsis: 'Episode synopsis' }] }] }, 'flixer');
  const app = express(); app.use(express.static(dir));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const detail = await fetch(`${base}/data/shows/${encodeURIComponent(encodeURIComponent(id))}.json`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).synopsis, 'Full synopsis');
  const index = await (await fetch(`${base}/data/catalog.json`)).json();
  assert.equal(index.shows[0].synopsis, undefined);
  assert.equal(index.shows[0].episodes[0].synopsis, undefined);
  assert.equal(index.stats.films, 1);
});
