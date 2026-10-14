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


export async function fetchMyflixerCatalog(_source, { maxPages = 60 } = {}) {
  const films = [], series = [];
  for (const [fetchPage, output] of [[fetchMovies, films], [fetchSeries, series]]) {
    let totalPages = 1;
    for (let page = 1; page <= Math.min(totalPages, maxPages); page++) {
      const result = await fetchPage({ page, perPage: 100, category: DOCUMENTARY_CAT });
      totalPages = result.totalPages;
      for (const item of result.items) {
        // Enforce the documentary boundary even if the upstream ignores its query.
        if (!item.tags.includes('documentary')) continue;
        output.push({ ...item, thumb: item.portrait, durationSec: 5400, views: null,
          tags: item.tags.map(t => ({ biography: 'people', 'sci-fi': 'science', war: 'history', mystery: 'crime', thriller: 'crime' }[t] || t)),
        });
      }
    }
  }
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, series.length) }, async () => {
    while (cursor < series.length) {
      const item = series[cursor++];
      item.episodes = await fetchSeriesEpisodes(item.slug);
    }
  }));
  return { films, series };
}
