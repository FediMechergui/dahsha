import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Innertube, Parser, YTNodes } from 'youtubei.js';
import {
  mapVideoItem, mapPlaylistItem, listChannelUploads, listChannelPlaylists, getPlaylistVideos, setClientFactory, parseChannelFeed,
  getVideoDetails, isUnavailablePlayability, isDetailStub, oembedEmbeddable, parseCount, detectProfile, resolveSource,
} from '../src/youtube.js';
import { parseDuration } from '../src/text.js';

const arabic = (s) => /[؀-ۿ]/.test(s);
const fixture = (lang) => JSON.parse(fs.readFileSync(new URL(`./fixtures/ingest/innertube-${lang}.json`, import.meta.url), 'utf8'));

// InnerTube answers recorded on 2026-10-16 (server/test/fixtures/ingest), served through youtubei.js's
// fetch option so the real parser runs offline. Requests are keyed by path|browseId|params|continuation.
function replayFactory(fx, langs, misses) {
  const fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const raw = init.body ?? (typeof input?.clone === 'function' ? await input.clone().text() : '');
    let body = {};
    try { body = raw ? JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) : {}; } catch { /* not JSON */ }
    const key = `${url.pathname}|${body.browseId || ''}|${body.params || ''}|${body.continuation || ''}`;
    const hit = fx.responses.find((r) => r.key === key);
    if (!hit) { misses.push(key); return new Response('{}', { status: 404 }); }
    return new Response(typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body), { status: hit.status, headers: { 'content-type': 'application/json' } });
  };
  return (lang) => { langs.push(lang); return Innertube.create({ lang, location: lang === 'en' ? 'US' : 'AE', retrieve_player: false, fetch }); };
}

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

test('a relist (no known ids) walks past cached pages; complete tells an exhausted tab from a cut-off walk', async t => {
  t.after(() => setClientFactory(null));
  const ids = (n, from = 0) => Array.from({ length: n }, (_, i) => `vid${String(from + i).padStart(8, '0')}`);
  const tabOf = (pages) => async () => ({ getChannel: async () => ({ has_videos: true, getVideos: async () => pageAt(pages, 0) }) });
  const walked = [];
  const pageAt = (pages, i) => { walked.push(i); return { videos: pages[i].map((id) => node(id)), has_continuation: i < pages.length - 1, getContinuation: async () => pageAt(pages, i + 1) }; };
  // Exhausted: every page read.
  setClientFactory(tabOf([ids(3), ids(3, 3), ids(2, 6)]));
  let r = await listChannelUploads('channel', { lang: 'en', max: 400, knownIds: null });
  assert.deepEqual([r.videos.length, r.complete, walked], [8, true, [0, 1, 2]]);
  // Stopped by max: not complete, but every wanted row was listed.
  walked.length = 0;
  setClientFactory(tabOf([ids(3), ids(3, 3), ids(3, 6), ids(3, 9)]));
  r = await listChannelUploads('channel', { lang: 'en', max: 5, knownIds: null });
  assert.deepEqual([r.videos.length, r.complete, walked], [6, false, [0, 1]]);
  // Stopped by unreadable pages: not complete and short of max (the scheduler relists again).
  walked.length = 0;
  setClientFactory(tabOf([ids(3), [], [], ids(3, 3)]));
  r = await listChannelUploads('channel', { lang: 'en', max: 400, knownIds: null });
  assert.deepEqual([r.videos.length, r.complete, walked], [3, false, [0, 1, 2]]);
});

test('recorded channel pages parse in each source language: English originals, Arabic for Arabic channels', async (t) => {
  t.after(() => setClientFactory(null));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('fixture tests must not reach the network'); });
  const expected = {
    en: { first: ['dPu8kxZzCvw', /^How Did the Apostle Peter Die\?$/, 1314], script: false, playlist: ['PLHsXddZFR9ANLFvyRRO1PaqG_nLoPCWLT', '5 videos|0m2ZQaxfpnY', 5] },
    ar: { first: ['EQBdo3yDsAg', /^صيد دموي - .+ - الحلقة 12 - الموسم الثاني \| /, 2643], script: true, playlist: ['PLPICL_nJ8xiw', '4 فيديوهات|VZOdc6emKgM', 4] },
  };
  for (const [lang, want] of Object.entries(expected)) {
    const fx = fixture(lang);
    const langs = [], misses = [];
    setClientFactory(replayFactory(fx, langs, misses));
    // max below the recorded page size: the walk stops before asking for an unrecorded continuation.
    const { videos } = await listChannelUploads(fx.channelId, { lang, max: 5 });
    assert.equal(videos.length, 6, lang);
    assert.deepEqual([videos[0].id, videos[0].durationSec], [want.first[0], want.first[2]]);
    assert.match(videos[0].title, want.first[1]);
    assert.ok(videos.every((v) => arabic(v.title) === want.script), `${lang} titles: ${videos.map((v) => v.title).join(' / ')}`);
    // The playlist change signature carries the count text in the client's language.
    const playlists = await listChannelPlaylists(fx.channelId, { lang });
    assert.equal(playlists.find((p) => p.id === want.playlist[0])?.signature, want.playlist[1]);
    const pl = await getPlaylistVideos(fx.playlistId, { lang });
    assert.equal(pl.videos.length, want.playlist[2]);
    assert.ok(pl.videos.every((v) => arabic(v.title) === want.script));
    assert.deepEqual(misses, []);
    assert.deepEqual(langs, [lang]);
  }
});

test('listChannelPlaylists says whether it read the playlists tab to its end', async t => {
  t.after(() => setClientFactory(null));
  const pl = (id) => ({ content_id: id, metadata: { title: { text: `Playlist ${id}` } }, content_image: { primary_thumbnail: { image: [{ url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' }], overlays: [{ badges: [{ text: '3 videos' }] }] } } });
  const pages = (list) => { const at = (i) => ({ playlists: list[i], has_continuation: i < list.length - 1, getContinuation: async () => at(i + 1) }); return at(0); };
  const channel = (tab) => async () => ({ getChannel: async () => (tab ? { has_playlists: true, getPlaylists: async () => tab() } : { has_playlists: false }) });
  setClientFactory(channel(() => pages([[pl('PLa'), pl('PLb')], [pl('PLc')]])));
  let r = await listChannelPlaylists('channel', { lang: 'ar' });
  assert.deepEqual([r.map((p) => p.id), r.complete], [['PLa', 'PLb', 'PLc'], true]);
  assert.equal(r[0].count, 3);
  // Two unreadable pages end the walk before the tab does: not complete.
  setClientFactory(channel(() => pages([[pl('PLa')], [], [], [pl('PLd')]])));
  r = await listChannelPlaylists('channel', { lang: 'ar' });
  assert.deepEqual([r.map((p) => p.id), r.complete], [['PLa'], false]);
  // No playlists tab: an empty listing that proves nothing.
  setClientFactory(channel(null));
  r = await listChannelPlaylists('channel', { lang: 'ar' });
  assert.deepEqual([r.length, r.complete], [0, false]);
});

test('RSS entries flag Shorts by their /shorts/ link', () => {
  const entry = (id, link) => `<entry><yt:videoId>${id}</yt:videoId><title>T &amp; ${id}</title><link rel="alternate" href="${link}"/><published>2026-10-16T14:08:53+00:00</published></entry>`;
  const xml = `<feed><link rel="alternate" href="https://www.youtube.com/channel/UCx"/>${entry('71GtWp-YQ2E', 'https://www.youtube.com/shorts/71GtWp-YQ2E')}${entry('abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk')}</feed>`;
  assert.deepEqual(parseChannelFeed(xml), [
    { id: '71GtWp-YQ2E', title: 'T & 71GtWp-YQ2E', published: '2026-10-16T14:08:53+00:00', short: true },
    { id: 'abcdefghijk', title: 'T & abcdefghijk', published: '2026-10-16T14:08:53+00:00', short: false },
  ]);
});

// ---- recorded pages, parsed directly ---------------------------------------------------------------
// Every LockupView of every recorded browse page (uploads tab, playlists tab, a playlist) goes through
// youtubei.js's parser and then mapVideoItem / mapPlaylistItem; the expected values are read straight
// from the raw InnerTube JSON, so a parser or layout change that loses titles, durations, counts or
// cover videos fails here, offline.
const rawLockups = (body) => {
  const out = [];
  (function walk(o) { if (!o || typeof o !== 'object') return; if (o.lockupViewModel) { out.push(o.lockupViewModel); return; } for (const k in o) walk(o[k]); })(body);
  return out;
};
const rawBadge = (l) => JSON.stringify(l.contentImage || {}).match(/"thumbnailBadgeViewModel":\{.*?"text":"([^"]*)"/)?.[1];
const rawParts = (l) => (l.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [])
  .flatMap((r) => (r.metadataParts || []).map((p) => p.text?.content)).filter(Boolean);

test('every recorded LockupView maps to the id, title, duration, views, age, count and cover the raw page carries', (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('fixture tests must not reach the network'); });
  const seen = { videos: 0, playlists: 0, courses: 0 };
  for (const lang of ['en', 'ar']) {
    const fx = fixture(lang);
    for (const r of fx.responses.filter((x) => x.key.startsWith('/youtubei/v1/browse|'))) {
      const body = typeof r.body === 'string' ? JSON.parse(r.body) : r.body;
      const raw = new Map(rawLockups(body).map((l) => [l.contentId, l]));
      const nodes = Parser.parseResponse(body).contents_memo?.getType(YTNodes.LockupView) || [];
      assert.equal(nodes.length, raw.size, `${lang} ${r.key}: every lockup is parsed`);
      for (const node of nodes) {
        const l = raw.get(node.content_id);
        assert.ok(l, node.content_id);
        const title = l.metadata.lockupMetadataViewModel.title.content;
        if (node.content_type === 'VIDEO') {
          seen.videos++;
          const v = mapVideoItem(node);
          const parts = rawParts(l);
          assert.match(v.id, /^[\w-]{11}$/);
          assert.deepEqual([v.id, v.title, v.durationText], [l.contentId, title, rawBadge(l)], `${lang} video ${v.id}`);
          assert.ok(v.durationSec > 0 && v.durationSec === parseDuration(rawBadge(l)), `${v.id} duration ${v.durationText}`);
          // The age is the last metadata part and the view count the one before it (a playlist page adds the channel first).
          assert.deepEqual([v.views, v.relative], parts.slice(-2), `${lang} video ${v.id} parts ${parts.join(' / ')}`);
          assert.match(v.thumb, new RegExp(`/vi/${v.id}/`));
        } else {
          seen[node.content_type === 'COURSE' ? 'courses' : 'playlists']++;
          const p = mapPlaylistItem(node);
          const countText = rawBadge(l);
          const cover = JSON.stringify(l.contentImage).match(/\/vi\/([\w-]{11})\//)?.[1];
          assert.deepEqual([p.id, p.title, p.countText, p.count], [l.contentId, title, countText, parseCount(countText)], `${lang} playlist ${p.id}`);
          assert.ok(p.count > 0, `${p.id} count from "${countText}"`);
          assert.equal(p.signature, `${countText}|${cover}`);
        }
      }
    }
  }
  // en: 6 uploads + 5 playlist videos, 6 playlists; ar: 6 uploads + 4 playlist videos, 4 playlists + 2 courses.
  assert.deepEqual(seen, { videos: 21, playlists: 10, courses: 2 });
});

// ---- video details ------------------------------------------------------------------------------
const vd = (id, extra = {}) => ({ title: `Title ${id}`, lengthSeconds: '1314', viewCount: '159902', shortDescription: 'About it', isPrivate: false, keywords: ['k'], ...extra });
const mf = (extra = {}) => ({ playerMicroformatRenderer: { publishDate: '2026-10-16T07:33:52-07:00', category: 'Education', ...extra } });
const embed = (id) => ({ embed: { iframeUrl: `https://www.youtube.com/embed/${id}` } });
const status = (s, reason, subreason) => ({
  status: s, ...(reason ? { reason } : {}),
  ...(subreason ? { errorScreen: { playerErrorMessageRenderer: { subreason: { runs: [{ text: subreason }] } } } } : {}),
});

function playerClient(answers, basic = {}) {
  const calls = { player: [], basic: [] };
  setClientFactory(async () => ({
    actions: { execute: async (_endpoint, { videoId }) => { calls.player.push(videoId); return { data: answers[videoId] }; } },
    getBasicInfo: async (id) => { calls.basic.push(id); if (!basic[id]) throw new Error('basic info failed'); return basic[id]; },
  }));
  return calls;
}

test('isUnavailablePlayability: only removals and private videos, never bot checks, rate limits or geo blocks', () => {
  const gone = [
    status('ERROR', 'This video is unavailable'),
    status('ERROR', 'This video has been removed by the uploader'),
    status('LOGIN_REQUIRED', 'This video is private', 'Sign in if you have been granted access to this video'),
    status('LOGIN_REQUIRED', 'هذا الفيديو خاص'),
    status('UNPLAYABLE', 'This video is no longer available because the YouTube account associated with this video has been terminated.'),
  ];
  const notGone = [
    null, status('OK'), status('UNPLAYABLE', 'Video unavailable'),
    status('LOGIN_REQUIRED', 'Sign in to confirm you’re not a bot'),
    status('LOGIN_REQUIRED', 'Sign in to confirm your age'),
    status('ERROR', 'This content is not available, try again later.'),
    status('ERROR', 'Video unavailable', 'The uploader has not made this video available in your country'),
    status('UNPLAYABLE', 'Video unavailable', 'This video is not available in your country'),
    status('LIVE_STREAM_OFFLINE', 'Premieres in 2 hours'),
    // A broken session: what CI's WEB /player answers for public videos today, here without videoDetails.
    { status: 'ERROR', reason: 'Video unavailable', errorScreen: { playerInterstitialRenderer: { content: { interstitialViewModel: { description: { content: 'The page needs to be reloaded.' } } } } } },
  ];
  for (const ps of gone) assert.equal(isUnavailablePlayability(ps), true, JSON.stringify(ps));
  for (const ps of notGone) assert.equal(isUnavailablePlayability(ps), false, JSON.stringify(ps));
});

test('getVideoDetails reports removed or private videos as gone and falls back for answers about the requester', async (t) => {
  t.after(() => setClientFactory(null));
  const emptyBasic = { basic_info: { title: undefined, duration: undefined }, playability_status: { status: 'LOGIN_REQUIRED' } };
  const calls = playerClient({
    removed0001: { playabilityStatus: status('ERROR', 'This video is unavailable') },
    private0001: { playabilityStatus: status('LOGIN_REQUIRED', 'This video is private') },
    botcheck001: { playabilityStatus: status('LOGIN_REQUIRED', 'Sign in to confirm you’re not a bot') },
    geoblock001: { playabilityStatus: status('UNPLAYABLE', 'Video unavailable', 'The uploader has not made this video available in your country') },
    basicdata01: { playabilityStatus: status('ERROR', 'Something went wrong, try again later') },
  }, {
    botcheck001: emptyBasic, geoblock001: emptyBasic,
    basicdata01: { basic_info: { title: 'From basic info', duration: 2700, view_count: 12, embed: { iframe_url: 'x' } }, playability_status: { status: 'OK' } },
  });
  const removed = await getVideoDetails('removed0001');
  assert.deepEqual([removed.gone, removed.status, removed.reason, removed.unavailable], [true, 'ERROR', 'This video is unavailable', undefined]);
  assert.equal((await getVideoDetails('private0001')).gone, true);
  // A bot check or a geo block: not gone; getBasicInfo has nothing either, so the answer is a stub.
  for (const id of ['botcheck001', 'geoblock001']) {
    const d = await getVideoDetails(id);
    assert.equal(d.gone, undefined, id);
    assert.equal(d.fallback, true);
    assert.equal(isDetailStub(d), true, id);
    assert.match(d.playerError, /^no videoDetails \((LOGIN_REQUIRED|UNPLAYABLE): /);
  }
  const basic = await getVideoDetails('basicdata01');
  assert.deepEqual([basic.title, basic.durationSec, basic.fallback, basic.embeddable, isDetailStub(basic)], ['From basic info', 2700, true, true, false]);
  assert.deepEqual(calls.basic, ['botcheck001', 'geoblock001', 'basicdata01']);
});

test('getVideoDetails records embeddability: playableInEmbed, the microformat embed block, oEmbed when it is missing', async (t) => {
  t.after(() => setClientFactory(null));
  playerClient({
    embedok0001: { videoDetails: vd('embedok0001'), playabilityStatus: status('UNPLAYABLE', 'Video unavailable'), microformat: mf(embed('embedok0001')) },
    noembed0001: { videoDetails: vd('noembed0001'), playabilityStatus: status('UNPLAYABLE', 'Video unavailable'), microformat: mf() },
    unknown0001: { videoDetails: vd('unknown0001'), playabilityStatus: status('UNPLAYABLE', 'Video unavailable'), microformat: mf() },
    inembedno01: { videoDetails: vd('inembedno01'), playabilityStatus: { status: 'OK', playableInEmbed: false }, microformat: mf(embed('inembedno01')) },
    nomicrofmt1: { videoDetails: vd('nomicrofmt1'), playabilityStatus: status('OK') },
  });
  const asked = [];
  const oembed = async (id) => { asked.push(id); return id === 'noembed0001' ? false : undefined; };
  const ok = await getVideoDetails('embedok0001', { oembed });
  assert.deepEqual([ok.title, ok.durationSec, ok.viewCount, ok.publishedAt, ok.embeddable, ok.fallback], ['Title embedok0001', 1314, 159902, '2026-10-16T07:33:52-07:00', true, undefined]);
  assert.equal((await getVideoDetails('noembed0001', { oembed })).embeddable, false);
  assert.equal('embeddable' in (await getVideoDetails('unknown0001', { oembed })), false, 'nothing tells: no flag');
  const off = await getVideoDetails('inembedno01', { oembed });
  assert.deepEqual([off.embeddable, off.playable], [false, true]);
  assert.equal('embeddable' in (await getVideoDetails('nomicrofmt1', { oembed })), false);
  assert.deepEqual(asked, ['noembed0001', 'unknown0001'], 'oEmbed is asked only when the microformat has no embed block');
});

test('oembedEmbeddable: 200 embeds, 401 does not, anything else (or a network error) is unknown', async (t) => {
  const codes = { aaaaaaaaaaa: 200, bbbbbbbbbbb: 401, ccccccccccc: 404, ddddddddddd: 400 };
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(String(url));
    const id = decodeURIComponent(String(url)).match(/v=([\w-]{11})/)[1];
    if (id === 'eeeeeeeeeee') throw new Error('network down');
    return new Response('{}', { status: codes[id] });
  });
  const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee'];
  assert.deepEqual(await Promise.all(ids.map((id) => oembedEmbeddable(id))), [true, false, undefined, undefined, undefined]);
  assert.equal(urls[0], 'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Daaaaaaaaaaa');
});

test('isDetailStub: no duration from the fallback, or neither title nor duration', () => {
  assert.equal(isDetailStub({ fallback: true, title: 'Has a title', durationSec: 0 }), true);
  assert.equal(isDetailStub({ title: '', durationSec: 0 }), true);
  assert.equal(isDetailStub({ id: 'aaaaaaaaaaa' }), true);
  assert.equal(isDetailStub({ title: 'Live now', durationSec: 0 }), false, 'a /player answer with a title is data');
  assert.equal(isDetailStub({ fallback: true, title: '', durationSec: 1800 }), false);
  assert.equal(isDetailStub({ id: 'aaaaaaaaaaa', gone: true }), false);
  assert.equal(isDetailStub(null), false);
});

test('the Arabic channels added on 2026-10-19 have known profiles that agree with sources.json', async (t) => {
  const sources = JSON.parse(fs.readFileSync(new URL('../data/sources.json', import.meta.url), 'utf8')).sources.filter((s) => s.addedAt === '2026-10-19T00:00:00.000Z');
  if (!sources.length) return t.skip('the channels are not configured');
  // 9 were added; World Odyssey (UCUETY-zVLykpUQlVweNaLsg) was dropped on 2026-10-20 because it
  // disables embedding on every upload, so it has no profile row either.
  assert.equal(sources.length, 8);
  assert.ok(!sources.some((s) => s.id === 'UCUETY-zVLykpUQlVweNaLsg'));
  assert.notEqual(detectProfile('UCUETY-zVLykpUQlVweNaLsg', 'any title', '').profile, 'ar-films');
  for (const s of sources) {
    // Known by id, whatever the title says (titles such as "Discovery Travel" would read as another profile).
    const det = detectProfile(s.id, 'any title', '');
    assert.deepEqual([det.profile, det.lang, det.short, det.brands], [s.profile, s.lang, s.short, s.brands], s.title);
    assert.equal(det.maxUploads, s.maxUploads, `${s.title} maxUploads`);
  }
  // Adding one of them from a link gives the same profile and listing depth.
  const aj = sources.find((s) => s.id === 'UC-4KnPMmZzwAzW7SbVATUZQ');
  setClientFactory(async () => ({ getChannel: async (id) => ({ metadata: { title: 'AJ+ كبريت', url: `https://www.youtube.com/channel/${id}` } }) }));
  t.after(() => setClientFactory(null));
  const src = await resolveSource(aj.id);
  assert.deepEqual([src.profile, src.lang, src.short, src.maxUploads], [aj.profile, aj.lang, aj.short, aj.maxUploads]);
});
