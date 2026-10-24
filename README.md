# Dahsha

Dahsha is reserved for documentaries, with its original Arabic/English channels, topics, and episode browsing.

- Website: [Dahsha](https://dahsha.netlify.app)
- Repository: [FediMechergui/dahsha](https://github.com/FediMechergui/dahsha)
- Android downloads: [Releases](https://github.com/FediMechergui/dahsha/releases)
- Flixer is maintained in its [own repository](https://github.com/FediMechergui/flixer).

## Run locally

Requires Node.js 22 or newer. Android builds additionally require Java 21 and the Android SDK.

```sh
npm run setup
npm run snapshot:restore
npm run export -- --cached
npm run dev
```

The repository defaults to **Dahsha**. The default commands do not build or deploy Flixer.

| Command | Purpose |
|---|---|
| `npm run dev` | Run Dahsha locally |
| `npm run start` | Build and serve Dahsha |
| `npm run build` | Build the static website |
| `npm run export -- --cached` | Export the restored catalogue |
| `npm run refresh:providers` | Incrementally refresh this app's providers |
| `npm run test` | Validate providers, catalogue policy, and media handling |
| `npm run publish` | Deploy this repository to its linked Vercel project |

## Project layout

- `client/src/`: Dahsha's frontend source.
- `server/src/`, `api/`, `shared/`: provider discovery, metadata matching, and playback.
- `client/public/data/`: generated catalogue; excluded from Git.
- `client/dist/`: generated website; excluded from Git.
- `mobile/`: Capacitor Android wrapper.

The repositories retain independent copies of the common provider infrastructure and compatibility tests. No build requires the other repository's working folder. Generated catalogues and old compiled frontend files are not source code.

## Uploads without playlists

Channel refreshes include standalone uploads, including Hochelaga. Videos still need to meet
the seven-minute minimum. Uploads with no real playlist membership receive an explainable
metadata score using category, title, description, keywords, duration, and an optional curated
source hint (`documentaryUploads: true`). This is a heuristic, not content verification.

Confident documentaries enter the normal shelves with topic tags. Clear promotional or
non-documentary formats are excluded. Uncertain videos remain playable, carry a “Not yet
classified” label, and appear in the “New uploads” shelf. A later real playlist membership
supersedes this uploads-only classifier on the next refresh.

Add optional rules to `server/data/overrides.json` (video IDs take precedence; patterns use
literal, case-insensitive title substrings, with an optional channel scope):

```json
{
  "uploadClassification": {
    "videos": { "VIDEO_ID": "documentary" },
    "patterns": [
      { "channelId": "CHANNEL_ID", "titleIncludes": "channel update", "status": "non-documentary" }
    ]
  }
}
```

Allowed statuses are `documentary`, `non-documentary`, and `uncertain`. Rebuild/export to apply
rule changes; classification status, score, reasons, and rule version are included in exports.

## Android builds

```sh
npm ci --prefix mobile
npm run build:mobile -- --data-base https://dahsha.netlify.app
npm run sync --prefix mobile
```

Build `assembleRelease` from `mobile/android/`. The application ID is `app.dahsha.stream`.
Release signing uses a private `mobile/keystore.properties` and keystore; neither belongs in Git. Keep the existing signing key when publishing updates.

## Hosting and refresh

The website and its data are served by Netlify (`https://dahsha.netlify.app`, site `dahsha`); `client/public/_redirects` and `_headers` carry the SPA rewrite and the `/data` CORS and cache headers. The serverless API in `api/` (provider titles and playback) stays on the Vercel project: the web build and the Android app call it at `https://dahsha.vercel.app`. Vercel blocked the Hobby team for serverless CPU on 2026-10-21, so that API answers again only when the block is lifted. Configure `STREAM_PROXY_SECRET` in Vercel for signed stream proxy URLs. Local development uses an ephemeral key.

This repo's refresh workflow updates only Dahsha and stores its cache in this repository's `data-snapshot` release. Android CI builds only Dahsha. The scheduled deploy (every 12 hours) uploads `client/dist` with the Netlify CLI; it needs the `NETLIFY_AUTH_TOKEN` repository secret (a Netlify personal access token) and uses the `NETLIFY_SITE_ID` variable when set, else the `dahsha` site's id. Android signing uses `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Without signing credentials CI produces an unsigned APK.

Read [Scraper behavior](docs/SCRAPERS.md) and [Provider integration](docs/FMOVIES.md) for parsing, matching, and playback details. Upstream streams and artwork may be unavailable; failed requests retain imported catalogue data.
