// Per-source title filters and playlist seasons from sources.json. Channels that mix documentaries
// with other programmes (AJ+ كبريت, New Media Academy Life, Museum of The Future) name what to take:
//   playlistsInclude / playlistsExclude  patterns for playlist titles: a playlist is used when it
//                                        matches one include pattern (when there are any) and no
//                                        exclude pattern. A playlist the filter rejects is not fetched,
//                                        a cached one is left out of the catalogue and the refresh
//                                        drops its record (fetched again when the filter takes it back).
//   uploadsInclude / uploadsExclude      the same for the titles of the channel's uploads (the uploads
//                                        tab and the RSS feed). A row the filter rejects stays in the
//                                        stored uploads list (so changing the filter needs no relist),
//                                        but gets no details request and never becomes an episode.
//   playlistSeasons                      { playlistId: season }: the season of a playlist's episodes
//                                        whose titles carry none.
// Patterns are case-insensitive Unicode regular expressions written as JSON strings, so a regex
// backslash is doubled: "^الدحيح\\s*-\\s*الموسم". A pattern that does not compile is reported once and
// ignored. The uploads tab, the Myflixer pseudo-playlist and playlist sources are never filtered by
// the playlist patterns.
// Whatever the patterns say, a channel playlist whose title marks YouTube Shorts ("Shorts | DW
// Documentary", "المدوان #shorts", "Short | روح"; isShortsPlaylist) is never wanted: it lists clips
// under a minute that never become episodes, and its rows would only cost details requests. The
// refresh drops a cached record of one (scheduler.js dropUnwanted), as it drops any left-out record.
// A channel with `scanUploads: false` (Museum of The Future) is taken through its playlists only
// (takesUploads): none of its uploads is wanted, so the RSS poll leaves it alone, and an uploads
// record stored for it (by a poll before this rule, or while it scanned its uploads) is left out of
// the catalogue and of the details work.
// `showGroup` names a programme several channels carry (catalog.js showGroupOf, mergeSisterShows):
// their same-named shows are one show, presented by the first of them in sources.json.

const compiled = new WeakMap();
const reported = new Set();

/** RegExps of a list of pattern strings; invalid patterns are reported once and left out. */
export function compilePatterns(list, label = 'sources.json') {
  if (!Array.isArray(list) || !list.length) return [];
  if (compiled.has(list)) return compiled.get(list);
  const out = [];
  for (const p of list) {
    if (typeof p !== 'string' || !p.trim()) continue;
    try { out.push(new RegExp(p, 'iu')); } catch (e) {
      const key = `${label}|${p}`;
      if (!reported.has(key)) { reported.add(key); console.warn(`[sources] ${label}: pattern ${JSON.stringify(p)} ignored (${e.message})`); }
    }
  }
  compiled.set(list, out);
  return out;
}

const label = (src, key) => `${src?.short || src?.title || src?.id || 'source'} ${key}`;
const texts = (title) => (Array.isArray(title) ? title : [title]).filter((t) => typeof t === 'string' && t.trim()).map((t) => t.normalize('NFC').trim());

/** Does a title (or one of several titles of one item) pass an include / exclude pair of a source? */
function passes(src, kind, title) {
  const include = compilePatterns(src?.[`${kind}Include`], label(src, `${kind}Include`));
  const exclude = compilePatterns(src?.[`${kind}Exclude`], label(src, `${kind}Exclude`));
  if (!include.length && !exclude.length) return true;
  const ts = texts(title);
  if (exclude.some((re) => ts.some((t) => re.test(t)))) return false;
  return !include.length || include.some((re) => ts.some((t) => re.test(t)));
}

export const hasPlaylistFilter = (src) => !!(src?.playlistsInclude?.length || src?.playlistsExclude?.length);
export const hasUploadFilter = (src) => !!(src?.uploadsInclude?.length || src?.uploadsExclude?.length);
/** Are a source's uploads (uploads tab and RSS feed) taken? Not for a channel with scanUploads: false. */
export const takesUploads = (src) => src?.type !== 'channel' || src.scanUploads !== false;

// "Shorts" or "#shorts" as a word, "#short", "شورتس", or "Short" as a whole " | " segment ("Short |
// روح"). "Short Film Showcase", "FRONTLINE Short Docs" and "The Short List" are documentaries, and so
// are "Documentary Shorts" and "Film Shorts": short films (FRONTLINE's "Documentary Shorts" lists films
// of 4 to 34 minutes).
const SHORTS_WORD = /(?<![\p{L}\p{N}])(?:#?shorts|#short|شورتس)(?![\p{L}\p{N}])/iu;
const SHORT_FILMS = /(?<![\p{L}\p{N}#])(?:documentar(?:y|ies)|docs?|films?)\s+shorts(?![\p{L}\p{N}])/giu;
const SHORT_SEGMENT = /^\s*short\s*$/i;
/** Does a playlist title mark a list of YouTube Shorts? */
export function isShortsPlaylist(title = '') {
  const t = String(title ?? '').normalize('NFC');
  return SHORTS_WORD.test(t.replace(SHORT_FILMS, ' ')) || t.split('|').some((p) => SHORT_SEGMENT.test(p));
}

/**
 * Is a channel playlist (a title, or a record with one) wanted: not a Shorts list (isShortsPlaylist)
 * and passing its source's playlist filter? The uploads record is wanted when the source takes its
 * uploads (takesUploads).
 */
export function playlistWanted(src, playlist) {
  if (!src || src.type !== 'channel') return true;
  const pl = typeof playlist === 'string' ? { title: playlist } : playlist || {};
  if (String(pl.id || '').startsWith('MYFLIXER:')) return true;
  if (pl.isUploads || String(pl.id || '').startsWith('UPLOADS:')) return takesUploads(src);
  if (isShortsPlaylist(pl.title)) return false;
  return passes(src, 'playlists', pl.title || '');
}

/**
 * Is an upload row wanted: its source takes its uploads (takesUploads) and the source's uploads
 * filter passes it? Its listing title and its details title both count.
 */
export function uploadWanted(src, video, details = null) {
  if (!takesUploads(src)) return false;
  if (!hasUploadFilter(src)) return true;
  return passes(src, 'uploads', [video?.title, details?.[video?.id]?.title]);
}

/** Is a row of a stored playlist record wanted: the playlist by its title, an uploads row by its own? */
export function rowWanted(src, pl, video, details = null) {
  if (!src) return true;
  if (pl?.isUploads) return uploadWanted(src, video, details);
  return playlistWanted(src, pl);
}

/** The season sources.json gives a playlist's episodes (playlistSeasons), or null. */
export function playlistSeason(src, playlistId) {
  const n = Number(src?.playlistSeasons?.[playlistId]);
  return Number.isInteger(n) && n > 0 ? n : null;
}
