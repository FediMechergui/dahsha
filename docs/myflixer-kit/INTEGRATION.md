# Myflixer module — integration guide

This folder is a self-contained copy of the Myflixer documentary source as it ships in the
Dahsha app (https://github.com/FediMechergui/dahsha). It is written so that an AI coding
assistant (or a developer) can drop the module into another streaming app with minimal
guesswork. All code here was authored in the Dahsha project; paths below are relative to
this folder.

> Note on scope: this module scrapes a third-party site that is not an official distributor
> and proxies its video streams. The source site can change markup at any time, which breaks
> the regexes in `server/myflixer.js`. Licensing of the content is the integrator's
> responsibility.

---

## 1. What the module does

| Capability | Where | Runs when |
|---|---|---|
| Lists documentary films and docuseries (title, slug, synopsis, poster, year, categories, episodes) | `fetchMyflixerCatalog` in `server/myflixer.js` | Catalogue refresh (cron / scheduler) |
| Resolves playable sources for one film or episode: direct HLS `.m3u8` files plus up to 7 embed players | `resolveMyflixerStream` | On demand, when the user opens a title |
| Proxies HLS playlists and segments with the headers the upstream CDN expects, rewriting playlist URIs so the whole chain stays same-origin | `handleStreamProxy` + `rewriteM3u8` | During playback |
| Serves a standalone HTML player page (Hls.js + server bar) that can be iframed by any client | `handleEmbedPlayer` | On demand |
| Plays the result in React: `<video>` + Hls.js for HLS servers, iframe for embed servers, with automatic failover and a server switcher | `client/Player.jsx` | In the app |

Everything is plain ESM JavaScript on Node 18+ (uses global `fetch`, `AbortSignal.timeout`).
No npm dependency on the server side. The client needs `hls.js` (^1.7).

---

## 2. Files in this kit

```
server/
  myflixer.js           # the whole module: scraper, resolver, proxy, embed page (605 lines)
  scheduler-snippet.js  # how Dahsha turns the scrape result into catalogue items
  express-route.js      # the Express route (/api/stream) — same contract as the Vercel one
vercel/
  stream.js             # Vercel serverless function version of the same endpoint (api/stream.js)
client/
  api.js                # API client: static/server modes, API_BASE detection for mobile
  Player.jsx            # hybrid player (YouTube + Myflixer). Only the Myflixer half matters here
  Thumb.jsx             # image component that skips YouTube CDN URLs for mf: ids
  player.css            # styles for the server switcher bar and the failover notice
```

---

## 3. Identifiers and data model

Every Myflixer item has a string id that starts with `mf:`. The prefix tells the resolver
which page to fetch.

| Id form | Meaning | Resolver fetches |
|---|---|---|
| `mf:m:<slug>` | Film (WordPress post) | `https://myflixerz.day/<slug>/` |
| `mf:s:<slug>` | Series (WordPress tvshow). Container only, not playable | — |
| `mf:e:<slug>` | Episode of a series | `https://myflixerz.day/episodes/<slug>/` |

`fetchMyflixerCatalog(source, { maxPages })` returns:

```js
{
  films: [{
    id: 'mf:m:the-slug', slug, kind: 'film', title, synopsis, thumb,   // thumb = poster URL
    year: 2021 | null, durationSec: 5400, views: 75000,                 // placeholders, site has no duration
    publishedAt: '2021-05-04T10:00:00Z', tags: ['history', ...], sourceUrl
  }],
  series: [{
    id: 'mf:s:the-slug', slug, kind: 'series', title, synopsis, thumb, year, publishedAt, tags, sourceUrl,
    episodes: [{ slug: 'the-slug-1x3', title: 'Episode title', season: 1, episode: 3 }]
  }]
}
```

Posters are derived, not fetched: `https://myflixerz.day/wp-content/uploads/posters/<postId>_medium.jpg`.

`CATEGORY_TAG_MAP` maps WordPress category ids to topic slugs (`history`, `crime`,
`politics`, `people-culture`, `survival`, `science-space`, `documentary`). Replace the
right-hand values with your own taxonomy; keep the numeric keys.

`DOCUMENTARY_CAT = 212` is the documentary genre. To scrape another genre, change that
constant (or make it a parameter) and the `categories=` query in `fetchMyflixerCatalog`.

---

## 4. Server integration

### 4.1 Catalogue refresh

Call `fetchMyflixerCatalog` from your refresh job and convert the result to your own
item shape. `server/scheduler-snippet.js` is the exact conversion Dahsha uses. Points worth
copying:

- Cache the result and skip the scrape if the cached copy is less than 3 hours old. A full
  scrape is roughly 60 list pages + one HTML fetch per series (hundreds of requests).
- Films become one playable item each. Series become one show with one playable item per
  episode (`mf:e:<slug>`), all sharing the series poster and synopsis.
- Store `sourceUrl` on each item so the UI can offer an "open on the source site" link
  when playback fails.
- Duration and view counts are not available from the API. Dahsha uses 90 min / 50 min
  and fixed view counts so sorting still works. Mark them as estimates in your UI if that
  matters.

### 4.2 The `/api/stream` endpoint

One endpoint, three modes selected by query string. Both `vercel/stream.js` (serverless)
and `server/express-route.js` (Express) implement the identical contract.

| Request | Behaviour |
|---|---|
| `GET /api/stream?id=mf:m:<slug>` | Resolve. Returns the JSON in 4.3. Must be served with `Cache-Control: no-store` (stream URLs are tokenised and short-lived). |
| `GET /api/stream?proxy=1&url=<encoded upstream url>` | Proxy. Fetches the upstream with a desktop User-Agent and the Referer/Origin the CDN expects, forwards `Range`, streams the body back. If the body is an m3u8 it is rewritten so every URI (segments, keys, variant playlists) points back at `/api/stream?proxy=1&url=...`. |
| `GET /api/stream?embed=1&id=mf:e:<slug>` | Standalone HTML player (Hls.js from jsDelivr, server bar, auto-failover). Sent with `frame-ancestors *` so any origin may iframe it. |

All modes answer `OPTIONS` and set `Access-Control-Allow-Origin: *`. Keep that: the mobile
app calls the endpoint cross-origin from a WebView.

`streamPrefix` must be the **absolute** public URL of the endpoint
(`https://your-host/api/stream`). It is derived from `x-forwarded-host` /
`x-forwarded-proto` on Vercel and from `req.headers.host` in Express. The resolver embeds it
in every `streamUrl` and in the rewritten playlists, so a wrong prefix breaks playback
silently.

### 4.3 Resolve response shape

```js
{
  id: 'mf:e:slug',
  sourceUrl: 'https://myflixerz.day/episodes/slug/',
  embedUrl:  'https://your-host/api/stream?embed=1&id=mf%3Ae%3Aslug',  // self-hosted player page
  rawEmbedUrl: 'https://.../player-2-url',                              // first third-party embed
  streamUrl: 'https://your-host/api/stream?proxy=1&url=...m3u8' | null, // first HLS through the proxy
  rawStreamUrl: 'https://cdn.../file.m3u8' | null,
  servers: [
    { id: 'hls_0', name: '1080p (HLS)', type: 'hls',   streamUrl: '<proxied m3u8>', rawStreamUrl: '<upstream m3u8>' },
    { id: 'tab_2', name: 'Player 2',    type: 'embed', embedUrl: '<third-party url>', rawEmbedUrl: '<same>' },
    ...                                                                   // Player 3 … Player 7
  ],
  streams: [ { id, name, uri, proxyUri, mimeType: 'application/x-mpegURL', quality, headers } ],
  error?: 'message'                                                       // present when resolution failed; servers is []
}
```

`servers` is the only field the client really needs. HLS entries come first, embed entries
follow in the order the site lists them. Player 1 is dropped from the embed list when its
direct HLS files were extracted (to avoid a duplicate).

### 4.4 Deploying on Vercel

- Put `vercel/stream.js` at `api/stream.js` in the repo root. It imports
  `../server/src/myflixer.js`, so keep the module where that relative path resolves (or
  edit the import).
- `vercel.json`: the SPA rewrite must exclude `api/`, e.g.
  `{ "source": "/((?!data/|assets/|api/).*)", "destination": "/index.html" }`.
  The install command must install the server package if the module ever grows
  dependencies (today it has none).
- Serverless limits: the proxy streams whole video segments through the function. On the
  Hobby plan this counts against execution time and bandwidth. For heavy use, move the
  proxy mode to an Edge function or a small always-on Node host and keep the resolve mode
  serverless.

### 4.5 Deploying on Express / any Node host

Mount `server/express-route.js` on your app (`app.get('/api/stream/:id?', ...)`). It uses
`req.protocol` and `req.headers.host`; behind a reverse proxy enable `trust proxy` so the
prefix is `https`.

---

## 5. Client integration

### 5.1 API client (`client/api.js`)

The only call the player needs:

```js
stream: (id) => req(`${API_BASE}/api/stream?id=${encodeURIComponent(id)}`)
```

`API_BASE` is the absolute origin of the endpoint. In a web deployment it is `''`
(same origin). In the Capacitor APK it must be the public site, because the bundle runs
from `https://localhost` inside the WebView. Dahsha sets it two ways:

1. Build time: `VITE_API_BASE=https://dahsha.vercel.app` (and `VITE_MOBILE=1`) when building
   the mobile bundle.
2. Runtime fallback: if the page origin looks like a Capacitor origin (`capacitor:` scheme,
   `localhost` without a port, or `file:`), default to the public host.

`req()` sends no custom headers on GET, so the cross-origin call needs no CORS preflight.

### 5.2 Player (`client/Player.jsx`)

Props: `videoId` (the `mf:` id), `episode` (for poster + `sourceUrl`), `startAt`,
`onProgress(position, duration)`, `onEnded()`, `autoplay`.

Flow for an `mf:` id:

1. **Resolve.** `api.stream(videoId)` → normalise `data.servers` into
   `{ id, name, type: 'hls' | 'embed', streamUrl, embedUrl }`. Relative URLs are made
   absolute with `API_BASE`. Fallback chain if `servers` is empty: `data.streams` →
   `data.streamUrl` → `data.embedUrl`.
2. **Pick the initial server.** The entry whose name contains "player 2" if present
   (most reliable in practice), otherwise index 0.
3. **HLS servers** render a `<video controls playsInline>`; Safari gets the URL natively,
   everything else goes through `new Hls({ enableWorker: true, lowLatencyMode: true })`.
   `timeupdate` feeds `onProgress` so resume and "next episode" work like any other source.
4. **Embed servers** render `<iframe src={embedUrl} allow="autoplay; fullscreen; ...">`.
   No progress events are available from third-party iframes.
5. **Failover.** A fatal Hls.js error or a native `error` event calls `failoverToNext()`:
   from an HLS server it jumps to the next *embed* server, otherwise to index + 1, shows a
   notice for 600 ms, then switches. When the list is exhausted, a Retry button and an
   "Open on <source>" link are shown.
6. **Server bar.** Rendered when there is more than one server; clicking switches
   immediately. Styles are in `client/player.css` (needs `.player` to be
   `position: relative` or the absolute-positioned bar will escape; Dahsha's base rule is
   `.player, .player iframe, .player video { position: absolute; inset: 0; width: 100%; height: 100%; }`
   inside a 16:9 container).

The YouTube half of the component (everything guarded by `!isMyflixer`) can be deleted if
your app has no YouTube sources.

Strings used: `loading`, `stream_error`, `open_myflixer` (i18n keys) plus two inline
Arabic/English notices. Replace with your own i18n.

### 5.3 Thumbnails (`client/Thumb.jsx`)

If your image component builds YouTube thumbnail URLs from a video id, guard it so `mf:`
ids are skipped (line 7). Myflixer items carry their poster in `thumbs.custom` /
`thumb`, which is always an absolute `https://` URL.

---

## 6. Mobile (Capacitor) notes

- The APK is a static bundle; it never runs the scraper. All it needs is network access to
  the public `/api/stream` endpoint (`INTERNET` permission, HTTPS scheme, mixed content off).
- Build with `VITE_STATIC=1 VITE_MOBILE=1 VITE_API_BASE=https://<public host>`.
- Because every mode of the endpoint sets `Access-Control-Allow-Origin: *`, the WebView
  origin (`https://localhost`) is accepted without further config.
- Hls.js works inside the Android WebView (Chromium). iOS WebKit takes the native HLS path.

---

## 7. Adapting to another app — checklist

1. Copy `server/myflixer.js` as is. Edit only `CATEGORY_TAG_MAP` (your tags) and, if
   needed, `DOCUMENTARY_CAT` / the `BASE` host.
2. Add the refresh step (section 4.1) to your catalogue job; store items with `mf:` ids,
   `sourceUrl`, and the poster URL.
3. Expose `/api/stream` with the three modes (section 4.2) using `vercel/stream.js` or
   `server/express-route.js`. Make sure `streamPrefix` is absolute and public.
4. Exclude `api/` from any SPA rewrite; keep CORS `*` on the endpoint.
5. In the client, add `api.stream(id)` and the Myflixer branch of `Player.jsx`
   (sections 5.1–5.2); include `player.css`.
6. Guard image helpers against `mf:` ids (section 5.3).
7. Give the player a "open on source site" fallback link using `item.sourceUrl`.
8. Test: open a film (`mf:m:`) and an episode (`mf:e:`); confirm the server bar shows
   several players, HLS plays through the proxy (network tab shows only your host), and
   switching to an embed server loads an iframe.

---

## 8. Known limitations

- **Markup dependence.** `resolveMyflixerStream` relies on `player-tab-btn` buttons with
  `data-player-url`, an `id="main-player"` iframe, and the `const cfg = {...}` /
  `const sources = [...]` blocks of the Player 1 host. Any change on those pages returns
  `servers: []` with an `error` message; the client then shows the fallback UI.
- **Placeholder metadata.** Durations and view counts are constants.
- **No progress from embeds.** Only HLS servers report playback position.
- **Proxy cost.** Video bytes flow through your function/host.
- **Upstream headers.** `handleStreamProxy` sends a fixed `Referer`/`Origin`
  (`https://sv4.nontongo.day/`). If the HLS host changes, update those two values or
  derive them from the `headers` field the resolver attaches to each stream.
