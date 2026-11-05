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
| `npm run publish` | Deploy the built website and API to Dahsha's Netlify site |

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

The website and lightweight API share `https://dahsha.netlify.app`. The API serves versioned catalogue chunks and resolves one documentary at a time for playback. Search, browsing and filtering run on the device. Video travels directly from its source to the player; Netlify does not relay video segments. `client/public/_redirects` and `_headers` retain the SPA routing and static fallback headers.

GitHub's hosted runners check YouTube RSS every 30 minutes and run the deeper channel, playlist and documentary-provider refresh every 12 hours. GitHub can delay scheduled jobs. Each successful refresh publishes immutable, hash-verified data in this repository's `catalogue-runtime` release and saves collection state in `data-snapshot`. Routine updates do not deploy Netlify or rebuild the APK. Failed or incomplete updates retain the previous catalogue. Curated channel and documentary filters still apply.

Reviewed HDToday identities in `server/config/dahsha-reviewed-identities.json` enrich only existing documentaries with an exact source ID, title, year and type match. `node scripts/apply-reviewed-identities.js` previews the changes; `--apply` writes them. Conflicts are skipped, and episode lists and update dates are preserved. The scheduled workflows apply these facts automatically.

Provider refreshes also rotate bounded episode-guide collection. Listing cards cannot erase saved episodes, and historical guide imports do not become recent releases. `server/config/dahsha-reviewed-guides.json` preserves explicitly observed FMovies episode links while hosted requests are denied; `node scripts/apply-reviewed-guides.js` previews its exact-match changes. The refresh workflow's `providers_only` input updates providers using the latest saved YouTube catalogue.

Android playback stays inline by default, filters known ad requests and popups (including service-worker requests), and remembers sources only after sustained content playback. Four automatic attempts are followed by an explicit Next source option. Optional Myflixer direct-stream discovery has its own short deadline so it cannot discard already resolved players. Upstream availability and advertisements embedded in the video itself are not guaranteed. A failed live playback metadata lookup can recover only a validated documentary and episode from the existing Dahsha deployment; this recovery never replaces the browsing catalogue.

Deploy website/API code explicitly with `npm run build` followed by `npm run publish` using the Netlify CLI login or `NETLIFY_AUTH_TOKEN`. Android client/player changes require a new APK. Android CI builds only Dahsha and uses `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`; without signing credentials it produces an unsigned APK.

Read [Scraper behavior](docs/SCRAPERS.md) and [Provider integration](docs/FMOVIES.md) for parsing, matching, and playback details. Upstream streams and artwork may be unavailable; failed requests retain imported catalogue data.
