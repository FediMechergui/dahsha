import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { thumbnailCandidates } from '../../client/src/lib/thumbnails.js';
import { playerPolicy } from '../../client/src/lib/player-policy.js';
import { seasonGroups } from '../../client/src/lib/catalog-helpers.js';

test('Dahsha skips missing image sizes and retains YouTube and show artwork fallbacks',()=>{
  assert.deepEqual(thumbnailCandidates({hq:'https://example.com/hq.jpg'},null,'sd'),['https://example.com/hq.jpg']);
  const urls=thumbnailCandidates({custom:'https://example.com/broken.jpg'},'dxroVYk0NKY','sd',{custom:'https://example.com/show.jpg'});
  assert.equal(urls[0],'https://example.com/broken.jpg');
  assert.ok(urls.includes('https://i.ytimg.com/vi/dxroVYk0NKY/hqdefault.jpg'));
  assert.equal(urls.at(-1),'https://example.com/show.jpg');
  assert.deepEqual(thumbnailCandidates(null,'fm:m:123'),[]);
});
test('Dahsha handles known player iframe requirements while dropping blocked wrappers',()=>{
  assert.equal(playerPolicy({embedUrl:'https://vidsrc.mov/embed/movie/123'}).sandbox,null);
  assert.equal(playerPolicy({embedUrl:'https://vidcore.net/movie/123'}).sandbox,null);
  assert.equal(playerPolicy({embedUrl:'https://hdtoday.sx/api/go?id=123'}),null);
  assert.equal(playerPolicy({requiresBrowserVerification:true}),null);
  assert.equal(playerPolicy({embedUrl:'https://unknown.example/player'}).sandbox,undefined);
});

// ── Rendered components ─────────────────────────────────────────────────────────────────────────
// The JSX components are compiled by the client's own Vite (installed by `npm ci --prefix client`,
// which CI runs before the tests) and rendered to static markup. The catalogue and progress hooks
// are replaced by stubs so each test controls the data a component sees.
const clientRoot = fileURLToPath(new URL('../../client/', import.meta.url));
const vitePath = path.join(clientRoot, 'node_modules/vite/dist/node/index.js');
const reactPluginPath = path.join(clientRoot, 'node_modules/@vitejs/plugin-react/dist/index.js');
// Without the client's dependencies (only `npm ci --prefix server`), these tests are skipped.
const rendered = fs.existsSync(vitePath) && fs.existsSync(reactPluginPath) ? {} : { skip: 'client dependencies are not installed (npm ci --prefix client)' };
const STUBS = {
  'hooks/useCatalog.jsx': 'export const useCatalog = () => globalThis.__dahshaCatalog; export const useFullShow = (id) => globalThis.__dahshaFullShow?.(id) ?? null;',
  'hooks/useProgress.js': 'export const useProgress = () => ({}); export const useFavorites = () => globalThis.__dahshaFavorites || []; export const favoritesStore = { toggle() {} }; export const progressStore = { set() {}, clear() {}, all: () => ({}) }; export const migrateShowIds = () => false; export const continueWatching = () => [];',
};
const ENTRY = '\0dahsha-test-entry';
let vite = null;
let mod = null;

before(async () => {
  if (rendered.skip) return;
  const { createServer } = await import(pathToFileURL(vitePath));
  const { default: react } = await import(pathToFileURL(reactPluginPath));
  vite = await createServer({
    root: clientRoot, configFile: false, logLevel: 'silent', appType: 'custom',
    cacheDir: path.join(os.tmpdir(), 'dahsha-client-test-vite'),
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    define: { 'import.meta.env.VITE_PRODUCT': '"dahsha"' },
    plugins: [react(), {
      name: 'dahsha-test-stubs', enforce: 'pre',
      resolveId(source, importer) {
        if (source === ENTRY) return ENTRY;
        // The entry itself may import a real hook module (normalizeCatalog); components get the stubs.
        if (importer === ENTRY) return null;
        const key = Object.keys(STUBS).find((name) => source.endsWith(name.split('/').pop()) && importer && path.resolve(path.dirname(importer), source).replace(/\\/g, '/').endsWith(`src/${name}`));
        return key ? `\0stub:${key}` : null;
      },
      load(id) {
        if (id === ENTRY) return [
          "export { createElement } from 'react';",
          "export { renderToStaticMarkup } from 'react-dom/server';",
          "export { MemoryRouter, Routes, Route } from 'react-router-dom';",
          "export { LangProvider } from '/src/lib/i18n.jsx';",
          "export { default as Thumb } from '/src/components/Thumb.jsx';",
          "export { default as EpisodeCard } from '/src/components/EpisodeCard.jsx';",
          "export { default as Header } from '/src/components/Header.jsx';",
          "export { default as App } from '/src/App.jsx';",
          "export { default as ShowCard } from '/src/components/ShowCard.jsx';",
          "export { default as NewReleasesWindow } from '/src/components/NewReleasesWindow.jsx';",
          "export { ProviderSyncInfo } from '/src/pages/Sources.jsx';",
          "export { default as Home } from '/src/pages/Home.jsx';",
          "export { default as ShowPage } from '/src/pages/ShowPage.jsx';",
          "export { default as Watch } from '/src/pages/Watch.jsx';",
          "export { normalizeCatalog } from '/src/hooks/useCatalog.jsx';",
        ].join('\n');
        if (id.startsWith('\0stub:')) return STUBS[id.slice(6)];
        return null;
      },
    }],
  });
  mod = await vite.ssrLoadModule(ENTRY);
});
after(async () => { await vite?.close(); });

const catalogStub = (overrides = {}) => ({
  catalog: { shows: [], channels: [], tags: [], stats: {} }, all: { shows: [], tags: [] }, allShowMap: new Map(), idAliases: {},
  tagMap: new Map(), channelMap: new Map(), showMap: new Map(), episodeIndex: new Map(), recentEpisodes: [],
  status: null, connected: true, checking: false, refresh() {}, toasts: [], dismissToast() {}, ...overrides,
});
function render(element, { url = '/', catalog = catalogStub(), lang = 'en' } = {}) {
  const { createElement: h, renderToStaticMarkup, MemoryRouter, LangProvider } = mod;
  globalThis.__dahshaCatalog = catalog;
  globalThis.localStorage = { getItem: (key) => (key === 'dahsha.lang' ? lang : null), setItem() {} };
  try { return renderToStaticMarkup(h(LangProvider, null, h(MemoryRouter, { initialEntries: [url] }, element))); }
  finally { delete globalThis.localStorage; }
}
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('Thumb draws a labelled, styled placeholder when a title has no artwork at all', rendered, () => {
  const { createElement: h, Thumb } = mod;
  const html = render(h(Thumb, { thumbs: null, videoId: 'hd:m:movie-john-simpson-60-years-at-the-bbc-32403a6o', className: 'card__img', label: 'John Simpson: 60 Years at the BBC' }));
  assert.match(html, /class="thumb thumb--empty card__img"/);
  assert.match(html, /thumb__mark/);
  assert.match(html, /<span class="thumb__label" dir="auto" aria-hidden="true">John Simpson: 60 Years at the BBC<\/span>/);
  assert.doesNotMatch(render(h(Thumb, { thumbs: null, videoId: 'x' })), /thumb__label/);
});

test('Thumb shows a 2:3 provider poster whole over a blurred copy instead of a 16:9 crop', rendered, () => {
  const { createElement: h, Thumb } = mod;
  const poster = 'https://myflixerz.day/wp-content/uploads/posters/1503908_medium.jpg';
  const html = render(h(Thumb, { thumbs: { custom: poster }, className: 'card__img' }));
  assert.match(html, /class="thumb  thumb--contain card__img"/);
  assert.match(html, /<img class="thumb__blur" src="https:\/\/myflixerz\.day[^"]+_medium\.jpg" alt="" aria-hidden="true"/);
  const landscape = render(h(Thumb, { videoId: 'dxroVYk0NKY', start: 'sd' }));
  assert.doesNotMatch(landscape, /thumb--contain|thumb__blur/);
  assert.doesNotMatch(render(h(Thumb, { thumbs: { custom: poster }, fitPortrait: false })), /thumb__blur/);
});

const providerShow = {
  id: 's_1pvkd23', title: "Clarkson's Farm", kind: 'series', lang: 'en', channelId: 'myflixer',
  poster: { custom: 'https://myflixerz.day/wp-content/uploads/posters/1503908_medium.jpg' },
};
const providerEpisode = (over) => ({ id: 'mf:e:clarksons-farm-s5e1-episode-5-1', title: 'Episode #5.1', season: 5, number: 1, durationSec: 3000, thumbs: { custom: providerShow.poster.custom }, ...over });

test('Episode lists replace IMDb-style placeholders and repeated show posters with numbered tiles', rendered, () => {
  const { createElement: h, EpisodeCard } = mod;
  const html = render(h(EpisodeCard, { show: providerShow, episode: providerEpisode(), index: 0, layout: 'list' }));
  assert.match(html, /<h4 class="ep__title" dir="auto">Episode 1<\/h4>/);
  assert.doesNotMatch(html, /Episode #5\.1/);
  assert.match(html, /class="ep ep--list[^"]*ep--tiled"/);
  assert.match(html, /<span class="ep__tile" aria-hidden="true"><small>Season 5<\/small><b>1<\/b><\/span>/);
  assert.match(html, /thumb[^"]*ep__img--ambient/);
  assert.doesNotMatch(html, /class="ep__num"/, 'the tile carries the number, so no badge');
  // An episode with its own still keeps it, and its real title.
  const own = render(h(EpisodeCard, { show: providerShow, episode: providerEpisode({ id: 'fm:e:1', title: 'Tractoring', season: 1, thumbs: { custom: 'https://image.tmdb.org/t/p/w300/still.jpg' } }), index: 0, layout: 'list' }));
  assert.doesNotMatch(own, /ep__tile/);
  assert.match(own, /<h4 class="ep__title" dir="auto">Tractoring<\/h4>/);
});

test('Empty episode titles read Episode N / الحلقة N from the number or the list position', rendered, () => {
  const { createElement: h, EpisodeCard } = mod;
  const show = { id: 's_ar', title: 'كنوز مصر المفقودة', kind: 'series', lang: 'ar', channelId: 'UCx' };
  const ar = render(h(EpisodeCard, { show, episode: { id: 'aaaaaaaaaaa', title: '', number: 4 }, index: 0, layout: 'list' }), { lang: 'ar' });
  assert.match(ar, /<h4 class="ep__title" dir="auto">الحلقة 4<\/h4>/);
  const byPosition = render(h(EpisodeCard, { show, episode: { id: 'bbbbbbbbbbb', title: null }, index: 2, layout: 'list' }), { lang: 'ar' });
  assert.match(byPosition, /<h4 class="ep__title" dir="auto">الحلقة 3<\/h4>/);
  assert.doesNotMatch(byPosition, /class="ep__num"/, 'the title already says the number');
  // A cross-language link: an English show opened from the Arabic UI keeps English labels.
  const en = render(h(EpisodeCard, { show: { ...show, title: 'Lost Treasures', lang: 'en' }, episode: { id: 'ccccccccccc', title: '  ', number: 7 }, index: 0, layout: 'list' }), { lang: 'ar' });
  assert.match(en, /<h4 class="ep__title" dir="auto">Episode 7<\/h4>/);
  // Standalone card: the show title headlines, the rebuilt label is the neutral chip.
  const card = render(h(EpisodeCard, { show: { ...show, title: 'Lost Treasures', lang: 'en' }, episode: { id: 'ddddddddddd', title: '', season: 2, number: 3 }, showShowTitle: true }));
  assert.match(card, /class="ep ep--grid[^"]*ep--generic/);
  assert.match(card, /<h4 class="ep__title" dir="auto">Lost Treasures<\/h4>/);
  assert.match(card, /<p class="ep__show ep__show--label" dir="auto">S2 · E3<\/p>/);
});

test('The status pill turns to a stale state when the data is more than 26 hours old', rendered, () => {
  const { createElement: h, Header } = mod;
  const hours = (n) => new Date(Date.now() - n * 3600e3).toISOString();
  const fresh = render(h(Header), { catalog: catalogStub({ status: { generatedAt: hours(13), static: true } }) });
  assert.match(fresh, /class="pill pill--live"/);
  assert.doesNotMatch(fresh, /Not updated recently/);
  const stale = render(h(Header), { catalog: catalogStub({ status: { generatedAt: hours(27), static: true } }) });
  assert.match(stale, /class="pill pill--stale"/);
  assert.match(text(stale), /Not updated recently/);
  assert.match(stale, /title="Not updated recently · /, 'narrow headers show only the dot, so the tooltip names the state');
  const staleAr = render(h(Header), { lang: 'ar', catalog: catalogStub({ status: { generatedAt: hours(30), static: true } }) });
  assert.match(text(staleAr), /لم يُحدَّث مؤخراً/);
  // Offline and in-progress states keep precedence over the age.
  assert.match(render(h(Header), { catalog: catalogStub({ connected: false, status: { generatedAt: hours(30) } }) }), /pill--off/);
  assert.match(render(h(Header), { catalog: catalogStub({ checking: true, status: { generatedAt: hours(30) } }) }), /pill--busy/);
  assert.doesNotMatch(render(h(Header), { catalog: catalogStub({ status: null }) }), /pill--stale/);
});

test('An aliased show id redirects only when it is not a live show itself', rendered, () => {
  const { createElement: h, App } = mod;
  const live = { id: 's_old', title: 'Old title that came back', kind: 'series', lang: 'en', tags: [], altTitles: [], episodes: [] };
  globalThis.__dahshaFullShow = (id) => (id === 's_old' ? live : null);
  try {
    // Alias map says s_old → s_new, but s_old is in the loaded catalogue: the show page renders.
    const kept = render(h(App), { url: '/show/s_old', catalog: catalogStub({ idAliases: { s_old: 's_new' }, allShowMap: new Map([['s_old', live]]) }) });
    assert.match(kept, /<h1 class="show__title" dir="auto">Old title that came back<\/h1>/);
    // Not live: the route redirects (Navigate renders nothing, so no show page and no empty state).
    const moved = render(h(App), { url: '/show/s_old', catalog: catalogStub({ idAliases: { s_old: 's_new' } }) });
    assert.doesNotMatch(moved, /show__title|class="empty"/);
    // Unknown and not aliased: the "missing show" state.
    assert.match(render(h(App), { url: '/show/s_gone', catalog: catalogStub() }), /class="empty"/);
  } finally { delete globalThis.__dahshaFullShow; }
});

// ── Recency of provider titles (provider contract 6) ────────────────────────────────────────────
const ago = (hours) => new Date(Date.now() - hours * 3600e3).toISOString();
/** A lean English section as export-catalog.js writes it: updatedAt/discoveredAt only where set. */
function leanSection({ withProviderDates = true } = {}) {
  const generatedAt = ago(1);
  const dated = (fields) => (withProviderDates ? fields : {});
  return {
    product: 'dahsha', lang: 'en', generatedAt, tags: [], stats: {},
    channels: [
      { id: 'fmovies', title: 'FMovies', name: 'FMovies', lang: 'en', profile: 'provider' },
      { id: 'hdtoday', title: 'HDToday', name: 'HDToday', lang: 'en', profile: 'provider' },
      { id: 'UCyt', title: 'Ocean Channel', name: 'Ocean Channel', lang: 'en', profile: 'generic-en' },
    ],
    shows: [
      // A title FMovies newly listed in its latest releases: dated only by the build's updatedAt.
      { id: 'fm:m:9999001', kind: 'film', title: 'A New FMovies Documentary', lang: 'en', channelId: 'fmovies', latestAt: null, sourceUrl: 'https://www.f-movies.org/movie/9999001', ...dated({ updatedAt: ago(2), discoveredAt: ago(2) }), episodes: [{ id: 'fm:m:9999001', title: 'A New FMovies Documentary' }] },
      // A bulk-imported card: crawl stamps only, never "latest" or "new".
      { id: 'fm:m:1755291', kind: 'film', title: 'NAZA', lang: 'en', channelId: 'fmovies', latestAt: null, firstSeenAt: '2026-10-14T13:28:25.887Z', providerUpdatedAt: '2026-10-14T13:28:25.887Z', episodes: [{ id: 'fm:m:1755291', title: 'NAZA' }] },
      // HDToday listed a newer latest episode (episodesAddedAt): dated, but not a discovery.
      { id: 'hd:s:tv-listed-episodes-x1', kind: 'series', title: 'Listed Episodes', lang: 'en', channelId: 'hdtoday', latestAt: null, episodeCount: 3, ...dated({ updatedAt: ago(30) }), episodes: [] },
      { id: 's_yt', kind: 'series', title: 'Ocean Giants', lang: 'en', channelId: 'UCyt', latestAt: ago(5), episodeCount: 2, episodes: [{ id: '61ODlrzb7Pk', title: 'Whales', publishedAt: ago(5) }] },
      // A clock-skewed source date ahead of the build is capped at generatedAt.
      { id: 's_skew', kind: 'film', title: 'Skewed Clock', lang: 'en', channelId: 'UCyt', latestAt: new Date(Date.now() + 3 * 3600e3).toISOString(), episodes: [] },
      { id: 's_old', kind: 'series', title: 'Old Series', lang: 'en', channelId: 'UCyt', latestAt: ago(24 * 40), episodeCount: 2, episodes: [] },
    ],
  };
}
const recentOf = (catalog) => Object.fromEntries(catalog.shows.map((s) => [s.id, s.recentAt]));

test('normalizeCatalog stores the recency every latest/new surface uses', rendered, () => {
  const raw = leanSection();
  const recent = recentOf(mod.normalizeCatalog(raw));
  const by = Object.fromEntries(raw.shows.map((s) => [s.id, s]));
  assert.equal(recent['fm:m:9999001'], by['fm:m:9999001'].updatedAt, 'a provider discovery dates the card');
  assert.equal(recent['hd:s:tv-listed-episodes-x1'], by['hd:s:tv-listed-episodes-x1'].updatedAt);
  assert.equal(recent['fm:m:1755291'], null, 'bulk-imported provider cards stay undated');
  assert.equal(recent.s_yt, by.s_yt.latestAt);
  assert.equal(recent.s_skew, raw.generatedAt, 'never later than the build');
  // A catalogue exported before updatedAt existed behaves as before: latestAt only.
  // (One section object: leanSection() dates rows from Date.now(), so a second call can differ by a millisecond.)
  const olderRaw = leanSection({ withProviderDates: false });
  const older = recentOf(mod.normalizeCatalog(olderRaw));
  assert.equal(older['fm:m:9999001'], null);
  assert.equal(older['hd:s:tv-listed-episodes-x1'], null);
  assert.equal(older.s_old, olderRaw.shows.find((s) => s.id === 's_old').latestAt);
});

test('ShowCard badges provider discoveries and new provider episodes as new, never bulk imports', rendered, () => {
  const { createElement: h, ShowCard, normalizeCatalog } = mod;
  const shows = Object.fromEntries(normalizeCatalog(leanSection()).shows.map((s) => [s.id, s]));
  const card = (id, lang = 'en') => render(h(ShowCard, { show: shows[id] }), { lang });
  assert.match(card('fm:m:9999001'), /<span class="badge badge--new" title="New on FMovies">New<\/span>/);
  assert.match(card('fm:m:9999001', 'ar'), /<span class="badge badge--new" title="جديد على FMovies">جديد<\/span>/);
  assert.match(card('hd:s:tv-listed-episodes-x1'), /<span class="badge badge--new">New<\/span>/, 'new episodes: new, but not a discovery');
  assert.match(card('s_yt'), /badge--new/);
  for (const id of ['fm:m:1755291', 's_old']) assert.doesNotMatch(card(id), /badge--new/, id);
  // Older catalogue: the same provider card is undated, so no badge.
  const older = normalizeCatalog(leanSection({ withProviderDates: false })).shows.find((s) => s.id === 'fm:m:9999001');
  assert.doesNotMatch(render(h(ShowCard, { show: older })), /badge--new/);
});

test('NewReleasesWindow lists dated provider titles by recency and leaves undated ones out', rendered, () => {
  const { createElement: h, NewReleasesWindow, normalizeCatalog } = mod;
  const order = (raw) => {
    const html = render(h(NewReleasesWindow), { catalog: catalogStub({ catalog: normalizeCatalog(raw) }) });
    return { html, ids: [...html.matchAll(/href="\/show\/([^"?]+)/g)].map((m) => decodeURIComponent(m[1])) };
  };
  const now = order(leanSection());
  assert.deepEqual(now.ids, ['s_skew', 'fm:m:9999001', 's_yt', 'hd:s:tv-listed-episodes-x1', 's_old']);
  assert.match(now.html, /Web providers/);
  assert.match(text(now.html), /YouTube channels and web providers \(FMovies, HDToday\)/);
  // Without the provider dates (older catalogues) the window is what it was: YouTube/Myflixer dates only.
  assert.deepEqual(order(leanSection({ withProviderDates: false })).ids, ['s_skew', 's_yt', 's_old']);
});

const providerSync = () => ({
  lastRefreshAt: ago(2), lastAttemptAt: ago(2), completed: false, remainingPartitions: 1, errors: { hdtoday: 'HDToday HTTP 403' }, sourceRecords: 2593,
  baselineAt: '2026-10-15T00:00:00.000Z',
  providers: {
    fmovies: { lastAttemptAt: ago(2), lastSuccessAt: ago(2), lastNewRecordAt: ago(48), lastError: null, lastErrorAt: null, consecutiveFailures: 0, records: 1779 },
    hdtoday: { lastAttemptAt: ago(2), lastSuccessAt: ago(96), lastNewRecordAt: ago(96), lastError: 'HDToday HTTP 403', lastErrorAt: ago(2), consecutiveFailures: 3, records: 814 },
  },
});

test('The Sources page shows each provider its own last success, last new title and failure', rendered, () => {
  const { createElement: h, ProviderSyncInfo } = mod;
  const info = (id, sync = providerSync(), lang = 'en') => render(h(ProviderSyncInfo, { providerSync: sync, id }), { lang });
  assert.equal(text(info('fmovies')), 'updated 2 hours ago • last new title 2 days ago');
  assert.doesNotMatch(info('fmovies'), /source__error/);
  const hd = info('hdtoday');
  const since = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(providerSync().providers.hdtoday.lastSuccessAt));
  assert.equal(text(hd), `updated 4 days ago • last new title 4 days ago Error: HDToday HTTP 403 — failing since ${since} • 3 failed scans in a row`);
  assert.match(hd, /class="source__error is-stale" style="color:var\(--danger\)"/, 'failing and no success for over a day');
  assert.doesNotMatch(hd, /2 hours ago/, 'the shared lastRefreshAt is not HDToday\'s freshness');
  const ar = text(info('hdtoday', providerSync(), 'ar'));
  assert.match(ar, /آخر استجابة ناجحة/);
  assert.match(ar, /خطأ: HDToday HTTP 403 — متعطّل منذ/);
  assert.match(ar, /3 محاولات فاشلة متتالية/);
  // A provider that has never answered says so instead of printing a date.
  const never = providerSync(); never.providers.hdtoday = { ...never.providers.hdtoday, lastSuccessAt: null, lastNewRecordAt: null, consecutiveFailures: 1 };
  assert.equal(text(info('hdtoday', never)), 'no successful scan yet Error: HDToday HTTP 403');
  // Older catalogues (no providerSync.providers) keep the previous line and error.
  const legacy = { lastRefreshAt: ago(6), errors: { hdtoday: 'HDToday HTTP 403' }, sourceRecords: 2593 };
  assert.equal(text(info('fmovies', legacy)), 'Last sync 6 hours ago');
  assert.equal(text(info('hdtoday', legacy)), 'Last sync 6 hours ago Error: HDToday HTTP 403');
  // Myflixer is refreshed with the YouTube sources, so providerSync says nothing about it.
  assert.equal(info('myflixer'), '');
  assert.equal(info('fmovies', null), '');
});

test('Home rows order provider titles by the same recency and keep bulk imports last', rendered, () => {
  const { createElement: h, Home, normalizeCatalog } = mod;
  const catalog = normalizeCatalog(leanSection());
  catalog.stats = { shows: catalog.shows.length, series: 3, films: 3, episodes: 7, channels: 3 };
  const html = render(h(Home), { catalog: catalogStub({ catalog }) });
  const rows = Object.fromEntries(html.split('<section class="row').slice(1).map((row) => [
    (row.match(/href="(\/browse[^"]*)"/) || [])[1]?.replace(/&amp;/g, '&'),
    [...row.matchAll(/href="\/show\/([^"?]+)/g)].map((m) => decodeURIComponent(m[1])),
  ]));
  assert.deepEqual(rows['/browse?kind=film&sort=latest'], ['s_skew', 'fm:m:9999001', 'fm:m:1755291']);
  assert.deepEqual(rows['/browse?kind=series&sort=latest'], ['s_yt', 'hd:s:tv-listed-episodes-x1', 's_old']);
  assert.deepEqual(rows['/browse?channel=fmovies'], ['fm:m:9999001', 'fm:m:1755291']);
});

// ── Favourites of grouped cards ─────────────────────────────────────────────────────────────────
test('A favourite stored under a version or offering id is the holder card\'s favourite on My List and its page', rendered, () => {
  const { createElement: h, App } = mod;
  // fm:s:32608 was a provider card; it is now an uncertain version of s_xgjqzn (c1 handoff).
  const holder = {
    id: 's_xgjqzn', title: 'Ancient Aliens', kind: 'series', lang: 'en', tags: [], altTitles: [], episodes: [],
    versions: [{ id: 'fm:s:32608', title: 'Ancient Aliens', year: 2010 }, { id: 'fm:m:777', title: 'Ancient Aliens', year: 2020 }],
    offerings: [{ id: 'mf:s:ancient-aliens', provider: 'myflixer' }],
  };
  // A version that is a live card of its own keeps its own favourite.
  const other = { id: 'fm:m:777', title: 'Ancient Aliens', kind: 'film', lang: 'en', tags: [], altTitles: [], episodes: [] };
  const shows = [holder, other];
  const catalog = catalogStub({
    catalog: { shows, channels: [], tags: [], stats: {} }, all: { shows, tags: [] },
    showMap: new Map(shows.map((s) => [s.id, s])),
    allShowMap: new Map([[holder.id, holder], ['mf:s:ancient-aliens', holder], [other.id, other]]),
  });
  const page = (favs, url) => {
    globalThis.__dahshaFavorites = favs;
    try { return render(h(App), { url, catalog }); } finally { delete globalThis.__dahshaFavorites; }
  };
  globalThis.__dahshaFullShow = (id) => shows.find((s) => s.id === id) || null;
  try {
    for (const stored of ['fm:s:32608', 'mf:s:ancient-aliens']) {
      assert.equal(page([stored], '/my').match(/href="\/show\/s_xgjqzn"/g)?.length, 1, `My List lists the holder once for ${stored}`);
      const showPage = page([stored], '/show/s_xgjqzn');
      assert.match(showPage, /class="btn btn--ghost fav-btn is-active"/, `the holder's heart reads ${stored}`);
      assert.match(text(showPage), /In My List/);
    }
    // The live card's own favourite is not the holder's.
    assert.match(text(page(['fm:m:777'], '/show/s_xgjqzn')), /Add to My List/);
    assert.match(page(['fm:m:777'], '/my'), /href="\/show\/fm%3Am%3A777"|href="\/show\/fm:m:777"/);
    assert.match(text(page([], '/show/s_xgjqzn')), /Add to My List/);
  } finally { delete globalThis.__dahshaFullShow; }
});

// ── Season groups (a programme across channels: server/src/catalog.js labelEras) ─────────────────
// الدحيح as the catalogue lists it: AJ+'s first era, the numbered seasons, AJ+ 2026, then a special.
const daheehEpisodes = [
  { id: 'aj_sell____', title: 'أبيع نفسي', seasonLabel: 'AJ+ كبريت 2017–2020', channelId: 'UC-aj' },
  { id: 'aj_peak____', title: 'هزت عرش العلم', seasonLabel: 'AJ+ كبريت 2017–2020', channelId: 'UC-aj' },
  { id: 'nm_apple___', title: 'أبل', season: 1, channelId: 'UC-nm' },
  { id: 'mo_worm____', title: 'الثقب الدودي', season: 2, channelId: 'UC-mo' },
  { id: 'nm_allergy_', title: 'الحساسية', season: 3, channelId: 'UC-nm' },
  { id: 'aj_port____', title: 'كيف هزمت بورسعيد ثلاث دول؟', seasonLabel: 'AJ+ كبريت 2026', channelId: 'UC-aj' },
  { id: 'nm_focus___', title: 'ركز في اللعب', season: null, channelId: 'UC-nm' },
];
const daheehShow = (over = {}) => ({
  id: 's_1nkbn9f', title: 'الدحيح', kind: 'series', lang: 'ar', tags: [], altTitles: [], seasons: [1, 2, 3], synopsis: 'الدحيح',
  channel: { id: 'UC-aj', title: 'AJ+ كبريت', short: 'AJ+ كبريت', lang: 'ar' }, episodes: daheehEpisodes, episodeCount: daheehEpisodes.length, ...over,
});

test('seasonGroups: numbered seasons ascending, labelled groups where the episode list reaches them, other episodes last', () => {
  const groups = seasonGroups(daheehShow());
  assert.deepEqual(groups.map((g) => [g.key, g.episodes.map((e) => e.id)]), [
    ['label:AJ+ كبريت 2017–2020', ['aj_sell____', 'aj_peak____']],
    ['season:1', ['nm_apple___']], ['season:2', ['mo_worm____']], ['season:3', ['nm_allergy_']],
    ['label:AJ+ كبريت 2026', ['aj_port____']],
    ['other', ['nm_focus___']],
  ]);
  assert.deepEqual(groups.map((g) => [g.season, g.label, g.other]).slice(0, 2), [[null, 'AJ+ كبريت 2017–2020', false], [1, null, false]]);
  // Numbered seasons stay ascending in their slots when live episodes arrive out of order.
  const live = seasonGroups({ episodes: [{ id: 'a', season: 2 }, { id: 'l', seasonLabel: 'X 2020' }, { id: 'b', season: 1 }, { id: 'c', season: 2 }] });
  assert.deepEqual(live.map((g) => [g.key, g.episodes.map((e) => e.id)]), [['season:1', ['b']], ['label:X 2020', ['l']], ['season:2', ['a', 'c']]]);
  // One season (or none) and no label: one plain list, as before.
  assert.deepEqual(seasonGroups({ episodes: [{ id: 'a', season: 1 }, { id: 'b' }] }), []);
  assert.deepEqual(seasonGroups({ episodes: [{ id: 'a', seasonLabel: '  ' }, { id: 'b', season: '2' }] }), []);
  assert.deepEqual(seasonGroups(null), []);
  // A show without labels groups exactly as show.seasons did.
  const plain = seasonGroups({ episodes: [{ id: 'x' }, { id: 'a', season: 1 }, { id: 'b', season: 2 }] });
  assert.deepEqual(plain.map((g) => g.key), ['season:1', 'season:2', 'other']);
});

test('The show page heads labelled season groups with the label, isolated, in Arabic and English UIs', rendered, () => {
  const { createElement: h, ShowPage } = mod;
  const show = daheehShow();
  const catalog = catalogStub({ catalog: { shows: [show], channels: [], tags: [], stats: {} }, all: { shows: [show], tags: [] }, allShowMap: new Map([[show.id, show]]) });
  globalThis.__dahshaFullShow = () => show;
  try {
    const headings = (html) => [...html.matchAll(/<h3 class="(season__title[^"]*)">(.*?)<\/h3>/g)].map((m) => [m[1], m[2]]);
    const ar = render(h(ShowPage), { catalog, lang: 'ar' });
    assert.match(ar, /<div class="page page--show" dir="rtl">/);
    assert.deepEqual(headings(ar), [
      ['season__title season__title--label', '<bdi>AJ+ كبريت 2017–2020</bdi>'],
      ['season__title', 'الموسم 1'], ['season__title', 'الموسم 2'], ['season__title', 'الموسم 3'],
      ['season__title season__title--label', '<bdi>AJ+ كبريت 2026</bdi>'],
      ['season__title', 'حلقات أخرى'],
    ]);
    assert.match(text(ar), /• 5 مواسم/, 'the labelled groups count as seasons');
    const en = render(h(ShowPage), { catalog, lang: 'en' });
    assert.match(en, /<div class="page page--show" dir="rtl">/, 'an Arabic show keeps its direction in the English UI');
    assert.deepEqual(headings(en).map(([, x]) => x), ['<bdi>AJ+ كبريت 2017–2020</bdi>', 'Season 1', 'Season 2', 'Season 3', '<bdi>AJ+ كبريت 2026</bdi>', 'Other episodes']);
    // Every episode is listed once, in its group (the play button above links the first one too).
    const list = en.slice(en.indexOf('show__episodes'));
    for (const e of daheehEpisodes) assert.equal(list.split(`/watch/${show.id}/${e.id}"`).length - 1, 1, e.id);
    // An English show with seasons only renders as before.
    const plain = { ...daheehShow({ lang: 'en', title: 'Wild Hawaii' }), episodes: [{ id: 'aaaaaaaaaaa', title: 'One', season: 1 }, { id: 'bbbbbbbbbbb', title: 'Two', season: 2 }, { id: 'ccccccccccc', title: 'Extra' }] };
    globalThis.__dahshaFullShow = () => plain;
    const ltr = render(h(ShowPage), { catalog, lang: 'en' });
    assert.match(ltr, /<div class="page page--show" dir="ltr">/);
    assert.deepEqual(headings(ltr), [['season__title', 'Season 1'], ['season__title', 'Season 2'], ['season__title', 'Other episodes']]);
    assert.doesNotMatch(ltr, /season__title--label|<bdi>Season/);
  } finally { delete globalThis.__dahshaFullShow; }
});

test('The watch page names a labelled episode\'s group, isolated, where a numbered one names its season', rendered, () => {
  const { createElement: h, Watch, Routes, Route } = mod;
  const show = daheehShow();
  const catalog = catalogStub({ catalog: { shows: [show], channels: [], tags: [], stats: {} }, all: { shows: [show], tags: [] }, allShowMap: new Map([[show.id, show]]) });
  globalThis.__dahshaFullShow = () => show;
  const crumbs = (episodeId, lang) => {
    const html = render(h(Routes, null, h(Route, { path: '/watch/:showId/:epId', element: h(Watch) })), { url: `/watch/${show.id}/${episodeId}`, catalog, lang });
    const m = html.match(/<p class="watch__crumbs">(.*?)<\/p>/);
    assert.ok(m, html.slice(0, 300));
    return m[1].replace(/^.*<span class="chev" aria-hidden="true"><\/span><span>/, '').replace(/<\/span>$/, '');
  };
  try {
    assert.equal(crumbs('aj_peak____', 'ar'), `<bdi>AJ+ كبريت 2017–2020</bdi> • الحلقة 2 من ${daheehEpisodes.length}`);
    assert.equal(crumbs('aj_peak____', 'en'), `<bdi>AJ+ كبريت 2017–2020</bdi> • Episode 2 of ${daheehEpisodes.length}`);
    assert.equal(crumbs('mo_worm____', 'en'), `Season 2 • Episode 4 of ${daheehEpisodes.length}`);
    assert.equal(crumbs('nm_focus___', 'en'), `Episode 7 of ${daheehEpisodes.length}`);
  } finally { delete globalThis.__dahshaFullShow; }
});

// ── Stylesheet layout checks ────────────────────────────────────────────────────────────────────
// A small cascade over client/src/styles.css (top-level and @media rules, specificity, source order)
// so layout budgets measured in the browser stay true when the breakpoints change.
const STYLES = fs.readFileSync(new URL('../../client/src/styles.css', import.meta.url), 'utf8');
function cssRules(css) {
  const out = [];
  const walk = (src, media) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      let depth = 1, j = open + 1;
      while (j < src.length && depth) { if (src[j] === '{') depth += 1; else if (src[j] === '}') depth -= 1; j += 1; }
      const prelude = src.slice(i, open).trim();
      const body = src.slice(open + 1, j - 1);
      if (prelude.startsWith('@media')) walk(body, prelude.slice(6).trim());
      else if (!prelude.startsWith('@')) {
        const decls = {};
        for (const d of body.split(';')) { const k = d.indexOf(':'); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim().replace(/\s+/g, ' '); }
        out.push({ media, selectors: prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls, index: out.length });
      }
      i = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), null);
  return out;
}
const RULES = cssRules(STYLES);
const mediaMatches = (media, width) => !media || media.split(/\band\b/).every((part) => {
  const m = part.match(/\((min|max)-width:\s*([\d.]+)px\)/);
  return m ? (m[1] === 'max' ? width <= +m[2] : width >= +m[2]) : false;
});
const specificity = (sel) => (sel.match(/#[\w-]+/g) || []).length * 1e4
  + (sel.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length * 1e2
  + (sel.replace(/\[[^\]]*\]/g, '').match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length;
/** The winning declaration of `prop` for an element that `selectors` match (lang-scoped ones included by the caller), at `width`. */
function cascade(width, selectors, ...props) {
  let best = null;
  for (const rule of RULES) {
    if (!mediaMatches(rule.media, width)) continue;
    const sel = rule.selectors.filter((s) => selectors.includes(s)).sort((a, b) => specificity(b) - specificity(a))[0];
    const prop = sel && props.find((p) => p in rule.decls);
    if (!prop) continue;
    const rank = [specificity(sel), rule.index];
    if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && rank[1] > best.rank[1])) best = { rank, prop, value: rule.decls[prop] };
  }
  return best;
}
/** Numeric value of a CSS length expression (px, em, vw, calc/min/max/clamp, var()). */
function cssNumber(expr, { vw, em = 16, vars = {} }) {
  let s = String(expr);
  for (let k = 0; k < 8 && /var\(/.test(s); k += 1) s = s.replace(/var\((--[\w-]+)\)/g, (_, name) => { assert.ok(name in vars, `unknown ${name}`); return `(${vars[name]})`; });
  s = s.replace(/env\([^)]*\)/g, '0').replace(/(\d*\.?\d+)vw/g, `($1*${vw}/100)`).replace(/(\d*\.?\d+)em/g, `($1*${em})`).replace(/(\d*\.?\d+)px/g, '$1').replace(/calc\(/g, '(');
  assert.match(s, /^[\d\s.+\-*/(),minaxclp]*$/, `cannot evaluate ${expr}`);
  return Function('min', 'max', 'clamp', `return ${s};`)(Math.min, Math.max, (a, v, b) => Math.max(a, Math.min(v, b)));
}
const px = (v) => parseFloat(v);

test('The header search box keeps a usable width at every desktop width, in both languages and when stale', () => {
  // Widths measured in the browser with the Google fonts of client/index.html (EN: Sora/Inter, AR:
  // Tajawal/IBM Plex Sans Arabic). nav = the five links at 12px side padding; each px less saves 10px.
  const WIDTHS = {
    en: { logo: 213, logoNoTagline: 107, nav: 526, lang: 87, langShort: 54, pill: { live: 97, stale: 180 } },
    ar: { logo: 122, logoNoTagline: 90, nav: 445, lang: 87, langShort: 63, pill: { live: 73, stale: 120 } },
  };
  const DOT = 26, GUTTER = 24, SCROLLBAR = 17; // a desktop scrollbar counts in media queries, not in the row
  const floor = px(cascade(1200, ['.hdr__search'], 'min-width')?.value);
  assert.ok(floor >= 160, `the search box has a real floor (min-width ${floor}px), not 0`);
  for (const lang of ['en', 'ar']) for (const state of ['live', 'stale']) for (let vw = 961; vw <= 1600; vw += 1) {
    const w = WIDTHS[lang];
    const scoped = (sel) => [sel, `html[lang="${lang}"] ${sel}`];
    assert.notEqual(cascade(vw, ['.hdr__burger'], 'display').value, 'flex', `${vw}px is above the burger breakpoint`);
    const gap = px(cascade(vw, scoped('.hdr__inner'), 'gap').value);
    const link = cascade(vw, scoped('.hdr__nav a'), 'padding-inline', 'padding');
    const pad = px(link.prop === 'padding-inline' ? link.value : link.value.split(' ')[1] ?? link.value);
    const tagline = cascade(vw, scoped('.hdr__brand small'), 'display')?.value !== 'none';
    const short = cascade(vw, [...scoped('.hdr__lang-short'), '.hdr__lang .hdr__lang-short'], 'display')?.value === 'inline';
    const dot = cascade(vw, [...scoped('.pill span'), ...scoped(`.pill--${state} span`)], 'display')?.value === 'none';
    const row = vw - SCROLLBAR - 2 * GUTTER - 4 * gap
      - (tagline ? w.logo : w.logoNoTagline) - (w.nav - (12 - pad) * 10) - (short ? w.langShort : w.lang) - (dot ? DOT : w.pill[state]);
    assert.ok(row >= floor, `${lang}/${state} at ${vw}px: ${Math.round(row)}px left for the search box (floor ${floor}px), the row would overflow`);
  }
});

test('The phone hero reserves the tallest slide, so rotating slides never move the page below', () => {
  const lineClamp = (vw, sel) => +cascade(vw, [sel], '-webkit-line-clamp').value;
  for (const lang of ['en', 'ar']) for (let vw = 320; vw <= 720; vw += 1) {
    const scoped = (sel) => [sel, `html[lang="${lang}"] ${sel}`];
    const vars = {};
    for (const name of ['--safe-top', '--hdr-h', '--gutter']) vars[name] = cascade(vw, [':root'], name).value;
    for (const name of ['--hero-frame-h', '--hero-title-size', '--hero-title-lh']) vars[name] = cascade(vw, scoped('.hero'), name).value;
    const num = (v, em) => cssNumber(v, { vw, vars, em });
    const decl = (sel, ...props) => cascade(vw, scoped(sel), ...props)?.value;
    const reserved = num(decl('.hero', 'min-height'));
    // Upper bound of every block of a slide, from the declarations that bound it.
    assert.equal(decl('.hero__kicker', 'flex-wrap'), 'nowrap');
    assert.equal(decl('.hero__actions', 'flex-wrap'), 'nowrap');
    for (const sel of ['.hero__kicker', '.hero__title', '.hero__meta', '.hero__synopsis']) assert.equal(decl(sel, 'overflow'), 'hidden', `${sel} is clipped to its bound`);
    assert.equal(decl('.hero__frame', 'aspect-ratio'), '16 / 9');
    const frameW = Math.min(vw - 2 * num(vars['--gutter']), num(decl('.hero__frame', 'max-width')));
    const frame = Math.max(frameW * 9 / 16, num(decl('.hero__frame--portrait', 'height')));
    const titleSize = num(decl('.hero__title', 'font-size'));
    const title = lineClamp(vw, '.hero__title') * num(decl('.hero__title', 'line-height')) * titleSize + num(decl('.hero__title', 'padding-bottom'), titleSize);
    const synopsisSize = num(decl('.hero__synopsis', 'font-size'));
    const synopsis = lineClamp(vw, '.hero__synopsis') * num(decl('.hero__synopsis', 'line-height')) * synopsisSize;
    const body = num(decl('.hero__body', 'padding-top')) + frame + num(decl('.hero__body', 'gap'))
      + num(decl('.hero__kicker', 'height')) + num(decl('.hero__kicker', 'margin-bottom'))
      + title
      + num(decl('.hero__meta', 'margin-top')) + num(decl('.hero__meta', 'max-height'))
      + num(decl('.hero__synopsis', 'margin-top')) + synopsis
      + num(decl('.hero__actions', 'margin-top')) + num(decl('.hero__actions', 'height'));
    const tallest = num(vars['--hdr-h']) + body + num(decl('.hero', 'padding-bottom'));
    assert.ok(reserved >= tallest - 0.5, `${lang} at ${vw}px: the hero reserves ${reserved.toFixed(1)}px but a slide can need ${tallest.toFixed(1)}px`);
    assert.ok(reserved - tallest < 40, `${lang} at ${vw}px: ${Math.round(reserved - tallest)}px reserved beyond the tallest slide`);
  }
});
