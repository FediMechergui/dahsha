import * as text from './text.js';
import { tagShow, allTagDefs, genreTopicTags } from './tagger.js';

// Comparison key of a title: entities decoded ("&#8216;Twas" = "'Twas"), '&' read as 'and', accents and punctuation dropped.
export const titleKey = value => decodeEntities(value || '').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
/** Alternative titles minus blanks, non-strings and anything with the same titleKey as `title` or an earlier entry. */
export function uniqueTitles(values, title) {
  const seen = new Set([titleKey(title)]), out = [];
  for (const value of values || []) {
    if (typeof value !== 'string') continue;
    const key = titleKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(value);
  }
  return out;
}
const unique = values => [...new Map(values.map(v => [`${v.provider}:${v.id}`,v])).values()];
const posterKey = show => { try { return new URL(show.portrait || show.poster?.custom || '').pathname.split('/').pop(); } catch { return null; } };
const episodesOf = show => show.episodes?.length ? show.episodes : show.kind === 'film' ? [{id:show.id,title:show.title,season:1,number:1,sourceUrl:show.sourceUrl,offerings:showOfferings(show)}] : [];
// Rows crawled from FMovies/HDToday; their ids are also the ids of the shows they lead.
export const isCrawledId = id => /^(fm|hd):/.test(String(id || ''));
export const isProviderLed = show => isCrawledId(show?.id);
// A film id that appears as an episode names the same title (e.g. Myflixer films grouped into one card).
const titleLevelEpisodeId = id => /^(mf:m|fm:m|hd:m):/.test(String(id || ''));
const timeOf = value => typeof value === 'string' && value ? Date.parse(value) : NaN;
/** The newest of several ISO dates (blank or unparsable ones ignored), as an ISO string, or null. */
export function latestDate(...values) {
  const times = values.map(timeOf).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}
/**
 * Show-level recency ("updatedAt"): the newest of latestAt, the date a provider listed a new episode
 * (episodesAddedAt) and, for a title led by a crawled row, the date that row first appeared in a
 * provider's latest listings (discoveredAt; null for the initial bulk import and the historical crawl).
 * Never later than `now`, so a clock-skewed publish date cannot outrank everything else.
 */
export function showUpdatedAt(show, now = null) {
  const at = latestDate(show?.latestAt, show?.episodesAddedAt, isProviderLed(show) ? show.discoveredAt : null);
  const cap = latestDate(now);
  return at && cap && at > cap ? cap : at;
}
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
// A function declaration (hoisted), because titleKey above uses it.
export function decodeEntities(value) {
  return typeof text.decodeEntities === 'function' ? String(text.decodeEntities(String(value ?? '')) ?? '') : String(value ?? '')
    .replace(/&#(\d+);/g,(_,n) => codePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n) => codePoint(parseInt(n,16))).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,n) => ENTITIES[n]);
}
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const listOf = (value, ok) => value == null || (Array.isArray(value) && value.every(ok));
/**
 * Why a cached provider row cannot be merged safely, or null when it can. Checks the fields the merge
 * iterates or spreads: episodes/offerings (arrays of objects), altTitles/tags (arrays of strings).
 */
export function providerRowProblem(row) {
  if (!isRecord(row)) return 'not an object';
  if (typeof row.id !== 'string' || !row.id.trim() || row.id.length > 350) return 'invalid id';
  if (!['film','series'].includes(row.kind)) return 'invalid kind';
  if (typeof row.title !== 'string' || !row.title.trim()) return 'invalid title';
  if (row.synopsis != null && typeof row.synopsis !== 'string') return 'invalid synopsis';
  if (!listOf(row.altTitles, t => typeof t === 'string')) return 'invalid altTitles';
  if (!listOf(row.tags, t => typeof t === 'string')) return 'invalid tags';
  if (!listOf(row.offerings, isRecord)) return 'invalid offerings';
  if (!listOf(row.seasons, s => s == null || typeof s === 'number')) return 'invalid seasons';
  if (!listOf(row.episodes, e => isRecord(e) && (e.id == null || typeof e.id === 'string') && listOf(e.offerings, isRecord))) return 'invalid episodes';
  if (row.poster != null && !isRecord(row.poster)) return 'invalid poster';
  return null;
}
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
// Slug words written as acronyms ("bbc", "cia"). Ambiguous words ("us", "ai", "la", "eu", "isis") are left out.
const SLUG_ACRONYMS = new Set('aaa abc atp bbc cbs cgi cia cnn csi dea diy dna dvd espn fbi fifa hbo hiv imax iss itv jfk kgb kkk lapd lgbt lgbtq mlb mlk mma mtv nasa nato nba nbc ncaa ncis nfl nhl nhs nsa nyc nypd oj pbs ptsd raf sos tv uae uap uefa ufc ufo ufos uk usa usaf ussr vhs wcw wwe wwi wwii'.split(' '));
// Two or three consonants read as an acronym ("nsr", "nct", "fc", "wm"), except these words.
const NOT_ACRONYMS = new Set(['mr','mrs','ms','dr','st','jr','sr','mt','ft','pt','vs','nth','hmm','shh','brr','tsk','pst','ps','pp','cwm']);
const CONTRACTIONS = {ll:/^(?:i|you|we|they|he|she|it|that|there|who|what)$/i, re:/^(?:you|we|they|who|what|there)$/i, ve:/^(?:i|you|we|they|who|could|would|should|might|must)$/i, d:/^(?:i|you|we|they|he|she|who)$/i, m:/^i$/i};
const slugAcronym = word => SLUG_ACRONYMS.has(word) || /^[a-z]{1,2}\d{1,4}[a-z]?$/.test(word) || /^\d{1,2}[dk]$/.test(word) || (/^[b-df-hj-np-tv-xz]{2,3}$/.test(word) && !NOT_ACRONYMS.has(word));
export function slugToTitle(words) {
  const out = [];
  for (const word of String(words || '').split(' ').filter(Boolean)) {
    const last = out.length - 1;
    // "britain-s-speeders" lost its apostrophe; rebuild the common contractions.
    if (word === 's' && last >= 0) { out[last] += "'s"; continue; }
    if (word === 't' && last >= 0 && /^(?:don|can|won|isn|aren|wasn|weren|didn|doesn|hasn|haven|couldn|wouldn|shouldn|ain)$/i.test(out[last])) { out[last] += "'t"; continue; }
    // "we-ll", "you-re", "i-m": contractions, not the acronyms "LL", "RE", "M".
    if (last >= 0 && CONTRACTIONS[word]?.test(out[last])) { out[last] += `'${word}`; continue; }
    if (/^(?:ii|iii|iv|vi|vii|viii|ix|xi|xii)$/.test(word)) { out.push(word.toUpperCase()); continue; }
    if (out.length && SMALL_WORDS.has(word)) { out.push(word); continue; }
    // "bbc" -> "BBC", "mh17" -> "MH17", "3d" -> "3D", "mccartney" -> "McCartney".
    if (slugAcronym(word)) { out.push(word.toUpperCase()); continue; }
    if (/^mc[a-z]{3,}$/.test(word)) { out.push(`Mc${word.charAt(2).toUpperCase()}${word.slice(3)}`); continue; }
    out.push(word.charAt(0).toUpperCase() + word.slice(1));
  }
  return out.join(' ');
}
const LATIN = /\p{Script=Latin}/u, NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u;
// The English section prefers an English (Latin-script) title carried by the row's own metadata.
function preferEnglishTitle(row) {
  if (row.lang === 'ar' || LATIN.test(row.title)) return row;
  const english = [row.englishTitle,row.titleEn,...(row.altTitles || [])].find(t => typeof t === 'string' && LATIN.test(t) && !NON_LATIN_LETTER.test(t));
  if (!english) return row;
  const title = cleanTitle(english);
  return {...row,title,originalTitle:row.title,altTitles:uniqueTitles([row.title,...(row.altTitles || [])],title)};
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
  // A raw title that only differs in case or entities ("john simpson 60 years at the bbc") is not another name.
  const altTitles = uniqueTitles([...(row.altTitles || []).map(cleanTitle), ...(title !== raw ? [raw] : [])],title);
  const out = {...row,title,altTitles};
  if (titleSource) out.titleSource = titleSource;
  if (typeof row.synopsis === 'string') out.synopsis = decodeEntities(row.synopsis).trim();
  if (Array.isArray(row.episodes) && row.episodes.some(e => typeof e.title === 'string' && /&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i.test(e.title))) out.episodes = row.episodes.map(e => typeof e.title === 'string' ? {...e,title:cleanTitle(e.title)} : e);
  return out;
}
// Real spoken languages only; FMovies cards also carry quality labels such as "HD" or "TV".
const LANGUAGES = new Set(['ar','en','fr','de','es','it','pt','nl','sv','no','da','fi','pl','ru','uk','tr','fa','he','hi','ja','ko','zh','id','ms','th','vi','el','cs','hu','ro']);
export const contentLanguage = value => { const code = String(value || '').toLowerCase(); return LANGUAGES.has(code) ? code : null; };
const TAG_DEFS = new Map(allTagDefs().map(t => [t.id,t]));
/** Dahsha topic tags for a provider row: mapped provider genres plus the tagger's reading of its text. */
export function providerTopicTags(row) {
  // Provider genres folded into Dahsha's topic set: the tagger's map, shared with the Myflixer rows of catalog.js.
  const mapped = genreTopicTags(row.tags);
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

// An episode title that names nothing: empty (catalog.js cleanProviderEpisodeTitle), 'Episode 3' or IMDb's 'Episode #24.1'.
const placeholderTitle = t => !t || /^Episode\s*#?\d+(?:\.\d+)?$/i.test(t);
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
      if (placeholderTitle(current.title) && !placeholderTitle(candidate.title)) current.title = candidate.title;
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
  const ownSynopsis = !!existing.synopsis && !existing.synopsisGenerated;
  return { ...incoming, ...existing, id:existing.id,
    title, titleSource:replaceTitle ? incoming.titleSource : existing.titleSource,
    year:existing.year || incoming.year || null,
    tmdbId:existing.tmdbId || incoming.tmdbId,
    imdbId:existing.imdbId || incoming.imdbId,
    tvm:existing.tvm || incoming.tvm,
    synopsis:ownSynopsis ? existing.synopsis : incoming.synopsis || existing.synopsis,
    synopsisGenerated:ownSynopsis ? false : !incoming.synopsis && existing.synopsisGenerated,
    // Where the kept synopsis came from (artwork.json source), never the source of a discarded one.
    synopsisSource:ownSynopsis || !incoming.synopsis ? existing.synopsisSource : incoming.synopsisSource,
    poster:existing.poster || incoming.poster, portrait:existing.portrait || incoming.portrait,
    documentary:existing.documentary === true || incoming.documentary === true,
    tags:[...new Set([...(existing.tags || []),...(incoming.tags || [])])],
    altTitles:uniqueTitles([...(existing.altTitles || []),...(incoming.altTitles || []),incoming.title,replaceTitle ? existing.title : null].map(t => typeof t === 'string' ? cleanTitle(t) : t),title),
    offerings:unique([...showOfferings(existing),...showOfferings(incoming)]),
    // An unknown episode guide is null, not "0 episodes".
    episodes, episodeCount:episodes.length || null,
    seasons:[...new Set(episodes.map(e => e.season).filter(Number.isInteger))].sort((a,b) => a-b),
    providerUpdatedAt:incoming.providerUpdatedAt || existing.providerUpdatedAt,
    latestEpisode:incoming.latestEpisode || existing.latestEpisode,
    latestAt:[existing.latestAt,incoming.latestAt].filter(Boolean).sort().pop() || null,
    // A new provider episode is news on the very merge that sees it, also when the base is an older merge.
    ...(existing.episodesAddedAt || incoming.episodesAddedAt ? {episodesAddedAt:latestDate(existing.episodesAddedAt,incoming.episodesAddedAt)} : {}),
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
    // A provider channel is as fresh as its newest card, discoveries of crawled titles included.
    const at = showUpdatedAt(show, now);
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

/**
 * Provider aliases (row id -> show id, provider-aliases-<product>.json) follow the catalogue's renames
 * (catalog.idAliases {oldId: liveId}): a target that is no longer live is replaced by the first live id
 * its alias chain reaches (a cycle ends the search). Live targets and targets no chain leads from to a
 * live show are kept as they are. Returns a new map; malformed input gives {}.
 */
export function resolveAliasTargets(aliases, idAliases, isLive) {
  const out = isRecord(aliases) ? {...aliases} : {};
  const renames = isRecord(idAliases) ? idAliases : {};
  for (const [rowId,target] of Object.entries(out)) {
    if (typeof target !== 'string' || isLive(target) || !Object.hasOwn(renames,target)) continue;
    for (let current = target, seen = new Set([target]); Object.hasOwn(renames,current);) {
      const next = renames[current];
      if (typeof next !== 'string' || !next || seen.has(next)) break;
      if (isLive(next)) { out[rowId] = next; break; }
      seen.add(next); current = next;
    }
  }
  return out;
}

export function mergeLibrary(base, incoming, { product = 'flixer', aliases = {}, onError = null } = {}) {
  const shows = (base.shows || []).map(s => ({...s,offerings:showOfferings(s),episodes:episodesOf(s).map(e => ({...e,offerings:episodeOfferings(e)}))}));
  const byId = new Map(shows.map(s => [s.id,s]));
  // Cards holding each uncertain version, so a row is held once whatever this merge decides for it,
  // also when the base is an earlier merge that already holds its version (export.js, refresh-providers).
  const versionHolders = new Map();
  const holdVersion = (group, id) => { if (!versionHolders.has(id)) versionHolders.set(id,new Set()); versionHolders.get(id).add(group); };
  const dropVersion = id => {
    for (const group of versionHolders.get(id) || []) group.versions = (group.versions || []).filter(v => v?.id !== id);
    versionHolders.delete(id);
  };
  for (const s of shows) for (const v of s.versions || []) if (v?.id) holdVersion(s,v.id);
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
  // A confirmed alias to a show a rebuild renamed leads to the live show (saveMergeReport keeps the fix).
  const report = {added:0,matched:0,rejected:0,failed:0,pending:[],aliases:resolveAliasTargets(aliases,base.idAliases,id => byId.has(id))};
  const mergeRow = row => {
    if (!['film','series'].includes(row.kind) || !row.id || !row.title || (product === 'dahsha' && row.documentary !== true)) { report.rejected++; return; }
    const source = prepareIncoming(row, product);
    // Decided afresh on every merge: an older uncertain version of this row is dropped first and is
    // added again only on the version path, never left beside the card it becomes (or joins) now.
    dropVersion(source.id);
    let match = byId.get(source.id) || byId.get(report.aliases[source.id]) || byId.get(offerings.get(source.id))
      || byId.get(source.tmdbId && external.get(`${source.kind}:tmdb:${source.tmdbId}`))
      || byId.get(source.imdbId && external.get(`${source.kind}:imdb:${source.imdbId}`));
    const candidates = [...(index.get(`${source.kind}:${titleKey(source.title)}`) || [])].map(id => byId.get(id));
    if (!match) {
      const gap = s => s.year && source.year ? Math.abs(Number(s.year) - Number(source.year)) : null;
      const exact = candidates.filter(s => gap(s) === 0);
      if (exact.length === 1) match = exact[0];
      else if (!exact.length && posterKey(source)) {
        const samePoster = candidates.filter(s => posterKey(s) === posterKey(source) && (gap(s) == null || gap(s) <= 1));
        if (samePoster.length === 1) match = samePoster[0];
      }
      // Providers often date one title a year apart (premiere vs release). A single same-kind candidate
      // one year off is the same title grouped as an uncertain version, never a confirmed identity.
      const near = !match && !exact.length && candidates.every(s => gap(s) != null) ? candidates.filter(s => gap(s) === 1) : [];
      const nearYear = near.length === 1 ? near[0] : null;
      if (!match && (exact.length > 1 || nearYear || candidates.some(s => gap(s) == null))) {
        report.pending.push({id:source.id,title:source.title,year:source.year,candidates:(nearYear ? [nearYear] : candidates).map(s => s.id),...(nearYear ? {nearYear:true} : {})});
        // Keep uncertain editions independently playable inside one catalogue card.
        // Do not combine their episode slots or persist a confirmed identity alias.
        const group = nearYear || candidates[0];
        if (group) {
          group.versions = [...(group.versions || []), {...source, uncertainMatch:true}];
          holdVersion(group,source.id);
          return;
        }
      }
    }
    if (match) {
      // A crawled row joining a YouTube/Myflixer title contributes playback and new episodes only:
      // its discovery date is not news about that title and its genres do not override the tagger.
      const joinsOther = isCrawledId(source.id) && !isProviderLed(match);
      const updated = mergeShow(match, joinsOther ? {...source,latestAt:source.episodesAddedAt || null,discoveredAt:undefined,...(product === 'dahsha' ? {tags:[]} : {})} : source);
      Object.assign(match,updated);
      report.aliases[source.id] = match.id;
      addIndex(match); report.matched++;
    } else {
      const added = {...source,offerings:showOfferings(source),episodes:(source.episodes || []).map(e => ({...e,offerings:episodeOfferings(e)}))};
      if (added.kind === 'series' && !added.episodes.length) added.episodeCount = null;
      shows.push(added); byId.set(added.id,added); addIndex(added); report.added++;
    }
  };
  // With onError, a row that cannot be merged is skipped (and reported) instead of failing the whole merge.
  for (const row of incoming || []) {
    try { mergeRow(row); }
    catch (error) { if (!onError) throw error; report.failed++; onError(row, error); }
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
  return { catalog:{...base,product,providerRegistry:1,sources,shows,channels,tags:tagList,stats:{...base.stats,shows:shows.length,series:shows.filter(s=>s.kind==='series').length,films:shows.filter(s=>s.kind==='film').length,episodes:shows.reduce((sum,s)=>sum+(s.episodeCount || s.episodes?.length || 0),0),channels:channels.length,...mergedSourceStats(base.stats,sources,shows)}}, report };
}
/**
 * Contract 3 after the merge: stats.bySource counted again over the merged cards (every source plus
 * fmovies/hdtoday; a card for its leading channel, an episode for the channel that uploaded it, its
 * channelId in a programme group's show, else the card's channel, as buildCatalog counts them) and
 * stats.classification over the merged cards. Only for a catalogue whose stats already carry them
 * (buildCatalog's), so older catalogues and the per-group 'youtube' form are left as they are.
 */
export function mergedSourceStats(stats, sources, shows) {
  const out = {};
  const by = stats?.bySource;
  if (by && typeof by === 'object' && !Array.isArray(by) && !('youtube' in by)) {
    const counts = Object.fromEntries(sources.filter(s => s?.id).map(s => [s.id,{title:by[s.id]?.title || s.title || s.short || s.id,shows:0,episodes:0}]));
    for (const show of shows) {
      const own = counts[show.channelId || show.channel?.id];
      if (own) own.shows++;
      if (Array.isArray(show.episodes) && show.episodes.length) {
        for (const e of show.episodes) { const row = (e?.channelId && counts[e.channelId]) || own; if (row) row.episodes++; }
      } else if (own) own.episodes += Number(show.episodeCount) || 0;
    }
    out.bySource = counts;
  }
  if (stats?.classification && typeof stats.classification === 'object') out.classification = {
    documentary:shows.filter(s => s.classification?.status === 'documentary').length,
    uncertain:shows.filter(s => s.classification?.status === 'uncertain').length,
  };
  return out;
}
