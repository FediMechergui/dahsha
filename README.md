# Dahsha and Flixer

This repository contains two independent apps. **Dahsha is for documentaries only**;
**Flixer is for movies and TV shows across all genres**. They share playback code,
but use separate catalogues, branding, storage keys and build outputs.

Dahsha remains the default app for the existing Vercel project and Android release.

See [Scraper behaviour and adding providers](docs/SCRAPERS.md) for discovery,
refresh, episode parsing, playback resolution, and the proposed provider contract.

| Command | Dahsha | Flixer |
|---|---|---|
| Develop | `npm run dev:dahsha` | `npm run dev:flixer` |
| Production server | `npm run start:dahsha` | `npm run start:flixer` |
| Export catalogue | `npm run export:dahsha` | `npm run export:flixer` |
| Static build | `npm run build:dahsha` | `npm run build:flixer` |
| Exported data | `client/public/data/` | `client/public/data-flixer/` |
| Build output | `client/dist/` | `client/dist-flixer/` |
| Vercel configuration | `vercel.json` | `vercel.flixer.json` |

Run one development server at a time, or give the second one distinct `PORT` and
`API_PORT` values. Direct server/build entry points select the app with
`APP_PRODUCT=dahsha` (default) or `APP_PRODUCT=flixer`.

Flixer's alternative vanilla frontend is in `client-terrarium/`; build it with
`node scripts/build-terrarium.js` after exporting Flixer data. Its TVmaze, service,
universe and episode-splitting tools also operate on `data-flixer/`.

For a separate Flixer Vercel project, use `vercel --local-config vercel.flixer.json`
and set `APP_PRODUCT=flixer` for both build and runtime. Do not point Flixer's
`VITE_DATA_BASE` or `VITE_API_BASE` at Dahsha's host.

Before deploying either app's Myflixer playback, set **`STREAM_PROXY_SECRET`** to
a strong random secret in the server environment. For example, generate a value
with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
All serverless instances must share this value. Local development uses an ephemeral
key automatically. Stream proxy URLs are signed and expire after six hours;
private destinations and unsafe redirects are blocked. Dahsha additionally restricts
stream resolution to documentary IDs in its export.

Source administration is enabled for local requests. Remote administration requires
`ADMIN_TOKEN` and an `Authorization: Bearer <token>` header. Static hosting is read-only.

In `mobile/`, `npm run build:web` builds Dahsha and `npm run build:web:flixer` builds
Flixer; both accept `-- --data-base <the-app-host>`. Run `npm run sync` afterward.
They use different Android application IDs, so the apps can coexist on a device.
`npm run build:terra` builds the Flixer alternative frontend. Web builds update the
native name and application ID before syncing; always build before generating an APK.

Run `npm test` for catalogue isolation, export safety, routing, SSE and playback security
regressions. The Flixer exporter walks all upstream pages; failures abort the export
and preserve the previous static data.

## Dahsha

**Documentaries that amaze.** A bilingual (Arabic-first, English) streaming catalogue of full-length documentaries from YouTube: every full episode of every show, grouped into series (with seasons) or standalone films, tagged by topic, with posters and synopses, refreshed automatically.

- Web: https://dahsha.vercel.app
- Android APK: see the [Releases](https://github.com/FediMechergui/dahsha/releases) page
- Playback uses the official YouTube embedded player; all rights belong to the channels.

## Channels

| Section | Channels |
|---|---|
| العربية | Nat Geo Abu Dhabi, Asharq Discovery, Asharq Discovery Wildlife, DW Documentary Arabic, Al Jazeera Documentary |
| English | National Geographic, Nat Geo Animals, DW Documentary, FRONTLINE PBS, HISTORY, Discovery, Curiosity Stream, WELT Documentary, Free Documentary – History, VICE News, fern, Hoog, JCS – Criminal Psychology, Kurzgesagt, Veritasium, C'est pas sorcier (French, tagged "In French") |

Each channel has a parsing *profile* (how its titles encode show / episode / season) chosen automatically; add more channels in `server/data/sources.json` or from the Sources page of the server edition. A source may carry `contentLang` (e.g. `"fr"`) when its spoken language differs from its section: those shows get a language badge and an "In French" tag.

### Posters & synopses (optional, TMDB)

Set `TMDB_API_KEY` (free key from themoviedb.org; locally as an environment variable, in CI as a repository secret) and each refresh looks up shows on TMDB by title: matched shows get the TMDB backdrop as card art, the portrait poster on the show page, and the TMDB overview (Arabic or English) when the channel wrote no synopsis. Results are cached in `server/data/artwork.json`; YouTube thumbnails remain the fallback.

## Three ways to run it

| | What it is | Data refresh |
|---|---|---|
| **Server edition** (`npm run dev` / `npm start`) | Express API + scheduler + React client on your machine | every 15 min + RSS fast-poll every 3 min, pushed live over SSE |
| **Static site** (Vercel) | the same client reading pre-exported JSON (`/data/*.json`) | GitHub Action every 6 hours (`refresh.yml`) re-scans YouTube, rebuilds and redeploys |
| **Android app** (Capacitor) | the static client packaged as an APK, reading data from the Vercel site | automatic, same data as the site |

```bash
npm run setup          # install server + client deps (once)
npm run dev            # API on :4545, UI on :5173 (first start builds the catalogue, a few minutes)

npm run refresh-data   # scan YouTube into server/data (incremental)
npm run export         # write client/public/data/*.json (lean catalogue + one file per show)
npm run build:static   # client/dist in static mode
npm run publish        # refresh + export + build + "vercel deploy --prod"
```

### Android

```bash
cd mobile && npm install
npm run build:web -- --data-base https://dahsha.vercel.app   # static client → mobile/www
npm run sync                                                  # copy into the Android project
npm run apk:release                                           # mobile/android/app/build/outputs/apk/release/
```

Release signing reads `mobile/keystore.properties` (not committed). The `android.yml` workflow builds and attaches a signed APK to a GitHub Release whenever a `v*` tag is pushed (keystore in repository secrets).

## How the catalogue is built

FMovies and HDToday now share a provider registry with the existing library. Confirmed
matches add servers to existing episodes; uncertain matches appear as selectable
versions inside one title page. Dahsha admits verified documentaries, while Flixer
admits movies and TV series across genres. Provider failures retain cached records.

`npm run refresh:providers` advances historical discovery and checks new releases.
`npm run refresh:providers:full` resumes the full crawl from its saved cursors.
The `providerSync` catalogue field reports coverage and upstream failures. HDToday
movie redirects resolve to their public player URLs; verification and rate limits
on other routes remain upstream limitations, with backoff and other servers retained.

Build web apps with `npm run build:dahsha` and `npm run build:flixer`. For Android,
run the matching `node scripts/product.js <product> mobile-web --data-base <host>`,
then `npx cap sync android` in `mobile`, followed by `gradlew assembleRelease` in
`mobile/android`. The default product remains Dahsha. Each product has its own app ID,
catalogue, branding, hosting and saved progress.

```
server/
  src/youtube.js    InnerTube client (youtubei.js, no API key): playlists, uploads tab, per-video details, RSS, profile detection
  src/text.js       Arabic/English normalisation, per-channel title parsers, boilerplate stripping
  src/catalog.js    shows → episodes per channel, series detection, prefix clustering, posters, synopses, lean export shapes
  src/tagger.js     keyword topic tags (19 topics, Arabic + English keyword sets)
  src/scheduler.js  refresh loop (change detection, incremental uploads scan) + RSS fast-poll
  src/index.js      Express API (gzipped lean list + full show endpoint) + SSE + static hosting
  src/export.js     static JSON export for Vercel / mobile
client/             Vite + React, RTL/LTR, i18n (lib/i18n.jsx), hand-written CSS
mobile/             Capacitor Android wrapper
scripts/            dev runner, static build, icons, data snapshot (release asset) for CI
```

- Only videos longer than 7 minutes (`minEpisodeSeconds`) are kept.
- Videos appearing in several playlists are merged by id; spelling variants are merged by fuzzy match + `aliases`.
- A show with a single video is a *film*; DW/Al Jazeera films sharing a title prefix 3+ times become a series; Al Jazeera playlists count as a series only when their videos reference the playlist name or carry episode numbers.
- The UI language (top bar) switches both the interface and the catalogue section; Arabic is the default.

## Curation (`server/data/overrides.json`)

```json
{
  "minEpisodeSeconds": 420,
  "aliases": { "كنوز روما الضائعة": "كنوز روما المفقودة" },
  "shows": { "s_abc123": { "title": "...", "synopsis": "...", "tags": ["wildlife"], "poster": "https://...", "hidden": false } }
}
```

Show ids are in the URL (`/show/s_abc123`). Edit the file and run `npm run rebuild-catalog` (or `PUT /api/overrides/shows/:id` on the server edition).

## API (server edition)

| Method | Path | |
|---|---|---|
| GET | `/api/catalog` | lean catalogue (gzipped) |
| GET | `/api/shows/:id` | one show with full synopses |
| GET | `/api/status` · `/api/events` (SSE) | refresh state / live updates |
| POST | `/api/refresh?full=1` | trigger a refresh |
| GET/POST/DELETE | `/api/sources` | manage channels |
| PUT | `/api/overrides/shows/:id` | curate a show |

Environment: `PORT` (4545), `REFRESH_MINUTES` (15), `FEED_MINUTES` (3), `DATA_DIR`. Client build: `VITE_STATIC=1`, `VITE_DATA_BASE`.
