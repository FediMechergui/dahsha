import test from 'node:test';
import assert from 'node:assert/strict';
import { mapVideoItem, listChannelUploads, setClientFactory } from '../src/youtube.js';

const node = (id, title = 'A film') => ({
  content_id: id, metadata: { title: { text: title }, metadata: { metadata_rows: [{ metadata_parts: [
    { text: { text: 'Creator' } }, { text: { text: '123 views' } }, { text: { text: '2 days ago' } },
  ] }] } }, content_image: { overlays: [{ badges: [{ text: '12:34' }] }] },
});

test('current LockupView uploads preserve titles, duration, views and age', () => {
  const video = mapVideoItem(node('abcdefghijk', 'A documentary'));
  assert.equal(video.title, 'A documentary');
  assert.equal(video.durationSec, 754);
  assert.equal(video.views, '123 views');
  assert.equal(video.relative, '2 days ago');
});

test('uploads paginate in the source language and stop after an already-known page', async t => {
  t.after(() => setClientFactory(null));
  const languages = [];
  let continuations = 0;
  setClientFactory(async lang => {
    languages.push(lang);
    return { getChannel: async () => ({ has_videos: true, getVideos: async () => ({
      videos: [node('abcdefghijk')], has_continuation: true,
      getContinuation: async () => { continuations++; return {
        videos: [node('lmnopqrstuv')], has_continuation: true,
        getContinuation: async () => { throw new Error('Must stop at known video'); },
      }; },
    }) }) };
  });
  const result = await listChannelUploads('channel', { lang: 'en', knownIds: new Set(['lmnopqrstuv']) });
  assert.deepEqual(result.videos.map(v => v.id), ['abcdefghijk', 'lmnopqrstuv']);
  assert.equal(continuations, 1);
  assert.deepEqual(languages, ['en']);
});
