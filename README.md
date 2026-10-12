# دهشة · Dahsha

**Documentaries that amaze.** A bilingual (Arabic-first, English) streaming catalogue of full-length documentaries from YouTube: every full episode of every show, grouped into series (with seasons) or standalone films, tagged by topic, with posters and synopses, refreshed automatically.

- Web: https://dahsha.vercel.app
- Android APK: see the [Releases](https://github.com/FediMechergui/dahsha/releases) page
- Playback uses the official YouTube embedded player; all rights belong to the channels.

## Channels

| Section | Channels |
|---|---|
| العربية | Nat Geo Abu Dhabi, Asharq Discovery, Asharq Discovery Wildlife, DW Documentary Arabic, Al Jazeera Documentary |
| English | National Geographic, DW Documentary, FRONTLINE PBS, HISTORY, Free Documentary – History, VICE News, fern, Hoog, JCS – Criminal Psychology, Kurzgesagt, Veritasium |

Each channel has a parsing *profile* (how its titles encode show / episode / season) chosen automatically; add more channels in `server/data/sources.json` or from the Sources page of the server edition.

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
