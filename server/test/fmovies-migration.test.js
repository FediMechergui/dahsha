import test from 'node:test';
import assert from 'node:assert/strict';
import { FMOVIES_BASE, canonicalFmoviesTitleUrl, parseFmoviesDetails, requestFmoviesPage, fmoviesServers } from '../src/fmovies.js';

const legacy = 'https://www.f-movies.org';
const titlePath = '/tv/great-performances-10029';
const page = `<script type="application/ld+json">${JSON.stringify({ '@type': 'TVSeries', name: 'Great Performances', genre: ['Documentary', 'Drama'], numberOfEpisodes: 725 })}</script>
<a href="?season=1&#38;episode=1"><span>Season 1</span></a>
<a href="?season=55&#38;episode=1"><span>Season 55</span></a>
${[1, 2, 3, 7, 18].map(number => `<a href="?season=1&#38;episode=${number}" title="Episode ${number}">${String(number).padStart(2, '0')}</a>`).join('')}
<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>`;
const response = (url, { status = 200, body = page } = {}) => {
  const result = new Response(body, { status });
  Object.defineProperty(result, 'url', { value: url });
  return result;
};

test('legacy and current FMovies titles canonicalize without changing title identity', () => {
  assert.equal(FMOVIES_BASE, 'https://www.f-moviess.org');
  for (const base of [legacy, FMOVIES_BASE]) {
    assert.equal(canonicalFmoviesTitleUrl(`${base}${titlePath}/?season=55&episode=1`), FMOVIES_BASE + titlePath);
    const show = parseFmoviesDetails(page, base + titlePath);
    assert.equal(show.id, 'fm:s:10029');
    assert.equal(show.documentary, true);
    assert.equal(show.sourceUrl, FMOVIES_BASE + titlePath);
    assert.deepEqual(show.episodes.map(episode => episode.number), [1, 2, 3, 7, 18]);
    assert.ok(show.episodes.every(episode => episode.season === 1), 'season selectors must not invent episodes');
    assert.deepEqual(show.seasons, [1, 55]);
    assert.equal(show.advertisedEpisodeCount, 725);
  }
});

test('FMovies title validation excludes unreviewed mirrors, credentials, ports and non-title paths', () => {
  for (const url of [
    'https://f-moviess.org' + titlePath, 'https://www.f-moviess.org.example' + titlePath,
    'https://www.f-movies.org.example' + titlePath, 'https://user@www.f-moviess.org' + titlePath,
    'https://www.f-moviess.org:444' + titlePath, 'http://www.f-moviess.org' + titlePath,
    FMOVIES_BASE + '/account', FMOVIES_BASE + '/api/search?q=title', FMOVIES_BASE + '/tv/not-a-numeric-id',
    FMOVIES_BASE + titlePath + '/extra', FMOVIES_BASE + titlePath + '#other',
  ]) assert.equal(canonicalFmoviesTitleUrl(url), null, url);
});

test('legacy episode links request the current origin directly and preserve cancellation/coordinates', async () => {
  const signal = new AbortController().signal;
  let calls = 0;
  const html = await requestFmoviesPage(`${legacy}${titlePath}?season=55&episode=1`, { signal, fetchPage: async (url, options) => {
    calls++;
    assert.equal(url, `${FMOVIES_BASE}${titlePath}?season=55&episode=1`);
    assert.equal(options.redirects, 0, 'do not follow a new mirror or a different title');
    assert.equal(options.signal, signal);
    return response(url);
  } });
  assert.equal(html, page);
  assert.equal(calls, 1);
});

test('unexpected final origin, title or episode query is rejected rather than imported', async () => {
  for (const target of ['https://other.example' + titlePath, FMOVIES_BASE + '/account', FMOVIES_BASE + '/tv/different-77', FMOVIES_BASE + titlePath + '?season=2&episode=1']) {
    let calls = 0;
    await assert.rejects(requestFmoviesPage(`${legacy}${titlePath}?season=1&episode=1`, { fetchPage: async () => { calls++; return response(target); } }), /Unexpected FMovies redirect/);
    assert.equal(calls, 1);
  }
});

test('denials and pre-aborted collection do not retry or fabricate episode guides', async () => {
  let calls = 0;
  await assert.rejects(requestFmoviesPage(legacy + titlePath, { fetchPage: async url => { calls++; return response(url, { status: 403, body: '<title>Verification required</title>' }); } }), /HTTP 403/);
  assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestFmoviesPage(legacy + titlePath, { signal: controller.signal, fetchPage: () => { throw Error('Must not request an aborted page'); } }), { name: 'AbortError' });
});

test('current FMovies wrapper routes preserve server identity and verified episode coordinates', () => {
  const film = fmoviesServers('fm:m:36970'), episode = fmoviesServers('fm:e:10029:55:1');
  assert.equal(film[0].id, 'fmovies:embos');
  assert.equal(film[0].embedUrl, 'https://emboser.com/movie/?mid=36970');
  assert.equal(episode[0].embedUrl, 'https://emboser.com/tv/?mid=10029&s=55&e=1');
  assert.equal(episode[1].embedUrl, 'https://vidcore.net/tv/10029/55/1');
  assert.equal(episode[2].embedUrl, 'https://vidapi.xyz/embed/tv/10029/55/1');
  assert.deepEqual(fmoviesServers('fm:s:10029'), [], 'a title without an episode coordinate is not playable');
});
