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

test('classification reads the original title behind an Arabic listing and decoded entities', () => {
  const run = (title, details) => buildCatalog({ sources: [source], seen: {}, overrides: {}, details: { [video.id]: { durationSec: 1500, category: 'Education', ...details } }, playlists: {
    uploads: { id: 'uploads', sourceId: source.id, isUploads: true, title: '__uploads__', videos: [{ ...video, title }] },
  } });
  // hl=ar localization of "Official Trailer | Planet Insect": nothing in the Arabic text marks a trailer.
  assert.equal(run('مقطع دعائي | كوكب الحشرات', { title: 'Official Trailer | Planet Insect' }).shows.length, 0);
  assert.equal(run('مقطع دعائي | كوكب الحشرات', {}).shows.length, 1, 'without an original title the listing is all there is');
  assert.equal(run('Q&amp;A + Giveaway for 10 Years', {}).shows.length, 0);
  const kept = run('حي غريب', { title: 'The Weirdest Neighborhood in Amsterdam' });
  assert.equal(kept.shows[0].title, 'The Weirdest Neighborhood in Amsterdam');
  assert.equal(kept.shows[0].classification.status, 'documentary');
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

test('uploads grouped into a series by part markers or a shared title prefix are still classified', () => {
  const creator = { id: 'creator2', type: 'channel', title: 'Some Creator', profile: 'creator', lang: 'en' };
  const aj = { id: 'UCaj', type: 'channel', title: 'Al Jazeera Documentary الجزيرة الوثائقية', short: 'الجزيرة الوثائقية', lang: 'ar', profile: 'aljazeera' };
  const yt = (id) => id.padEnd(11, '_').slice(0, 11);
  const en = {
    bts1: 'Behind the Scenes of Planet X - Part 1', bts2: 'Behind the Scenes of Planet X - Part 2',
    qa1: 'Q&A Livestream Part 1', qa2: 'Q&A Livestream Part 2',
    ice1: 'My Trip Across Iceland, Part One', ice2: 'My Trip Across Iceland, Part Two',
    cold1: 'The Coldest Place on Earth, Part One | Documentary', cold2: 'The Coldest Place on Earth, Part Two | Documentary',
  };
  const ar = { song1: 'حكاية أغنية - الأطلال', song2: 'حكاية أغنية - زهرة المدائن', songBts: 'حكاية أغنية - كواليس التصوير' };
  const rows = (o) => Object.entries(o).map(([k, title]) => ({ id: yt(k), title }));
  const details = Object.fromEntries([
    ...Object.keys(en).map((k) => [yt(k), { durationSec: 1300 }]),
    ...Object.keys(ar).map((k) => [yt(k), { durationSec: 2400, category: 'Education', description: 'فيلم وثائقي من الجزيرة الوثائقية' }]),
  ]);
  const catalog = buildCatalog({ sources: [creator, aj], details, seen: {}, overrides: {}, playlists: {
    'UPLOADS:creator2': { id: 'UPLOADS:creator2', sourceId: creator.id, isUploads: true, title: '__uploads__', videos: rows(en) },
    'UPLOADS:UCaj': { id: 'UPLOADS:UCaj', sourceId: aj.id, isUploads: true, title: '__uploads__', videos: rows(ar) },
  } });
  const showOf = (k) => catalog.shows.find((s) => s.episodes.some((e) => e.id === yt(k)));
  for (const k of ['bts1', 'bts2', 'qa1', 'qa2', 'songBts']) assert.equal(showOf(k), undefined, `${k} is not a documentary`);
  const iceland = showOf('ice1');
  assert.equal(iceland, showOf('ice2'));
  assert.equal(iceland.kind, 'series');
  assert.equal(iceland.classification.status, 'uncertain', 'an uncertain part keeps the grouped show out of the main rows');
  assert.equal(iceland.documentary, false);
  assert.deepEqual(iceland.episodes.map((e) => e.classification.status), ['uncertain', 'uncertain']);
  const cold = showOf('cold1');
  assert.deepEqual([cold.kind, cold.episodes.length, cold.classification.status], ['series', 2, 'documentary']);
  const songs = showOf('song1');
  assert.equal(songs, showOf('song2'));
  assert.deepEqual([songs.title, songs.kind, songs.episodes.length, songs.classification.status], ['حكاية أغنية', 'series', 2, 'documentary']);
  assert.deepEqual(catalog.stats.classification, { documentary: 2, uncertain: 1 });
});
