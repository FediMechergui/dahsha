# Scraper behaviour and adding providers

Code audit and small read-only live probes: 2026-10-14. This describes the current
implementation, including limitations. No additional provider has been integrated.

See [F-Movies investigation](FMOVIES.md) for its verified discovery routes,
Documentary genre IDs, player-server mapping, and integration limitations.

## Product boundaries

| App | Catalogue membership | Current discovery sources |
|---|---|---|
| Dahsha | Documentary films and documentary series | Curated YouTube channels/playlists, Myflixer documentary category |
| Flixer | Movies and TV series across genres, including documentaries | Myflixer's all-genre movie and series lists |

`APP_PRODUCT` chooses the app, defaulting to Dahsha. Exported catalogues carry a
product marker and live in different directories. React rejects a mismatched
catalogue; the alternative Flixer client also requires the Flixer marker.

YouTube's documentary membership is based on curated sources, not an independent
classifier of every upload. Myflixer's membership is based on its Documentary
taxonomy. Neither mechanism proves that every source classification is accurate.

## Myflixer catalogue discovery

Implementation: `server/src/myflixer.js`.

This uses HTTP requests, not a headless browser. It reads the site's public
WordPress API at `https://myflixerz.day/wp-json/wp/v2`:

| Request | Purpose |
|---|---|
| `/posts` | Movie records |
| `/tvshows` | Series records |
| `/release-year` | Map year taxonomy IDs to four-digit years |

Movie and series requests use `orderby=modified&order=desc`. Page size is clamped
to 1–100, and page number to a positive integer. Genre filtering sends a category
ID; year filtering first resolves the year to a taxonomy ID; search sends the
WordPress `search` parameter. Pagination totals come from `x-wp-total` and
`x-wp-totalpages`. List calls have a 12-second timeout and throw on HTTP/network
failure. They do not retry automatically.

Year taxonomy fetching checks up to eight pages of 100 terms, with a six-second
timeout per request. The resulting map is cached for the lifetime of the process,
including a partial or empty map after an error. There is no TTL or single-flight
lock; concurrent cold requests can repeat this lookup.

Rows are normalized to `film` or `series`. HTML is stripped from titles and
synopses and a limited set of entities is decoded. Known category IDs become genre
tags. Unknown category IDs are discarded. Source IDs are slug-based:

- `mf:m:<slug>`: movie;
- `mf:s:<slug>`: series;
- `mf:e:<slug>`: episode.

Posters are constructed from the WordPress numeric ID using the site's
`/wp-content/uploads/posters/<id>_medium.jpg` and `<id>.jpg` naming convention.
Their existence is not checked during listing. Release year comes from taxonomy;
publication dates are site record dates, not necessarily original release dates.
Flixer leaves unavailable duration and view totals unknown.

### Dahsha's documentary adapter

`server/src/documentaries.js` calls those same movie and series functions with
category **212**, then independently rejects records missing the normalized
`documentary` tag. It fetches up to 60 pages per type by default, with the source's
`maxPages` able to override that limit. It resolves episode lists for all returned
series with four workers.

The scheduler stores these records as a synthetic `MYFLIXER:<source-id>` playlist
and accompanying episode-detail records, then passes them through Dahsha's normal
catalogue builder. It skips the Myflixer scan when its nonempty cache is less than
three hours old, unless a full refresh is requested. A failed source scan retains
the previous playlist. An entirely empty result is also rejected.

Current caveats: the adapter assigns a 90-minute film duration and the scheduler
assigns 50 minutes to series episodes. These are placeholders, not measured
durations. Some adapter topic mappings also do not match Dahsha's established
topic IDs; this needs normalization before extending the adapter system.

### Flixer's exports

`fetchFullCatalog()` walks every movie page and then every series page, sequentially,
at 100 records per page. It deduplicates by provider ID, keeping a movie and series
with the same slug separate. It resolves episodes for the first 80 returned series
using four workers. Other series obtain details/episodes when opened.

`npm run export:flixer` uses that path. `server/src/export-index.js` is an alternate
path: it fetches the first page to discover totals, then walks remaining pages with
four workers by default. It resolves the 300 newest series by default with eight
workers. Its retry loop handles empty responses; thrown HTTP/network errors escape
that loop rather than being retried.

Both paths now use staged static exports with rollback: catalogue lists and
per-title files are prepared beside the destination before replacing it. The
previous export survives a listing failure or an empty overall catalogue. An
episode-parser failure can still result in an incomplete episode list because
that parser returns an empty array on failure.

## Details and episode parsing

`getTitleDetails()` selects `/posts?slug=...` or `/tvshows?slug=...` from the ID,
with an opposite-type fallback if no record is found. Series details then fetch
`/series/<slug>/`.

`fetchSeriesEpisodes()` searches that HTML for embedded JSON fragments with the
ordered fields `title`, `permalink`, `season`, and `episode`. It extracts episode
slugs from `/episodes/<slug>/`, deduplicates by slug, decodes the title, and emits
season/episode numbers. This is regex parsing, not a general JSON or DOM parser:
field reordering or changed page markup can break it. Its eight-second timeout,
HTTP failures, or an unmatched page all produce `[]`; callers cannot distinguish
an empty series from a parsing/network failure. It preserves encounter order.

## Playback resolution

`resolveMyflixerStream()` runs on demand when a viewer opens a film or episode.
It fetches `/<movie-slug>/` or `/episodes/<episode-slug>/`, then:

1. Reads `player-tab-btn` buttons and their `data-player-url` attributes.
2. Reads the `main-player` iframe's `data-src` or `src` attribute.
3. If the selected player URL contains `soap/`, fetches its wrapper and parses
   `const cfg = {...};`.
4. Selects the first usable movie/TV server URL template, substitutes TMDB ID and
   season/episode, fetches it, and parses `const sources = [...];`.
5. Returns HTTPS HLS source URLs plus the other iframe tabs as selectable servers.

The advertised seven players are seven tab/provider options on a Myflixer page,
not seven independent catalogue adapters. Their actual number can vary. HLS
extraction is specialized to the `soap/` wrapper; other tabs are embedded rather
than resolved to direct streams. No browser JavaScript is executed by this resolver.

React initially prefers the server named Player 2 if present. HLS playback errors
can trigger failover. An opaque cross-origin iframe does not provide the same
reliable progress, end-of-video, or error signals as a native video element.

The resolver returns an object containing `error` and empty server arrays on most
resolution failures, rather than throwing. API HTTP success therefore does not
always mean playback resolution succeeded. Stream URLs are deliberately not
persisted in static catalogues because sessions and tokens can expire.

### Shared stream proxy

HLS playlist URLs, child playlists, encryption keys, and segments receive signed
proxy URLs expiring after six hours. Production requires one shared
`STREAM_PROXY_SECRET`. Destinations are DNS-validated and pinned to a public address;
redirects are revalidated. Requests have a 30-second timeout per hop and at most
five redirects. Range headers are forwarded; response streaming handles client
disconnects and backpressure.

The proxy currently hardcodes the upstream Referer and Origin to
`sv2.nontongo.stream`. Although extracted streams carry header metadata, that
metadata is not currently used to select proxy headers. New providers will need
their own server-controlled header policies.

Dahsha's Express route only resolves Myflixer IDs present among its catalogue
episodes. Its serverless route checks the exported documentary playback manifest.
Flixer accepts valid Myflixer IDs without that documentary membership restriction.

## YouTube discovery and refresh

`server/src/youtube.js` uses `youtubei.js`/InnerTube without a YouTube Data API key.
The scheduler reads curated channels and playlists from `sources.json`:

- Channel playlist listings use a count/cover signature to decide what changed.
- Playlist contents follow continuation pages, guarded at 100 continuations.
- Channel uploads are scanned newest first. Incremental scanning stops fetching
  additional pages after a page contains a known video; full scanning ignores
  that stop condition. Source-specific upload limits apply, with whole-page
  overfetch possible.
- Per-video details are fetched only for IDs not already in the details cache.
  Existing detail records are not routinely refreshed for removals or availability.
- The catalogue builder deduplicates video IDs, parses channel-specific titles,
  merges spelling variants, groups series/seasons, and excludes videos shorter
  than the configured seven-minute default.

The local Dahsha server starts a refresh immediately, then refreshes every
15 minutes and polls channel RSS every three minutes by default. Overlapping
refresh calls are skipped. The hosted static workflow runs every six hours.
RSS polling accelerates YouTube discovery; it does not discover Myflixer changes.
Static export by itself reads Dahsha's current cache, without scanning sources.

TMDB, TVmaze, Wikipedia and Wikidata are enrichment sources for metadata, artwork,
services or franchises. They are not currently additional playback catalogues.

## The alternative Flixer client also scrapes

`client-terrarium/js/api.js` contains a second Myflixer implementation. It prefers
the Flixer API when `/api/genres` succeeds; otherwise it tries the public WordPress
API and HTML pages directly from the browser. This fallback depends on upstream
CORS and browser restrictions. Server availability is cached for the page session.

It starts background sync after 1.5 seconds, then repeats every three minutes and
on qualifying visibility changes. It checks up to six pages of 50 records per
type, stopping when no records are merged. A capped 2,500-record local delta is
persisted. This discovers recent additions/changes, not full deletion reconciliation.
Search combines local matches with live results. Details and playback also have
browser-side fallback paths. Adding a provider only on the server will not
automatically extend those paths.

## Small live probe results

The probes fetched one item per list, one series page, and one movie's player
chain. No full refresh or video-segment download was performed.

| Probe | Observed result |
|---|---|
| All-genre movie list | Reported 43,666 movies; sample `mf:m:vigilante`, Action |
| All-genre series list | Reported 7,229 series; sample `mf:s:the-trap`, Drama/Mystery |
| Documentary movie list | Reported 4,747 movies; sample `mf:m:who-is-martin-mull`, Comedy/Documentary |
| Sample series episodes | Six episode records parsed |
| Sample movie resolution | Four HLS options plus Player 2–7 iframe options |

With `per_page=1`, reported page totals equal record totals; they are not the page
counts for a full 100-item scan. These observations do not verify every title,
every player, actual video playback, or browser CORS compatibility. Cached local
catalogue counts can differ from current upstream counts.

## Extension design: recommendation, not implemented yet

Keep catalogue membership separate from provider implementation. Each provider
should implement a small shared contract:

```text
list({ kind, cursor, updatedSince }) -> items, nextCursor, scanComplete
details(providerId)                 -> title metadata and classification evidence
episodes(providerId)                -> normalized seasons and episodes
resolve(providerEpisodeId)          -> fresh playback options
```

Use `kind: film | series` consistently for both apps. Store documentary status
separately with its provider evidence. Dahsha accepts positively classified
documentaries; ambiguous entries stay out pending curation. Flixer accepts both
kinds across genres. Apply this policy during import and again during playback
authorization. A History/Biography tag alone should not imply Documentary.

Give each provider a namespace and retain its original ID, URL, timestamps, raw
genre IDs, and provenance. Keep a canonical title/episode ID independent of the
provider, with multiple provider offerings attached. Prefer validated external
IDs for cross-provider matching; otherwise use conservative title/year/kind
matching with review for ambiguity. Preserve season/episode identity and existing
watch-history IDs when adding alternative playback sources.

Introduce a provider registry for discovery and playback dispatch. Today
`validMediaId()`, the resolver, scheduler source branches, both frontends, and
fallback URLs explicitly assume Myflixer or YouTube. New ID prefixes will require
those assumptions to be replaced, not just another fetch function.

Give each adapter bounded concurrency, pagination completeness, retry/backoff,
rate limits, checkpoints, and explicit outcomes for unavailable, failed,
unclassified, and successfully empty results. Reconcile deletions only after
complete successful scans. Keep dynamic tokens, cookies and allowed upstream
headers in server-controlled playback state, outside the static catalogue.

Before adding providers, consolidate the browser fallback or make it delegate
through the same registry, and replace fabricated durations with unknown values
or measured metadata. Test product isolation, classification rejection, duplicate
matching, incomplete scans, parser changes and fallback between providers.
