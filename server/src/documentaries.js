// Dahsha imports only category 212. Flixer keeps its independent all-genre catalogue.
import { fetchMovies, fetchSeries, fetchSeriesEpisodes } from './myflixer.js';
export const DOCUMENTARY_CAT = 212;
export const CATEGORY_TAG_MAP = {
  236: 'history',            // History
  150: 'history',            // War
  220: 'history',            // Western
  2924983: 'politics',       // War & Politics
  241303: 'politics',        // News
  160: 'crime',              // Crime
  40: 'crime',               // Mystery
  45: 'crime',               // Thriller
  237: 'crime',              // Horror
  2343589: 'people-culture', // Biography
  238: 'people-culture',     // Music
  252374: 'people-culture',  // Musical
  46: 'people-culture',      // Comedy
  56: 'people-culture',      // Drama
  99: 'people-culture',      // Family
  130: 'people-culture',     // Romance
  97: 'people-culture',      // Animation
  2347584: 'people-culture', // Reality-TV
  2613490: 'people-culture', // Short
  2652335: 'people-culture', // Game-Show
  2647311: 'people-culture', // Talk-Show
  2340416: 'survival',       // Sport
  42: 'survival',            // Adventure
  2716699: 'science-space',  // Sci-Fi
  2924281: 'science-space',  // Science Fiction
  241300: 'science-space',   // Sci-Fi & Fantasy
  48: 'science-space',       // Fantasy
  212: 'documentary',        // Documentary
};

// WordPress `date`/`modified` are the site's local time without an offset. myflixerz.day keeps a fixed
// gmt_offset of +3 (no daylight saving: its date and date_gmt differ by 3 hours, or 0, all year round).
export const SITE_UTC_OFFSET = '+03:00';

/** A Myflixer date as an ISO UTC string: an offset-less one is site-local time, one with a zone keeps it; null when unreadable. */
export function siteDate(value, offset = SITE_UTC_OFFSET) {
  if (value == null || value === '') return null;
  const s = String(value).trim().replace(' ', 'T');
  const local = /^\d{4}-\d\d-\d\d$/.test(s) ? `${s}T00:00:00` : s;
  const t = Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/i.test(local) ? local : `${local}${offset}`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Documentary films and series (with their episodes). Nothing Myflixer returns carries a runtime or a
 * view count: durationSec is 0 (unknown, contract 4) and views null. Dates are UTC (siteDate). A series
 * whose episode page fails has episodes [] (episodesError when the fetch threw); the scheduler decides
 * what that means. The fetch functions can be injected (tests).
 */
export async function fetchMyflixerCatalog(_source, { maxPages = 60, fetchMovies: movies = fetchMovies, fetchSeries: shows = fetchSeries, fetchSeriesEpisodes: episodesOf = fetchSeriesEpisodes } = {}) {
  const films = [], series = [];
  for (const [fetchPage, output] of [[movies, films], [shows, series]]) {
    let totalPages = 1;
    for (let page = 1; page <= Math.min(totalPages, maxPages); page++) {
      const result = await fetchPage({ page, perPage: 100, category: DOCUMENTARY_CAT });
      totalPages = result.totalPages;
      for (const item of result.items) {
        // Enforce the documentary boundary even if the upstream ignores its query.
        if (!item.tags.includes('documentary')) continue;
        output.push({ ...item, thumb: item.portrait, durationSec: 0, views: null,
          publishedAt: siteDate(item.publishedAt), firstAt: siteDate(item.firstAt), latestAt: siteDate(item.latestAt),
          tags: item.tags.map(t => ({ biography: 'people', 'sci-fi': 'science', war: 'history', mystery: 'crime', thriller: 'crime' }[t] || t)),
        });
      }
    }
  }
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, series.length) }, async () => {
    while (cursor < series.length) {
      const item = series[cursor++];
      try {
        const episodes = await episodesOf(item.slug);
        item.episodes = Array.isArray(episodes) ? episodes : [];
      } catch (e) {
        item.episodes = [];
        item.episodesError = e?.message || String(e);
      }
    }
  }));
  return { films, series };
}
