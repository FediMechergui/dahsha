# وثائقيات بالعربية — Arabic Documentary Catalogue

A self-hosted streaming catalogue of Arabic documentaries from YouTube. It reads every playlist and the uploads tab of each channel you add, keeps only **full episodes** (longer than 7 minutes by default), groups them into **series** (with seasons/episode numbers) or standalone **films**, tags each title by topic, and keeps the catalogue **updated in real time** without any API key.

Playback uses the official YouTube embedded player.

## Channels (default sources)

| Channel | Profile | What the parser expects |
|---|---|---|
| Nat Geo Abu Dhabi | `natgeo` | `الحلقة \| العرض \| ناشونال جيوغرافيك أبوظبي`, playlists per show, a big "حلقات كاملة" playlist |
| Asharq Discovery / Asharq Discovery Wildlife | `asharq` | `العرض - الحلقة - الحلقة N - الموسم X \| الشرق ديسكفري`, playlists per show |
| DW Documentary Arabic | `dw` | `وثائقي \| عنوان الفيلم \| وثائقية دي دبليو`; mostly standalone films, multi-part films `(2/2)` / `الجزء الثاني`; series only in "سلسلة وثائقيات" playlists |
| Al Jazeera Documentary | `aljazeera` | `السلسلة.. العنوان \| الحلقة الرابعة` for series, plain titles for films; topic playlists are detected and ignored as series |
| anything else | `generic` | pipes, dashes and playlist names |

Add more channels or playlists from the **المصادر** page (or `POST /api/sources`). The profile and language are detected automatically and can be edited in `server/data/sources.json`.

## Run it

```bash
npm run setup     # installs server + client dependencies (once)
npm run dev       # API on http://localhost:4545, UI on http://localhost:5173
```

Production-style (single port, built client served by the API):

```bash
npm start         # builds the client, then serves everything on http://localhost:4545
```

The first start builds the catalogue (a few minutes: ~1,000 playlists / ~8,000 videos for the five default channels). The UI shows live progress and switches to the catalogue automatically.

## How it works

```
server/
  src/youtube.js    InnerTube client (youtubei.js): playlists, uploads tab, per-video details, channel RSS, profile detection
  src/text.js       Arabic normalisation, per-channel title parsers, boilerplate stripping
  src/catalog.js    builds shows → episodes per channel, series detection, prefix clustering, posters & synopses
  src/tagger.js     keyword-based Arabic topic tags (19 topics)
  src/scheduler.js  refresh loop with change detection + RSS fast-poll; emits update events
  src/index.js      Express API (lean gzipped list + full show endpoint) + SSE + static hosting of client/dist
  data/             sources.json, overrides.json (yours) + cached playlists/details/catalog (generated)
client/             Vite + React, RTL, no CSS framework
```

**Real-time:** every 15 min the server re-lists each channel's playlists (re-fetching only those whose video count or cover changed) and reads the uploads tab incrementally (stops at the first known video). Every 3 min it checks each channel's RSS feed; a new upload triggers an immediate refresh. Browsers stay connected over SSE and get a toast + refreshed catalogue when new episodes land.

**Organisation:** titles are parsed per channel profile; videos appearing in several playlists are merged by id; shows with slightly different spellings are merged (fuzzy match + `aliases`); on DW and Al Jazeera, films whose titles share a prefix three or more times ("صراع البوارج.. X") become a series; Al Jazeera playlists count as a series only when their videos reference the playlist name or carry episode numbers.

## Curation (`server/data/overrides.json`)

```json
{
  "minEpisodeSeconds": 420,
  "aliases": { "كنوز روما الضائعة": "كنوز روما المفقودة" },
  "shows": {
    "s_abc123": { "title": "...", "synopsis": "...", "tags": ["wildlife"], "poster": "https://...", "hidden": false }
  }
}
```

Show ids are visible in the URL (`/show/s_abc123`). Edit the file and run `npm run rebuild-catalog`, or call `PUT /api/overrides/shows/:id` (applied instantly).

## API

| Method | Path | |
|---|---|---|
| GET | `/api/catalog` | lean catalogue (shows with episode lists, channels, tags, stats), gzipped |
| GET | `/api/shows/:id` | one show with full synopsis and per-episode synopses |
| GET | `/api/status` | refresh state |
| GET | `/api/events` | SSE stream: `status`, `update` |
| POST | `/api/refresh?full=1` | trigger refresh (full = re-fetch all playlists and uploads) |
| GET/POST/DELETE | `/api/sources` | manage channels / playlists |
| PUT | `/api/overrides/shows/:id` | curate a show |

Environment: `PORT` (4545), `REFRESH_MINUTES` (15), `FEED_MINUTES` (3), `DATA_DIR`.

## Roadmap

- English section (same pipeline, `lang: "en"` sources; UI language switch, Arabic stays the default)
- Mobile APK and a desktop build hosted on Vercel
