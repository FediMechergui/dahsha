import * as text from './text.js';
import { tagShow, allTagDefs } from './tagger.js';

export const titleKey = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const unique = values => [...new Map(values.map(v => [`${v.provider}:${v.id}`,v])).values()];
const posterKey = show => { try { return new URL(show.portrait || show.poster?.custom || '').pathname.split('/').pop(); } catch { return null; } };
const episodesOf = show => show.episodes?.length ? show.episodes : show.kind === 'film' ? [{id:show.id,title:show.title,season:1,number:1,sourceUrl:show.sourceUrl,offerings:showOfferings(show)}] : [];
// Rows crawled from FMovies/HDToday; their ids are also the ids of the shows they lead.
export const isCrawledId = id => /^(fm|hd):/.test(String(id || ''));
export const isProviderLed = show => isCrawledId(show?.id);
// A film id that appears as an episode names the same title (e.g. Myflixer films grouped into one card).
const titleLevelEpisodeId = id => /^(mf:m|fm:m|hd:m):/.test(String(id || ''));
export function episodeOfferings(episode) {
  const inferred = /^mf:[me]:/.test(episode.id) ? [{provider:'myflixer',id:episode.id}] : /^fm:/.test(episode.id) ? [{provider:'fmovies',id:episode.id}] : /^hd:/.test(episode.id) ? [{provider:'hdtoday',id:episode.id}] : /^[\w-]{11}$/.test(episode.id) ? [{provider:'youtube',id:episode.id}] : [];
  return unique([...inferred, ...(episode.offerings || [])]);
}
export function showOfferings(show) {
  const inferred = /^mf:[ms]:/.test(show.id) ? [{provider:'myflixer',id:show.id,sourceUrl:show.sourceUrl,kind:show.kind}] : [];
  return unique([...inferred, ...(show.offerings || [])]);
}

// ---- Provider row hygiene ----------------------------------------------------------------------
const ENTITIES = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
const codePoint = n => n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
// text.js owns the shared helpers (C9); these fallbacks only cover an older text.js.
export const decodeEntities = value => typeof text.decodeEntities === 'function' ? String(text.decodeEntities(String(value ?? '')) ?? '') : String(value ?? '')
  .replace(/&#(\d+);/g,(_,n) => codePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n) => codePoint(parseInt(n,16))).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,n) => ENTITIES[n]);
export function cleanTitle(value) {
  const decoded = decodeEntities(value).replace(/\s+/g,' ').trim();
  const cleaned = typeof text.cleanTitle === 'function' ? String(text.cleanTitle(decoded) ?? '').replace(/\s+/g,' ').trim() : decoded;
  return cleaned || decoded;
}
const TRUNCATED = /\.\.+\s*(?:Season\s*\d+\s*)?$/i;
export const defectiveTitle = show => show?.titleSource === 'slug' || /\.\.+\s*Season\s*\d+\s*$/i.test(show?.title || '');
// HDToday slugs end with a 5- or 8-character hash ("tv-motorway-cops-vzbm9zej", "movie-x-b2eex").
export function hdtodaySlugWords(id) {
  const m = /^hd:[ms]:(?:movie|tv)-([a-z0-9-]+)$/.exec(String(id || ''));
  if (!m) return null;
  const parts = m[1].split('-').filter(Boolean);
  if (parts.length > 1 && /^[a-z0-9]{5,8}$/.test(parts.at(-1))) parts.pop();
  return parts.join(' ');
}
const SMALL_WORDS = new Set(['a','an','and','as','at','but','by','for','from','in','into','nor','of','on','or','the','to','vs','via','with']);
export function slugToTitle(words) {
  const out = [];
  for (const word of String(words || '').split(' ').filter(Boolean)) {
    const last = out.length - 1;
    // "britain-s-speeders" lost its apostrophe; rebuild the common contractions.
    if (word === 's' && last >= 0) { out[last] += "'s"; continue; }
    if (word === 't' && last >= 0 && /^(?:don|can|won|isn|aren|wasn|weren|didn|doesn|hasn|haven|couldn|wouldn|shouldn|ain)$/i.test(out[last])) { out[last] += "'t"; continue; }
    if (/^(?:ii|iii|iv|vi|vii|viii|ix|xi|xii)$/.test(word)) { out.push(word.toUpperCase()); continue; }
    out.push(out.length && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1));
  }
  return out.join(' ');
}
const LATIN = /\p{Script=Latin}/u, NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u;
// The English section prefers an English (Latin-script) title carried by the row's own metadata.
function preferEnglishTitle(row) {
  if (row.lang === 'ar' || LATIN.test(row.title)) return row;
  const english = [row.englishTitle,row.titleEn,...(row.altTitles || [])].find(t => typeof t === 'string' && LATIN.test(t) && !NON_LATIN_LETTER.test(t));
  if (!english) return row;
  return {...row,title:cleanTitle(english),originalTitle:row.title,altTitles:[...new Set([row.title,...(row.altTitles || [])])].filter(t => t !== english)};
}
/** Decodes entities and repairs HDToday's "..Season N" truncations and lowercase slug titles. */
export function normalizeProviderRow(row) {
  if (!row || typeof row.title !== 'string') return row;
  const raw = decodeEntities(row.title).replace(/\s+/g,' ').trim();
  let title = raw, titleSource = row.titleSource;
  const words = hdtodaySlugWords(row.id);
  if (words && /\p{L}/u.test(raw)) {
    const truncated = TRUNCATED.exec(raw);
    if (truncated) {
      const prefix = raw.slice(0,truncated.index).replace(/[\s.:,;-]+$/,'').trim();
      const fromSlug = slugToTitle(words);
      if (titleKey(prefix) && titleKey(fromSlug).startsWith(titleKey(prefix)) && titleKey(fromSlug).length > titleKey(prefix).length) { title = fromSlug; titleSource = 'slug'; }
      else if (/Season\s*\d+\s*$/i.test(raw) && prefix) title = prefix;
    } else if (raw === raw.toLowerCase() && titleKey(words) && titleKey(raw).startsWith(titleKey(words))) {
      title = slugToTitle(words); titleSource = 'slug';
    }
  }
  title = cleanTitle(title) || raw;
  const altTitles = [...new Set([...(row.altTitles || []).map(cleanTitle), ...(title !== raw ? [raw] : [])])].filter(t => t && t !== title);
  const out = {...row,title,altTitles};
  if (titleSource) out.titleSource = titleSource;
  if (typeof row.synopsis === 'string') out.synopsis = decodeEntities(row.synopsis).trim();
  if (Array.isArray(row.episodes) && row.episodes.some(e => typeof e.title === 'string' && /&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i.test(e.title))) out.episodes = row.episodes.map(e => typeof e.title === 'string' ? {...e,title:cleanTitle(e.title)} : e);
  return out;
}
// Real spoken languages only; FMovies cards also carry quality labels such as "HD" or "TV".
const LANGUAGES = new Set(['ar','en','fr','de','es','it','pt','nl','sv','no','da','fi','pl','ru','uk','tr','fa','he','hi','ja','ko','zh','id','ms','th','vi','el','cs','hu','ro']);
export const contentLanguage = value => { const code = String(value || '').toLowerCase(); return LANGUAGES.has(code) ? code : null; };
// Provider genres folded into Dahsha's topic set (see CATEGORY_TAG_MAP in documentaries.js).
const GENRE_TOPICS = {
  war:'history', history:'history', western:'history', 'war-politics':'politics', politics:'politics', news:'politics',
  crime:'crime', mystery:'crime', thriller:'crime', horror:'crime', adventure:'survival', action:'survival', sport:'survival', sports:'survival',
  'sci-fi':'science-space', 'science-fiction':'science-space', science:'science-space', fantasy:'science-space', nature:'planet',
  biography:'people-culture', music:'people-culture', musical:'people-culture', family:'people-culture', reality:'people-culture', talk:'people-culture',
  drama:'people-culture', comedy:'people-culture', romance:'people-culture', animation:'people-culture', 'tv-movie':'people-culture', kids:'people-culture', soap:'people-culture',
};
const TAG_DEFS = new Map(allTagDefs().map(t => [t.id,t]));
/** Dahsha topic tags for a provider row: mapped provider genres plus the tagger's reading of its text. */
export function providerTopicTags(row) {
  const mapped = (row.tags || []).map(t => TAG_DEFS.has(t) ? t : GENRE_TOPICS[t]).filter(Boolean);
  const tagged = tagShow({title:row.title,altTitles:row.altTitles,episodes:row.episodes,synopsis:row.synopsis,kind:row.kind,lang:row.lang === 'ar' ? 'ar' : 'en'}).tags;
  const topics = [...tagged,...mapped].filter(t => t !== 'documentary' && TAG_DEFS.has(t));
  const tags = [...new Set([...topics,...(row.tags || []).filter(t => /^lang-[a-z]{2}$/.test(t)),'documentary'])];
  return {tags,primaryTag:tags[0]};
}
function prepareIncoming(row, product) {
  const crawled = isCrawledId(row.id);
  let source = crawled ? normalizeProviderRow(row) : row;
  if (product !== 'dahsha') return source;
  source = {...source,lang:source.lang === 'ar' ? 'ar' : 'en',channelId:source.channelId || 'fmovies'};
  if (typeof source.title === 'string' && !crawled) source.title = cleanTitle(source.title) || source.title;
  source = preferEnglishTitle(source);
  if (crawled || source.contentLang !== undefined) source.contentLang = contentLanguage(source.contentLang);
  return {...source,...providerTopicTags(source)};
}

export function mergeShow(existing, incoming) {
  const episodes = episodesOf(existing).map(e => ({...e,offerings:episodeOfferings(e)}));
  const byId = new Map(episodes.map(e => [e.id,e]));
  const slots = new Map();
  for (const e of episodes) if (Number.isInteger(e.season) && Number.isInteger(e.number)) {
    const key = `${e.season}:${e.number}`;
    slots.set(key, slots.has(key) ? null : e);
  }
  for (const candidate of incoming.episodes || []) {
    const current = byId.get(candidate.id) || (existing.kind === 'film' && episodes.length === 1 ? episodes[0] : Number.isInteger(candidate.season) && Number.isInteger(candidate.number) ? slots.get(`${candidate.season}:${candidate.number}`) : null);
    if (current) {
      current.offerings = unique([...episodeOfferings(current),...episodeOfferings(candidate)]);
      if (!current.synopsis && candidate.synopsis) current.synopsis = candidate.synopsis;
      if (/^Episode \d+$/i.test(current.title || '') && candidate.title) current.title = candidate.title;
      if (!current.durationSec && candidate.durationSec) current.durationSec = candidate.durationSec;
    } else {
      const e = {...candidate,showId:existing.id,offerings:episodeOfferings(candidate)};
      episodes.push(e); byId.set(e.id,e);
      if (Number.isInteger(e.season) && Number.isInteger(e.number)) slots.set(`${e.season}:${e.number}`,e);
    }
  }
  if (existing.kind === 'series') episodes.sort((a,b) => (a.season ?? Infinity)-(b.season ?? Infinity) || (a.number ?? Infinity)-(b.number ?? Infinity));
  // A verified provider title replaces a slug-derived or truncated one, never a curated title.
  const replaceTitle = defectiveTitle(existing) && !!incoming.title && !defectiveTitle(incoming);
  const title = replaceTitle ? incoming.title : existing.title || incoming.title;
  return { ...incoming, ...existing, id:existing.id,
    title, titleSource:replaceTitle ? incoming.titleSource : existing.titleSource,
    year:existing.year || incoming.year || null,
    tmdbId:existing.tmdbId || incoming.tmdbId,
    imdbId:existing.imdbId || incoming.imdbId,
    tvm:existing.tvm || incoming.tvm,
    synopsis:existing.synopsis && !existing.synopsisGenerated ? existing.synopsis : incoming.synopsis || existing.synopsis,
    synopsisGenerated:existing.synopsis && !existing.synopsisGenerated ? false : !incoming.synopsis && existing.synopsisGenerated,
    poster:existing.poster || incoming.poster, portrait:existing.portrait || incoming.portrait,
    documentary:existing.documentary === true || incoming.documentary === true,
    tags:[...new Set([...(existing.tags || []),...(incoming.tags || [])])],
    altTitles:[...new Set([...(existing.altTitles || []),...(incoming.altTitles || []),incoming.title,replaceTitle ? existing.title : null])].filter(t => t && t !== title),
    offerings:unique([...showOfferings(existing),...showOfferings(incoming)]),
    // An unknown episode guide is null, not "0 episodes".
    episodes, episodeCount:episodes.length || null,
    seasons:[...new Set(episodes.map(e => e.season).filter(Number.isInteger))].sort((a,b) => a-b),
    providerUpdatedAt:incoming.providerUpdatedAt || existing.providerUpdatedAt,
    latestEpisode:incoming.latestEpisode || existing.latestEpisode,
    latestAt:[existing.latestAt,incoming.latestAt].filter(Boolean).sort().pop() || null,
  };
}

const PROVIDER_CHANNELS = {
  myflixer:{title:'Myflixer',name:'Myflixer',url:'https://myflixerz.day'},
  fmovies:{title:'FMovies',name:'FMovies',url:'https://www.f-movies.org'},
  hdtoday:{title:'HDToday',name:'HDToday',url:'https://hdtoday.sx'},
};
/** Complete channel records for the provider "channels" (C2), counted from the shows they lead. */
export function providerChannels(shows, channels = [], now = new Date().toISOString()) {
  const totals = new Map(Object.keys(PROVIDER_CHANNELS).map(id => [id,{shows:0,series:0,films:0,episodes:0,latestAt:null}]));
  for (const show of shows) {
    const total = totals.get(show.channelId || show.channel?.id);
    if (!total) continue;
    total.shows++; if (show.kind === 'film') total.films++; else if (show.kind === 'series') total.series++;
    total.episodes += Number(show.episodeCount) || 0;
    const at = show.latestAt ? (show.latestAt > now ? now : show.latestAt) : null;
    if (at && (!total.latestAt || at > total.latestAt)) total.latestAt = at;
  }
  const out = [...channels];
  for (const [id,total] of totals) {
    const index = out.findIndex(c => c.id === id);
    if (index < 0 && !total.shows) continue;
    const previous = index >= 0 ? out[index] : {}, meta = PROVIDER_CHANNELS[id];
    const entry = {...previous,id,title:previous.title || meta.title,short:previous.short || meta.title,name:previous.name || meta.name,lang:'en',profile:'provider',url:previous.url || meta.url,...total};
    if (previous.profile && previous.profile !== 'provider') entry.sourceProfile = previous.profile;
    if (index >= 0) out[index] = entry; else out.push(entry);
  }
  return out;
}

export function mergeLibrary(base, incoming, { product = 'flixer', aliases = {} } = {}) {
  const shows = (base.shows || []).map(s => ({...s,offerings:showOfferings(s),episodes:episodesOf(s).map(e => ({...e,offerings:episodeOfferings(e)}))}));
  const byId = new Map(shows.map(s => [s.id,s]));
  const index = new Map(), external = new Map(), offerings = new Map();
  const addIndex = s => {
    for (const t of [s.title,...(s.altTitles || [])]) {
      const key = `${s.kind}:${titleKey(t)}`;
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(s.id);
    }
    if (s.tmdbId) external.set(`${s.kind}:tmdb:${s.tmdbId}`,s.id);
    if (s.imdbId) external.set(`${s.kind}:imdb:${s.imdbId}`,s.id);
    for (const o of s.offerings || []) offerings.set(o.id,s.id);
    for (const e of s.episodes || []) if (titleLevelEpisodeId(e.id) && !offerings.has(e.id)) offerings.set(e.id,s.id);
  };
  shows.forEach(addIndex);
  const report = {added:0,matched:0,rejected:0,pending:[],aliases:{...aliases}};
  for (const row of incoming || []) {
    if (!['film','series'].includes(row.kind) || !row.id || !row.title || (product === 'dahsha' && row.documentary !== true)) { report.rejected++; continue; }
    const source = prepareIncoming(row, product);
    let match = byId.get(source.id) || byId.get(report.aliases[source.id]) || byId.get(offerings.get(source.id))
      || byId.get(source.tmdbId && external.get(`${source.kind}:tmdb:${source.tmdbId}`))
      || byId.get(source.imdbId && external.get(`${source.kind}:imdb:${source.imdbId}`));
    const candidates = [...(index.get(`${source.kind}:${titleKey(source.title)}`) || [])].map(id => byId.get(id));
    if (!match) {
      const exact = candidates.filter(s => s.year && source.year && Number(s.year) === Number(source.year));
      if (exact.length === 1) match = exact[0];
      else if (!exact.length && posterKey(source)) {
        const samePoster = candidates.filter(s => posterKey(s) === posterKey(source) && (!s.year || !source.year || Number(s.year) === Number(source.year)));
        if (samePoster.length === 1) match = samePoster[0];
      }
      if (!match && (exact.length > 1 || candidates.some(s => !s.year || !source.year))) {
        report.pending.push({id:source.id,title:source.title,year:source.year,candidates:candidates.map(s => s.id)});
        // Keep uncertain editions independently playable inside one catalogue card.
        // Do not combine their episode slots or persist a confirmed identity alias.
        const group = candidates[0];
        if (group) {
          group.versions = [...(group.versions || []).filter(v => v.id !== source.id), {...source, uncertainMatch:true}];
          continue;
        }
      }
    }
    if (match) {
      for (const group of shows) if (group.versions) group.versions=group.versions.filter(v=>v.id!==source.id);
      // A crawled row joining a YouTube/Myflixer title contributes playback and new episodes only:
      // its discovery date is not news about that title and its genres do not override the tagger.
      const joinsOther = isCrawledId(source.id) && !isProviderLed(match);
      const updated = mergeShow(match, joinsOther ? {...source,latestAt:source.episodesAddedAt || null,...(product === 'dahsha' ? {tags:[]} : {})} : source);
      Object.assign(match,updated);
      report.aliases[source.id] = match.id;
      addIndex(match); report.matched++;
    } else {
      const added = {...source,offerings:showOfferings(source),episodes:(source.episodes || []).map(e => ({...e,offerings:episodeOfferings(e)}))};
      if (added.kind === 'series' && !added.episodes.length) added.episodeCount = null;
      shows.push(added); byId.set(added.id,added); addIndex(added); report.added++;
    }
  }
  const tags = new Map((base.tags || []).map(t => [t.id,{...t,count:0,countAr:0,countEn:0}]));
  for (const s of shows) for (const id of s.tags || []) {
    if (!tags.has(id)) { const def = TAG_DEFS.get(id); tags.set(id,{id,label:def?.label || id.replace(/-/g,' '),labelEn:def?.labelEn || def?.label || id.replace(/-/g,' '),...(def?.color ? {color:def.color} : {}),count:0,countAr:0,countEn:0}); }
    const tag = tags.get(id); tag.count++; tag[s.lang === 'ar' ? 'countAr' : 'countEn']++;
  }
  const channels = providerChannels(shows, base.channels || []);
  const sources=[...(base.sources || [])];
  for(const id of ['fmovies','hdtoday'])if(!sources.some(s=>s.id===id))sources.push({id,type:'provider',title:id==='fmovies'?'FMovies':'HDToday',managed:true});
  const tagList = [...tags.values()].filter(t => product !== 'dahsha' || t.count > 0);
  return { catalog:{...base,product,providerRegistry:1,sources,shows,channels,tags:tagList,stats:{...base.stats,shows:shows.length,series:shows.filter(s=>s.kind==='series').length,films:shows.filter(s=>s.kind==='film').length,episodes:shows.reduce((sum,s)=>sum+(s.episodeCount || s.episodes?.length || 0),0),channels:channels.length}}, report };
}
