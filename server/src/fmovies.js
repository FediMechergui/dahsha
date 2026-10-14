import { safeRemoteFetch } from './stream-security.js';

export const FMOVIES_BASE = 'https://www.f-movies.org';
export const FMOVIES_GENRES = {
  28:'action',12:'adventure',16:'animation',35:'comedy',80:'crime',99:'documentary',18:'drama',10751:'family',14:'fantasy',36:'history',27:'horror',10402:'music',9648:'mystery',10749:'romance',878:'sci-fi',10770:'tv-movie',53:'thriller',10752:'war',37:'western',10759:'action',10762:'kids',10763:'news',10764:'reality',10765:'sci-fi',10766:'soap',10767:'talk',10768:'war',
};
export function text(value = '') {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => {
    const cp = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
    return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  }).replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, n) => ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[n])).replace(/\s+/g, ' ').trim();
}
export function parseFmoviesId(id) {
  const m = /^fm:([ms]):([1-9]\d*)$/.exec(String(id));
  if (m) return { kind: m[1] === 'm' ? 'film' : 'series', tmdbId: Number(m[2]), id: m[0] };
  const e = /^fm:e:([1-9]\d*):(\d+):([1-9]\d*)$/.exec(String(id));
  return e ? { kind:'series', tmdbId:Number(e[1]), season:Number(e[2]), number:Number(e[3]), id:e[0] } : null;
}
function offering(item) {
  return { provider:'fmovies', id:item.id, tmdbId:item.tmdbId, kind:item.kind, sourceUrl:item.sourceUrl, documentary:item.documentary === true };
}
function baseItem({ id, kind, title, year, poster, tags = [], sourceUrl, synopsis = '', lang = null }) {
  const item = { id:`fm:${kind === 'film' ? 'm' : 's'}:${id}`, tmdbId:Number(id), kind, title, year:year || null, lang, contentLang:lang, synopsis,
    tags:[...new Set(tags)], documentary:tags.includes('documentary'), sourceUrl, channelId:'fmovies', poster:poster ? {custom:poster} : null, portrait:poster || null,
    publishedAt:null, latestAt:null, totalDurationSec:null, totalViews:null, episodes:[], episodeCount:0, seasons:[], altTitles:[], providerMetadata:true };
  item.offerings = [offering(item)];
  if (kind === 'film') { item.episodes = [{ id:item.id, title, number:1, season:1, sourceUrl, offerings:item.offerings, thumbs:item.poster }]; item.episodeCount = 1; }
  return item;
}
export function parseFmoviesList(html, { kind = 'film', documentary = false, genre, page = 1 } = {}) {
  if (documentary && !/<option\b[^>]*value="99"[^>]*selected/.test(html) && !/Documentary (?:Movies|TV|Series)/i.test(html)) throw new Error('FMovies documentary filter was not confirmed');
  const items = new Map();
  // Restrict discovery to poster cards, excluding navigation, related links and adverts.
  for (const m of html.matchAll(/<a\b[^>]*href="(\/(movie|tv)\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const [, href, type, card] = m;
    if (!card.includes('<article') || (kind === 'film') !== (type === 'movie')) continue;
    const id = /-(\d+)$/.exec(href)?.[1];
    const title = text(/<h3\b[^>]*>([\s\S]*?)<\/h3>/.exec(card)?.[1] || /\balt="([^"]+)"/.exec(card)?.[1]);
    if (!id || !title) continue;
    const year = Number(/<span[^>]*>\s*((?:18|19|20|21)\d{2})\s*<\/span>/.exec(card)?.[1]) || null;
    const lang = /<span[^>]*>\s*([A-Z]{2})\s*<\/span>/.exec(card)?.[1]?.toLowerCase() || null;
    const poster = /<img\b[^>]*src="(https:\/\/image\.tmdb\.org\/[^" ]+)"/.exec(card)?.[1];
    const item = baseItem({ id, kind, title, year, lang, poster, tags:documentary ? ['documentary'] : genre ? [genre] : [], sourceUrl:FMOVIES_BASE + href });
    items.set(item.id, item);
  }
  const pagination = /Page\s+(\d+)\s+of\s+(\d+)/i.exec(text(html));
  if (!pagination) throw new Error('FMovies listing format changed: pagination missing');
  if (Number(pagination[2]) > 0 && !items.size && !/no (?:movies|results|series|titles)|nothing found/i.test(text(html))) throw new Error('FMovies listing format changed: no poster records');
  return { items:[...items.values()], page:Number(pagination[1]) || page, totalPages:Number(pagination[2]) };
}
async function request(path) {
  const url = new URL(path, FMOVIES_BASE);
  if (url.origin !== FMOVIES_BASE) throw new Error('Invalid FMovies page');
  let error;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await safeRemoteFetch(url.href, { timeoutMs:7000,headers:{'User-Agent':'Mozilla/5.0', Accept:'text/html,application/json'} });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`FMovies HTTP ${response.status}`); }
      if (new URL(response.url).origin !== FMOVIES_BASE) throw new Error('Unexpected FMovies redirect');
      return await response.text();
    } catch (e) { error = e; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1))); }
  }
  throw error;
}
export async function fetchFmoviesPage({ kind = 'film', documentary = false, page = 1, year, sort = 'popularity.desc', genre, country, language } = {}) {
  const params = new URLSearchParams({ page:String(Math.max(1, Number(page) || 1)), sort });
  if (documentary) params.set('genre', '99');
  else if (genre) { const id = typeof genre === 'number' ? genre : (kind === 'series' ? {action:10759,'sci-fi':10765,war:10768}[genre] : null) || Object.entries(FMOVIES_GENRES).find(([, slug]) => slug === genre)?.[0]; if (id) params.set('genre', String(id)); }
  if (year) params.set('year', String(year));
  if (country) params.set('country', country);
  if (language) params.set('language', language);
  return parseFmoviesList(await request(`/${kind === 'film' ? 'movies' : 'tv-series'}?${params}`), { kind, documentary, page, genre:typeof genre === 'number' ? FMOVIES_GENRES[genre] : genre });
}
export function parseFmoviesDetails(html, sourceUrl) {
  const url = new URL(sourceUrl, FMOVIES_BASE);
  if (url.origin !== FMOVIES_BASE) throw new Error('Invalid title origin');
  const route = /^\/(movie|tv)\/[^/]+-(\d+)\/?$/.exec(url.pathname);
  if (!route) throw new Error('Invalid FMovies title URL');
  let data;
  for (const m of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { const json = JSON.parse(m[1]); data = (json['@graph'] || [json]).find(node => ['Movie','TVSeries'].includes(node['@type'])); if (data) break; } catch { /* try next block */ }
  }
  if (!data?.name || (route[1] === 'movie' ? data['@type'] !== 'Movie' : data['@type'] !== 'TVSeries')) throw new Error('FMovies details format changed');
  const kind = route[1] === 'movie' ? 'film' : 'series';
  const tags = (data.genre || []).map(g => ({ 'Science Fiction':'sci-fi','Sci-Fi & Fantasy':'sci-fi','Action & Adventure':'action','War & Politics':'war' }[g] || g.toLowerCase().replace(/[^a-z0-9]+/g, '-')));
  const item = baseItem({ id:route[2], kind, title:text(data.name), year:Number(String(data.dateCreated || '').slice(0, 4)) || null, poster:typeof data.image === 'string' ? data.image : data.image?.url, tags, sourceUrl:url.origin + url.pathname, synopsis:text(data.description) });
  item.imdbId = /tt\d+/.exec((data.sameAs || []).join(' '))?.[0] || null;
  item.releaseDate = data.dateCreated || null;
  const duration = /^PT(?:(\d+)H)?(?:(\d+)M)?/.exec(data.duration || '');
  if (duration) item.totalDurationSec = Number(duration[1] || 0)*3600 + Number(duration[2] || 0)*60;
  if (kind === 'film') { item.episodes[0].durationSec = item.totalDurationSec; return item; }
  const seasons = new Set();
  const episodes = new Map();
  const currentTitle = text(/Season\s+\d+\s+Episode\s+\d+:\s*([^<]+)/.exec(html)?.[1]);
  const selected = /type=tv(?:&#38;|&amp;|&)id=\d+(?:&#38;|&amp;|&)server=\d+(?:&#38;|&amp;|&)season=(\d+)(?:&#38;|&amp;|&)episode=(\d+)/.exec(html);
  for (const m of html.matchAll(/<a\b[^>]*href="\?season=(\d+)(?:&#38;|&amp;|&)episode=(\d+)"([^>]*)>([\s\S]*?)<\/a>/g)) {
    const season = Number(m[1]), number = Number(m[2]); seasons.add(season);
    // Season selector links are discovery seeds, not evidence that its first episode exists.
    if (!/^\d+$/.test(text(m[4]))) continue;
    const id = `fm:e:${item.tmdbId}:${season}:${number}`;
    episodes.set(id, { id, title:text(/\btitle="([^"]*)"/.exec(m[3])?.[1]) || (selected && Number(selected[1]) === season && Number(selected[2]) === number && currentTitle ? currentTitle : `Episode ${number}`), season, number,
      sourceUrl:`${item.sourceUrl}?season=${season}&episode=${number}`, thumbs:item.poster,
      offerings:[{ ...offering(item), id, season, number }] });
  }
  item.seasons = [...seasons].sort((a,b) => a-b);
  item.episodes = [...episodes.values()].sort((a,b) => a.season-b.season || a.number-b.number);
  item.episodeCount = item.episodes.length;
  item.advertisedEpisodeCount = Number(data.numberOfEpisodes) || null;
  return item;
}
const detailCache = new Map();
export async function getFmoviesDetails(record, { allSeasons = true, season, number } = {}) {
  const sourceUrl = typeof record === 'string' ? record : record.sourceUrl;
  if (!sourceUrl) throw new Error('Missing FMovies title URL');
  const key = `${sourceUrl}:${allSeasons}:${season ?? ''}:${number ?? ''}`;
  const cached = detailCache.get(key);
  if (cached && Date.now()-cached.at < 5*60e3) return cached.promise;
  const promise = (async () => {
    const query = season != null ? `?season=${season}&episode=${number || 1}` : '';
    const item = parseFmoviesDetails(await request(sourceUrl + query), sourceUrl);
    if (allSeasons && item.kind === 'series') {
      const collected = new Map(item.episodes.map(e => [e.id,e]));
      const pending = item.seasons.filter(s => !item.episodes.some(e => e.season === s));
      let cursor = 0;
      await Promise.all(Array.from({length:Math.min(3,pending.length)}, async () => {
        while (cursor < pending.length) {
          const s = pending[cursor++];
          try {
            const part = parseFmoviesDetails(await request(`${sourceUrl}?season=${s}&episode=1`), sourceUrl);
            for (const episode of part.episodes) collected.set(episode.id, episode);
          } catch (error) {
            (item.providerErrors ||= []).push({provider:'fmovies',season:s,error:error.message});
          }
        }
      }));
      item.episodes = [...collected.values()].sort((a,b) => a.season-b.season || a.number-b.number);
      item.episodeCount = item.episodes.length;
    }
    return item;
  })();
  detailCache.set(key,{at:Date.now(),promise});
  if (detailCache.size > 500) detailCache.delete(detailCache.keys().next().value);
  try { return await promise; } catch (e) { detailCache.delete(key); throw e; }
}
export async function searchFmovies(query, { documentary = false, page = 1, limit = 20 } = {}) {
  const json = JSON.parse(await request(`/api/search?${new URLSearchParams({q:query,page:String(page),limit:String(limit)})}`));
  return (json.results || []).filter(r => ['movie','tv'].includes(r.media_type) && (!documentary || r.genre_ids?.includes(99))).map(r => {
    const kind = r.media_type === 'movie' ? 'film' : 'series';
    const item = baseItem({ id:r.id, kind, title:text(r.title || r.name), year:Number((r.release_date || r.first_air_date || '').slice(0,4)) || null, lang:r.original_language || null,
      poster:r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null, synopsis:text(r.overview), tags:(r.genre_ids || []).map(id => FMOVIES_GENRES[id]).filter(Boolean), sourceUrl:new URL(r.href,FMOVIES_BASE).href });
    return item;
  });
}
export function fmoviesServers(id) {
  const parsed = parseFmoviesId(id);
  if (!parsed || (parsed.kind === 'series' && parsed.season == null)) return [];
  const {tmdbId,season,number,kind} = parsed;
  return [
    { id:'fmovies:embos', name:'FMovies · Embos', embedUrl:kind==='film' ? `https://embos.top/movie/?mid=${tmdbId}` : `https://embos.top/tv/?mid=${tmdbId}&s=${season}&e=${number}`, sandbox:null },
    { id:'fmovies:vidcore', name:'FMovies · Vidcore', embedUrl:kind==='film' ? `https://vidcore.net/movie/${tmdbId}` : `https://vidcore.net/tv/${tmdbId}/${season}/${number}` },
    { id:'fmovies:vidapi', name:'FMovies · VidAPI', embedUrl:kind==='film' ? `https://vidapi.xyz/embed/movie/${tmdbId}` : `https://vidapi.xyz/embed/tv/${tmdbId}/${season}/${number}` },
  ].map(s => ({...s, sandbox:null, provider:'fmovies', type:'embed', availability:'unverified'}));
}
