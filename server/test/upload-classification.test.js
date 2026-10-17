import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyUpload } from '../src/classify-upload.js';
import { buildCatalog } from '../src/catalog.js';
import { leanCatalog } from '../src/export-catalog.js';

const source = { id: 'channel', type: 'channel', title: 'Example', profile: 'creator', lang: 'en', documentaryUploads: true };
const video = { id: 'abcdefghijk', title: 'The Family That Broke News', durationSec: 1500 };
const build = (title = video.title, overrides = {}, playlist = false) => buildCatalog({
  sources: [source], details: { [video.id]: { durationSec: 1500, category: 'Education' } }, seen: {}, overrides,
  playlists: {
    uploads: { id: 'uploads', sourceId: source.id, isUploads: true, title: '__uploads__', videos: [{ ...video, title }] },
    ...(playlist ? { series: { id: 'series', sourceId: source.id, title: 'Films', videos: [{ ...video, title }] } } : {}),
  },
});

test('metadata signals admit factual films without misleading title exclusions', () => {
  for (const title of ['The Family That Broke News', 'How people could live in space']) {
    assert.equal(classifyUpload({ ...video, title }, { category: 'Education' }, source).status, 'documentary');
  }
  assert.equal(classifyUpload(video).status, 'uncertain');
  assert.equal(classifyUpload(video, { category: 'Gaming' }).status, 'uncertain');
});

test('clear non-documentary formats outweigh positive channel and metadata signals', () => {
  for (const title of ['Q&A + Giveaway for 10 Years on YouTube', 'The Making Of Planet Insect', 'Official documentary trailer']) {
    assert.equal(classifyUpload({ ...video, title }, { category: 'Education', keywords: ['documentary'], description: 'A documentary' }, source).status, 'non-documentary');
    assert.equal(build(title).shows.length, 0);
  }
});

test('ID and scoped literal pattern overrides take precedence', () => {
  assert.equal(build('Official trailer', { uploadClassification: { videos: { [video.id]: 'documentary' } } }).shows.length, 1);
  const rules = { uploadClassification: { patterns: [{ channelId: source.id, titleIncludes: 'Family', status: 'non-documentary' }] } };
  assert.equal(build(video.title, rules).shows.length, 0);
  assert.equal(classifyUpload(video, {}, { ...source, id: 'other' }, rules).status, 'documentary');
});

test('playlist membership supersedes uploads-only classification regardless of listing order', () => {
  const catalog = build('Q&A + Giveaway', {}, true);
  assert.equal(catalog.shows.length, 1);
  assert.equal(catalog.shows[0].classification, undefined);
});

test('uncertain uploads remain watchable with classification preserved in static exports', () => {
  const catalog = build(video.title, { uploadClassification: { videos: { [video.id]: 'uncertain' } } });
  assert.equal(catalog.shows[0].documentary, false);
  assert.doesNotMatch(catalog.shows[0].synopsis, /documentary/i);
  const lean = leanCatalog(catalog, 'dahsha');
  assert.equal(lean.shows[0].classification.status, 'uncertain');
  assert.equal(lean.shows[0].episodes[0].classification.status, 'uncertain');
});

test('recognized series episodes are not reclassified as standalone films', () => {
  const catalog = buildCatalog({ sources: [source], details: {}, seen: {}, overrides: {}, playlists: {
    uploads: { id: 'uploads', sourceId: source.id, isUploads: true, title: '__uploads__', videos: [{
      ...video, title: 'An episode about trailers',
      parsed: { kind: 'series', showTitle: 'A known series', episodeTitle: 'Trailers', number: 1 },
    }] },
  } });
  assert.equal(catalog.shows.length, 1);
  assert.equal(catalog.shows[0].kind, 'series');
  assert.equal(catalog.shows[0].classification, undefined);
});
