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

test('poll keeps the listing language of an existing uploads record and marks a new one as never walked', async () => {
  const c = make();
  c.playlists['UPLOADS:example'] = { id: 'UPLOADS:example', title: '__uploads__', isUploads: true, sourceId: 'example', listedLang: 'en', videos: [{ id: 'aaaaaaaaaaa', title: 'Old' }] };
  await c.fastPoll({ fetchFeed: async () => [{ id: 'bbbbbbbbbbb', title: 'New' }], fetchDetails: async id => ({ id, durationSec: 900 }) });
  assert.equal(c.playlists['UPLOADS:example'].listedLang, 'en');
  assert.deepEqual(c.playlists['UPLOADS:example'].videos.map(v => v.id), ['bbbbbbbbbbb', 'aaaaaaaaaaa']);
  const fresh = make();
  await fresh.fastPoll({ fetchFeed: async () => [{ id: 'ccccccccccc', title: 'First' }], fetchDetails: async id => ({ id, durationSec: 900 }) });
  assert.equal(fresh.playlists['UPLOADS:example'].listedLang, null);
});

test('poll skips Shorts and known clips without a request, remembers fetched clips, and keeps episodes past the cap', async () => {
  const c = make();
  c.sources = [{ ...source, maxUploads: 2 }];
  c.details = { knownclip01: { id: 'knownclip01', durationSec: 95 }, oldepisode1: { id: 'oldepisode1', durationSec: 2700 }, oldclip0001: { id: 'oldclip0001', durationSec: 60 } };
  c.playlists['UPLOADS:example'] = { id: 'UPLOADS:example', title: '__uploads__', isUploads: true, sourceId: 'example', listedLang: 'en',
    videos: [{ id: 'oldepisode1', title: 'Old', durationSec: 2700 }, { id: 'oldclip0001', title: 'Old clip', durationSec: 60 }] };
  const requested = [];
  const feed = [
    { id: 'shortvideo1', title: 'A short', published: null, short: true },
    { id: 'knownclip01', title: 'Known clip', published: null, short: false },
    { id: 'freshclip01', title: 'Fresh clip', published: null, short: false },
    { id: 'newepisode1', title: 'New episode', published: '2026-10-18T00:00:00Z', short: false },
  ];
  await c.fastPoll({ fetchFeed: async () => feed, fetchDetails: async (id) => { requested.push(id); return { id, durationSec: id === 'freshclip01' ? 120 : 1800 }; } });
  assert.deepEqual(requested.sort(), ['freshclip01', 'newepisode1']);
  // The new episode goes first; past maxUploads (2) the old episode stays and the old clip is trimmed.
  assert.deepEqual(c.playlists['UPLOADS:example'].videos.map(v => v.id), ['newepisode1', 'oldepisode1']);
  assert.equal(c.playlists['UPLOADS:example'].videos[0].short, undefined, 'the feed flag is not stored');
  assert.equal(c.details.freshclip01.durationSec, 120, 'a fetched clip is remembered');
  // Next poll: nothing to request, and no failure although nothing new is added.
  requested.length = 0;
  const diff = await c.fastPoll({ fetchFeed: async () => feed, fetchDetails: async (id) => { requested.push(id); return { id, durationSec: 1800 }; } });
  assert.deepEqual(requested, []);
  assert.deepEqual(diff, { newShows: [], newEpisodes: [] });
});

test('a poll whose only new videos turn out to be clips stores their details and does not fail', async () => {
  const c = make();
  const diff = await c.fastPoll({ fetchFeed: async () => [{ id: 'freshclip02', title: 'Clip', short: false }], fetchDetails: async (id) => ({ id, durationSec: 200 }) });
  assert.deepEqual(diff, { newShows: [], newEpisodes: [] });
  assert.equal(c.playlists['UPLOADS:example'], undefined);
  assert.equal(c.details.freshclip02.durationSec, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'details.json'), 'utf8'));
  assert.equal(saved.freshclip02.durationSec, 200);
});

const captureLogs = (t) => {
  const lines = [];
  t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
  t.mock.method(console, 'warn', (...a) => lines.push(a.join(' ')));
  return lines;
};

test('an answer without a duration is neither stored nor added, is logged, and is asked again on the next poll', async (t) => {
  const logs = captureLogs(t);
  const c = make();
  let rebuilds = 0;
  c.rebuild = () => { rebuilds++; return { newEpisodes: [{ id: 'freshupload' }], newShows: [] }; };
  const fetchFeed = async () => [{ id: 'freshupload', title: 'Kingdom of the Mummies', published: '2026-10-18T13:00:10Z', short: false }];
  const requested = [];
  const stubs = [
    { id: 'freshupload', title: '', description: '', durationSec: 0, fallback: true, playerError: 'no videoDetails (UNPLAYABLE: Video unavailable)' },
    { id: 'freshupload', title: '', durationSec: 0 }, // no title and no duration, whatever the path
    { id: 'freshupload', title: 'Kingdom of the Mummies', durationSec: 0, fallback: true }, // a title alone is not enough from the fallback
    { id: 'freshupload', gone: true, status: 'ERROR', reason: 'This video is unavailable' }, // gone answers are not stored by the poll
  ];
  for (const answer of stubs) {
    const diff = await c.fastPoll({ fetchFeed, fetchDetails: async (id) => { requested.push(id); return answer; } });
    assert.deepEqual(diff, { newShows: [], newEpisodes: [] }, 'an answer without data does not fail the poll');
    assert.equal(c.details.freshupload, undefined, JSON.stringify(answer));
    assert.equal(c.playlists['UPLOADS:example'], undefined);
    assert.equal(c.seen.freshupload, undefined);
  }
  assert.equal(requested.length, 4, 'asked again on every poll');
  assert.equal(rebuilds, 0);
  assert.ok(logs.some((l) => l === '[poll] details freshupload of example (example): no duration or title (no videoDetails (UNPLAYABLE: Video unavailable)); not stored, asked again on the next poll'), logs.join('\n'));
  assert.ok(logs.some((l) => /^\[poll\] details freshupload of example \(example\): no duration \(getBasicInfo fallback\); not stored/.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => /^\[poll\] details freshupload of example \(example\): YouTube says ERROR: This video is unavailable; not added/.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => /^\[poll\] details: 0 added, 0 listed videos got their duration, 0 clips, 1 without usable details, 0 failed$/.test(l)), logs.join('\n'));
  const onDisk = fs.existsSync(path.join(dir, 'details.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'details.json'), 'utf8')) : {};
  assert.equal(onDisk.freshupload, undefined, 'never written to details.json');
  // Once /player answers, the upload becomes an episode.
  const diff = await c.fastPoll({ fetchFeed, fetchDetails: async (id) => ({ id, title: 'Kingdom of the Mummies', durationSec: 2664, publishedAt: '2026-10-18T06:00:10-07:00', embeddable: true }) });
  assert.equal(diff.newEpisodes.length, 1);
  assert.equal(rebuilds, 1);
  assert.deepEqual(c.playlists['UPLOADS:example'].videos.map((v) => [v.id, v.durationSec]), [['freshupload', 2664]]);
  assert.deepEqual([c.details.freshupload.durationSec, c.details.freshupload.publishedAt, c.details.freshupload.embeddable], [2664, '2026-10-18T06:00:10-07:00', true]);
  assert.ok(c.details.freshupload.checkedAt);
});

test('a listed feed entry whose stored details are a stub or lack a duration is asked again and becomes an episode once answered', async (t) => {
  const logs = captureLogs(t);
  const c = make();
  let rebuilds = 0;
  c.rebuild = () => { rebuilds++; return { newEpisodes: [{ id: 'listedstub1' }], newShows: [] }; };
  // Written by a poll before this fix: the row has no duration and the details are an empty fallback.
  const rows = [{ id: 'listedstub1', title: 'Old stub', published: '2026-10-17T10:00:00Z', durationSec: 0 }, { id: 'listedgood1', title: 'Good', durationSec: 0 }, { id: 'premiere001', title: 'Premiere', durationSec: 0 }];
  c.playlists['UPLOADS:example'] = { id: 'UPLOADS:example', title: '__uploads__', isUploads: true, sourceId: 'example', listedLang: 'en', videos: rows };
  const stub = { id: 'listedstub1', title: '', durationSec: 0, fallback: true, publishedAt: '2026-10-17T10:00:00Z', fetchedAt: '2026-10-17T10:37:00Z' };
  c.details = { listedstub1: stub, listedgood1: { id: 'listedgood1', title: 'Good', durationSec: 1800 }, premiere001: { id: 'premiere001', title: 'Premiere', durationSec: 0, isLiveContent: true } };
  const fetchFeed = async () => [...rows.map((r) => ({ id: r.id, title: r.title, published: r.published || null, short: false })), { id: 'knownshort1', title: 'Short', short: true }];
  const requested = [];
  // Still nothing from YouTube: the stored stub stays as it is, nothing is rebuilt, the poll does not fail.
  await c.fastPoll({ fetchFeed, fetchDetails: async (id) => { requested.push(id); return { id, title: '', durationSec: 0, fallback: true }; } });
  assert.deepEqual(requested.sort(), ['listedstub1', 'premiere001'], 'entries with a usable duration are not asked again');
  assert.deepEqual(c.details.listedstub1, stub);
  assert.equal(rebuilds, 0);
  assert.ok(logs.includes('[poll] 1/1 feeds read, 4 entries, 0 unknown, 1 shorts or clips skipped, 2 listed without a duration asked again'), logs.join('\n'));
  // YouTube answers: details are filled in (the feed date kept where /player gives none) and the catalogue is rebuilt.
  requested.length = 0;
  await c.fastPoll({ fetchFeed, fetchDetails: async (id) => { requested.push(id); return id === 'listedstub1' ? { id, title: 'Old stub', durationSec: 2400, publishedAt: null } : { id, title: 'Premiere', durationSec: 0 }; } });
  assert.deepEqual(requested.sort(), ['listedstub1', 'premiere001']);
  assert.equal(rebuilds, 1);
  assert.deepEqual([c.details.listedstub1.durationSec, c.details.listedstub1.fallback, c.details.listedstub1.publishedAt], [2400, undefined, '2026-10-17T10:00:00Z']);
  assert.equal(c.playlists['UPLOADS:example'].videos.length, 3, 'no row is added twice');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'details.json'), 'utf8'));
  assert.equal(saved.listedstub1.durationSec, 2400);
  // Now complete: not asked again.
  requested.length = 0;
  await c.fastPoll({ fetchFeed, fetchDetails: async (id) => { requested.push(id); return { id, title: 'Premiere', durationSec: 0 }; } });
  assert.deepEqual(requested, ['premiere001']);
});
