import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchMovies, fetchFullCatalog } from '../src/myflixer.js';
import { fetchMyflixerCatalog } from '../src/documentaries.js';
import { writeCatalog } from '../src/export-catalog.js';

test('year taxonomy is applied and pagination inputs are bounded', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input); urls.push(url);
    const rows = url.pathname.includes('release-year') ? [{ id: 202, name: '2026' }] : [];
    return Response.json(rows, { headers: { 'x-wp-totalpages': '1' } });
  });
  await fetchMovies({ year: 2026, page: -10, perPage: 10000 });
  const url = urls.at(-1);
  assert.equal(url.searchParams.get('release-year'), '202');
  assert.equal(url.searchParams.get('page'), '1');
  assert.equal(url.searchParams.get('per_page'), '100');
});

test('Flixer walks every page and keeps films and series with identical slugs', async t => {
  const requested = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.pathname.includes('release-year')) return Response.json([]);
    const page = Number(url.searchParams.get('page'));
    requested.push(`${url.pathname}:${page}`);
    return Response.json([{ id: page, slug: `shared-${page}`, title: { rendered: 'Title' }, categories: [39], date: '2026-01-01' }], { headers: { 'x-wp-totalpages': '3', 'x-wp-total': '3' } });
  });
  const result = await fetchFullCatalog({ episodeLimit: 0 });
  assert.equal(result.shows.length, 6);
  assert.equal(result.product, 'flixer');
  assert.equal(requested.length, 6);
  assert.equal(result.shows[0].latestAt, '2026-01-01');
});

test('Dahsha requests documentary category and rejects unrelated upstream results', async t => {
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.pathname.includes('release-year')) return Response.json([]);
    assert.equal(url.searchParams.get('categories'), '212');
    const rows = url.pathname.endsWith('/posts') ? [
      { id: 1, slug: 'documentary', title: { rendered: 'Documentary' }, categories: [212] },
      { id: 2, slug: 'action-movie', title: { rendered: 'Action Movie' }, categories: [39] },
    ] : [];
    return Response.json(rows, { headers: { 'x-wp-totalpages': '1' } });
  });
  const result = await fetchMyflixerCatalog({});
  assert.deepEqual(result.films.map(s => s.slug), ['documentary']);
  assert.equal(result.series.length, 0);
});

test('upstream errors cannot produce a successful empty catalogue', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status: 503 }));
  await assert.rejects(fetchFullCatalog(), /503/);
});

test('exports preserve existing data on empty results and separate language sections', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-export-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'data');
  fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'marker'), 'keep');
  assert.throws(() => writeCatalog(out, { shows: [] }, 'dahsha'), /empty/);
  assert.equal(fs.readFileSync(path.join(out, 'marker'), 'utf8'), 'keep');
  writeCatalog(out, { generatedAt: '2026-01-01', shows: [{ id: 'ar', lang: 'ar' }, { id: 'en', lang: 'en' }] }, 'dahsha');
  const ar = JSON.parse(fs.readFileSync(path.join(out, 'catalog.ar.json')));
  assert.equal(ar.product, 'dahsha');
  assert.deepEqual(ar.shows.map(s => s.id), ['ar']);
  assert.ok(fs.existsSync(path.join(out, 'shows/en.json')));
});

test('Flixer exports retain universe and streaming service metadata across refreshes',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flixer-metadata-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const catalog={shows:[{id:'mf:m:example',kind:'film',title:'Example'}]};
  writeCatalog(dir,catalog,'flixer');
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir,'universes.json'))).universes.length>0);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir,'services.json'))).services.length>0);
  fs.writeFileSync(path.join(dir,'services.json'),JSON.stringify({services:[{name:'Custom service',logo:'https://example.com/logo.svg'}]}));
  writeCatalog(dir,catalog,'flixer');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'services.json'))).services[0].name,'Custom service');
});
