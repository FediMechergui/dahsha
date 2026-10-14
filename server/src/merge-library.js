export const titleKey = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const unique = values => [...new Map(values.map(v => [`${v.provider}:${v.id}`,v])).values()];
const posterKey = show => { try { return new URL(show.portrait || show.poster?.custom || '').pathname.split('/').pop(); } catch { return null; } };
const episodesOf = show => show.episodes?.length ? show.episodes : show.kind === 'film' ? [{id:show.id,title:show.title,season:1,number:1,sourceUrl:show.sourceUrl,offerings:showOfferings(show)}] : [];
export function episodeOfferings(episode) {
  const inferred = /^mf:[me]:/.test(episode.id) ? [{provider:'myflixer',id:episode.id}] : /^fm:/.test(episode.id) ? [{provider:'fmovies',id:episode.id}] : /^hd:/.test(episode.id) ? [{provider:'hdtoday',id:episode.id}] : /^[\w-]{11}$/.test(episode.id) ? [{provider:'youtube',id:episode.id}] : [];
  return unique([...inferred, ...(episode.offerings || [])]);
}
export function showOfferings(show) {
  const inferred = /^mf:[ms]:/.test(show.id) ? [{provider:'myflixer',id:show.id,sourceUrl:show.sourceUrl,kind:show.kind}] : [];
  return unique([...inferred, ...(show.offerings || [])]);
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
  return { ...incoming, ...existing, id:existing.id,
    title:existing.title || incoming.title,
    year:existing.year || incoming.year || null,
    tmdbId:existing.tmdbId || incoming.tmdbId,
    imdbId:existing.imdbId || incoming.imdbId,
    tvm:existing.tvm || incoming.tvm,
    synopsis:existing.synopsis && !existing.synopsisGenerated ? existing.synopsis : incoming.synopsis || existing.synopsis,
    synopsisGenerated:existing.synopsis && !existing.synopsisGenerated ? false : !incoming.synopsis && existing.synopsisGenerated,
    poster:existing.poster || incoming.poster, portrait:existing.portrait || incoming.portrait,
    documentary:existing.documentary === true || incoming.documentary === true,
    tags:[...new Set([...(existing.tags || []),...(incoming.tags || [])])],
    altTitles:[...new Set([...(existing.altTitles || []),...(incoming.altTitles || []),incoming.title].filter(t => t && t !== existing.title))],
    offerings:unique([...showOfferings(existing),...showOfferings(incoming)]),
    episodes, episodeCount:episodes.length,
    seasons:[...new Set(episodes.map(e => e.season).filter(Number.isInteger))].sort((a,b) => a-b),
    providerUpdatedAt:incoming.providerUpdatedAt || existing.providerUpdatedAt,
    latestEpisode:incoming.latestEpisode || existing.latestEpisode,
  };
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
  };
  shows.forEach(addIndex);
  const report = {added:0,matched:0,rejected:0,pending:[],aliases:{...aliases}};
  for (const row of incoming || []) {
    if (!['film','series'].includes(row.kind) || !row.id || !row.title || (product === 'dahsha' && row.documentary !== true)) { report.rejected++; continue; }
    const source = product === 'dahsha' ? {...row,lang:row.lang === 'ar' ? 'ar' : 'en',channelId:row.channelId || 'fmovies'} : row;
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
      const updated = mergeShow(match,source);
      Object.assign(match,updated);
      report.aliases[source.id] = match.id;
      addIndex(match); report.matched++;
    } else {
      const added = {...source,offerings:showOfferings(source),episodes:(source.episodes || []).map(e => ({...e,offerings:episodeOfferings(e)}))};
      shows.push(added); byId.set(added.id,added); addIndex(added); report.added++;
    }
  }
  const tags = new Map((base.tags || []).map(t => [t.id,{...t,count:0,countAr:0,countEn:0}]));
  for (const s of shows) for (const id of s.tags || []) {
    if (!tags.has(id)) tags.set(id,{id,label:id.replace(/-/g,' '),labelEn:id.replace(/-/g,' '),count:0,countAr:0,countEn:0});
    const tag = tags.get(id); tag.count++; tag[s.lang === 'ar' ? 'countAr' : 'countEn']++;
  }
  const channels = [...(base.channels || [])];
  if (shows.some(s => s.channelId === 'fmovies') && !channels.some(c => c.id === 'fmovies')) channels.push({id:'fmovies',title:'FMovies',short:'FMovies'});
  if (shows.some(s => s.channelId === 'hdtoday') && !channels.some(c => c.id === 'hdtoday')) channels.push({id:'hdtoday',title:'HDToday',short:'HDToday'});
  const sources=[...(base.sources || [])];
  for(const id of ['fmovies','hdtoday'])if(!sources.some(s=>s.id===id))sources.push({id,type:'provider',title:id==='fmovies'?'FMovies':'HDToday',managed:true});
  return { catalog:{...base,product,providerRegistry:1,sources,shows,channels,tags:[...tags.values()],stats:{...base.stats,shows:shows.length,series:shows.filter(s=>s.kind==='series').length,films:shows.filter(s=>s.kind==='film').length,episodes:shows.reduce((sum,s)=>sum+(s.episodeCount || s.episodes?.length || 0),0),channels:channels.length}}, report };
}
