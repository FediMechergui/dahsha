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

What the Myflixer job stores (`refreshMyflixer` in `server/src/scheduler.js`):

- Display-ready rows: titles through `cleanTitle`, synopses through
  `cleanSynopsis`, and episode titles without the leading `Season N Episode N` /
  `SxEy` (an episode with nothing left is `Episode N`). Rows written by older code
  are brought to this form once, without a fetch (the playlist record then carries
  `form`). Each episode row carries `seriesId` (`mf:s:<slug>`).
- Dates are UTC. WordPress dates have no offset and are site-local time
  (`+03:00`, no daylight saving); `siteDate` in `documentaries.js` converts them,
  and the catalogue builder reads older offset-less dates the same way.
- Myflixer gives no runtime and no view count: durations are `0` (unknown, never
  a minimum-length clip) and views `null`. The 90/50-minute placeholders and the
  invented view counts of older caches count as unknown too.
- A series whose episodes come back empty keeps its cached episode rows and
  details (matched by `seriesId`, or by poster for rows stored before it); more
  than 10% of the listed series failing is reported as a warning (a `::warning`
  annotation in Actions). Series and films the listing no longer names are
  removed. A listing that leaves out more than 10% of the cached series or of the
  cached films is refused: the cached playlist stays, a `::warning` annotation
  says so, and the record counts `dropRefusals` since `dropSince`. Once the drop
  has been refused twice in a row over at least 10 hours, the next fetch that
  still shows it accepts it as removals; `cli.js rebuild` (a full refresh)
  accepts it at once.
- `addedAt` (contract 4): an episode's first-seen date, set only when it is later
  than the earliest first-seen episode of its series, so importing a whole series
  (or the whole catalogue) is not news. The catalogue dates a Myflixer show by the
  later of `publishedAt` and `addedAt`.
- One summary line per run: `[myflixer] <source>: F films, S series, W series with
  episodes, N episodes; series without episodes: X failed with a cache (Y cached
  episodes kept), Z failed without a cache`, plus up to 10 notes naming failed
  series.

Topic tags: Myflixer genre slugs go through `genreTopicTags` in
`server/src/tagger.js`, the same map FMovies/HDToday rows use; unknown slugs are
dropped.

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
- A playlist fetch never empties or badly shrinks a cached playlist
  (`judgePlaylist`): an empty result, or one below 70% of the cached list that the
  count badge does not explain, keeps the cached videos and backs off (12 h, 24 h,
  48 h, 96 h, then 7 days; a new listing signature ends the backoff). A playlist
  cached empty while its badge counts videos is fetched again. A playlist missing
  from a complete channel listing is probed by id and deleted only when YouTube
  says it is gone, or after 30 days without a listing or an answer.
  A stored fetch keeps the cached rows it did not return, in their place
  (`mergePlaylistRows`): they are dropped only when the fetch returned at least
  the playlist's own count, or when details mark the video unavailable or
  private. Each such playlist gets one log note, and the `[catalogue] playlists:`
  line counts the rows kept and dropped.
- `maxUploads` only limits how deep the uploads tab is listed: past the cap only
  short, unknown-length, unavailable, private or non-embeddable rows are trimmed.
  Uploads lists read with the Arabic client (records without `listedLang`) are
  relisted once in the source's language.
- `server/data/playlist-seeds.json` (committed) restores playlists and uploads
  that CI runs cannot list (most Asharq playlists). `applySeeds` adds a missing
  seeded playlist as a placeholder, its rows rebuilt from cached details, at the
  start of every refresh. Regenerate it only from a machine that can see those
  channels. Seeded uploads that the uploads merge would trim again (unavailable,
  private, not embeddable or shorter than `minEpisodeSeconds`) are not seeded.
  An unlisted seeded playlist that YouTube says is gone keeps its rows
  (`goneSince`) and is asked again a day later at the earliest; a second "gone"
  answer from then on empties it. The empty placeholder stays, so the seed does
  not bring it back (delete the record from `playlists.json` to seed it again).
  Both steps are reported as a `::warning` annotation in Actions.
- Per-source title filters (`server/src/source-filters.js`), for channels that
  mix documentaries with other programmes. `playlistsInclude` /
  `playlistsExclude` are patterns for playlist titles: a playlist is used when it
  matches one include pattern (when there are any) and no exclude pattern; a
  rejected playlist is not fetched, a cached one is left out of the catalogue
  and the refresh drops its record (it is fetched again when the filter takes
  it back; seeded records stay). `uploadsInclude` / `uploadsExclude` do the same for upload titles
  (uploads tab and RSS feed): a rejected row stays in the stored uploads list, so
  a changed filter needs no relist, but it gets no details request and never
  becomes an episode. Patterns are case-insensitive Unicode regular expressions
  written as JSON strings, so a regex backslash is doubled
  (`"^الدحيح\\s*-\\s*الموسم"`); a pattern that does not compile is reported and
  ignored, and an include list that matches none of a channel's listed
  playlists is reported as a `::warning`. `playlistSeasons`
  (`{ "<playlist id>": <season> }`) gives the season of a playlist's episodes
  whose titles carry none. Whatever the patterns say, a channel playlist whose
  title marks YouTube Shorts (`shorts` or `#shorts` as a word, `#short`,
  `شورتس`, or `Short` as a whole ` | ` segment as in `Short | روح`;
  `isShortsPlaylist`) is never fetched, for any channel. A cached record of one
  is dropped the same way. "Short Film Showcase",
  "The Short List" and "Documentary Shorts" (short films) are documentaries and
  stay.
- `showGroup` names a programme several channels carry (الدحيح on AJ+ كبريت,
  New Media Academy Life and Museum of The Future). Their same-named shows are
  always one show (copies of an episode still become offerings), presented by
  the first of them in `sources.json`, which also keeps the show's id: id
  assignment counts the group's videos as one unit, so a new upload or a
  bigger listing on another channel never moves the show, its id or its
  episode count. Every episode keeps its own `channelId`. A channel that
  numbers no season of its own gets era groups in a show the others give
  seasons: `seasonLabel` "<channel short> <first year>–<last year>" ("AJ+
  كبريت 2017–2020"), split where three years or more pass between two
  episodes, placed in date order among the numbered seasons. The lean export
  keeps `seasonLabel` and `channelId`. `stats.bySource` and the regression
  check count a show for the channel that presents it and every episode for
  the channel that uploaded it (its `channelId`, else the show's channel), so
  New Media Academy Life is guarded on its 300-odd episodes of الدحيح, not on
  the two small shows of its own, Museum of The Future on its season, and a
  source whose episodes all sit in another source's show is not reported as
  empty.
- Profile `ar-show` (`parseArShow`): a title names its programme on one side,
  "Show | Episode", "Show - Episode" or "Episode | Show". The show is the side
  the playlist names, else a name that recurs (at least 3 times) across the
  channel's wanted titles (`arShowNames`, passed as `ctx.showNames`), else
  the side that reads like a name; a channel brand never is. A year or
  "الموسم X" after the name is the season, and a playlist such as "الدحيح -
  الموسم الثامن - الحلقات الكاملة" gives show الدحيح, season 8; a four-digit
  year after "الموسم" ("الموسم 2026") is the season's year and gives no season
  number. A bare episode or season marker ("الحلقة (49)") never names a show,
  a known name before the dash of a segment ("الجهبذ - عقدة النقص | الحلقة
  12") does, and in a playlist whose title reads like a name a title naming
  none of the channel's programmes is that show's episode. The show title
  follows the video titles ("المُخبر الاقتصادي+", not the playlist's "+
  المُخبر الاقتصادي"). An episode titled with emoji only keeps it.
- Profile `ar-films` (`parseArFilms`): labels such as "فيلم وثائقي عن السفر
  بدقة 4K", "4K", "فيلم وثائقي كامل" or "وثائقي مدبلج" and the channel's brands
  are removed, as separate segments, dash segments or glued to the title;
  descriptive subtitles stay. A playlist is a collection of films unless
  `arFilmsPlaylistIsSeries` holds (a "سلسلة …" title, or at least half of its
  videos numbered episodes of it or starting with its name);
  `playlistsGeneric: true` keeps every playlist a collection. Series also come
  from `#سلسلة_X (N)` hashtags and numbered titles ("ملوك اليمن القديم(16)",
  "تاريخ الأمازيغ (جزء 2)"). Films of an hour or more that name the same
  subject before their first separator and whose lengths are within 3% are one
  card, the other uploads its offerings (`mergeReuploadedFilms`; the card is
  the upload the previous catalogue listed, else the first posted). World
  Odyssey (`UCUETY-zVLykpUQlVweNaLsg`), added with these channels on
  2026-10-19, was dropped from `sources.json` the next day: it disables
  embedding on every one of its 85 uploads, so none can play in Dahsha, the
  channel built no show and every run warned about it.
- Per-video details (`refreshDetails` / `planDetails`): new IDs first, at most
  `DETAILS_NEW_PER_RUN` (default 4000) per run, long rows first and the newest
  first among them; the rest wait for the next refreshes, so a channel added
  with thousands of uploads is fetched over several runs. Rows of Shorts lists
  and rows the source's title filters reject get no details request, in the
  refresh or the hourly poll. Then up to
  `DETAILS_STUB_RETRY_PER_RUN` (default 300) stored stubs (no duration, or no title
  and no duration), at most once an hour each, then a rolling re-check of
  `DETAILS_RECHECK_PER_RUN` (default 300) listed videos: unconfirmed removal
  reports first, then weak records (daily), then the rest once they are
  `DETAILS_RECHECK_MIN_DAYS` (default 7) old. `0` turns a pass off.
- Availability flags (contract 1): `details[id].unavailable === true` only after
  two consecutive "removed or private" answers at least an hour apart, never for
  network errors, bot checks, rate limits or country blocks; `embeddable === false`
  when `/player` (or oEmbed, HTTP 401) says embedding is off. If more than
  max(10, 20%) of a pass's answers say "gone" (or newly "not embeddable"), none
  of them is recorded, since that looks like YouTube blocking the runner. A video
  that plays again loses the flags. The catalogue skips both kinds of video.
- The catalogue builder deduplicates video IDs, parses channel-specific titles,
  merges spelling variants, groups series/seasons, and excludes videos shorter
  than the configured seven-minute default.

The local Dahsha server starts a refresh immediately, then refreshes every
15 minutes and polls channel RSS every three minutes by default. Overlapping
refresh calls are skipped. The hosted static workflow runs every six hours.
RSS polling accelerates YouTube discovery; it does not discover Myflixer changes.
Static export by itself reads Dahsha's current cache, without scanning sources.

## Metadata enrichment

TMDB, TVmaze, Wikidata and Wikipedia add posters, synopses and network names.
None of them is a playback catalogue. Two modules call them:

- `server/src/artwork.js` looks up posters and synopses by title, or by a
  provider's own TMDB id. The order is TMDB (only when `TMDB_API_KEY` is set),
  TVmaze (English-titled series), Wikidata (an Arabic dub title to the English
  programme, then TVmaze) and Wikipedia (ar/en/fr page image and extract). Only
  `exact` matches reach the catalogue; looser ones are cached as `fuzzy` and never
  shown. Results are cached per show id in `server/data/artwork.json`, which the
  data snapshot carries.
- Artwork lookups run in the scheduler's refresh (`cli.js refresh` or `rebuild`,
  so in `refresh.yml` only; the hourly poll makes none). `refresh.yml` allows
  `ARTWORK_MAX_PER_RUN=1500` lookups per run (default 600) and artwork.js stops
  after `ARTWORK_MAX_MINUTES` (default 30). The queue takes matches shown under
  older rules first, then never-checked titles, then the rest; within each tier
  YouTube shows come before Myflixer shows, then FMovies/HDToday rows, newest
  first. FMovies/HDToday rows only take an English synopsis and a missing portrait
  from it (`applyCachedArtwork` in `mergeCachedProviders`); their own covers are
  never replaced. Matches are checked again after 90 days, lookups without a
  match after 7, 30, then 90 days, each with a per-show delay of up to half as
  long again, so one batch does not come back as one wave.
  A cached match that a later lookup no longer finds is kept as `fuzzy` (not
  shown) rather than emptied, so a rules change that re-checks every match
  cannot shrink the matched count `scripts/snapshot.js` guards. Before the lookups,
  artwork.json is pruned to live show ids, the ids of uncertain versions inside
  cards, and catalogue id aliases (a matched entry under an old id moves to the
  renamed show).
- The repository has no `TMDB_API_KEY` secret at the moment. Each `refresh.yml`
  run then shows a "TMDB enrichment disabled" warning annotation, and artwork
  comes from TVmaze, Wikidata and Wikipedia only: no TMDB backdrops, posters or
  overviews. Entries looked up without TMDB are queued again once the secret
  exists (a v3 key or a v4 read token).
- `server/src/service-metadata.js` looks up the TVmaze network or streaming
  service of series (`tvm`), at most 100 per run (`--services`), only in the
  provider step of `refresh.yml` (`scripts/refresh-providers.js`). Hits and misses
  are cached per show id in `server/data/service-metadata-dahsha.json` (also in
  the snapshot) and looked up again after 30 days or when the title changes.
  `mergeCachedProviders` applies the cache on every rebuild and export, so the
  hourly poll deploys keep `tvm`. The show page displays the network
  (`networkInfo` in `client/src/lib/text.js`).
- `server/src/tagger.js` classifies titles locally and makes no external call.

`enrich-tvmaze.js`, `build-universes.js`, `build-services.js` and
`export-index.js` in `server/src` write Flixer's franchise and service data
(`client/public/data-flixer`). Dahsha's pipeline does not run them.

## Hosted refresh and its safeguards

`.github/workflows/refresh.yml` runs every six hours: restore the data snapshot,
`cli.js refresh` (YouTube, Myflixer, artwork), `export.js`, the FMovies/HDToday
provider step (`scripts/refresh-providers.js`), the regression check, the Vercel
deploy, then the snapshot save. `poll.yml` adds new YouTube uploads hourly in
between, with the same restore, check and save around it.

- The provider step is best effort (`continue-on-error`) and has a 30-minute
  timeout. The caches it writes (`providers-dahsha.json`,
  `provider-aliases/identities/matches-dahsha.json`,
  `service-metadata-dahsha.json` and `catalog.json`) are copied to
  `$RUNNER_TEMP` before it runs. If it fails or times out they are put back, along
  with the previous export if it was interrupted mid-swap. The YouTube update then
  deploys without that run's provider changes, and a final step fails the run so
  GitHub emails the failure. Provider HTTP errors such as the recurring
  `HDToday HTTP 403` are handled inside the scan and do not fail the step.
- `scripts/check-regression.js` must pass before the deploy and the snapshot
  save. It compares the fresh export with the live deploy (or the stored
  baseline) and with the counts recorded right after the restore. A run fails
  when total or YouTube shows/episodes drop by more than 5%, or when a
  `sources.json` source with at least 20 episodes loses more than 25% of them.
  It also fails when total or YouTube shows/episodes sit more than 10% below
  their peak of the last seven days, or a source's episodes more than 25% below
  theirs. The peak history is kept in `deploy-baseline.json`, which the
  snapshot carries, so an erosion of 1% per run is still caught after about
  eleven runs. Per-source show counts are reported only, because titles merge or
  split when the grouping rules change. The check also warns about `sources.json`
  channels with no show, and prints the documentary/uncertain classification
  counts.
- The `force` input of the two workflows overrides the regression check only (it
  also restarts the peak history). The snapshot's own cache checks
  (`scripts/snapshot.js`) are skipped only by the separate
  `allow_snapshot_shrink` input.
- `keepalive.yml` re-enables the scheduled workflows and pushes to the
  `keepalive` branch once a month, so GitHub does not disable them after 60 days
  without activity. Twice a day it also fails when
  `https://dahsha.vercel.app/data/status.json` cannot be read or its
  `generatedAt` is more than 12 hours old. GitHub emails that failure, which a
  disabled or broken refresh workflow cannot do for itself.
- `test.yml` runs `npm test` on every push and pull request, including the weekly
  dependency updates that `.github/dependabot.yml` opens for `/server`, `/client`
  and the workflow actions.

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
