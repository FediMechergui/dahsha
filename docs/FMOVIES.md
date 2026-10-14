# F-Movies source investigation

Investigated 2026-10-14 using small, read-only HTTP requests and inspection of public
HTML/client scripts. No integration, full crawl, browser playback, media-segment
download, login, challenge bypass, or ad-script execution was performed.

## Findings

The source at https://www.f-movies.org has a server-rendered catalogue, one verified
JSON search endpoint, and a small static player wrapper. It does not expose the
same WordPress API used by Myflixer. Its metadata uses numeric IDs, `genre_ids`,
`media_type`, TMDB image paths and TMDB-style field names. These strongly indicate
a TMDB-backed metadata catalogue; access to its private backend or a general TMDB
proxy API has not been established.

A catalogue entry and an HD badge do not demonstrate that a provider currently has
a playable copy. Its richer metadata should be evaluated separately from playback
coverage. The sampled catalogue contains future/announced seasons and releases.
Neither the library's total unique size nor superiority to Myflixer was verified.

## Confirmed catalogue routes

All routes below are on `https://www.f-movies.org`.

| Route | Response | Purpose |
|---|---|---|
| `/` | HTML | Introductory/search landing page |
| `/home` | HTML | Featured titles and discovery rails |
| `/movies` | HTML | Movie discovery, 20 title links in the sampled page |
| `/tv-series` | HTML | TV discovery, 20 title links in the sampled page |
| `/movies?page=2` | HTML | Movie pagination, verified |
| `/movies?genre=99` | HTML | Documentary films, verified |
| `/tv-series?genre=99` | HTML | Documentary series, verified |
| `/search?q=<query>` | HTML route | Search form target advertised by the client |
| `/api/search?q=<query>&limit=5` | JSON | Live search/autocomplete, verified |
| `/api/search?q=<query>&limit=2&page=2` | JSON | Search pagination parameter, verified |
| `/movie/<slug>-<numeric-id>` | HTML | Movie details and server selectors |
| `/tv/<slug>-<numeric-id>` | HTML | TV details, season and episode selectors |
| `/tv/<slug>-<numeric-id>?season=2&episode=1` | HTML navigation | Season/episode links emitted by the TV page |
| `/watch/index.html?...` | HTML + inline JS | Provider selection and iframe construction |
| `/robots.txt` | Text | Allows crawling and identifies `/sitemap.xml` |
| `/sitemap.xml` | XML | Seven navigation URLs; not a title inventory |

The `/search` route and non-default TV selectors above were observed in public
forms/links; the API search, default TV detail page, and the explicitly marked
listing routes were directly requested.

JSON search returns `page`, `results`, `total_pages`, and `total_results`. Sample
results contain `id`, `media_type`, `title`/`name`, `overview`, `genre_ids`, release
or first-air date, `original_language`, popularity, vote average/count, image
paths, `href`, and `poster_url`. The page's autocomplete waits 180 ms, requires
at least two characters, requests five results, and aborts superseded requests.
Search output is mixed movie/TV metadata, not a list of verified video streams.

### Routes tested and NOT found

These returned HTTP 404 and must not be implemented as assumed APIs:

```text
/api/movies
/api/tv
/api/discover
/api/movie/75780
/api/tv/108978
/sitemap-index.xml
```

Only `/api/search` was positively identified as a JSON API in this investigation.
Other undocumented endpoints may exist; the observations do not establish their
absence.

## Filters, categorization and pagination

Both discovery forms accept `sort`, `year`, `genre`, `country`, and `language`.
Pagination uses `page`. A combined request below returned HTTP 200 and preserved
all five selected filter values in the rendered form:

```text
/movies?genre=99&year=2024&country=US&language=en&sort=vote_average.desc&page=2
```

Countries use codes such as `US`, `GB`, `FR`; languages use codes such as `en`,
`ar`, `fr`. The forms include individual years, an `older` option, and some decade
values. Support/semantics for every option were not individually tested.

The sampled broad movie and TV lists each advertise 500 pages. With 20 observed
cards per page, one broad browse traversal exposes at most 10,000 positions per
type if that pagination is accurate. This is not a verified total library count.
Year/genre partitions may expose more titles; overlap must be deduplicated by
numeric ID and media type. The sitemap does not solve complete discovery.

### Movie genre IDs

| ID | Genre | ID | Genre |
|---|---|---|---|
| 28 | Action | 12 | Adventure |
| 16 | Animation | 35 | Comedy |
| 80 | Crime | 99 | Documentary |
| 18 | Drama | 10751 | Family |
| 14 | Fantasy | 36 | History |
| 27 | Horror | 10402 | Music |
| 9648 | Mystery | 10749 | Romance |
| 878 | Science Fiction | 10770 | TV Movie |
| 53 | Thriller | 10752 | War |
| 37 | Western | | |

### TV genre IDs

| ID | Genre | ID | Genre |
|---|---|---|---|
| 10759 | Action & Adventure | 16 | Animation |
| 35 | Comedy | 80 | Crime |
| 99 | Documentary | 18 | Drama |
| 10751 | Family | 10762 | Kids |
| 9648 | Mystery | 10763 | News |
| 10764 | Reality | 10765 | Sci-Fi & Fantasy |
| 10766 | Soap | 10767 | Talk |
| 10768 | War & Politics | 37 | Western |

Movie sorts include popularity, primary release date, rating, vote count, revenue,
title and original title, each ascending/descending. TV sorts include popularity,
first-air date, rating, vote count, name and original name, each ascending/descending.

For our apps, map movie to `film` and TV to `series`. Dahsha should request genre
99 and verify documentary membership from detail/metadata evidence before import
and playback authorization. Flixer can import both media types across genres.
History, News, Reality and Biography-like themes alone are not Documentary.

## Playback routing: exact top-level server mapping

The movie and TV pages emit three buttons with `data-media-server` and
`data-media-src`. Clicking changes the media iframe to the selected wrapper URL.
The wrapper is the same static HTML for every title; inline JS reads its query
string and creates a provider iframe.

```text
Movie:
/watch/index.html?type=movie&id=<id>&server=<server>

TV episode:
/watch/index.html?type=tv&id=<id>&server=<server>&season=<s>&episode=<e>
```

| Server | Accepted aliases | Movie iframe template | TV iframe template |
|---|---|---|---|
| Embos | `embos`, `1`, `server1`, `s1` | `https://embos.top/movie/?mid={id}` | `https://embos.top/tv/?mid={id}&s={season}&e={episode}` |
| Vidcore | `vidcore`, `2`, `server2`, `s2` | `https://vidcore.net/movie/{id}` | `https://vidcore.net/tv/{id}/{season}/{episode}` |
| VidAPI | `vidapi`, `3`, `server3`, `s3` | `https://vidapi.xyz/embed/movie/{id}` | `https://vidapi.xyz/embed/tv/{id}/{season}/{episode}` |

The wrapper defaults to Embos, defaults missing season/episode to 1, treats only
`type=tv` as TV and otherwise chooses movie, and displays an error for unknown
server values. It URL-encodes substitutions. It has no fetch call for a stream
manifest and no title-availability check.

Examples directly observed:

```text
/watch/index.html?type=movie&id=969681&server=1
/watch/index.html?type=tv&id=108978&server=1&season=1&episode=1
```

These are embed routes, not direct HLS or MP4 addresses.

## Provider observations and media segments

Small provider probes used movie ID 75780. HTTP success refers to wrapper HTML,
not to actual video playback.

| Provider | Observation |
|---|---|
| Embos | HTTP 200; public player loads `/js/watch.js` and contains five internal server choices |
| Vidcore | Redirected from `vidcore.net` to `vidcore.io`, then returned HTTP 403 |
| VidAPI | HTTP 200; HTML exposes nested iframes, including an IMDb-ID embed and a `stream.vidapi.xyz/xps?...` wrapper |

Static decoding of Embos's public string table identified these additional
movie/TV template prefixes. The downloaded JS was not executed. These prefixes
are code observations, not individually verified playable servers:

```text
https://vidsrc.sh/embed/movie/     https://vidsrc.sh/embed/tv/
https://vidlink.pro/movie/        https://vidlink.pro/tv/
https://vidfast.vc/movie/          https://vidfast.vc/tv/
https://player.vidzee.wtf/embed/movie/
https://player.vidzee.wtf/embed/tv/
https://vidnest.fun/movie/        https://vidnest.fun/tv/
```

Embos's script also contains an explicit sandbox-rejection message. Our current
player applies sandbox restrictions, so direct Embos embedding needs compatibility
testing. Do not assume that removing restrictions is an acceptable integration
fix. Vidcore's 403 was not bypassed.

The sampled VidAPI nested wrapper returned HTML rather than a manifest. Its
`xps.js` was a small mouse/context-menu script, not a stream API. Its nested iframe
source did not establish a valid CDN media URL.

**No direct `.m3u8`, `.mpd`, `.mp4`, `.ts` or `.m4s` endpoint was verified.** The
observable chain is:

```text
F-Movies title page
  -> F-Movies /watch/index.html (server selection)
    -> external provider embed
      -> optional further provider embed
        -> media manifest / segments (not established by this investigation)
```

Segment URLs, expiry, required headers, cookies, subtitles, qualities and actual
playback success must be observed from a working provider session before promising
native HLS integration. A successful wrapper response is insufficient evidence.
The initial implementation can represent confirmed providers as embed offerings,
with playback verification state explicitly unknown.

## Recommended adapter shape

- Use stable keys such as `fmovies:movie:<id>` and `fmovies:tv:<id>`; retain original
  numeric IDs and media type. Treat TMDB identity as strongly suggested until
  validated against authoritative metadata during matching.
- Discover through HTML list/filter pages and the verified search API. Parse
  title metadata and season/episode links from detail HTML. JSON-LD is present
  and can supply some fields, but is not a complete catalogue API.
- Keep three provider offerings separate from the canonical title/episode record.
  Preserve season and episode in playback requests. Resolve embeds on demand.
- Store Documentary classification evidence independently of provider name. Genre
  99 gates Dahsha; all supported movie/TV genres can enter Flixer.
- Deduplicate discovery partitions and existing Myflixer matches conservatively.
  Preserve existing favourite/history IDs through canonical-ID mappings.
- Do not import ad overlays, ad scripts, anti-debugging code or unknown iframe
  content into our app's origin. Captured pages include unrelated ad resources.
- Distinguish metadata discovered, embed route known, playback tested, and
  unavailable. Track failures per provider without deleting catalogue metadata.

The adapters are now implemented in `server/src/fmovies.js` and `server/src/hdtoday.js`.
The shared library service merges confirmed identities and exposes uncertain matches as
independently selectable versions inside the original title page. Existing episode IDs
and their progress remain stable. Run `npm run refresh:providers` for an incremental
scan or `npm run refresh:providers:full` for a resumable historical scan. Coverage and
upstream errors are recorded in `providerSync`; a partial scan is never marked complete.

HDToday's public `/api/go` movie responses expose meta-refresh redirects. These are
resolved to allowlisted HTTPS player origins before embedding, avoiding the extra
HDToday wrapper. TV pages may still require browser verification or return 403, and
429 responses trigger backoff. Metadata and working providers are retained. A known
player URL is not proof that a video is available or that playback has been tested.

For blocked TV pages, a confirmed title/year or title/poster match can supply the
FMovies episode guide. A verified TMDB identity then enables the documented TV
embeds of [VidSrc](https://vidsrc.mov/), [VidFast](https://vidfast.vc/) and
[VidLink](https://vidlink.pro/) directly. This avoids depending on HDToday's TV
wrapper without guessing an identity or inventing episode numbers.
Unresolved HDToday wrapper routes are omitted from the playable server list.
For movies, a verified TMDB identity enables the twelve provider URL patterns
observed in HDToday's public redirects. When only the HDToday slug is known,
the resolver can obtain that identity from a validated public player redirect.
Both API and Android clients reject `/api/go` wrappers as iframe sources, so a
failed resolution cannot turn into twelve copies of the same blocked page.
Raw HTML and script snapshots are retained locally under `docs/research/fmovies/`
and excluded from version control. Do not render those snapshots as trusted pages.

## Public references

- [Movie discovery and filters](https://www.f-movies.org/movies)
- [TV discovery and filters](https://www.f-movies.org/tv-series)
- [Documentary movie discovery](https://www.f-movies.org/movies?genre=99)
- [Documentary TV discovery](https://www.f-movies.org/tv-series?genre=99)
- [Sample TV detail/season page](https://www.f-movies.org/tv/reacher-108978)
- [Public player wrapper](https://www.f-movies.org/watch/index.html)
- [JSON search example](https://www.f-movies.org/api/search?q=reacher&limit=2)
