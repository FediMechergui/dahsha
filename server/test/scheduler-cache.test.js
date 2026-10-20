import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-scheduler-'));
process.env.DATA_DIR = dir;
process.env.SKIP_PROVIDER_SYNC = '1';
process.env.ARTWORK = '0';
// The listing and cache tests below count details requests: the stub retry and the rolling re-check are
// switched off for them and tested on their own further down.
process.env.DETAILS_STUB_RETRY_PER_RUN = '0';
process.env.DETAILS_RECHECK_PER_RUN = '0';
// Warnings are plain log lines here, also when the suite runs in GitHub Actions (ciWarning has its own test).
delete process.env.GITHUB_ACTIONS;
const { Catalogue, originalTitle, judgePlaylist, mergePlaylistRows, worthyUpload, retainUploads, mergeDetails, planDetails, listedRowTime, envCount, myflixerEpisodeTitle, healMyflixerRow, ciWarning } = await import('../src/scheduler.js');
const { fetchMyflixerCatalog, siteDate } = await import('../src/documentaries.js');
const { setClientFactory } = await import('../src/youtube.js');
const { buildCatalog } = await import('../src/catalog.js');
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

const EN = { type: 'channel', id: 'UCenglishchannel000000aa', title: 'English Docs', short: 'English Docs', lang: 'en', profile: 'creator', scanUploads: true, maxUploads: 400 };
const AR = { type: 'channel', id: 'UCarabicchannel0000000aa', title: 'قناة', short: 'قناة', lang: 'ar', profile: 'generic', scanUploads: true, maxUploads: 400 };

const videoNode = (id, title) => ({
  content_id: id, metadata: { title: { text: title }, metadata: { metadata_rows: [{ metadata_parts: [{ text: { text: '1K views' } }, { text: { text: '3 weeks ago' } }] }] } },
  content_image: { overlays: [{ badges: [{ text: '45:00' }] }] },
});
const playlistNode = (id, title, countText, cover) => ({
  content_id: id, metadata: { title: { text: title } },
  content_image: { primary_thumbnail: { image: [{ url: `https://i.ytimg.com/vi/${cover}/hqdefault.jpg` }], overlays: [{ badges: [{ text: countText }] }] } },
});

/**
 * Mocked InnerTube clients. `tabs[channelId](lang)` returns the uploads tab as pages of [id, title];
 * `playlists[channelId]` the channel's playlist nodes and `playlistVideos[id]` a playlist's [id, title] rows
 * (a playlist missing there answers as gone). `playlistTotals[id]` overrides the playlist's own count text,
 * `playlistErrors[id]` makes reading it fail (not as gone), and a channel in `incompleteListing` has a
 * playlists tab whose walk ends on unreadable pages. Records the client languages, the uploads pages
 * walked and the playlists fetched.
 */
function fakeYouTube({ tabs = {}, playlists = {}, playlistVideos = {}, playlistTotals = {}, playlistErrors = {}, incompleteListing = [], failChannel = null } = {}) {
  const calls = { langs: [], pages: [], playlistFetches: [], details: [] };
  const pageAt = (channelId, lang, pages, i) => {
    calls.pages.push(`${channelId}:${lang}:${i}`);
    return {
      videos: (pages[i] || []).map(([id, title]) => videoNode(id, title)),
      has_continuation: i < pages.length - 1,
      getContinuation: async () => pageAt(channelId, lang, pages, i + 1),
    };
  };
  setClientFactory(async (lang) => {
    calls.langs.push(lang);
    return {
      getChannel: async (channelId) => ({
        has_videos: !!tabs[channelId] || channelId === failChannel,
        has_playlists: !!playlists[channelId],
        getVideos: async () => {
          // Thrown while the page is read (outside withRetry), so the test does not wait for retries.
          if (channelId === failChannel) return { get videos() { throw new Error('unreadable uploads tab'); } };
          return pageAt(channelId, lang, tabs[channelId](lang), 0);
        },
        getPlaylists: async () => {
          const emptyPage = { playlists: [], has_continuation: true, getContinuation: async () => emptyPage };
          const incomplete = incompleteListing.includes(channelId);
          return { playlists: playlists[channelId] || [], has_continuation: incomplete, getContinuation: async () => emptyPage };
        },
      }),
      getPlaylist: async (id) => {
        calls.playlistFetches.push(`${id}:${lang}`);
        // Thrown while the page is read (outside withRetry), so the test does not wait for retries.
        if (playlistErrors[id]) return { get info() { throw new Error(playlistErrors[id]); } };
        if (!playlistVideos[id]) throw Object.assign(new Error('This playlist does not exist'), { info: { type: 'Alert', alert_type: 'ERROR' } });
        return { info: { title: `Playlist ${id}`, total_items: playlistTotals[id] ?? `${playlistVideos[id].length} videos` }, videos: playlistVideos[id].map(([vid, t]) => videoNode(vid, t)), has_continuation: false };
      },
      actions: {
        execute: async (_endpoint, { videoId }) => {
          calls.details.push(`${videoId}:${lang}`);
          return { data: { videoDetails: { title: `Details ${videoId}`, lengthSeconds: '2700', viewCount: '10', shortDescription: '' }, playabilityStatus: { status: 'OK' }, microformat: { playerMicroformatRenderer: { publishDate: '2026-01-01', embed: { iframeUrl: `https://www.youtube.com/embed/${videoId}` } } } } };
        },
      },
    };
  });
  return calls;
}

const make = ({ sources, playlists = {}, details = {} }) => {
  const c = new Catalogue();
  c.sources = sources; c.playlists = playlists; c.details = details; c.seen = {};
  c.rebuild = () => ({ newEpisodes: [], newShows: [] });
  c.enrich = async () => {};
  return c;
};
const uploads = (src, videos, extra = {}) => ({ [`UPLOADS:${src.id}`]: { id: `UPLOADS:${src.id}`, title: '__uploads__', isUploads: true, sourceId: src.id, signature: null, videos, fetchedAt: '2026-10-16T00:00:00Z', ...extra } });
const row = (id, title) => ({ id, title, durationSec: 2700, durationText: '45:00', views: '١ ألف مشاهدة', relative: 'قبل 3 أسابيع', thumb: null });

function captureLogs(t) {
  const lines = [];
  t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
  t.mock.method(console, 'warn', (...a) => lines.push(a.join(' ')));
  return lines;
}

test.afterEach(() => setClientFactory(null));

test('uploads listed with the Arabic client are walked again in the source language, keeping and healing unlisted rows', async (t) => {
  const logs = captureLogs(t);
  const calls = fakeYouTube({ tabs: { [EN.id]: (lang) => [
    [['nnnnnnnnnnn', 'Brand new'], ['aaaaaaaaaaa', lang === 'en' ? 'Title A' : 'عنوان أ']],
    [['bbbbbbbbbbb', lang === 'en' ? 'Title B' : 'عنوان ب']],
  ] } });
  const c = make({
    sources: [EN],
    // Written before per-language clients: no listedLang, hl=ar titles.
    playlists: uploads(EN, [row('aaaaaaaaaaa', 'عنوان أ'), row('bbbbbbbbbbb', 'عنوان ب'), row('ccccccccccc', 'عنوان ج'), row('ddddddddddd', 'عنوان د')]),
    details: {
      aaaaaaaaaaa: { title: 'Title A' }, bbbbbbbbbbb: { title: 'Title B' },
      ccccccccccc: { title: 'Original C' }, // not on the tab any more: kept, title restored from details
      ddddddddddd: { title: 'FRONTLINE: بالعربية' }, // mixed-script original: left alone
    },
  });
  await c.refresh();
  // No knownIds: the walk went past the page that holds already-cached ids.
  assert.deepEqual(calls.pages, [`${EN.id}:en:0`, `${EN.id}:en:1`]);
  assert.deepEqual([...new Set(calls.langs)], ['en']);
  const rec = c.playlists[`UPLOADS:${EN.id}`];
  assert.equal(rec.listedLang, 'en');
  assert.deepEqual(rec.videos.map((v) => [v.id, v.title]), [
    ['nnnnnnnnnnn', 'Brand new'], ['aaaaaaaaaaa', 'Title A'], ['bbbbbbbbbbb', 'Title B'], ['ccccccccccc', 'Original C'], ['ddddddddddd', 'عنوان د'],
  ]);
  assert.deepEqual(calls.details, ['nnnnnnnnnnn:en']);
  const line = logs.find((l) => l.startsWith('[uploads]'));
  assert.match(line, /English Docs \(UCenglishchannel000000aa\) en, relist from ar: 1 new, 3 listed, 2 cached, 5 total, 1 titles restored from details/);
  assert.match(logs.find((l) => l.startsWith('[catalogue] refresh done')), /uploads scanned 1 \(1 relisted\)/);

  // Once listed in English the scan is incremental again: it stops at the first page with a known id.
  calls.pages.length = 0;
  await c.refresh();
  assert.deepEqual(calls.pages, [`${EN.id}:en:0`]);
  assert.equal(c.playlists[`UPLOADS:${EN.id}`].listedLang, 'en');
  assert.equal(c.playlists[`UPLOADS:${EN.id}`].videos.length, 5);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'playlists.json'), 'utf8'));
  assert.equal(saved[`UPLOADS:${EN.id}`].listedLang, 'en');
});

test('Arabic sources without listedLang stay incremental and keep their titles', async (t) => {
  captureLogs(t);
  const calls = fakeYouTube({ tabs: { [AR.id]: () => [[['nnnnnnnnnnn', 'جديد'], ['aaaaaaaaaaa', 'عنوان أ']], [['bbbbbbbbbbb', 'عنوان ب']]] } });
  const c = make({ sources: [AR], playlists: uploads(AR, [row('aaaaaaaaaaa', 'عنوان أ'), row('ccccccccccc', 'عنوان ج')]), details: { aaaaaaaaaaa: { title: 'Title A' }, ccccccccccc: { title: 'Title C' } } });
  await c.refresh();
  assert.deepEqual(calls.pages, [`${AR.id}:ar:0`]);
  const rec = c.playlists[`UPLOADS:${AR.id}`];
  assert.equal(rec.listedLang, 'ar');
  assert.deepEqual(rec.videos.map((v) => v.title), ['جديد', 'عنوان أ', 'عنوان ج']);
});

test('a relist that stops on unreadable pages is repeated on the next refresh', async (t) => {
  const logs = captureLogs(t);
  // Two empty pages in a row end the walk before the tab is exhausted.
  const calls = fakeYouTube({ tabs: { [EN.id]: () => [[['aaaaaaaaaaa', 'Title A']], [], [], [['bbbbbbbbbbb', 'Title B']]] } });
  const c = make({ sources: [EN], playlists: uploads(EN, [row('aaaaaaaaaaa', 'عنوان أ'), row('bbbbbbbbbbb', 'عنوان ب')]), details: { aaaaaaaaaaa: { title: 'Title A' }, bbbbbbbbbbb: { title: 'Title B' } } });
  await c.refresh();
  const rec = c.playlists[`UPLOADS:${EN.id}`];
  assert.equal(rec.listedLang, undefined);
  assert.deepEqual(rec.videos.map((v) => v.title), ['Title A', 'Title B']);
  assert.match(logs.find((l) => l.startsWith('[uploads]')), /walk stopped early, relisting again next refresh/);
  calls.pages.length = 0;
  await c.refresh();
  assert.equal(calls.pages.length, 3, 'walked again without known ids');
});

test('an empty listing keeps the cache, restores titles and is logged', async (t) => {
  const logs = captureLogs(t);
  fakeYouTube({ tabs: { [EN.id]: () => [[]], [AR.id]: () => [[['aaaaaaaaaaa', 'عنوان أ']]] } });
  const c = make({
    sources: [EN, AR],
    playlists: { ...uploads(EN, [row('ccccccccccc', 'عنوان ج')]), ...uploads(AR, [row('aaaaaaaaaaa', 'عنوان أ')], { listedLang: 'ar' }) },
    details: { ccccccccccc: { title: 'Original C' }, aaaaaaaaaaa: { title: 'x' } },
  });
  await c.refresh();
  const rec = c.playlists[`UPLOADS:${EN.id}`];
  assert.deepEqual(rec.videos.map((v) => v.title), ['Original C']);
  assert.equal(rec.listedLang, undefined, 'still to be relisted');
  assert.ok(logs.some((l) => /^\[uploads\] English Docs .*listing returned no videos; 1 cached kept, 1 titles restored/.test(l)));
});

test('playlists store listedLang; a missing one never forces a refetch, a different one does', async (t) => {
  const logs = captureLogs(t);
  const pl = (id, sig, extra = {}) => ({ [id]: { id, title: `Playlist ${id}`, sourceId: EN.id, signature: sig, videos: [row('aaaaaaaaaaa', 'Title A')], fetchedAt: '2026-10-16T00:00:00Z', ...extra } });
  const calls = fakeYouTube({
    tabs: { [EN.id]: () => [[['aaaaaaaaaaa', 'Title A']]] },
    playlists: { [EN.id]: [playlistNode('PLsame', 'Same', '1 video', 'aaaaaaaaaaa'), playlistNode('PLchanged', 'Changed', '2 videos', 'aaaaaaaaaaa'), playlistNode('PLarabic', 'Arabic', '1 video', 'aaaaaaaaaaa'), playlistNode('PLgone', 'Gone', '3 videos', 'aaaaaaaaaaa')] },
    playlistVideos: { PLchanged: [['aaaaaaaaaaa', 'Title A'], ['bbbbbbbbbbb', 'Title B']], PLarabic: [['aaaaaaaaaaa', 'Title A']] },
  });
  const c = make({
    sources: [EN],
    playlists: {
      ...uploads(EN, [row('aaaaaaaaaaa', 'Title A')], { listedLang: 'en' }),
      ...pl('PLsame', '1 video|aaaaaaaaaaa'), // no listedLang, same signature
      ...pl('PLchanged', '1 video|aaaaaaaaaaa'),
      ...pl('PLarabic', '1 video|aaaaaaaaaaa', { listedLang: 'ar' }),
    },
    details: { aaaaaaaaaaa: { title: 'Title A' }, bbbbbbbbbbb: { title: 'Title B' } },
  });
  await c.refresh();
  assert.deepEqual(calls.playlistFetches.sort(), ['PLarabic:en', 'PLchanged:en', 'PLgone:en']);
  assert.equal(c.playlists.PLsame.listedLang, undefined);
  assert.equal(c.playlists.PLchanged.listedLang, 'en');
  assert.equal(c.playlists.PLchanged.videos.length, 2);
  assert.equal(c.playlists.PLarabic.listedLang, 'en');
  // pool() failures are reported with the playlist and its channel.
  assert.ok(logs.some((l) => /^\[catalogue\] playlist PLgone "Gone" of English Docs \(UCenglishchannel000000aa\): playlist PLgone is gone/.test(l)), logs.join('\n'));
});

test('per-channel upload failures and poll feed failures are logged, not swallowed', async (t) => {
  const logs = captureLogs(t);
  const BAD = { ...EN, id: 'UCbrokenchannel00000000a', title: 'Broken', short: 'Broken' };
  fakeYouTube({ tabs: { [EN.id]: () => [[['aaaaaaaaaaa', 'Title A']]] }, failChannel: BAD.id });
  const c = make({ sources: [EN, BAD], playlists: uploads(EN, [], { listedLang: 'en' }) });
  await c.refresh();
  assert.ok(logs.some((l) => l === '[uploads] Broken (UCbrokenchannel00000000a): unreadable uploads tab'), logs.join('\n'));
  assert.ok(logs.some((l) => /^\[uploads\] English Docs \(UCenglishchannel000000aa\) en: 1 new, 1 listed, 0 cached, 1 total$/.test(l)), logs.join('\n'));

  logs.length = 0;
  c.rebuild = () => ({ newEpisodes: [], newShows: [] });
  await c.fastPoll({
    fetchFeed: async (id) => { if (id === BAD.id) throw new Error('feed 404'); return [{ id: 'zzzzzzzzzzz', title: 'Fresh', published: '2026-10-18T00:00:00Z' }]; },
    fetchDetails: async (id) => ({ id, title: 'Fresh', durationSec: 1800 }),
  });
  assert.ok(logs.includes('[poll] feed of Broken (UCbrokenchannel00000000a): feed 404'), logs.join('\n'));
  assert.ok(logs.includes('[poll] 1/2 feeds read, 1 entries, 1 unknown'), logs.join('\n'));
});

test('an uploads record created by the poll is walked in full by the next refresh', async (t) => {
  captureLogs(t);
  const calls = fakeYouTube({ tabs: { [AR.id]: () => [[['zzzzzzzzzzz', 'جديد'], ['aaaaaaaaaaa', 'أ']], [['bbbbbbbbbbb', 'ب']]] } });
  const c = make({ sources: [AR] });
  await c.fastPoll({ fetchFeed: async () => [{ id: 'zzzzzzzzzzz', title: 'جديد', published: '2026-10-18T00:00:00Z' }], fetchDetails: async (id) => ({ id, durationSec: 1800 }) });
  assert.equal(c.playlists[`UPLOADS:${AR.id}`].listedLang, null);
  await c.refresh();
  assert.deepEqual(calls.pages, [`${AR.id}:ar:0`, `${AR.id}:ar:1`]);
  const rec = c.playlists[`UPLOADS:${AR.id}`];
  assert.equal(rec.listedLang, 'ar');
  assert.deepEqual(rec.videos.map((v) => v.id), ['zzzzzzzzzzz', 'aaaaaaaaaaa', 'bbbbbbbbbbb']);
});

test('cached playlists of a source no longer in sources.json are kept by a refresh', async (t) => {
  captureLogs(t);
  const GONE = 'UCremovedchannel0000000a';
  fakeYouTube({
    tabs: { [EN.id]: () => [[['aaaaaaaaaaa', 'Title A']]] },
    playlists: { [EN.id]: [playlistNode('PLlive', 'Live', '1 video', 'aaaaaaaaaaa')] },
    playlistVideos: { PLlive: [['aaaaaaaaaaa', 'Title A']] },
  });
  const orphan = { id: 'PLorphan', title: 'Orphan', sourceId: GONE, signature: '1 video|bbbbbbbbbbb', videos: [row('bbbbbbbbbbb', 'Title B')], fetchedAt: '2026-10-16T00:00:00Z' };
  const c = make({
    sources: [EN],
    playlists: { ...uploads(EN, [row('aaaaaaaaaaa', 'Title A')], { listedLang: 'en' }), ...uploads({ id: GONE }, [row('ccccccccccc', 'Title C')]), PLorphan: orphan },
    details: { aaaaaaaaaaa: { title: 'Title A' }, bbbbbbbbbbb: { title: 'Title B' }, ccccccccccc: { title: 'Title C' } },
  });
  await c.refresh();
  assert.deepEqual(c.playlists.PLorphan, orphan);
  assert.deepEqual(c.playlists[`UPLOADS:${GONE}`].videos.map((v) => v.id), ['ccccccccccc']);
  assert.ok(c.playlists.PLlive, 'the configured source is refreshed as usual');
});

test('artwork enrichment gets the whole catalogue when it carries idAliases, else the show list', async (t) => {
  const prev = process.env.ARTWORK;
  process.env.ARTWORK = '1';
  t.after(() => { process.env.ARTWORK = prev; });
  const c = make({ sources: [EN] });
  c.enrich = Catalogue.prototype.enrich; // make() stubs it for the refresh tests
  const inputs = [];
  let rebuilds = 0;
  c.rebuild = () => { rebuilds++; return { newEpisodes: [], newShows: [] }; };
  const enrichArtwork = async (input) => { inputs.push(input); return {}; };
  c.catalog = { shows: [{ id: 's_live' }], idAliases: { s_old: 's_live' } };
  await c.enrich({ enrichArtwork });
  assert.equal(inputs[0], c.catalog);
  c.catalog = { shows: [{ id: 's_live' }] };
  await c.enrich({ enrichArtwork });
  assert.equal(inputs[1], c.catalog.shows);
  assert.equal(rebuilds, 0, 'unchanged artwork is not rebuilt in');
});

test('the original-title rule only rewrites Arabic listing titles of non-Arabic YouTube sources', () => {
  const details = { aaaaaaaaaaa: { title: 'The Weirdest Neighborhood in Amsterdam' }, bbbbbbbbbbb: { title: 'FRONTLINE: بالعربية' }, 'mf:e:slug-1': { title: 'Episode' } };
  const v = (id, title = 'أغرب حي في أمستردام') => ({ id, title });
  assert.equal(originalTitle(v('aaaaaaaaaaa'), EN, details), 'The Weirdest Neighborhood in Amsterdam');
  assert.equal(originalTitle(v('aaaaaaaaaaa'), { lang: 'en', contentLang: 'fr' }, details), 'The Weirdest Neighborhood in Amsterdam');
  assert.equal(originalTitle(v('aaaaaaaaaaa'), AR, details), null);
  assert.equal(originalTitle(v('aaaaaaaaaaa', 'Already English'), EN, details), null);
  assert.equal(originalTitle(v('bbbbbbbbbbb'), EN, details), null);
  assert.equal(originalTitle(v('mf:e:slug-1'), EN, details), null);
  assert.equal(originalTitle(v('ccccccccccc'), EN, details), null);
});

test('rebuild passes the catalogue loaded from catalog.json and the committed id aliases to buildCatalog', async () => {
  const stored = { generatedAt: '2026-10-18T00:00:00Z', shows: [{ id: 's_old', title: 'Old', episodes: [{ id: 'aaaaaaaaaaa' }] }], stats: { shows: 1, episodes: 1 }, idAliases: { s_older: 's_old' } };
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(stored));
  fs.writeFileSync(path.join(dir, 'show-id-aliases.json'), JSON.stringify({ s_ancient: 's_old' }));
  try {
    const c = new Catalogue();
    c.sources = [EN]; c.playlists = {}; c.details = {}; c.seen = {};
    const loaded = c.catalog;
    assert.deepEqual(loaded.shows.map((s) => s.id), ['s_old']);
    assert.deepEqual(loaded.idAliases, { s_older: 's_old' });
    const seen = [];
    const build = (args) => { seen.push(args); return buildCatalog(args); };
    c.rebuild({ build });
    assert.equal(seen[0].previous, loaded);
    assert.deepEqual(seen[0].idSeed, { s_ancient: 's_old' });
    // Later rebuilds of the same run start from the previous rebuild's result.
    const first = c.catalog;
    c.rebuild({ build });
    assert.equal(seen[1].previous, first);
  } finally {
    fs.rmSync(path.join(dir, 'catalog.json'), { force: true });
    fs.rmSync(path.join(dir, 'show-id-aliases.json'), { force: true });
  }
});

// ---- cache safety: playlists ------------------------------------------------------------------
const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(11 - prefix.length, '0')}`);
const plRec = (id, videoIds, extra = {}) => ({ id, title: `Playlist ${id}`, sourceId: EN.id, signature: `${videoIds.length} videos|${videoIds[0] || 'none'}`, videos: videoIds.map((v) => row(v, `Title ${v}`)), fetchedAt: '2026-10-16T00:00:00Z', listedLang: 'en', expectedCount: videoIds.length, ...extra });
const uploadsTab = { [EN.id]: () => [[['uuuuuuuuuuu', 'Upload U']]] };
const enUploads = () => uploads(EN, [row('uuuuuuuuuuu', 'Upload U')], { listedLang: 'en' });
const past = '2026-01-01T00:00:00.000Z';

test('judgePlaylist: empty or far shorter results never replace a cached list the badge does not explain', () => {
  const vids = (n) => ({ videos: Array.from({ length: n }, (_, i) => ({ id: `v${i}` })) });
  const cached10 = vids(10);
  assert.equal(judgePlaylist({ ...vids(0), expectedCount: 10 }, cached10), 'keep');
  assert.equal(judgePlaylist({ ...vids(0), expectedCount: 0 }, cached10), 'keep', 'never [] over a cached list');
  assert.equal(judgePlaylist({ ...vids(2), expectedCount: 10 }, cached10), 'keep');
  assert.equal(judgePlaylist({ ...vids(2), expectedCount: null }, cached10), 'keep');
  assert.equal(judgePlaylist({ ...vids(2), expectedCount: 2 }, cached10), 'ok', 'the playlist really shrank: its badge agrees');
  assert.equal(judgePlaylist({ ...vids(8), expectedCount: 10 }, cached10), 'ok');
  assert.equal(judgePlaylist({ ...vids(9), expectedCount: 30 }, cached10), 'keep', 'partial and shorter than the cache');
  assert.equal(judgePlaylist({ ...vids(12), expectedCount: 30 }, cached10), 'retry', 'partial but better than the cache');
  assert.equal(judgePlaylist({ ...vids(0), expectedCount: 7 }, null), 'retry');
  assert.equal(judgePlaylist({ ...vids(0), expectedCount: null }, null), 'retry');
  assert.equal(judgePlaylist({ ...vids(0), expectedCount: 0 }, null), 'ok', 'a playlist that says it is empty');
  assert.equal(judgePlaylist({ ...vids(0) }, null, 4), 'retry', 'the listing badge stands in for a missing expectedCount');
  assert.equal(judgePlaylist({ ...vids(3), expectedCount: 4 }, null), 'ok');
});

test('an empty or far shorter fetch keeps the cached videos and old signature, backs off, and retries when due', async (t) => {
  const logs = captureLogs(t);
  const ten = ids('aa', 10);
  const node = (id, n, cover) => playlistNode(id, `Playlist ${id}`, `${n} videos`, cover);
  const yt = {
    tabs: uploadsTab, playlists: { [EN.id]: [node('PLempty', 11, ten[0]), node('PLshort', 11, ten[0]), node('PLshrunk', 2, ten[0])] },
    playlistVideos: { PLempty: [], PLshort: ten.slice(0, 2).map((v) => [v, v]), PLshrunk: ten.slice(0, 2).map((v) => [v, v]) },
    playlistTotals: { PLempty: '11 videos', PLshort: '11 videos', PLshrunk: '2 videos' },
  };
  let calls = fakeYouTube(yt);
  const c = make({ sources: [EN], playlists: { ...enUploads(), PLempty: plRec('PLempty', ten), PLshort: plRec('PLshort', ten), PLshrunk: plRec('PLshrunk', ten) } });
  await c.refresh();
  assert.deepEqual(calls.playlistFetches.sort(), ['PLempty:en', 'PLshort:en', 'PLshrunk:en']);
  for (const id of ['PLempty', 'PLshort']) {
    const rec = c.playlists[id];
    assert.equal(rec.videos.length, 10, `${id} keeps its cached videos`);
    assert.equal(rec.signature, `10 videos|${ten[0]}`, `${id} keeps its old signature`);
    assert.equal(rec.fetchedAt, '2026-10-16T00:00:00Z');
    assert.equal(rec.retries, 1);
    assert.equal(rec.retrySignature, `11 videos|${ten[0]}`);
    assert.ok(Date.parse(rec.retryAfter) > Date.now() + 11 * 3600e3, 'backs off about 12 hours');
  }
  // The badge says 2: the playlist really shrank, so the result is stored.
  assert.equal(c.playlists.PLshrunk.videos.length, 2);
  assert.equal(c.playlists.PLshrunk.signature, `2 videos|${ten[0]}`);
  assert.ok(logs.some((l) => /^\[catalogue\] playlist PLempty "Playlist PLempty" of English Docs \(UCenglishchannel000000aa\): 0 videos returned for 10 cached \(badge 11\); cached list kept, retry after /.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => /^\[catalogue\] playlists: 3 cached, 3 fetched \(0 unlisted probed\), 2 kept their cached list/.test(l)), logs.join('\n'));
  assert.match(logs.find((l) => l.startsWith('[catalogue] refresh done')), /playlists fetched 3 \(2 kept cached\)/);

  // Within the backoff the same listing does not refetch them.
  calls = fakeYouTube(yt);
  await c.refresh();
  assert.deepEqual(calls.playlistFetches, []);
  // Once due they are fetched again; a full result replaces the cache and clears the backoff.
  c.playlists.PLempty.retryAfter = past;
  calls = fakeYouTube({ ...yt, playlistVideos: { ...yt.playlistVideos, PLempty: ids('bb', 11).map((v) => [v, v]) } });
  await c.refresh();
  assert.deepEqual(calls.playlistFetches, ['PLempty:en']);
  const rec = c.playlists.PLempty;
  assert.equal(rec.videos.length, 11);
  assert.equal(rec.signature, `11 videos|${ten[0]}`);
  assert.equal(rec.retryAfter, undefined);
  assert.equal(rec.retries, undefined);
  // Still within its backoff, but the listing shows a new signature: fetched again (and kept again).
  yt.playlists[EN.id][1] = node('PLshort', 12, ten[0]);
  calls = fakeYouTube(yt);
  await c.refresh();
  assert.deepEqual(calls.playlistFetches, ['PLshort:en']);
  assert.equal(c.playlists.PLshort.videos.length, 10);
  assert.equal(c.playlists.PLshort.retries, 2);
  assert.ok(Date.parse(c.playlists.PLshort.retryAfter) > Date.now() + 23 * 3600e3, 'the second backoff is longer');
});

test('a new playlist that comes back empty is stored with signature null and a backoff', async (t) => {
  captureLogs(t);
  const yt = { tabs: uploadsTab, playlists: { [EN.id]: [playlistNode('PLnew', 'New', '5 videos', 'aaaaaaaaaaa')] }, playlistVideos: { PLnew: [] }, playlistTotals: { PLnew: '5 videos' } };
  let calls = fakeYouTube(yt);
  const c = make({ sources: [EN], playlists: enUploads() });
  await c.refresh();
  assert.deepEqual(calls.playlistFetches, ['PLnew:en']);
  const rec = c.playlists.PLnew;
  assert.deepEqual([rec.videos.length, rec.signature, rec.retries, rec.retrySignature], [0, null, 1, '5 videos|aaaaaaaaaaa']);
  calls = fakeYouTube(yt);
  await c.refresh();
  assert.deepEqual(calls.playlistFetches, [], 'not requested again on every run');
  c.playlists.PLnew.retryAfter = past;
  calls = fakeYouTube({ ...yt, playlistVideos: { PLnew: ids('cc', 5).map((v) => [v, v]) } });
  await c.refresh();
  assert.deepEqual([c.playlists.PLnew.videos.length, c.playlists.PLnew.signature], [5, '5 videos|aaaaaaaaaaa']);
});

test('a playlist cached empty although its badge counts videos is refetched despite an unchanged signature', async (t) => {
  const logs = captureLogs(t);
  const calls = fakeYouTube({
    tabs: uploadsTab, playlists: { [EN.id]: [playlistNode('PLwiped', 'Wiped', '3 videos', 'aaaaaaaaaaa'), playlistNode('PLnone', 'None', '0 videos', 'aaaaaaaaaaa')] },
    playlistVideos: { PLwiped: ids('dd', 3).map((v) => [v, v]), PLnone: [] },
  });
  const c = make({ sources: [EN], playlists: { ...enUploads(), PLwiped: plRec('PLwiped', [], { signature: '3 videos|aaaaaaaaaaa' }), PLnone: plRec('PLnone', [], { signature: '0 videos|aaaaaaaaaaa' }) } });
  await c.refresh();
  assert.deepEqual(calls.playlistFetches, ['PLwiped:en'], 'a playlist whose badge says 0 stays as it is');
  assert.equal(c.playlists.PLwiped.videos.length, 3);
  assert.ok(logs.some((l) => /1 stale empty refetched/.test(l)), logs.join('\n'));
});

test('a full refresh falls back to the cached list when a playlist comes back empty', async (t) => {
  captureLogs(t);
  const ten = ids('ee', 10);
  const calls = fakeYouTube({ tabs: uploadsTab, playlists: { [EN.id]: [playlistNode('PLfull', 'Full', '10 videos', ten[0])] }, playlistVideos: { PLfull: [] }, playlistTotals: { PLfull: '10 videos' } });
  const c = make({ sources: [EN], playlists: { ...enUploads(), PLfull: plRec('PLfull', ten) } });
  await c.refresh({ full: true });
  assert.deepEqual(calls.playlistFetches, ['PLfull:en']);
  assert.equal(c.playlists.PLfull.videos.length, 10);
  // Full mode ignores the backoff: a manual rebuild asks again.
  await c.refresh({ full: true });
  assert.equal(calls.playlistFetches.length, 2);
  assert.equal(c.playlists.PLfull.videos.length, 10);
});

// ---- cache safety: playlists a listing omits ---------------------------------------------------
test('a playlist a complete listing omits is kept, probed by id and deleted only when YouTube says it is gone', async (t) => {
  const logs = captureLogs(t);
  const yt = {
    tabs: uploadsTab, playlists: { [EN.id]: [playlistNode('PLlisted', 'Listed', '1 video', 'aaaaaaaaaaa')] },
    playlistVideos: { PLlisted: [['aaaaaaaaaaa', 'A']], PLhidden: ids('ff', 4).map((v) => [v, v]) },
  };
  let calls = fakeYouTube(yt);
  const c = make({ sources: [EN], playlists: { ...enUploads(), PLlisted: plRec('PLlisted', ['aaaaaaaaaaa'], { signature: '1 video|aaaaaaaaaaa' }), PLhidden: plRec('PLhidden', ids('ff', 3)), PLgone: plRec('PLgone', ids('gg', 2)) } });
  await c.refresh();
  assert.deepEqual(calls.playlistFetches.sort(), ['PLgone:en', 'PLhidden:en']);
  // Answered: kept and refreshed, with the time it last answered; rechecked a day later.
  const hidden = c.playlists.PLhidden;
  assert.equal(hidden.videos.length, 4);
  assert.ok(hidden.missingSince && hidden.confirmedAt);
  assert.ok(Date.parse(hidden.retryAfter) > Date.now() + 23 * 3600e3);
  // Gone: deleted.
  assert.equal(c.playlists.PLgone, undefined);
  assert.ok(logs.some((l) => /^\[catalogue\] playlist PLgone .*: not listed and gone .*; deleted$/.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => /2 unlisted probed.* 2 newly unlisted, 1 deleted \(1 gone, 0 expired\)/.test(l)), logs.join('\n'));

  // The next refresh leaves it alone until the recheck is due, and keeps the first missingSince.
  const since = hidden.missingSince;
  calls = fakeYouTube(yt);
  await c.refresh();
  assert.deepEqual(calls.playlistFetches, []);
  assert.equal(c.playlists.PLhidden.missingSince, since);
  // Listed again: the missing marks are cleared.
  yt.playlists[EN.id].push(playlistNode('PLhidden', 'Hidden', '4 videos', 'ff000000000'));
  calls = fakeYouTube(yt);
  await c.refresh();
  assert.equal(c.playlists.PLhidden.missingSince, undefined);
  assert.equal(c.playlists.PLhidden.confirmedAt, undefined);
});

test('an unlisted playlist that cannot be read is backed off and deleted after 30 days without an answer', async (t) => {
  captureLogs(t);
  const yt = {
    tabs: uploadsTab, playlists: { [EN.id]: [playlistNode('PLlisted', 'Listed', '1 video', 'aaaaaaaaaaa')] },
    playlistVideos: { PLlisted: [['aaaaaaaaaaa', 'A']] }, playlistErrors: { PLold: 'boom', PLrecent: 'boom', PLanswered: 'boom' },
  };
  let calls = fakeYouTube(yt);
  const day = 864e5;
  const ago = (d) => new Date(Date.now() - d * day).toISOString();
  const c = make({ sources: [EN], playlists: {
    ...enUploads(), PLlisted: plRec('PLlisted', ['aaaaaaaaaaa'], { signature: '1 video|aaaaaaaaaaa' }),
    PLold: plRec('PLold', ids('hh', 2), { missingSince: ago(31) }),
    PLrecent: plRec('PLrecent', ids('ii', 2), { missingSince: ago(5) }),
    PLanswered: plRec('PLanswered', ids('jj', 2), { missingSince: ago(40), confirmedAt: ago(3) }),
    PLseeded: plRec('PLseeded', ids('kk', 2), { missingSince: ago(90), seeded: true, retryAfter: new Date(Date.now() + day).toISOString() }),
  } });
  await c.refresh();
  assert.equal(c.playlists.PLold, undefined, 'missing for 31 days and never answered');
  assert.equal(c.playlists.PLrecent.videos.length, 2);
  assert.equal(c.playlists.PLanswered.videos.length, 2, 'answered 3 days ago');
  assert.equal(c.playlists.PLseeded.videos.length, 2, 'seeded playlists do not expire');
  assert.deepEqual(calls.playlistFetches.sort(), ['PLanswered:en', 'PLrecent:en']);
  assert.equal(c.playlists.PLrecent.retries, 1, 'a failed probe backs off');
  calls = fakeYouTube(yt);
  await c.refresh();
  assert.deepEqual(calls.playlistFetches, []);
});

test('an incomplete channel listing marks nothing as missing', async (t) => {
  captureLogs(t);
  fakeYouTube({
    tabs: uploadsTab, playlists: { [EN.id]: [playlistNode('PLlisted', 'Listed', '1 video', 'aaaaaaaaaaa')] },
    playlistVideos: { PLlisted: [['aaaaaaaaaaa', 'A']], PLother: ids('ll', 2).map((v) => [v, v]) }, incompleteListing: [EN.id],
  });
  const c = make({ sources: [EN], playlists: { ...enUploads(), PLlisted: plRec('PLlisted', ['aaaaaaaaaaa'], { signature: '1 video|aaaaaaaaaaa' }), PLother: plRec('PLother', ids('ll', 2)) } });
  await c.refresh();
  assert.equal(c.playlists.PLother.missingSince, undefined);
  assert.equal(c.playlists.PLother.videos.length, 2);
});

// ---- cache safety: uploads window ---------------------------------------------------------------
test('worthyUpload and retainUploads: the cap trims only short, unknown or unavailable rows', () => {
  const details = { long1: { durationSec: 2700 }, gone1: { durationSec: 2700, unavailable: true }, priv1: { durationSec: 2700, isPrivate: true }, noemb: { durationSec: 2700, embeddable: false }, clip1: { durationSec: 90 } };
  const r = (id, durationSec = 0) => ({ id, durationSec });
  assert.equal(worthyUpload(r('long1'), details), true);
  assert.equal(worthyUpload(r('nodet', 1800), details), true, 'the listing badge counts when details are missing');
  assert.equal(worthyUpload(r('nodet'), details), false);
  for (const id of ['gone1', 'priv1', 'noemb', 'clip1']) assert.equal(worthyUpload(r(id), details), false, id);
  assert.equal(worthyUpload(r('clip1'), details, 60), true, 'minEpisodeSeconds is honoured');
  const rows = [r('n1', 2700), r('n2', 60), r('long1'), r('clip1'), r('gone1'), r('nodet')];
  assert.deepEqual(retainUploads(rows, 2, details).map((v) => v.id), ['n1', 'n2', 'long1']);
  assert.deepEqual(retainUploads(rows, 10, details).map((v) => v.id), rows.map((v) => v.id));
});

test('new uploads no longer evict cached episodes past maxUploads; a full refresh keeps the worthy ones', async (t) => {
  const logs = captureLogs(t);
  const src = { ...EN, maxUploads: 3 };
  // Cached list at its cap: old episodes and clips. Two new uploads arrive.
  const cachedRows = [row('old00000001', 'Old 1'), { ...row('clip0000001', 'Clip 1'), durationSec: 60 }, row('old00000002', 'Old 2'), row('gone0000001', 'Gone 1')];
  const details = { old00000001: { title: 'Old 1', durationSec: 2700 }, clip0000001: { title: 'Clip 1', durationSec: 60 }, old00000002: { title: 'Old 2', durationSec: 2700 }, gone0000001: { id: 'gone0000001', unavailable: true } };
  fakeYouTube({ tabs: { [src.id]: () => [[['new00000001', 'New 1'], ['new00000002', 'New 2'], ['old00000001', 'Old 1']]] } });
  const c = make({ sources: [src], playlists: uploads(src, cachedRows, { listedLang: 'en' }), details });
  await c.refresh();
  assert.deepEqual(c.playlists[`UPLOADS:${src.id}`].videos.map((v) => v.id), ['new00000001', 'new00000002', 'old00000001', 'old00000002']);
  assert.ok(logs.some((l) => /^\[uploads\] English Docs .* 2 new, 3 listed, 1 cached, 4 total, 2 short or unavailable rows trimmed past 3$/.test(l)), logs.join('\n'));
  // Full mode lists afresh but keeps worthy cached rows the listing did not reach; clips and unknown rows go.
  c.playlists[`UPLOADS:${src.id}`].videos.push({ ...row('clip0000001', 'Clip 1'), durationSec: 60 });
  fakeYouTube({ tabs: { [src.id]: () => [[['new00000003', 'New 3'], ['new00000001', 'New 1'], ['new00000002', 'New 2']], [['old00000001', 'Old 1']]] } });
  await c.refresh({ full: true });
  assert.deepEqual(c.playlists[`UPLOADS:${src.id}`].videos.map((v) => v.id), ['new00000003', 'new00000001', 'new00000002', 'old00000001', 'old00000002']);
});

// ---- seeds ------------------------------------------------------------------------------------------
test('seeds put back missing playlists as placeholders and missing uploads, and only once', (t) => {
  const logs = captureLogs(t);
  const OTHER = 'UCnotconfigured000000000';
  const seeds = {
    note: 'test',
    playlists: [
      { sourceId: EN.id, id: 'PLseed', title: 'Seeded', videos: ['sss00000001', 'sss00000002', 'nodetails01', { id: 'own00000001', title: 'Own row', durationSec: 1800 }] },
      { sourceId: EN.id, id: 'PLcached', title: 'Already cached', videos: ['sss00000001'] },
      { sourceId: OTHER, id: 'PLother', title: 'Other source', videos: [] },
    ],
    uploads: [
      { sourceId: EN.id, id: 'upl00000001', title: 'Evicted', published: '2025-03-01T00:00:00.000Z', durationSec: 2700 },
      { sourceId: EN.id, id: 'uuuuuuuuuuu', title: 'Already there', published: null, durationSec: 2700 },
      { sourceId: EN.id, id: 'gone0000001', title: 'Removed', published: null, durationSec: 2700 },
      { sourceId: OTHER, id: 'upl00000002', title: 'Other source', published: null, durationSec: 2700 },
    ],
  };
  const details = { sss00000001: { title: 'Seed 1', durationSec: 2600 }, sss00000002: { title: 'Seed 2', durationSec: 2500 }, gone0000001: { unavailable: true } };
  const c = make({ sources: [EN], playlists: { ...enUploads(), PLcached: plRec('PLcached', ['ccccccccccc']) }, details });
  assert.deepEqual(c.applySeeds(seeds), { playlists: 1, uploads: 1 });
  assert.deepEqual(c.playlists.PLseed, { id: 'PLseed', title: 'Seeded', sourceId: EN.id, signature: null, seeded: true, videos: [
    { id: 'sss00000001', title: 'Seed 1', durationSec: 2600, seeded: true }, { id: 'sss00000002', title: 'Seed 2', durationSec: 2500, seeded: true },
    { id: 'own00000001', title: 'Own row', durationSec: 1800, seeded: true },
  ] });
  assert.deepEqual(c.playlists.PLcached.videos.map((v) => v.id), ['ccccccccccc']);
  assert.equal(c.playlists.PLother, undefined);
  assert.deepEqual(c.playlists[`UPLOADS:${EN.id}`].videos.map((v) => v.id), ['uuuuuuuuuuu', 'upl00000001']);
  assert.deepEqual(c.playlists[`UPLOADS:${EN.id}`].videos[1], { id: 'upl00000001', title: 'Evicted', published: '2025-03-01T00:00:00.000Z', durationSec: 2700, seeded: true });
  assert.ok(logs.includes('[catalogue] seeds: 1 playlists and 1 uploads restored from playlist-seeds.json'));
  assert.deepEqual(c.applySeeds(seeds), { playlists: 0, uploads: 0 }, 'applying again changes nothing');
});

test('a refresh fetches seeded placeholders; an empty answer keeps the seeded rows, two gone ones a day apart leave an empty placeholder', async (t) => {
  const logs = captureLogs(t);
  fs.writeFileSync(path.join(dir, 'playlist-seeds.json'), JSON.stringify({ note: 'test', playlists: [
    { sourceId: EN.id, id: 'PLgeo', title: 'Geo-limited', videos: ['sss00000001', 'sss00000002'] },
    { sourceId: EN.id, id: 'PLdeleted', title: 'Deleted', videos: ['sss00000003'] },
    { sourceId: EN.id, id: 'PLvisible', title: 'Visible', videos: ['sss00000004'] },
  ], uploads: [] }));
  t.after(() => fs.rmSync(path.join(dir, 'playlist-seeds.json'), { force: true }));
  const details = Object.fromEntries(['sss00000001', 'sss00000002', 'sss00000003', 'sss00000004'].map((id) => [id, { title: `Seed ${id}`, durationSec: 2600 }]));
  // CI lists none of them; PLgeo answers with no videos, PLdeleted as gone, PLvisible with its videos.
  const yt = {
    tabs: uploadsTab, playlists: { [EN.id]: [playlistNode('PLlisted', 'Listed', '1 video', 'aaaaaaaaaaa')] },
    playlistVideos: { PLlisted: [['aaaaaaaaaaa', 'A']], PLgeo: [], PLvisible: [['sss00000004', 'Seed 4'], ['sss00000005', 'Seed 5']] }, playlistTotals: { PLgeo: '2 videos' },
  };
  let calls = fakeYouTube(yt);
  const c = make({ sources: [EN], playlists: enUploads(), details });
  await c.refresh();
  assert.deepEqual(calls.playlistFetches.sort(), ['PLdeleted:en', 'PLgeo:en', 'PLlisted:en', 'PLvisible:en']);
  assert.deepEqual(c.playlists.PLgeo.videos.map((v) => v.id), ['sss00000001', 'sss00000002']);
  assert.equal(c.playlists.PLgeo.retries, 1);
  // One "gone" answer is only reported: the seeded rows (which CI cannot fetch back) stay for a day.
  const reported = c.playlists.PLdeleted;
  assert.deepEqual([reported.videos.map((v) => v.id), reported.seeded, !!reported.gone, !!reported.goneSince], [['sss00000003'], true, false, true]);
  assert.ok(Date.parse(reported.retryAfter) >= Date.parse(reported.goneSince) + 24 * 3600e3, 'asked again a day later at the earliest');
  assert.ok(logs.some((l) => /warning: 1 unlisted seeded playlists answered "gone"; their rows are kept/.test(l)));
  assert.deepEqual(c.playlists.PLvisible.videos.map((v) => v.id), ['sss00000004', 'sss00000005']);
  assert.equal(c.playlists.PLvisible.seeded, true);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'playlists.json'), 'utf8'));
  assert.equal(saved.PLgeo.videos.length, 2);
  assert.equal(saved.PLdeleted.videos.length, 1);
  // A full refresh within the day asks again regardless of backoff: a second answer that soon does not count.
  calls = fakeYouTube(yt);
  await c.refresh({ full: true });
  assert.ok(calls.playlistFetches.includes('PLdeleted:en'));
  assert.deepEqual([c.playlists.PLdeleted.videos.length, c.playlists.PLdeleted.goneSince, !!c.playlists.PLdeleted.gone], [1, reported.goneSince, false]);
  // A day later (moved back by hand) the second "gone" answer empties it, and the run says so.
  const dayAgo = (iso) => new Date(Date.parse(iso) - 25 * 3600e3).toISOString();
  for (const pl of Object.values(c.playlists)) if (pl.retryAfter) pl.retryAfter = dayAgo(pl.retryAfter);
  c.playlists.PLdeleted.goneSince = dayAgo(c.playlists.PLdeleted.goneSince);
  calls = fakeYouTube(yt);
  logs.length = 0;
  await c.refresh();
  assert.ok(calls.playlistFetches.includes('PLdeleted:en'));
  assert.deepEqual([c.playlists.PLdeleted.videos.length, c.playlists.PLdeleted.seeded, !!c.playlists.PLdeleted.gone, c.playlists.PLdeleted.goneSince], [0, true, true, undefined]);
  assert.ok(logs.some((l) => l.includes('warning: 1 seeded playlists (1 rows) answered "gone" twice at least a day apart and were emptied')), logs.join('\n'));
  // The next refresh does not seed the gone playlist again, and every probe is backing off.
  calls = fakeYouTube(yt);
  await c.refresh();
  assert.deepEqual(calls.playlistFetches, []);
  assert.equal(c.playlists.PLdeleted.videos.length, 0);
  assert.deepEqual(c.applySeeds(), { playlists: 0, uploads: 0 });
});

test('a seeded playlist reported gone that answers again forgets the report', async (t) => {
  captureLogs(t);
  const details = { sss00000006: { title: 'Seed 6', durationSec: 2600 }, sss00000007: { title: 'Seed 7', durationSec: 2600 } };
  const goneSince = new Date(Date.now() - 2 * 24 * 3600e3).toISOString();
  const rec = (id, videos) => ({ id, title: id, sourceId: EN.id, signature: null, seeded: true, goneSince, retryAfter: goneSince, videos: videos.map((v) => ({ id: v, title: details[v].title, durationSec: 2600, seeded: true })) });
  const playlists = { ...enUploads(), PLback: rec('PLback', ['sss00000006', 'sss00000007']), PLempty: rec('PLempty', ['sss00000006']) };
  // Both answer again: PLback with its rows and a new one (stored), PLempty with nothing (its cached rows are kept).
  fakeYouTube({ tabs: uploadsTab, playlists: { [EN.id]: [playlistNode('PLlisted', 'Listed', '1 video', 'aaaaaaaaaaa')] }, playlistVideos: { PLlisted: [['aaaaaaaaaaa', 'A']], PLback: [['sss00000006', 'Seed 6'], ['sss00000007', 'Seed 7'], ['new00000001', 'New']], PLempty: [] }, playlistTotals: { PLempty: '1 video' } });
  const c = make({ sources: [EN], playlists, details });
  await c.refresh();
  assert.deepEqual([c.playlists.PLback.videos.map((v) => v.id), c.playlists.PLback.goneSince, !!c.playlists.PLback.gone, c.playlists.PLback.seeded], [['sss00000006', 'sss00000007', 'new00000001'], undefined, false, true]);
  assert.deepEqual([c.playlists.PLempty.videos.map((v) => v.id), c.playlists.PLempty.goneSince, !!c.playlists.PLempty.gone], [['sss00000006'], undefined, false]);
});

test('mergePlaylistRows keeps cached rows a fetch did not return, in their place, unless the count or details confirm they went', () => {
  const rows = (...list) => list.map((id) => ({ id }));
  const idsOf = (m) => m.videos.map((v) => v.id);
  const cached = { videos: rows('a', 'h1', 'b', 'h2', 'h3', 'c') };
  const fetched = rows('n', 'a', 'b', 'c');
  let m = mergePlaylistRows(fetched, cached, { expected: 10 });
  assert.deepEqual(idsOf(m), ['n', 'a', 'h1', 'b', 'h2', 'h3', 'c'], 'each kept row follows the cached row before it');
  assert.deepEqual([m.kept, m.dropped, m.reason], [3, 0, null]);
  assert.deepEqual(idsOf(mergePlaylistRows(rows('a', 'b'), { videos: rows('h0', 'a', 'h0', 'b') }, { expected: 5 })), ['h0', 'a', 'b'], 'rows before any returned one lead; duplicates are kept once');
  for (const expected of [null, 0, 7]) assert.equal(mergePlaylistRows(fetched, cached, { expected }).kept, 3, `count ${expected} does not confirm the shrink`);
  // The fetch returned the playlist's whole count: the shrink is real.
  m = mergePlaylistRows(fetched, cached, { expected: 4 });
  assert.deepEqual([idsOf(m), m.kept, m.dropped, m.reason], [['n', 'a', 'b', 'c'], 0, 3, 'complete']);
  // Details say the video is gone or private: dropped. Not embeddable stays (the catalogue hides it).
  m = mergePlaylistRows(fetched, cached, { expected: 10, details: { h1: { unavailable: true }, h2: { isPrivate: true }, h3: { embeddable: false } } });
  assert.deepEqual([idsOf(m), m.kept, m.dropped, m.reason], [['n', 'a', 'b', 'h3', 'c'], 1, 2, 'unavailable']);
  m = mergePlaylistRows(fetched, cached, { expected: 10, details: { h1: { unavailable: true }, h2: { unavailable: true }, h3: { isPrivate: true } } });
  assert.deepEqual([idsOf(m), m.kept, m.dropped, m.reason], [['n', 'a', 'b', 'c'], 0, 3, 'unavailable']);
  // Nothing missing, or nothing cached: the fetched rows as they are.
  assert.equal(mergePlaylistRows(fetched, { videos: rows('a', 'b') }, { expected: 10 }).videos, fetched);
  assert.equal(mergePlaylistRows(fetched, undefined).videos, fetched);
});

test('a stored playlist fetch keeps the cached rows it did not return (seeded rows included), logs it, and drops them only when the count or details confirm', async (t) => {
  const logs = captureLogs(t);
  const seedIds = ids('se', 25), wide = ids('wd', 25);
  fs.writeFileSync(path.join(dir, 'playlist-seeds.json'), JSON.stringify({ note: 'test', playlists: [{ sourceId: EN.id, id: 'PLmena', title: 'MENA only', videos: seedIds }], uploads: [] }));
  t.after(() => fs.rmSync(path.join(dir, 'playlist-seeds.json'), { force: true }));
  const details = Object.fromEntries([...seedIds, ...wide].map((id) => [id, { title: `Title ${id}`, durationSec: 2700 }]));
  // CI does not list the seeded PLmena, and its probe shows 18 of the 25 seeded rows (badge 34): judged 'ok'.
  // PLwide was cached with 25 rows from a machine that sees more; its badge moves to 26 and CI sees 18 of them plus a new one.
  const yt = {
    tabs: uploadsTab, playlists: { [EN.id]: [playlistNode('PLwide', 'Wide', '26 videos', wide[0])] },
    playlistVideos: { PLmena: seedIds.slice(0, 18).map((v) => [v, v]), PLwide: [...wide.slice(0, 18), 'wdnew000001'].map((v) => [v, v]) },
    playlistTotals: { PLmena: '34 videos', PLwide: '26 videos' },
  };
  assert.equal(judgePlaylist({ videos: seedIds.slice(0, 18), expectedCount: 34 }, { videos: seedIds }), 'ok');
  fakeYouTube(yt);
  const c = make({ sources: [EN], playlists: { ...enUploads(), PLwide: plRec('PLwide', wide, { signature: `25 videos|${wide[0]}` }) }, details });
  await c.refresh();
  assert.deepEqual(c.playlists.PLmena.videos.map((v) => v.id), seedIds, 'the 7 seeded rows CI cannot see stay, in their place');
  assert.equal(c.playlists.PLmena.seeded, true);
  assert.equal(c.playlists.PLmena.expectedCount, 34);
  assert.deepEqual(c.playlists.PLwide.videos.map((v) => v.id), [...wide, 'wdnew000001']);
  assert.equal(c.playlists.PLwide.signature, `26 videos|${wide[0]}`);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'playlists.json'), 'utf8'));
  assert.deepEqual([saved.PLmena.videos.length, saved.PLwide.videos.length], [25, 26]);
  assert.ok(logs.includes('[catalogue] playlist PLmena "MENA only" of English Docs (UCenglishchannel000000aa): 18 videos returned for 25 cached (badge 34); 7 cached videos it did not return kept'), logs.join('\n'));
  assert.ok(logs.includes('[catalogue] playlist PLwide "Wide" of English Docs (UCenglishchannel000000aa): 19 videos returned for 25 cached (badge 26); 7 cached videos it did not return kept'), logs.join('\n'));
  assert.ok(logs.some((l) => /^\[catalogue\] playlists: .*; cached videos a stored fetch did not return: 14 kept \(2 playlists\), 0 dropped$/.test(l)), logs.join('\n'));

  // The unlisted recheck a day later: the same partial view keeps them again, and nothing needs re-seeding.
  c.playlists.PLmena.retryAfter = past;
  fakeYouTube(yt);
  logs.length = 0;
  await c.refresh();
  assert.equal(c.playlists.PLmena.videos.length, 25);
  assert.ok(!logs.some((l) => l.includes('seeds:')), logs.join('\n'));
  // Details say two of the hidden rows are gone or private: only those go.
  c.details[seedIds[20]] = { ...c.details[seedIds[20]], unavailable: true };
  c.details[seedIds[21]] = { ...c.details[seedIds[21]], isPrivate: true };
  c.playlists.PLmena.retryAfter = past;
  fakeYouTube(yt);
  logs.length = 0;
  await c.refresh();
  assert.deepEqual(c.playlists.PLmena.videos.map((v) => v.id), seedIds.filter((_, i) => i !== 20 && i !== 21));
  // The record now carries the title the playlist itself gives.
  assert.ok(logs.includes('[catalogue] playlist PLmena "Playlist PLmena" of English Docs (UCenglishchannel000000aa): 18 videos returned for 25 cached (badge 34); '
    + '5 cached videos it did not return kept; 2 cached videos it did not return dropped (unavailable or private)'), logs.join('\n'));
  // A fetch that returns the playlist's whole count confirms the shrink: the rows it did not return go.
  const node19 = playlistNode('PLwide', 'Wide', '19 videos', wide[0]);
  fakeYouTube({ ...yt, playlists: { [EN.id]: [node19] }, playlistTotals: { ...yt.playlistTotals, PLwide: '19 videos' } });
  logs.length = 0;
  await c.refresh();
  assert.deepEqual(c.playlists.PLwide.videos.map((v) => v.id), [...wide.slice(0, 18), 'wdnew000001']);
  assert.ok(logs.includes('[catalogue] playlist PLwide "Wide" of English Docs (UCenglishchannel000000aa): 19 videos returned for 26 cached (badge 19); '
    + '7 cached videos it did not return dropped (the playlist count confirms the shrink)'), logs.join('\n'));
});

test('seeded uploads the uploads merge would trim again are not seeded, so no refresh restores and trims them in a loop', async (t) => {
  const logs = captureLogs(t);
  const src = { ...EN, maxUploads: 2 };
  const seed = (id, durationSec = 2700) => ({ sourceId: src.id, id, title: `Seed ${id}`, published: null, durationSec });
  const details = {
    aaaaaaaaaaa: { title: 'A', durationSec: 2700 }, bbbbbbbbbbb: { title: 'B', durationSec: 2700 },
    noembed0001: { title: 'No embed', durationSec: 2700, embeddable: false }, private0001: { title: 'Private', durationSec: 2700, isPrivate: true },
    unavail0001: { title: 'Gone', durationSec: 2700, unavailable: true }, okupload001: { title: 'Fine', durationSec: 2700, embeddable: true },
  };
  const listed = () => uploads(src, [row('aaaaaaaaaaa', 'A'), row('bbbbbbbbbbb', 'B')], { listedLang: 'en' });
  // The same rule as worthyUpload: unavailable, private, not embeddable or short (details or the seed's own duration) is skipped.
  const c0 = make({ sources: [src], playlists: listed(), details });
  const all = { note: 'test', playlists: [], uploads: [seed('noembed0001'), seed('private0001'), seed('unavail0001'), seed('shortup0001', 300), seed('okupload001')] };
  assert.deepEqual(c0.applySeeds(all), { playlists: 0, uploads: 1 });
  assert.deepEqual(c0.playlists[`UPLOADS:${src.id}`].videos.map((v) => v.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'okupload001']);
  assert.deepEqual(c0.applySeeds(all, { minSec: 60 }), { playlists: 0, uploads: 1 }, 'minEpisodeSeconds is honoured');

  // Three refreshes with a seed whose embedding is disabled, the channel at its cap: never restored, never trimmed.
  fs.writeFileSync(path.join(dir, 'playlist-seeds.json'), JSON.stringify({ note: 'test', playlists: [], uploads: [seed('noembed0001')] }));
  t.after(() => fs.rmSync(path.join(dir, 'playlist-seeds.json'), { force: true }));
  fakeYouTube({ tabs: { [src.id]: () => [[['aaaaaaaaaaa', 'A'], ['bbbbbbbbbbb', 'B']]] } });
  const c = make({ sources: [src], playlists: listed(), details });
  for (let run = 0; run < 3; run++) {
    logs.length = 0;
    await c.refresh();
    assert.deepEqual(c.playlists[`UPLOADS:${src.id}`].videos.map((v) => v.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    assert.ok(!logs.some((l) => l.includes('seeds:') || l.includes('trimmed past')), logs.join('\n'));
  }
  // Once it embeds again it is seeded, once, and kept past the cap.
  c.details.noembed0001 = { ...c.details.noembed0001, embeddable: true };
  logs.length = 0;
  await c.refresh();
  assert.ok(logs.includes('[catalogue] seeds: 0 playlists and 1 uploads restored from playlist-seeds.json'), logs.join('\n'));
  logs.length = 0;
  await c.refresh();
  assert.deepEqual(c.playlists[`UPLOADS:${src.id}`].videos.map((v) => v.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'noembed0001']);
  assert.ok(!logs.some((l) => l.includes('seeds:')), logs.join('\n'));
});

test('the committed playlist-seeds.json is well formed and names configured channels', () => {
  const repoData = new URL('../data/', import.meta.url);
  const seeds = JSON.parse(fs.readFileSync(new URL('playlist-seeds.json', repoData), 'utf8'));
  const sources = new Set(JSON.parse(fs.readFileSync(new URL('sources.json', repoData), 'utf8')).sources.map((s) => s.id));
  assert.equal(typeof seeds.note, 'string');
  assert.ok(seeds.playlists.length > 0 && seeds.uploads.length > 0);
  const plIds = new Set();
  for (const p of seeds.playlists) {
    assert.ok(sources.has(p.sourceId), p.sourceId);
    assert.match(p.id, /^PL[\w-]+$/);
    assert.ok(!plIds.has(p.id), `duplicate ${p.id}`);
    plIds.add(p.id);
    assert.ok(p.title);
    for (const v of p.videos) assert.match(typeof v === 'string' ? v : v.id, /^[\w-]{11}$/);
  }
  for (const u of seeds.uploads) {
    assert.ok(sources.has(u.sourceId), u.sourceId);
    assert.match(u.id, /^[\w-]{11}$/);
    assert.ok(u.title && u.durationSec >= 420);
  }
  assert.deepEqual(seeds.counts, { playlists: seeds.playlists.length, playlistVideos: seeds.playlists.reduce((a, p) => a + p.videos.length, 0), uploads: seeds.uploads.length });
});

// ---- video details: stub retry and rolling re-check ---------------------------------------------------
const HOUR_MS = 3600e3, DAY_MS = 24 * HOUR_MS;
const T0 = Date.parse('2026-10-19T12:00:00.000Z');
const at = (ms) => new Date(ms).toISOString();
const good = (id, extra = {}) => ({ id, title: `Title ${id}`, description: `About ${id}`, durationSec: 2700, viewCount: 10, publishedAt: '2026-01-01T00:00:00-08:00', category: 'Education', keywords: [], isPrivate: false, playable: false, fetchedAt: at(T0 - 30 * DAY_MS), ...extra });
const stubRec = (id, fetchedAt) => ({ id, title: '', description: '', durationSec: 0, viewCount: 0, publishedAt: null, category: null, keywords: [], isPrivate: false, playable: false, fetchedAt, fallback: true });
const goneAnswer = (id) => ({ id, gone: true, status: 'ERROR', reason: 'This video is unavailable', fetchedAt: at(T0) });

test('mergeDetails: two "gone" checks mark a video unavailable, data clears the marks, stubs never replace data', () => {
  const now = at(T0);
  // First report: counted, not yet marked; the data stays.
  let m = mergeDetails(good('aaaaaaaaaaa'), goneAnswer('aaaaaaaaaaa'), now);
  assert.equal(m.change, 'reported');
  assert.deepEqual([m.record.unavailable, m.record.unavailableChecks, m.record.unavailableSince, m.record.unavailableReason, m.record.title], [undefined, 1, now, 'ERROR: This video is unavailable', 'Title aaaaaaaaaaa']);
  // Second consecutive report: unavailable (contract 1), first report time kept.
  const later = at(T0 + 6 * HOUR_MS);
  m = mergeDetails(m.record, goneAnswer('aaaaaaaaaaa'), later);
  assert.deepEqual([m.change, m.record.unavailable, m.record.unavailableChecks, m.record.unavailableSince, m.record.checkedAt], ['confirmed', true, 2, now, later]);
  m = mergeDetails(m.record, goneAnswer('aaaaaaaaaaa'), later);
  assert.deepEqual([m.change, m.record.unavailableChecks], ['still-unavailable', 3]);
  // A stub answer (bot check, fallback without data) is not a check: nothing changes but checkedAt.
  const stubbed = mergeDetails(m.record, stubRec('aaaaaaaaaaa', later), at(T0 + 7 * HOUR_MS));
  assert.deepEqual([stubbed.change, stubbed.record.unavailable, stubbed.record.unavailableChecks, stubbed.record.title], ['stub', true, 3, 'Title aaaaaaaaaaa']);
  // It plays again: every unavailability field goes.
  m = mergeDetails(stubbed.record, good('aaaaaaaaaaa', { viewCount: 99, fetchedAt: later }), later);
  assert.equal(m.change, 'restored');
  for (const k of ['unavailable', 'unavailableChecks', 'unavailableSince', 'unavailableReason']) assert.equal(k in m.record, false, k);
  assert.equal(m.record.viewCount, 99);
  // An unconfirmed report followed by data is cleared.
  const reported = mergeDetails(good('bbbbbbbbbbb'), goneAnswer('bbbbbbbbbbb'), now).record;
  assert.equal(mergeDetails(reported, good('bbbbbbbbbbb'), later).change, 'cleared');
  // A legacy single-check mark (unavailable without a count) is confirmed by the next report.
  m = mergeDetails({ id: 'ccccccccccc', unavailable: true, status: 'ERROR', fetchedAt: '2026-10-15T00:00:00Z' }, goneAnswer('ccccccccccc'), now);
  assert.deepEqual([m.change, m.record.unavailableChecks, m.record.unavailableSince], ['confirmed', 2, '2026-10-15T00:00:00Z']);
  // A new id reported gone: a record without data that waits for confirmation.
  m = mergeDetails(undefined, goneAnswer('ddddddddddd'), now);
  assert.deepEqual([m.change, m.record.id, m.record.unavailableChecks, m.record.unavailable], ['reported', 'ddddddddddd', 1, undefined]);
});

test('mergeDetails: stubs, fallbacks and fresh /player data', () => {
  const now = at(T0);
  // A stub never replaces data, but replaces a missing record or an older stub.
  assert.deepEqual(mergeDetails(good('aaaaaaaaaaa'), stubRec('aaaaaaaaaaa', now), now).record, { ...good('aaaaaaaaaaa'), checkedAt: now });
  assert.deepEqual(mergeDetails(undefined, stubRec('aaaaaaaaaaa', now), now).record, { ...stubRec('aaaaaaaaaaa', now), checkedAt: now });
  assert.equal(mergeDetails(stubRec('aaaaaaaaaaa', '2026-10-17T10:37:00Z'), stubRec('aaaaaaaaaaa', now), now).record.fetchedAt, now);
  // Fresh /player data replaces a stub: no fallback flag left, publish date filled.
  let m = mergeDetails(stubRec('aaaaaaaaaaa', '2026-10-17T10:37:00Z'), good('aaaaaaaaaaa', { fetchedAt: now }), now);
  assert.deepEqual([m.change, m.record.fallback, m.record.durationSec, m.dated], ['filled', undefined, 2700, true]);
  // A getBasicInfo fallback over /player data refreshes what it has and keeps the publish date and category.
  m = mergeDetails(good('aaaaaaaaaaa'), { id: 'aaaaaaaaaaa', title: 'Renamed', description: '', durationSec: 2701, viewCount: 50, publishedAt: null, category: null, fallback: true, fetchedAt: now }, now);
  assert.deepEqual([m.change, m.record.title, m.record.description, m.record.durationSec, m.record.viewCount, m.record.publishedAt, m.record.category, m.record.fallback, m.edited],
    ['updated', 'Renamed', 'About aaaaaaaaaaa', 2701, 50, '2026-01-01T00:00:00-08:00', 'Education', undefined, true]);
  // Re-check data: description, views and publish date refreshed; a missing date is kept from before.
  m = mergeDetails(good('aaaaaaaaaaa'), good('aaaaaaaaaaa', { description: 'New text', viewCount: 500, publishedAt: null, fetchedAt: now }), now);
  assert.deepEqual([m.record.description, m.record.viewCount, m.record.publishedAt, m.record.fetchedAt, m.edited, m.dated], ['New text', 500, '2026-01-01T00:00:00-08:00', now, true, false]);
  // Embeddability: a new answer sets it, an answer that does not tell keeps it.
  m = mergeDetails(good('aaaaaaaaaaa'), good('aaaaaaaaaaa', { embeddable: false }), now);
  assert.deepEqual([m.record.embeddable, m.embedOff], [false, true]);
  m = mergeDetails(m.record, good('aaaaaaaaaaa'), now);
  assert.deepEqual([m.record.embeddable, m.embedOff], [false, false]);
  m = mergeDetails(m.record, good('aaaaaaaaaaa', { embeddable: true }), now);
  assert.deepEqual([m.record.embeddable, m.embedOn], [true, true]);
});

test('planDetails: new ids, then stubs (bounded, oldest first), then a re-check in priority order', () => {
  const src = { ...EN, maxUploads: 400 };
  const listedIds = ['newlong0001', 'newclip0001', 'stubold0001', 'stubnew0001', 'stubrecent1', 'reported001', 'reportnow01', 'weak0000001', 'old00000001', 'old00000002', 'recent00001', 'legacygone1', 'confirmed01', 'livestream1', 'premiere001'];
  const rows = listedIds.map((id) => ({ id, title: id, durationSec: id === 'newclip0001' ? 60 : 2700 }));
  const playlists = { ...uploads(src, [...rows, { id: 'mf:e:some-slug', title: 'Myflixer row' }]) };
  const details = {
    stubold0001: stubRec('stubold0001', at(T0 - 3 * DAY_MS)),
    stubnew0001: stubRec('stubnew0001', at(T0 - 2 * DAY_MS)),
    stubrecent1: stubRec('stubrecent1', at(T0 - 10 * 60e3)), // asked ten minutes ago: not yet
    reported001: good('reported001', { unavailableChecks: 1, unavailableSince: at(T0 - 6 * HOUR_MS), checkedAt: at(T0 - 6 * HOUR_MS) }),
    reportnow01: good('reportnow01', { unavailableChecks: 1, unavailableSince: at(T0 - 20 * 60e3), checkedAt: at(T0 - 20 * 60e3) }), // within the hour
    weak0000001: good('weak0000001', { fallback: true, publishedAt: null, fetchedAt: at(T0 - 2 * DAY_MS) }),
    old00000001: good('old00000001', { fetchedAt: at(T0 - 30 * DAY_MS) }),
    old00000002: good('old00000002', { fetchedAt: at(T0 - 20 * DAY_MS), checkedAt: at(T0 - 8 * DAY_MS) }),
    recent00001: good('recent00001', { fetchedAt: at(T0 - 2 * DAY_MS) }), // re-checked once a week at most
    livestream1: good('livestream1', { durationSec: 0, isLive: true, fetchedAt: at(T0 - 2 * DAY_MS) }), // live: no duration yet, not weak
    premiere001: good('premiere001', { durationSec: 0, fetchedAt: at(T0 - 2 * DAY_MS) }), // over now? asked daily
    legacygone1: { id: 'legacygone1', unavailable: true, fetchedAt: at(T0 - 5 * DAY_MS) },
    confirmed01: good('confirmed01', { unavailable: true, unavailableChecks: 2, checkedAt: at(T0 - 40 * DAY_MS) }),
    unlisted001: stubRec('unlisted001', at(T0 - 9 * DAY_MS)), // in no playlist: never asked
    'mf:e:some-slug': { id: 'mf:e:some-slug', title: 'Myflixer', durationSec: 0 },
  };
  const plan = planDetails({ playlists, details, sources: [src], now: T0, stubLimit: 2, recheckLimit: 5 });
  assert.deepEqual(plan.fresh.map((j) => j.id), ['newlong0001', 'newclip0001']);
  assert.deepEqual(plan.fresh.map((j) => [j.kind, j.lang]), [['new', 'en'], ['new', 'en']]);
  assert.deepEqual(plan.stubs.map((j) => j.id), ['stubold0001', 'stubnew0001']);
  // Awaiting confirmation (an hour after the report), then weak records, then the oldest requests.
  assert.deepEqual(plan.recheck.map((j) => j.id), ['legacygone1', 'reported001', 'weak0000001', 'premiere001', 'confirmed01']);
  assert.deepEqual(plan.waiting, { fresh: 0, stubs: 2, recheck: 7 });
  const all = planDetails({ playlists, details, sources: [src], now: T0, stubLimit: 0, recheckLimit: 0 });
  assert.deepEqual([all.fresh.length, all.stubs.length, all.recheck.length], [2, 0, 0], 'limits of 0 switch the passes off; new ids are fetched without a newLimit');
});

test('planDetails: new ids long first and newest first, at most newLimit per run; the rest wait for the next refreshes', () => {
  const src = { ...AR };
  // Uploads rows dated by their age text (counted from listedAt, else the record's fetchedAt) or by an
  // RSS publish time; playlist rows by their age text. Rows of unknown age keep their order after the rest.
  const listedAt = '2026-10-19T00:00:00.000Z';
  const playlists = {
    ...uploads(src, [
      { id: 'old00000001', title: 'قديم', durationSec: 2700, relative: 'قبل سنتين', listedAt },
      { id: 'clip0000001', title: 'مقطع', durationSec: 60, relative: 'قبل ساعة واحدة', listedAt },
      { id: 'week0000001', title: 'أسبوع', durationSec: 2700, relative: 'قبل أسبوع واحد', listedAt },
      { id: 'undated0001', title: 'بلا تاريخ', durationSec: 2700 },
      { id: 'rss00000001', title: 'جديد', durationSec: 2700, published: '2026-10-18T20:00:00Z' },
    ]),
    PLshow: { id: 'PLshow', title: 'برنامج', sourceId: src.id, fetchedAt: listedAt, videos: [{ id: 'month000001', title: 'شهر', durationSec: 2700, relative: 'خلال 3 أشهر' }, { id: 'day00000001', title: 'يوم', durationSec: 2700, relative: '3 days ago' }] },
  };
  const plan = planDetails({ playlists, details: {}, sources: [src], now: T0 });
  assert.deepEqual(plan.fresh.map((j) => j.id), ['rss00000001', 'day00000001', 'week0000001', 'month000001', 'old00000001', 'undated0001', 'clip0000001']);
  assert.equal(plan.waiting.fresh, 0);
  const capped = planDetails({ playlists, details: {}, sources: [src], now: T0, newLimit: 3 });
  assert.deepEqual(capped.fresh.map((j) => j.id), ['rss00000001', 'day00000001', 'week0000001']);
  assert.equal(capped.waiting.fresh, 4);
  // The next run, with those three fetched, takes the next ones.
  const next = planDetails({ playlists, details: Object.fromEntries(capped.fresh.map((j) => [j.id, good(j.id)])), sources: [src], now: T0, newLimit: 3, recheckLimit: 0 });
  assert.deepEqual(next.fresh.map((j) => j.id), ['month000001', 'old00000001', 'undated0001']);
  assert.equal(listedRowTime({ published: '2026-10-18T20:00:00Z' }), Date.parse('2026-10-18T20:00:00Z'));
  assert.equal(listedRowTime({ relative: 'قبل 3 أيام', listedAt }), Date.parse(listedAt) - 3 * DAY_MS);
  assert.equal(listedRowTime({ relative: '2 weeks ago' }, { fetchedAt: listedAt }), Date.parse(listedAt) - 14 * DAY_MS);
  assert.equal(listedRowTime({ title: 'بلا تاريخ' }), null);
});

test('rows of a Shorts list get no details request; a known feed entry the uploads filters reject is not asked by the poll', async (t) => {
  const logs = captureLogs(t);
  const src = { ...AR, uploadsExclude: ['^\\W*السليط'] };
  const playlists = {
    ...uploads(src, [{ id: 'satire00001', title: 'السليط الإخباري | حلقة', durationSec: 900 }, { id: 'doc00000001', title: 'وثائقي', durationSec: 2700 }]),
    PLshorts: { id: 'PLshorts', title: 'المدوان #shorts', sourceId: src.id, videos: [{ id: 'short000001', title: 'مقطع', durationSec: 50 }] },
    PLshow: { id: 'PLshow', title: 'المدوان', sourceId: src.id, videos: [{ id: 'show0000001', title: 'حلقة', durationSec: 700 }] },
  };
  assert.deepEqual(planDetails({ playlists, details: {}, sources: [src], now: T0 }).fresh.map((j) => j.id).sort(), ['doc00000001', 'show0000001']);
  const c = make({ sources: [src], playlists });
  const asked = [];
  await c.fastPoll({
    fetchFeed: async () => [{ id: 'satire00001', title: 'السليط الإخباري | حلقة' }, { id: 'doc00000001', title: 'وثائقي' }],
    fetchDetails: async (id) => { asked.push(id); return { id, title: 'وثائقي', durationSec: 2700 }; },
  });
  assert.deepEqual(asked, ['doc00000001'], 'the listed row without details is asked again; the filtered one is not');
  assert.ok(logs.some((l) => /^\[poll\] 1\/1 feeds read, 2 entries, 0 unknown, 1 left out by sources.json uploads filters, 1 listed without a duration asked again$/.test(l)), logs.join('\n'));
});

test('refresh never fetches a Shorts list, whatever the channel\'s filters say', async (t) => {
  const logs = captureLogs(t);
  const calls = fakeYouTube({
    tabs: { [AR.id]: () => [[['aaaaaaaaaaa', 'أ']]] },
    playlists: { [AR.id]: [playlistNode('PLshorts1', 'المدوان #shorts', '30 videos', 'bbbbbbbbbbb'), playlistNode('PLshorts2', 'Short | روح', '12 videos', 'bbbbbbbbbbb'), playlistNode('PLshow', 'المدوان', '1 video', 'aaaaaaaaaaa'), playlistNode('PLfilm', 'Short Film Showcase', '1 video', 'aaaaaaaaaaa')] },
    playlistVideos: { PLshow: [['aaaaaaaaaaa', 'أ']], PLfilm: [['aaaaaaaaaaa', 'أ']], PLshorts1: [['bbbbbbbbbbb', 'ب']], PLshorts2: [['bbbbbbbbbbb', 'ب']] },
  });
  const c = make({ sources: [AR] });
  await c.refresh({ fetchDetails: async (id) => good(id) });
  assert.deepEqual(calls.playlistFetches.sort(), ['PLfilm:ar', 'PLshow:ar']);
  assert.ok(logs.some((l) => /^\[catalogue\] playlists: 2 cached, 2 fetched \(0 unlisted probed\), 2 Shorts lists skipped, /.test(l)), logs.join('\n'));
});

test('refresh drops the cached records of playlists it leaves out (Shorts lists, filtered ones), listed or not; seeded ones stay', async (t) => {
  const logs = captureLogs(t);
  const src = { ...AR, scanUploads: false, playlistsInclude: ['^الوثائقي', '^Playlist PL'] };
  const calls = fakeYouTube({
    playlists: { [src.id]: [playlistNode('PLshorts', 'المدوان #shorts', '30 videos', 'bbbbbbbbbbb'), playlistNode('PLtalk', 'برنامج حواري', '9 videos', 'ddddddddddd'), playlistNode('PLdoc', 'الوثائقي', '1 video', 'aaaaaaaaaaa')] },
    playlistVideos: { PLdoc: [['aaaaaaaaaaa', 'أ']], PLshorts: [['bbbbbbbbbbb', 'ب']], PLtalk: [['ddddddddddd', 'د']] },
  });
  const rec = (id, title, extra = {}) => ({ id, title, sourceId: src.id, signature: 'old|x', videos: [row('ccccccccccc', 'ج')], fetchedAt: past, ...extra });
  const playlists = {
    PLshorts: rec('PLshorts', 'المدوان #shorts'), // listed Shorts list
    PLtalk: rec('PLtalk', 'برنامج حواري'), // listed, rejected by playlistsInclude
    PLoldshorts: rec('PLoldshorts', 'Shorts | DW Documentary'), // unlisted Shorts list, as production holds them
    PLoldtalk: rec('PLoldtalk', 'حوار قديم', { missingSince: past }), // unlisted, rejected
    PLseeded: rec('PLseeded', 'حوار مزروع', { seeded: true, signature: null }), // unlisted, rejected, seeded: stays
    PLdoc: rec('PLdoc', 'الوثائقي'), // wanted
  };
  const c = make({ sources: [src], playlists });
  await c.refresh({ fetchDetails: async (id) => good(id) });
  assert.deepEqual(calls.playlistFetches, ['PLdoc:ar'], 'left-out records are neither fetched nor probed');
  assert.deepEqual(Object.keys(c.playlists).sort(), ['PLdoc', 'PLseeded']);
  assert.ok(logs.some((l) => /^\[catalogue\] playlists: 2 cached, 1 fetched \(0 unlisted probed\), 1 Shorts lists skipped, 1 left out by sources.json filters, 4 cached records of left-out playlists dropped, /.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => l.includes(`playlist PLoldshorts "Shorts | DW Documentary" of قناة (${src.id}): left out of the catalogue; cached record dropped`)), logs.join('\n'));
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'playlists.json'), 'utf8'))).sort(), ['PLdoc', 'PLseeded'], 'gone from playlists.json too');
  // Nothing left to drop on the next run; the seeded record is still left alone.
  const again = captureLogs(t);
  await c.refresh({ fetchDetails: async (id) => good(id) });
  assert.ok(again.some((l) => /^\[catalogue\] playlists: 2 cached, 0 fetched \(0 unlisted probed\), 1 Shorts lists skipped, 1 left out by sources.json filters, \d+ kept/.test(l)), again.join('\n'));
  assert.deepEqual(Object.keys(c.playlists).sort(), ['PLdoc', 'PLseeded']);
});

// A channel taken through its playlists only (Museum of The Future: scanUploads false, its الدحيح playlist).
const PO = { ...AR, id: 'UCplaylistonly000000000a', title: 'متحف', short: 'متحف', scanUploads: false, playlistsInclude: ['^الدحيح$'] };

test('the poll leaves a playlist-only channel (scanUploads: false) alone: no feed read, no uploads record, no film', async (t) => {
  const logs = captureLogs(t);
  const daheeh = { PLdaheeh: { id: 'PLdaheeh', title: 'الدحيح', sourceId: PO.id, videos: [row('daheeh00001', 'الدحيح | المدينة')] } };
  const c = make({ sources: [AR, PO], playlists: { ...daheeh } });
  const feeds = [], asked = [];
  await c.fastPoll({
    fetchFeed: async (id) => { feeds.push(id); return id === AR.id ? [{ id: 'arnew000001', title: 'وثائقي' }] : [{ id: 'talk0000001', title: 'متحف المستقبل | حوارات المستقبل: كيف ستبدو المدن في 2071؟' }]; },
    fetchDetails: async (id) => { asked.push(id); return { id, title: 'وثائقي', durationSec: 2400 }; },
  });
  assert.deepEqual(feeds, [AR.id]);
  assert.deepEqual(asked, ['arnew000001']);
  assert.equal(c.playlists[`UPLOADS:${PO.id}`], undefined);
  assert.deepEqual(c.playlists[`UPLOADS:${AR.id}`].videos.map((v) => v.id), ['arnew000001']);
  assert.ok(logs.includes('[poll] 1/1 feeds read (1 playlist-only channel not polled), 1 entries, 1 unknown'), logs.join('\n'));
  // Only playlist-only channels: nothing to poll, which is not an ingestion failure.
  const only = make({ sources: [PO], playlists: { ...daheeh } });
  const diff = await only.fastPoll({ fetchFeed: async () => { throw new Error('feed read'); }, fetchDetails: async () => { throw new Error('details asked'); } });
  assert.deepEqual(diff, { newShows: [], newEpisodes: [] });
});

test('an uploads record stored for a playlist-only channel gets no details work, and the refresh takes its playlists only', async (t) => {
  const logs = captureLogs(t);
  // Written by a poll before playlist-only channels were left alone: never listed and never trimmed.
  const playlists = {
    ...uploads(PO, [row('talk0000001', 'متحف المستقبل | حوارات المستقبل'), row('talk0000002', 'جلسة المنتدى')], { listedLang: null }),
    PLdaheeh: { id: 'PLdaheeh', title: 'الدحيح', sourceId: PO.id, fetchedAt: at(T0 - DAY_MS), videos: [row('daheeh00001', 'الدحيح | المدينة')] },
  };
  const details = { talk0000002: good('talk0000002', { fetchedAt: at(T0 - 9 * DAY_MS) }) };
  const plan = planDetails({ playlists, details, sources: [PO], now: T0 });
  assert.deepEqual(plan.fresh.map((j) => j.id), ['daheeh00001']);
  assert.deepEqual(plan.recheck.map((j) => j.id), [], 'a stored row of it is not re-checked either');
  const calls = fakeYouTube({
    playlists: { [PO.id]: [playlistNode('PLdaheeh', 'الدحيح', '1 video', 'daheeh00001'), playlistNode('PLtalks', 'Future Talks', '30 videos', 'talk0000001')] },
    playlistVideos: { PLdaheeh: [['daheeh00001', 'الدحيح | المدينة']], PLtalks: [['talk0000001', 'حوارات']] },
  });
  // The fake client titles a fetched playlist "Playlist <id>".
  const c = make({ sources: [{ ...PO, playlistsInclude: ['^الدحيح$', '^Playlist PLdaheeh$'] }], playlists, details: { ...details } });
  const asked = [];
  await c.refresh({ fetchDetails: async (id) => { asked.push(id); return good(id); } });
  assert.deepEqual(calls.pages, [], 'the uploads tab is not walked');
  assert.deepEqual(calls.playlistFetches, ['PLdaheeh:ar']);
  assert.deepEqual(asked, ['daheeh00001'], logs.join('\n'));
});

test('refreshDetails retries stored stubs (bounded per run) and fills them in', async (t) => {
  const logs = captureLogs(t);
  const ids = ['stub0000001', 'stub0000002', 'stub0000003'];
  const c = make({ sources: [EN], playlists: uploads(EN, ids.map((id) => row(id, id))), details: Object.fromEntries(ids.map((id, i) => [id, stubRec(id, at(T0 - (10 - i) * DAY_MS))])) });
  const asked = [];
  const answers = { stub0000001: good('stub0000001', { fetchedAt: at(T0) }), stub0000002: { ...stubRec('stub0000002', at(T0)), playerError: 'no videoDetails (LOGIN_REQUIRED: Sign in to confirm you are not a bot)' } };
  const report = await c.refreshDetails({ now: T0, stubLimit: 2, recheckLimit: 0, fetchDetails: async (id, o) => { asked.push(`${id}:${o.lang}`); return answers[id]; } });
  assert.deepEqual(asked, ['stub0000001:en', 'stub0000002:en']);
  assert.deepEqual([report.stubs, report.filled, report.noData], [2, 1, 1]);
  assert.equal(c.details.stub0000001.durationSec, 2700);
  assert.equal(c.details.stub0000001.fallback, undefined);
  assert.equal(c.details.stub0000002.checkedAt, at(T0), 'still a stub, now at the back of the queue');
  assert.ok(logs.some((l) => /^\[details\] 0 new, 2 stubs retried \(1 filled; 1 more waiting\), 0 re-checked/.test(l)), logs.join('\n'));
  assert.ok(logs.includes('[details] answers without data: 1 x no videoDetails (LOGIN_REQUIRED: Sign in to confirm you are not a bot)'), logs.join('\n'));
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'details.json'), 'utf8'));
  assert.equal(saved.stub0000001.durationSec, 2700);
  // Next run: the one never retried goes first.
  asked.length = 0;
  await c.refreshDetails({ now: T0 + 2 * HOUR_MS, stubLimit: 1, recheckLimit: 0, fetchDetails: async (id) => { asked.push(id); return stubRec(id, at(T0)); } });
  assert.deepEqual(asked, ['stub0000003']);
});

test('the rolling re-check refreshes data, records embedding, and marks a video unavailable only on two reports an hour or more apart', async (t) => {
  const logs = captureLogs(t);
  const listed = ['vanish00001', 'weak0000001', 'noembed0001', 'steady00001'];
  const details = {
    vanish00001: good('vanish00001', { fetchedAt: at(T0 - 30 * DAY_MS) }),
    weak0000001: good('weak0000001', { fallback: true, publishedAt: null, description: '', fetchedAt: at(T0 - 3 * DAY_MS) }),
    noembed0001: good('noembed0001', { fetchedAt: at(T0 - 29 * DAY_MS) }),
    steady00001: good('steady00001', { fetchedAt: at(T0 - 28 * DAY_MS) }),
  };
  const c = make({ sources: [EN], playlists: uploads(EN, listed.map((id) => row(id, id))), details });
  const asked = [];
  let answer = (id) => ({
    vanish00001: goneAnswer(id),
    weak0000001: good(id, { description: 'Full synopsis', viewCount: 4321, publishedAt: '2026-10-12T05:00:00-07:00', fetchedAt: at(T0) }),
    noembed0001: good(id, { embeddable: false, fetchedAt: at(T0) }),
    steady00001: good(id, { viewCount: 11, embeddable: true, fetchedAt: at(T0) }),
  })[id];
  const run = (now, extra = {}) => c.refreshDetails({ now, stubLimit: 0, recheckLimit: 10, fetchDetails: async (id) => { asked.push(id); return answer(id); }, ...extra });
  let report = await run(T0);
  assert.deepEqual(asked.sort(), [...listed].sort());
  assert.deepEqual([report.rechecked, report.reported, report.confirmed, report.embedOff, report.dated, report.updated], [4, 1, 0, 1, 1, 3]);
  assert.deepEqual([c.details.vanish00001.unavailableChecks, c.details.vanish00001.unavailable], [1, undefined], 'one report is not enough');
  assert.deepEqual([c.details.weak0000001.fallback, c.details.weak0000001.description, c.details.weak0000001.viewCount, c.details.weak0000001.publishedAt],
    [undefined, 'Full synopsis', 4321, '2026-10-12T05:00:00-07:00']);
  assert.equal(c.details.noembed0001.embeddable, false);
  assert.equal(c.details.steady00001.embeddable, true);
  assert.ok(logs.some((l) => /^\[details\] vanish00001 of English Docs \(UCenglishchannel000000aa\): YouTube says ERROR: This video is unavailable; checked again before it is marked$/.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => /^\[details\] noembed0001 of English Docs .*: embedding disabled/.test(l)), logs.join('\n'));
  // Half an hour later the report is not checked again yet; the others are not due for a week.
  asked.length = 0;
  await run(T0 + 30 * 60e3);
  assert.deepEqual(asked, []);
  // Two hours later a network error and a bot-check stub change nothing but checkedAt.
  asked.length = 0;
  answer = () => { throw new Error('socket hang up'); };
  report = await run(T0 + 2 * HOUR_MS);
  assert.deepEqual([asked, report.failed], [['vanish00001'], 1]);
  assert.deepEqual([c.details.vanish00001.unavailableChecks, c.details.vanish00001.unavailable, c.details.vanish00001.checkedAt], [1, undefined, at(T0 + 2 * HOUR_MS)]);
  answer = (id) => stubRec(id, at(T0));
  await run(T0 + 4 * HOUR_MS);
  assert.deepEqual([c.details.vanish00001.unavailableChecks, c.details.vanish00001.unavailable, c.details.vanish00001.title], [1, undefined, 'Title vanish00001']);
  // The next real report confirms it.
  answer = (id) => goneAnswer(id);
  report = await run(T0 + 6 * HOUR_MS);
  assert.equal(report.confirmed, 1);
  assert.deepEqual([c.details.vanish00001.unavailable, c.details.vanish00001.unavailableChecks, c.details.vanish00001.unavailableSince], [true, 2, at(T0)]);
  assert.ok(logs.some((l) => /^\[details\] vanish00001 of .*: unavailable \(ERROR: This video is unavailable\), reported since /.test(l)), logs.join('\n'));
  // A week later it is re-checked with the rest; it plays again and is unmarked.
  asked.length = 0;
  answer = (id) => good(id, { fetchedAt: at(T0 + 8 * DAY_MS) });
  report = await run(T0 + 8 * DAY_MS);
  assert.ok(asked.includes('vanish00001'));
  assert.equal(report.restored, 1);
  assert.equal('unavailable' in c.details.vanish00001, false);
  assert.ok(logs.some((l) => /^\[details\] vanish00001 of .*: plays again; unavailable mark removed$/.test(l)), logs.join('\n'));
});

test('many "gone" answers in one pass look like a block: none of them counts', async (t) => {
  const logs = captureLogs(t);
  const ids = Array.from({ length: 12 }, (_, i) => `blocked${String(i).padStart(4, '0')}`);
  const c = make({ sources: [EN], playlists: uploads(EN, ids.map((id) => row(id, id))), details: Object.fromEntries(ids.map((id) => [id, good(id)])) });
  const report = await c.refreshDetails({ now: T0, stubLimit: 0, recheckLimit: 50, fetchDetails: async (id) => goneAnswer(id) });
  assert.deepEqual([report.reported, report.goneIgnored], [0, 12]);
  assert.ok(ids.every((id) => !c.details[id].unavailableChecks && c.details[id].checkedAt === at(T0)));
  assert.ok(logs.includes('[details] 12 of 12 answers say the video is removed or private; that looks like a block, so none is counted'), logs.join('\n'));
  // A few reports among many answers are counted.
  const d = make({ sources: [EN], playlists: uploads(EN, ids.map((id) => row(id, id))), details: Object.fromEntries(ids.map((id) => [id, good(id)])) });
  const r2 = await d.refreshDetails({ now: T0, stubLimit: 0, recheckLimit: 50, fetchDetails: async (id) => (id === ids[0] ? goneAnswer(id) : good(id)) });
  assert.deepEqual([r2.reported, r2.goneIgnored], [1, 0]);
  // "Embedding disabled" for most answers at once is not recorded either; earlier values stay.
  const e = make({ sources: [EN], playlists: uploads(EN, ids.map((id) => row(id, id))), details: Object.fromEntries(ids.map((id, i) => [id, good(id, i === 0 ? { embeddable: true } : {})])) });
  const r3 = await e.refreshDetails({ now: T0, stubLimit: 0, recheckLimit: 50, fetchDetails: async (id) => good(id, { embeddable: false, viewCount: 77 }) });
  assert.deepEqual([r3.embedOff, r3.embedIgnored, r3.updated], [0, 12, 12]);
  assert.equal(e.details[ids[0]].embeddable, true);
  assert.ok(ids.slice(1).every((id) => !('embeddable' in e.details[id]) && e.details[id].viewCount === 77), 'the rest of the answer is kept');
  assert.ok(logs.includes('[details] 12 of 12 answers say embedding is disabled; that looks like a block, so none is recorded'), logs.join('\n'));
});

test('refresh runs the details passes with their per-run limits from the environment', async (t) => {
  const logs = captureLogs(t);
  const prev = { stub: process.env.DETAILS_STUB_RETRY_PER_RUN, recheck: process.env.DETAILS_RECHECK_PER_RUN };
  process.env.DETAILS_STUB_RETRY_PER_RUN = '1';
  process.env.DETAILS_RECHECK_PER_RUN = '1';
  t.after(() => { process.env.DETAILS_STUB_RETRY_PER_RUN = prev.stub; process.env.DETAILS_RECHECK_PER_RUN = prev.recheck; });
  fakeYouTube({ tabs: { [EN.id]: () => [[['newvideo001', 'New'], ['stub0000001', 'S1'], ['stub0000002', 'S2'], ['old00000001', 'O1'], ['old00000002', 'O2']]] } });
  const c = make({
    sources: [EN],
    playlists: uploads(EN, [row('stub0000001', 'S1'), row('stub0000002', 'S2'), row('old00000001', 'O1'), row('old00000002', 'O2')], { listedLang: 'en' }),
    details: {
      stub0000001: stubRec('stub0000001', '2026-10-15T01:00:00.000Z'), stub0000002: stubRec('stub0000002', '2026-10-17T10:37:00.000Z'),
      old00000001: good('old00000001', { fetchedAt: '2026-09-12T09:00:00.000Z' }), old00000002: good('old00000002', { fetchedAt: '2026-09-12T10:00:00.000Z' }),
    },
  });
  const asked = [];
  await c.refresh({ fetchDetails: async (id) => { asked.push(id); return good(id, { fetchedAt: new Date().toISOString() }); } });
  assert.deepEqual(asked, ['newvideo001', 'stub0000001', 'old00000001']);
  assert.ok(logs.some((l) => /^\[details\] 1 new, 1 stubs retried \(1 filled; 1 more waiting\), 1 re-checked \(1 updated, 0 edited, 1 publish dates filled; 1 more due\)/.test(l)), logs.join('\n'));
  assert.match(logs.find((l) => l.startsWith('[catalogue] refresh done')), /details 1 \(\+1 stubs retried, 1 re-checked\)/);
  assert.equal(c.details.stub0000001.durationSec, 2700);
  // A bad value falls back to the default instead of switching a pass off.
  assert.equal(envCount('DETAILS_NOT_SET_ANYWHERE', 300), 300);
  process.env.DETAILS_STUB_RETRY_PER_RUN = 'lots';
  assert.equal(envCount('DETAILS_STUB_RETRY_PER_RUN', 300), 300);
  process.env.DETAILS_STUB_RETRY_PER_RUN = '0';
  assert.equal(envCount('DETAILS_STUB_RETRY_PER_RUN', 300), 0);
});

test('DETAILS_NEW_PER_RUN caps the new-video details of a refresh (default 4000); the rest come with the next refreshes', async (t) => {
  const logs = captureLogs(t);
  const prev = process.env.DETAILS_NEW_PER_RUN;
  t.after(() => { if (prev === undefined) delete process.env.DETAILS_NEW_PER_RUN; else process.env.DETAILS_NEW_PER_RUN = prev; });
  delete process.env.DETAILS_NEW_PER_RUN;
  assert.equal(envCount('DETAILS_NEW_PER_RUN', 4000), 4000);
  process.env.DETAILS_NEW_PER_RUN = '2';
  fakeYouTube({ tabs: { [AR.id]: () => [[['new00000001', 'أ'], ['new00000002', 'ب'], ['new00000003', 'ج']]] } });
  const c = make({ sources: [AR] });
  const asked = [];
  const fetchDetails = async (id) => { asked.push(id); return good(id, { fetchedAt: new Date().toISOString() }); };
  await c.refresh({ fetchDetails });
  assert.deepEqual(asked, ['new00000001', 'new00000002'], 'listing order among rows of the same age');
  assert.ok(logs.some((l) => /^\[details\] 2 new \(1 more waiting for the next refreshes\), 0 stubs retried/.test(l)), logs.join('\n'));
  asked.length = 0;
  await c.refresh({ fetchDetails });
  assert.deepEqual(asked, ['new00000003']);
});

// ---- Myflixer job (documentaries.js and refreshMyflixer, with mocked fetch functions) ------------
const MF = { type: 'myflixer', id: 'myflixer', title: 'Myflixer', short: 'Myflixer', profile: 'myflixer', lang: 'en', scanUploads: false, maxUploads: 0, brands: ['Myflixer'] };
const MF_KEY = 'MYFLIXER:myflixer';
const poster = (wpId) => `https://myflixerz.day/wp-content/uploads/posters/${wpId}_medium.jpg`;
const mfFilm = (slug, title, extra = {}) => ({
  id: `mf:m:${slug}`, wpId: 1, slug, title, synopsis: `About ${title}`, thumb: poster(1), tags: ['documentary'], sourceUrl: `https://myflixerz.day/${slug}/`,
  durationSec: 0, views: null, publishedAt: '2026-10-16T11:34:30.000Z', ...extra,
});
const mfSeries = (wpId, slug, title, episodes, extra = {}) => ({
  id: `mf:s:${slug}`, wpId, slug, title, synopsis: `About ${title} [&hellip;]`, thumb: poster(wpId), tags: ['documentary'], sourceUrl: `https://myflixerz.day/series/${slug}/`,
  durationSec: 0, views: null, publishedAt: '2026-01-17T17:00:42.000Z', episodes, ...extra,
});
const mfEp = (slug, season, episode, title) => ({ id: `mf:e:${slug}`, slug, title, season, number: episode, episode, sourceUrl: `https://myflixerz.day/episodes/${slug}/` });
const episodeRows = (c) => c.playlists[MF_KEY].videos.filter((v) => v.id.startsWith('mf:e:'));

test('documentaries.js: Myflixer dates are site-local time (+03:00), runtimes unknown (0), no views; a failing episode page gives []', async () => {
  assert.equal(siteDate('2026-10-16T14:34:30'), '2026-10-16T11:34:30.000Z');
  assert.equal(siteDate('2026-10-16 14:34:30'), '2026-10-16T11:34:30.000Z');
  assert.equal(siteDate('2026-10-16T11:34:30Z'), '2026-10-16T11:34:30.000Z', 'a date with a zone keeps it');
  assert.equal(siteDate('2026-10-16T14:34:30+03:00'), '2026-10-16T11:34:30.000Z');
  assert.equal(siteDate('2026-01-17T20:00:42.000Z'), '2026-01-17T20:00:42.000Z', 'converting twice changes nothing');
  assert.deepEqual([siteDate('soon'), siteDate(null), siteDate('')], [null, null, null]);

  const item = (kind, slug, wpId, tags = ['documentary']) => ({
    id: `mf:${kind}:${slug}`, wpId, slug, title: slug, synopsis: '', tags, portrait: poster(wpId),
    publishedAt: '2026-10-16T14:34:30', firstAt: '2026-10-16T14:34:30', latestAt: '2026-10-17T09:00:00',
  });
  const asked = [], episodePages = [];
  const pages = (list) => async ({ page, perPage, category }) => { asked.push([page, perPage, category]); return { items: list[page - 1] || [], totalPages: list.length }; };
  const result = await fetchMyflixerCatalog({}, {
    fetchMovies: pages([[item('m', 'film-a', 1), item('m', 'action-film', 2, ['action'])], [item('m', 'film-b', 3)]]),
    fetchSeries: pages([[item('s', 'ok', 4), item('s', 'broken', 5), item('s', 'empty', 6)]]),
    fetchSeriesEpisodes: async (slug) => {
      episodePages.push(slug);
      if (slug === 'broken') throw new Error('timeout');
      return slug === 'ok' ? [mfEp('ok-1x1', 1, 1, 'One')] : [];
    },
  });
  assert.deepEqual(result.films.map((f) => f.slug), ['film-a', 'film-b'], 'the documentary boundary is enforced');
  assert.deepEqual(asked, [[1, 100, 212], [2, 100, 212], [1, 100, 212]], 'the request pattern is unchanged');
  assert.deepEqual(episodePages.sort(), ['broken', 'empty', 'ok']);
  for (const f of [...result.films, ...result.series]) {
    assert.deepEqual([f.durationSec, f.views, f.thumb], [0, null, f.portrait]);
    assert.deepEqual([f.publishedAt, f.firstAt, f.latestAt], ['2026-10-16T11:34:30.000Z', '2026-10-16T11:34:30.000Z', '2026-10-17T06:00:00.000Z']);
  }
  const bySlug = Object.fromEntries(result.series.map((s) => [s.slug, s]));
  assert.equal(bySlug.ok.episodes.length, 1);
  assert.deepEqual([bySlug.broken.episodes, bySlug.broken.episodesError], [[], 'timeout']);
  assert.deepEqual([bySlug.empty.episodes, bySlug.empty.episodesError], [[], undefined]);
});

test('Myflixer episode titles lose entities, escaped quotes and the repeated show and season/episode prefix', () => {
  const cases = [
    ['Surviving Earth – Season 1 Episode 1: When the Earth Burned', 'Surviving Earth', 1, 'When the Earth Burned'],
    ["999: What\\'s Your Emergency? Season 1 Episode 3", "999: What's Your Emergency?", 3, 'Episode 3'],
    ['Commando Missions Season 1 Episode 1', 'Missions Commandos', 1, 'Episode 1'], // English prefix, original-language show title
    ['The Beatles Anthology – S1995E1 – July &#8217;40 to March &#8217;63', 'The Beatles Anthology', 1, 'July ’40 to March ’63'],
    ['Sunderland &#8216;Til I Die – Season 2, Episode 1', 'Sunderland &#8216;Til I Die', 1, 'Episode 1'],
    ['Naples &#038; Campania', 'Rick Steves’ Europe', 4, 'Naples & Campania'],
    ['Pompeii: Out of Time with Tom Hiddleston – The Last Day', 'Pompeii: Out of Time with Tom Hiddleston', 1, 'The Last Day'],
    ['Episode 4', 'Show', 4, 'Episode 4'],
    ['', 'Show', 2, 'Episode 2'],
  ];
  for (const [title, show, n, want] of cases) assert.equal(myflixerEpisodeTitle(title, show, n), want, title);
  assert.equal(myflixerEpisodeTitle('When the Earth Burned', 'Surviving Earth', 1), 'When the Earth Burned', 'idempotent');
});

test('healMyflixerRow brings rows and details written by older code to the stored form, and only once', () => {
  const ep = {
    id: 'mf:e:tyson-season-1-episode-1-power', title: 'TYSON - S1E1: TYSON – Season 1 Episode 1: Power', showTitle: 'TYSON', episodeTitle: 'TYSON – Season 1 Episode 1: Power',
    parsed: { showTitle: 'TYSON', episodeTitle: 'TYSON – Season 1 Episode 1: Power', kind: 'series', number: 1, season: 1 },
    durationSec: 3000, durationText: '50:00', views: null, thumb: poster(1552516), tags: ['documentary'],
  };
  const epDetail = { id: ep.id, title: ep.episodeTitle, description: 'The life of Mike Tyson &#8212; one of the most feared [&hellip;]', durationSec: 3000, viewCount: null, publishedAt: '2026-10-14T16:35:06', playable: true };
  const h = healMyflixerRow(ep, epDetail);
  assert.deepEqual([h.video.title, h.video.episodeTitle, h.video.parsed.episodeTitle, h.video.durationSec, h.video.durationText], ['TYSON - S1E1: Power', 'Power', 'Power', 0, '']);
  assert.deepEqual([h.detail.title, h.detail.description, h.detail.durationSec, h.detail.publishedAt], ['Power', 'The life of Mike Tyson — one of the most feared', 0, '2026-10-14T13:35:06.000Z']);
  const again = healMyflixerRow(h.video, h.detail);
  assert.equal(again.video, h.video, 'a healed row is returned as it is');
  assert.equal(again.detail, h.detail);

  const raw = '&#8216;Twas the Fight Before Christmas';
  const film = { id: 'mf:m:twas-the-fight-before-christmas', title: raw, showTitle: raw, episodeTitle: 'Full film', parsed: { showTitle: raw, episodeTitle: 'Full film', kind: 'film', number: null, season: null }, durationSec: 5400, durationText: '1:30:00', views: null };
  const hf = healMyflixerRow(film, { id: film.id, title: raw, description: 'Fists &#038; carols', durationSec: 5400, viewCount: null, publishedAt: '2026-10-16T14:34:30' });
  assert.deepEqual([hf.video.title, hf.video.showTitle, hf.video.parsed.showTitle, hf.video.durationSec, hf.video.durationText], ['‘Twas the Fight Before Christmas', '‘Twas the Fight Before Christmas', '‘Twas the Fight Before Christmas', 0, '']);
  assert.deepEqual([hf.detail.title, hf.detail.description, hf.detail.durationSec, hf.detail.publishedAt], ['‘Twas the Fight Before Christmas', 'Fists & carols', 0, '2026-10-16T11:34:30.000Z']);
  // A runtime that is not the invented one stays; rows of other sources are not touched.
  const real = { ...h.video, durationSec: 2580, durationText: '43:00' };
  assert.equal(healMyflixerRow(real, null).video, real);
  const yt = { id: 'aaaaaaaaaaa', title: 'A &amp; B', durationSec: 3000 };
  assert.equal(healMyflixerRow(yt, {}).video, yt);
});

test('the Myflixer job stores display-ready rows with seriesId and no invented runtimes, logs one summary line, and skips a fresh cache', async (t) => {
  const logs = captureLogs(t);
  const c = make({ sources: [MF] });
  const catalogue = {
    films: [mfFilm('the-trial', 'The Trial &#038; the Verdict', { synopsis: 'Court &#8216;drama&#8217; [&hellip;]' })],
    series: [
      mfSeries(10, 'surviving-earth', 'Surviving Earth', [
        mfEp('surviving-earth-season-1-episode-1-when-the-earth-burned', 1, 1, 'Surviving Earth – Season 1 Episode 1: When the Earth Burned'),
        mfEp('surviving-earth-season-1-episode-2', 1, 2, 'Surviving Earth Season 1 Episode 2'),
      ]),
      mfSeries(11, 'air-disasters', 'Air Disasters', []),
    ],
  };
  let calls = 0;
  const fetchMyflixer = async (src, opts) => { calls++; assert.equal(src.id, 'myflixer'); assert.equal(opts.maxPages, 60); return structuredClone(catalogue); };
  await c.refresh({ fetchMyflixer });
  const videos = c.playlists[MF_KEY].videos;
  assert.equal(c.playlists[MF_KEY].signature, '3');
  const [film, e1, e2] = videos;
  assert.deepEqual([film.title, film.showTitle, film.parsed.showTitle, film.durationSec, film.durationText, film.views], ['The Trial & the Verdict', 'The Trial & the Verdict', 'The Trial & the Verdict', 0, '', null]);
  assert.deepEqual([e1.title, e1.episodeTitle, e1.parsed.episodeTitle, e1.seriesId, e1.durationSec, e1.durationText], ['Surviving Earth - S1E1: When the Earth Burned', 'When the Earth Burned', 'When the Earth Burned', 'mf:s:surviving-earth', 0, '']);
  assert.equal(e2.episodeTitle, 'Episode 2');
  assert.ok(videos.every((v) => !('addedAt' in v)), 'a first import is not "new"');
  const fd = c.details[film.id];
  assert.deepEqual([fd.title, fd.description, fd.durationSec, fd.viewCount, fd.publishedAt], ['The Trial & the Verdict', 'Court ‘drama’', 0, null, '2026-10-16T11:34:30.000Z']);
  assert.deepEqual([c.details[e1.id].title, c.details[e1.id].description, c.details[e1.id].durationSec, c.details[e1.id].publishedAt], ['When the Earth Burned', 'About Surviving Earth', 0, '2026-01-17T17:00:42.000Z']);
  assert.ok(videos.every((v) => c.seen[v.id]), 'first-seen dates are stamped');
  // No YouTube work in this refresh: details.json is still written for the Myflixer records.
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'details.json'), 'utf8'));
  assert.equal(saved[film.id].title, 'The Trial & the Verdict');
  assert.ok(logs.includes('[myflixer] Myflixer (myflixer): 1 films, 2 series, 1 series with episodes, 2 episodes; series without episodes: 0 failed with a cache (0 cached episodes kept), 1 failed without a cache'), logs.join('\n'));
  assert.ok(logs.includes('[myflixer] series air-disasters "Air Disasters": no episodes returned; nothing cached'));
  // Within MYFLIXER_CACHE the cached playlist is used as it is.
  await c.refresh({ fetchMyflixer });
  assert.equal(calls, 1);
});

test('a series whose episodes come back empty keeps its cached rows and details; added episodes get addedAt, imports do not', async (t) => {
  const logs = captureLogs(t);
  const c = make({ sources: [MF] });
  const T1 = Date.parse('2026-10-19T00:00:00.000Z'), T2 = T1 + 6 * 3600e3, T3 = T2 + 6 * 3600e3;
  const twist = (eps) => mfSeries(20, 'harlan-cobens-final-twist', 'Harlan Coben&#8217;s Final Twist', eps);
  const planet = (eps, extra) => mfSeries(21, 'blue-planet', 'Blue Planet', eps, extra);
  const others = (n) => Array.from({ length: n }, (_, i) => mfSeries(30 + i, `other-${i}`, `Other ${i}`, [mfEp(`other-${i}-1x1`, 1, 1, 'Pilot')]));
  const t1 = mfEp('final-twist-1x1', 1, 1, 'Season 1 Episode 1'), t2 = mfEp('final-twist-1x2', 1, 2, 'Season 1 Episode 2');
  const b1 = mfEp('blue-planet-1x1', 1, 1, 'One Ocean'), b2 = mfEp('blue-planet-1x2', 1, 2, 'The Deep');
  await c.refreshMyflixer(MF, { now: T1, fetchMyflixer: async () => ({ films: [mfFilm('a-film', 'A Film')], series: [twist([t1, t2]), planet([b1, b2]), ...others(10)] }) });
  assert.ok(c.playlists[MF_KEY].videos.every((v) => !('addedAt' in v)));
  const planetDetail = c.details['mf:e:blue-planet-1x1'];

  // Next run: Blue Planet's page fails, Final Twist gains S2E1, a new series arrives, another has nothing at all.
  const s2 = mfEp('final-twist-2x1', 2, 1, 'Final Twist – Season 2 Episode 1: Return');
  const r = await c.refreshMyflixer(MF, { now: T2, fetchMyflixer: async () => ({
    films: [mfFilm('a-film', 'A Film')],
    series: [twist([t1, t2, s2]), planet([], { episodesError: 'timeout' }), ...others(10), mfSeries(50, 'new-show', 'New Show', [mfEp('new-show-1x1', 1, 1, 'Start'), mfEp('new-show-1x2', 1, 2, 'End')]), mfSeries(51, 'never', 'Never Listed', [])],
  }) });
  assert.deepEqual([r.withEpisodes, r.failedCached, r.reused, r.failedEmpty, r.added, r.episodes], [12, 1, 2, 1, 1, 17]);
  const rows = Object.fromEntries(episodeRows(c).map((v) => [v.id, v]));
  assert.deepEqual([rows['mf:e:blue-planet-1x1']?.episodeTitle, rows['mf:e:blue-planet-1x2']?.seriesId], ['One Ocean', 'mf:s:blue-planet'], 'the failed series keeps its cached rows');
  assert.equal(c.details['mf:e:blue-planet-1x1'], planetDetail, 'and its details');
  assert.equal(rows['mf:e:final-twist-2x1'].addedAt, new Date(T2).toISOString(), 'an episode added to a listed series is dated by its first sighting');
  assert.equal(rows['mf:e:final-twist-2x1'].episodeTitle, 'Return');
  assert.equal(rows['mf:e:final-twist-1x1'].episodeTitle, 'Episode 1');
  assert.equal(rows['mf:e:final-twist-1x1'].showTitle, 'Harlan Coben’s Final Twist');
  for (const id of ['mf:e:final-twist-1x1', 'mf:e:new-show-1x1', 'mf:e:new-show-1x2']) assert.equal('addedAt' in rows[id], false, `${id}: first sighting of its series`);
  assert.ok(logs.includes('[myflixer] Myflixer (myflixer): 1 films, 14 series, 12 series with episodes, 17 episodes; series without episodes: 1 failed with a cache (2 cached episodes kept), 1 failed without a cache'), logs.join('\n'));
  assert.ok(logs.includes('[myflixer] series blue-planet "Blue Planet": no episodes returned (timeout); 2 cached episodes kept'));
  assert.ok(logs.includes('[myflixer] Myflixer (myflixer): 1 episodes added to series already listed (addedAt)'));

  // Blue Planet answers again: its episodes keep their old first sighting; S2E1 keeps its addedAt.
  const r3 = await c.refreshMyflixer(MF, { now: T3, fetchMyflixer: async () => ({ films: [mfFilm('a-film', 'A Film')], series: [twist([t1, t2, s2]), planet([b1, b2]), ...others(10)] }) });
  assert.equal(r3.added, 1);
  const rows3 = Object.fromEntries(episodeRows(c).map((v) => [v.id, v]));
  assert.equal(rows3['mf:e:final-twist-2x1'].addedAt, new Date(T2).toISOString());
  assert.equal('addedAt' in rows3['mf:e:blue-planet-1x1'], false);
});

test('series whose episode pages fail keep their cached rows without blocking the fetch; more than 10% failing is reported', async (t) => {
  const logs = captureLogs(t);
  const c = make({ sources: [MF] });
  const T1 = Date.parse('2026-10-19T00:00:00.000Z');
  const catalogue = (failing, title = 'A Film') => ({
    films: [mfFilm('a-film', title)],
    series: Array.from({ length: 10 }, (_, i) => mfSeries(60 + i, `s-${i}`, `Series ${i}`, i < failing ? [] : [mfEp(`s-${i}-1x1`, 1, 1, 'One'), mfEp(`s-${i}-1x2`, 1, 2, 'Two')])),
  });
  await c.refreshMyflixer(MF, { now: T1, fetchMyflixer: async () => catalogue(0) });
  // 2 of 10 listed series without episodes: their cached rows are kept, and the rest of the fetch (the renamed film) is stored.
  const two = await c.refreshMyflixer(MF, { now: T1 + 4 * 3600e3, fetchMyflixer: async () => catalogue(2, 'A Film, renamed') });
  assert.deepEqual([two.withEpisodes, two.failedCached, two.reused, two.episodes, two.delistedSeries, two.dropAccepted], [8, 2, 4, 20, 0, false]);
  assert.equal(c.details['mf:m:a-film'].title, 'A Film, renamed');
  assert.equal(episodeRows(c).length, 20);
  assert.ok(logs.includes('[myflixer] warning: Myflixer (myflixer): no episodes came back for 2 of 10 listed series (2 kept their 4 cached episodes, 0 had none cached)'), logs.join('\n'));
  // One in ten is within the margin: no warning.
  logs.length = 0;
  const one = await c.refreshMyflixer(MF, { now: T1 + 8 * 3600e3, fetchMyflixer: async () => catalogue(1) });
  assert.deepEqual([one.withEpisodes, one.failedCached, one.episodes], [9, 1, 20]);
  assert.ok(!logs.some((l) => l.includes('warning')), logs.join('\n'));
});

test('a listing that leaves out more than 10% of the cached series or films is refused twice over 10 hours, then accepted as removals: it never blocks later fetches for good', async (t) => {
  const logs = captureLogs(t);
  const c = make({ sources: [MF] });
  const H = 3600e3, T1 = Date.parse('2026-10-19T00:00:00.000Z');
  const series = (n) => Array.from({ length: n }, (_, i) => mfSeries(100 + i, `s-${i}`, `Series ${i}`, [mfEp(`s-${i}-1x1`, 1, 1, 'One')]));
  const imported = { films: [mfFilm('a', 'A')], series: series(10) };
  // s-8 and s-9 leave the listing (a purge, or a re-tag out of the documentary category); a new film arrives.
  const purged = () => ({ films: [mfFilm('a', 'A'), mfFilm('brand-new', 'Brand New Film')], series: series(8) });
  const ids = () => c.playlists[MF_KEY].videos.map((v) => v.id);
  await c.refreshMyflixer(MF, { now: T1, fetchMyflixer: async () => imported });
  const before = ids();
  const refused = async (now, n) => {
    await assert.rejects(c.refreshMyflixer(MF, { now, fetchMyflixer: async () => purged() }), (e) => {
      assert.equal(e.code, 'MYFLIXER_LISTING_DROP');
      assert.match(e.message, /^Myflixer \(myflixer\): the listing leaves out 2 of 10 cached series and 0 of 1 cached films \(more than 10 percent of either\); cached documentary playlist kept/);
      return true;
    });
    assert.deepEqual(ids(), before, 'the cached rows stay');
    assert.deepEqual([c.playlists[MF_KEY].dropRefusals, c.playlists[MF_KEY].dropSince], [n, new Date(T1 + 6 * H).toISOString()]);
  };
  await refused(T1 + 6 * H, 1);
  await refused(T1 + 12 * H, 2);
  // Seen again after two refusals and 12 hours: accepted, with a warning, and the count is cleared.
  const r = await c.refreshMyflixer(MF, { now: T1 + 18 * H, fetchMyflixer: async () => purged() });
  assert.deepEqual([r.dropAccepted, r.delistedSeries, r.delistedFilms, r.withEpisodes], [true, 2, 0, 8]);
  assert.ok(ids().includes('mf:m:brand-new'));
  assert.ok(!ids().some((id) => /^mf:e:s-[89]-/.test(id)), 'the delisted series are gone');
  assert.equal(c.playlists[MF_KEY].dropRefusals, undefined);
  assert.ok(logs.includes(`[myflixer] warning: Myflixer (myflixer): the listing leaves out 2 of 10 cached series and 0 of 1 cached films (more than 10 percent of either); accepted as removals (after 2 refusals in a row since ${new Date(T1 + 6 * H).toISOString()})`), logs.join('\n'));
  // The next fetch compares with the accepted playlist: nothing is refused any more.
  const next = await c.refreshMyflixer(MF, { now: T1 + 24 * H, fetchMyflixer: async () => purged() });
  assert.deepEqual([next.dropAccepted, next.delistedSeries], [false, 0]);

  // Refusals close together (a local server refreshing every 15 minutes) wait for the hold as well.
  const c2 = make({ sources: [MF] });
  await c2.refreshMyflixer(MF, { now: T1, fetchMyflixer: async () => imported });
  for (const m of [6 * H, 6.25 * H, 6.5 * H, 6.75 * H]) await assert.rejects(c2.refreshMyflixer(MF, { now: T1 + m, fetchMyflixer: async () => purged() }), { code: 'MYFLIXER_LISTING_DROP' });
  assert.equal(c2.playlists[MF_KEY].dropRefusals, 4);
  assert.equal((await c2.refreshMyflixer(MF, { now: T1 + 16 * H, fetchMyflixer: async () => purged() })).dropAccepted, true);
  // A fetch without the drop in between starts the count again.
  const c3 = make({ sources: [MF] });
  await c3.refreshMyflixer(MF, { now: T1, fetchMyflixer: async () => imported });
  await assert.rejects(c3.refreshMyflixer(MF, { now: T1 + 6 * H, fetchMyflixer: async () => purged() }), { code: 'MYFLIXER_LISTING_DROP' });
  await c3.refreshMyflixer(MF, { now: T1 + 12 * H, fetchMyflixer: async () => imported });
  assert.equal(c3.playlists[MF_KEY].dropRefusals, undefined);
  await assert.rejects(c3.refreshMyflixer(MF, { now: T1 + 18 * H, fetchMyflixer: async () => purged() }), { code: 'MYFLIXER_LISTING_DROP' });
  assert.deepEqual([c3.playlists[MF_KEY].dropRefusals, c3.playlists[MF_KEY].dropSince], [1, new Date(T1 + 18 * H).toISOString()]);
  // A full refresh accepts the drop at once.
  assert.equal((await c3.refreshMyflixer(MF, { full: true, now: T1 + 19 * H, fetchMyflixer: async () => purged() })).dropAccepted, true);
  // Films count too: a listing cut to half its films is refused, whatever the series do.
  const c4 = make({ sources: [MF] });
  const films = (n) => Array.from({ length: n }, (_, i) => mfFilm(`f-${i}`, `Film ${i}`));
  await c4.refreshMyflixer(MF, { now: T1, fetchMyflixer: async () => ({ films: films(20), series: series(10) }) });
  await assert.rejects(c4.refreshMyflixer(MF, { now: T1 + 6 * H, fetchMyflixer: async () => ({ films: films(10), series: series(10) }) }), /leaves out 0 of 10 cached series and 10 of 20 cached films/);
  // Removals within the margin are taken and logged.
  logs.length = 0;
  const small = await c4.refreshMyflixer(MF, { now: T1 + 12 * H, fetchMyflixer: async () => ({ films: films(19), series: series(10) }) });
  assert.deepEqual([small.delistedFilms, small.dropAccepted], [1, false]);
  assert.ok(logs.includes('[myflixer] Myflixer (myflixer): 0 cached series and 1 cached films are no longer listed; removed'), logs.join('\n'));
});

test('through refresh() a refused Myflixer drop is a warning (an annotation in Actions), the refusal count reaches playlists.json, and the rest of the refresh goes on', async (t) => {
  const logs = captureLogs(t);
  const c = make({ sources: [MF] });
  const series = (n) => Array.from({ length: n }, (_, i) => mfSeries(100 + i, `s-${i}`, `Series ${i}`, [mfEp(`s-${i}-1x1`, 1, 1, 'One')]));
  await c.refresh({ fetchMyflixer: async () => ({ films: [mfFilm('a', 'A')], series: series(10) }) });
  c.playlists[MF_KEY] = { ...c.playlists[MF_KEY], fetchedAt: '2026-01-01T00:00:00.000Z' };
  await c.refresh({ fetchMyflixer: async () => ({ films: [mfFilm('a', 'A')], series: series(8) }) });
  assert.ok(logs.some((l) => /^\[catalogue\] warning: myflixer fetch refused: Myflixer \(myflixer\): the listing leaves out 2 of 10 cached series .*refusal 1 in a row since /.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => l.startsWith('[catalogue] refresh done')), 'the refresh finishes');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'playlists.json'), 'utf8'))[MF_KEY];
  assert.deepEqual([saved.dropRefusals, saved.videos.length], [1, 11]);
});

test('ciWarning is a ::warning annotation in GitHub Actions (escaped, on its own line) and a plain line elsewhere', (t) => {
  const out = [];
  t.mock.method(console, 'log', (...a) => out.push(['log', a.join(' ')]));
  t.mock.method(console, 'warn', (...a) => out.push(['warn', a.join(' ')]));
  const saved = process.env.GITHUB_ACTIONS;
  t.after(() => { if (saved == null) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = saved; });
  delete process.env.GITHUB_ACTIONS;
  ciWarning('Myflixer listing shrank', 'cut by 10% here', '[myflixer]');
  process.env.GITHUB_ACTIONS = 'true';
  ciWarning('Myflixer: listing, shrank', 'cut by 10%\nhere');
  assert.deepEqual(out, [['warn', '[myflixer] warning: cut by 10% here'], ['log', '\n::warning title=Myflixer%3A listing%2C shrank::cut by 10%25%0Ahere']]);
});

test('rows stored before seriesId are found by poster when their series fails (titles collide, posters do not); cached rows are healed without a fetch', async (t) => {
  const logs = captureLogs(t);
  const old = (slug, title, wpId, n) => ({
    id: `mf:e:${slug}`, title: `${title} - S1E${n}: ${title} Season 1 Episode ${n}`, showTitle: title, episodeTitle: `${title} Season 1 Episode ${n}`,
    parsed: { showTitle: title, episodeTitle: `${title} Season 1 Episode ${n}`, kind: 'series', number: n, season: 1 },
    durationSec: 3000, durationText: '50:00', views: null, thumb: poster(wpId), tags: ['documentary'],
  });
  const oldDetail = (v) => ({ id: v.id, title: v.episodeTitle, description: 'x &#038; y', durationSec: 3000, viewCount: null, publishedAt: '2026-10-14T16:35:06', playable: true });
  const videos = [old('american-nightmare-1x1', 'American Nightmare', 151770, 1), old('american-nightmare-2024-1x1', 'American Nightmare', 379288, 1), old('american-nightmare-2024-1x2', 'American Nightmare', 379288, 2)];
  const playlist = { id: MF_KEY, title: 'Myflixer', sourceId: 'myflixer', signature: '3', videos, fetchedAt: new Date().toISOString() };
  const c = make({ sources: [MF], playlists: { [MF_KEY]: structuredClone(playlist) }, details: Object.fromEntries(videos.map((v) => [v.id, oldDetail(v)])) });
  // A fresh cache is not fetched again, but its rows and details are healed in place.
  let calls = 0;
  await c.refresh({ fetchMyflixer: async () => { calls++; return { films: [], series: [] }; } });
  assert.equal(calls, 0);
  assert.deepEqual(episodeRows(c).map((v) => [v.episodeTitle, v.durationSec, v.durationText]), [['Episode 1', 0, ''], ['Episode 1', 0, ''], ['Episode 2', 0, '']]);
  const healed = c.details['mf:e:american-nightmare-1x1'];
  assert.deepEqual([healed.durationSec, healed.publishedAt, healed.description], [0, '2026-10-14T13:35:06.000Z', 'x & y']);
  assert.ok(logs.includes('[myflixer] Myflixer (myflixer): 3 cached rows brought to the stored form (titles, synopses, dates, no invented runtimes)'), logs.join('\n'));
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'details.json'), 'utf8'));
  assert.equal(saved['mf:e:american-nightmare-1x1'].durationSec, 0, 'healed details are written');
  const lines = logs.length;
  await c.refresh({ fetchMyflixer: async () => { calls++; return { films: [], series: [] }; } });
  assert.ok(!logs.slice(lines).some((l) => l.includes('cached rows brought')), 'healing happens once');

  // The 2024 series (poster 379288) fails: only its own two rows come back from the cache (full: the
  // cached playlist is younger than three hours). Both series are still listed, so nothing counts as removed.
  const r = await c.refreshMyflixer(MF, { full: true, fetchMyflixer: async () => ({ films: [], series: [
    mfSeries(151770, 'american-nightmare', 'American Nightmare', [mfEp('american-nightmare-1x1', 1, 1, 'American Nightmare Season 1 Episode 1')]),
    mfSeries(379288, 'american-nightmare-2024', 'American Nightmare', []),
  ] }) });
  assert.deepEqual([r.withEpisodes, r.failedCached, r.reused], [1, 1, 2]);
  assert.deepEqual(episodeRows(c).map((v) => [v.id, v.seriesId]), [
    ['mf:e:american-nightmare-1x1', 'mf:s:american-nightmare'],
    ['mf:e:american-nightmare-2024-1x1', 'mf:s:american-nightmare-2024'], ['mf:e:american-nightmare-2024-1x2', 'mf:s:american-nightmare-2024'],
  ]);
});

test('uploads rows dated only by their age text carry the time they were listed (listedAt); rows not listed again keep theirs', async (t) => {
  captureLogs(t);
  const src = { ...EN };
  const old = '2026-01-01T00:00:00.000Z';
  fakeYouTube({ tabs: { [src.id]: () => [[['new00000001', 'New 1'], ['old00000001', 'Old 1']]] } });
  const cachedRows = [{ ...row('old00000001', 'Old 1'), listedAt: old }, { ...row('old00000002', 'Old 2'), listedAt: old }];
  const c = make({ sources: [src], playlists: uploads(src, cachedRows, { listedLang: 'en' }) });
  const before = Date.now() - 1000;
  await c.refresh();
  const rows = Object.fromEntries(c.playlists[`UPLOADS:${src.id}`].videos.map((v) => [v.id, v]));
  assert.ok(Date.parse(rows.new00000001.listedAt) >= before, 'a new row carries the listing time');
  assert.ok(Date.parse(rows.old00000001.listedAt) >= before, 'a row listed again has a new age text, and so a new listing time');
  assert.equal(rows.old00000002.listedAt, old, 'a cached row that was not listed again keeps its own');
});
