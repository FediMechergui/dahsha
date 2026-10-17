import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-poll-'));
process.env.DATA_DIR = dir;
const { Catalogue } = await import('../src/scheduler.js');
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const source = { type: 'channel', id: 'example', lang: 'en' };
const make = () => {
  const c = new Catalogue();
  c.sources = [source]; c.playlists = {}; c.details = {}; c.seen = {};
  c.rebuild = () => ({ newEpisodes: [{ id: 'abcdefghijk' }], newShows: [] });
  c.refresh = () => { throw new Error('Poll must not perform a full provider refresh'); };
  return c;
};

test('RSS poll ingests uploads directly with source language and publish date', async () => {
  const c = make();
  const date = '2026-10-17T10:00:00Z';
  const result = await c.fastPoll({
    fetchFeed: async (id, options) => {
      assert.equal(options.lang, 'en');
      return [{ id: 'abcdefghijk', title: 'New film', published: date }];
    },
    fetchDetails: async (id, options) => {
      assert.equal(options.lang, 'en');
      return { id, durationSec: 1200, publishedAt: null };
    },
  });
  assert.equal(result.newEpisodes.length, 1);
  assert.equal(c.playlists['UPLOADS:example'].videos[0].durationSec, 1200);
  assert.equal(c.details.abcdefghijk.publishedAt, date);
  assert.ok(c.seen.abcdefghijk);
});

test('empty feeds fail with the workflow ingestion exit-code signal', async () => {
  const c = make();
  await assert.rejects(c.fastPoll({ fetchFeed: async () => [] }), { code: 'INGESTION_EMPTY' });
});

test('failed detail requests are retried on the next poll', async () => {
  const c = make();
  const fetchFeed = async () => [{ id: 'lmnopqrstuv', title: 'Retry me' }];
  await assert.rejects(c.fastPoll({ fetchFeed, fetchDetails: async () => { throw new Error('Temporary failure'); } }), /retry/);
  await c.fastPoll({ fetchFeed, fetchDetails: async id => ({ id, durationSec: 900 }) });
  assert.equal(c.playlists['UPLOADS:example'].videos.length, 1);
});
