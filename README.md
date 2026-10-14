# Dahsha

Dahsha is reserved for documentaries, with its original Arabic/English channels, topics, and episode browsing.

- Website: [Dahsha](https://dahsha.vercel.app)
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

## Android

```sh
npm ci --prefix mobile
npm run build:mobile -- --data-base https://dahsha.vercel.app
npm run sync --prefix mobile
```

Build `assembleRelease` from `mobile/android/`. The application ID is `app.dahsha.stream`.
Release signing uses a private `mobile/keystore.properties` and keystore; neither belongs in Git. Keep the existing signing key when publishing updates.

## Hosting and refresh

`vercel.json` targets Dahsha's own Vercel project and build output. Configure `STREAM_PROXY_SECRET` in Vercel for signed stream proxy URLs. Local development uses an ephemeral key.

This repo's refresh workflow updates only Dahsha and stores its cache in this repository's `data-snapshot` release. Android CI builds only Dahsha. Scheduled Vercel deployment uses `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` repository secrets. Android signing uses `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Without signing credentials CI produces an unsigned APK.

Read [Scraper behavior](docs/SCRAPERS.md) and [Provider integration](docs/FMOVIES.md) for parsing, matching, and playback details. Upstream streams and artwork may be unavailable; failed requests retain imported catalogue data.
