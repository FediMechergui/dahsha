import { safeRemoteFetch } from './stream-security.js';
import { text } from './fmovies.js';
import { HDTODAY_PLAYER_ROUTES, isHdtodayPlayerRoute } from '../../shared/hdtoday-player-routes.js';

export const HDTODAY_BASE = 'https://hdtoday.sx';
const slugPattern = /^(movie|tv)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function parseHdtodayId(id) {
  const m = /^hd:([ms]):([a-z0-9]+(?:-[a-z0-9]+)*)(?::(\d+):([1-9]\d*))?$/.exec(String(id));
  if (!m || !slugPattern.test(m[2]) || (m[1] === 'm') !== m[2].startsWith('movie-')) return null;
  if(m[3]!=null&&(m[1]==='m'||!Number.isSafeInteger(Number(m[3]))||!Number.isSafeInteger(Number(m[4]))))return null;
  return {id,kind:m[1] === 'm' ? 'film':'series',slug:m[2],season:m[3] == null ? null:Number(m[3]),number:m[4] == null ? null:Number(m[4])};
}
const tag = label => ({'Science Fiction':'sci-fi','Sci-Fi & Fantasy':'sci-fi','Action & Adventure':'action','War & Politics':'war'}[label] || label.toLowerCase().replace(/[^a-z0-9]+/g,'-'));
function record({slug,title,year,poster,tags=[],tmdbId,synopsis='',lang=null}) {
  const kind = slug.startsWith('movie-') ? 'film':'series';
  const id = `hd:${kind === 'film'?'m':'s'}:${slug}`;
  const sourceUrl = `${HDTODAY_BASE}/watch/${slug}`;
  const documentary = tags.includes('documentary');
  const item = {id,kind,title:title.replace(/\s+-\s+Season\s+\d+$/i,''),year:year || null,tmdbId:tmdbId || null,lang,contentLang:lang,sourceUrl,synopsis,tags,documentary,
    channelId:'hdtoday',poster:poster?{custom:poster}:null,portrait:poster || null,providerMetadata:true,episodes:[],episodeCount:0,seasons:[],altTitles:[],totalDurationSec:null,totalViews:null,
    offerings:[{provider:'hdtoday',id,slug,kind,sourceUrl,documentary}]};
  if (kind === 'film') { item.episodes=[{id,title:item.title,season:1,number:1,sourceUrl,offerings:item.offerings,thumbs:item.poster}]; item.episodeCount=1; }
  return item;
}
export function parseHdtodayList(html, {kind,documentary=false,page=1} = {}) {
  if (/<title>\s*Quick check/i.test(html) || /<title>[^<]*(?:Just a moment|Access denied)/i.test(html)) throw new Error('HDToday requires browser verification; cached data retained');
  const items = new Map();
  for (const m of html.matchAll(/<a\b([^>]*class="bf-card"[^>]*)>([\s\S]*?)<\/a>/g)) {
    const slug = /href="\/watch\/([^"?#/]+)/.exec(m[1])?.[1];
    if (!slug || !slugPattern.test(slug)) continue;
    const full = text(/title="([^"]+)"/.exec(m[1])?.[1] || /class="bf-card__name"[^>]*>([^<]+)/.exec(m[2])?.[1]);
    const year = Number(/\((\d{4})\)$/.exec(full)?.[1]) || null;
    let title = full.replace(/\s*\(\d{4}\)$/,'');
    if (/\.\.$/.test(title)) title=slug.replace(/^(movie|tv)-/,'').replace(/-[a-z0-9]{8}$/,'').replace(/-/g,' ');
    const tags = text(/class="bf-card__genre"[^>]*>([^<]*)/.exec(m[2])?.[1]).split(/,\s*/).filter(Boolean).map(tag);
    // The actual card genres must confirm documentary membership; the route alone is insufficient.
    if (documentary && !tags.includes('documentary')) continue;
    const poster = /<img[^>]*src="(https:\/\/image\.tmdb\.org\/[^" ]+)"/.exec(m[2])?.[1];
    const item=record({slug,title,year,poster,tags});
    const slot=/<b>S(\d+)\s+E(\d+)<\/b>/.exec(m[2]);
    if(item.kind==='series' && slot) {
      const season=Number(slot[1]),number=Number(slot[2]),id=`${item.id}:${season}:${number}`;
      item.episodes=[{id,title:`Episode ${number}`,season,number,sourceUrl:`${item.sourceUrl}?s=${season}&e=${number}`,offerings:[{...item.offerings[0],id,season,number}]}];
      item.episodeCount=1;item.seasons=[season];item.latestEpisode=`${season}:${number}`;
    }
    const age=/\b(\d+)\s*(h|days?|minutes?)\s+ago\b/.exec(text(m[2]));
    if(age)item.providerUpdatedAt=new Date(Date.now()-Number(age[1])*({h:3600000,day:86400000,days:86400000,minute:60000,minutes:60000}[age[2]])).toISOString();
    else if(/\byesterday\b/.test(text(m[2])))item.providerUpdatedAt=new Date(Date.now()-86400000).toISOString();
    if (!kind || item.kind===kind) items.set(item.id,item);
  }
  const links=[...html.matchAll(/<a\b([^>]*href="[^"]*[?&](?:amp;)?page=(\d+)[^"]*"[^>]*)>/g)];
  const last=links.filter(m=>/rel="last"/.test(m[1])).map(m=>Number(m[2]));
  const next=links.filter(m=>/rel="next"/.test(m[1])).map(m=>Number(m[2]));
  if (!items.size && !/class="bf-card"/.test(html) && !/no (?:movies|results|series|titles)|nothing found/i.test(text(html))) throw new Error('HDToday listing format changed');
  return {items:[...items.values()],page,totalPages:Math.max(page,...last,...next),hasNext:next.length>0};
}
let retryAt=0;
async function request(path,{timeoutMs=12000,signal}={}) {
  if(Date.now()<retryAt)throw new Error('HDToday rate limited; cached data retained until retry');
  const url=new URL(path,HDTODAY_BASE);
  if(url.origin!==HDTODAY_BASE)throw new Error('Invalid HDToday URL');
  const r=await safeRemoteFetch(url.href,{timeoutMs,signal,headers:{'User-Agent':'Mozilla/5.0','Referer':HDTODAY_BASE+'/home','Accept':'text/html,application/json;q=0.9,*/*;q=0.8'}});
  if(!r.ok){if(r.status===429)retryAt=Date.now()+Math.max(60,Number(r.headers.get('retry-after'))||60)*1000;await r.body?.cancel();throw new Error(`HDToday HTTP ${r.status}`);}
  const html=await r.text();
  if(/<title>\s*Quick check/i.test(html))throw new Error('HDToday requires browser verification; cached data retained');
  return html;
}
export async function fetchHdtodayPage({kind='film',documentary=false,page=1,latest=false,genre}={}) {
  if(genre && !/^[a-z-]+$/.test(genre))throw new Error('Invalid HDToday genre');
  const slug=genre==='sci-fi'?(kind==='film'?'science-fiction':'sci-fi-fantasy'):genre;
  const route=latest&&kind==='series'?'/new-episodes':documentary?'/genre/documentary':slug?`/genre/${slug}`:kind==='film'?'/movie':'/tv';
  return parseHdtodayList(await request(`${route}?page=${page}`),{kind:documentary?undefined:kind,documentary,page});
}
const attribute=(html,name)=>new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`,'i').exec(html)?.[2];
export function hdtodayTitleContinuation(html,source) {
  // One ordinary, visible Continue link advertised by the title page. This is
  // not a browser verification step and does not execute any remote script.
  if(html.length>12000||/captcha|challenge|just a moment|quick check|access denied/i.test(html))return null;
  try{
    const origin=new URL(source);
    if(origin.origin!==HDTODAY_BASE||origin.username||origin.password||!/^\/watch\/(?:movie|tv)-[a-z0-9-]+$/.test(origin.pathname))return null;
    const refresh=[...html.matchAll(/<meta\b[^>]*>/gi)].find(match=>attribute(match[0],'http-equiv')?.toLowerCase()==='refresh');
    const target=/^\s*\d+\s*;\s*url=(.+)$/i.exec(attribute(refresh?.[0]||'','content')||'')?.[1];
    if(!target)return null;
    const next=new URL(text(target),origin);
    if(next.origin!==origin.origin||next.pathname!==origin.pathname||next.username||next.password||next.hash||next.searchParams.get('dv1')!=='1'||origin.searchParams.has('dv1'))return null;
    for(const [key,value]of next.searchParams)if(key!=='dv1'&&origin.searchParams.get(key)!==value)return null;
    for(const [key,value]of origin.searchParams)if(next.searchParams.get(key)!==value)return null;
    const visible=[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].some(match=>/\bcontinue\b/i.test(text(match[2]))&&new URL(text(attribute(match[1],'href')||''),origin).href===next.href);
    return visible?next.href:null;
  }catch{return null;}
}
export async function fetchHdtodayTitleHtml(source,{signal,fetchPage=request}={}) {
  signal?.throwIfAborted();
  const html=await fetchPage(source,{signal}),continuation=hdtodayTitleContinuation(html,source);
  if(!continuation)return html;
  signal?.throwIfAborted();
  return fetchPage(continuation,{signal});
}
export function parseHdtodayDetails(html, sourceUrl) {
  const url=new URL(sourceUrl,HDTODAY_BASE),slug=/^\/watch\/([^/]+)$/.exec(url.pathname)?.[1];
  if(url.origin!==HDTODAY_BASE||!slugPattern.test(slug || ''))throw new Error('Invalid HDToday title');
  let data;
  for(const m of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)){
    try{const d=JSON.parse(m[1]);data=(d['@graph']||[d]).find(n=>['Movie','TVSeries','TVEpisode'].includes(n['@type']));if(data)break;}catch{}
  }
  if(!data?.name)throw new Error('HDToday details unavailable or format changed');
  const tmdbId=Number(/name="tmdb_id"\s+value="(\d+)"/.exec(html)?.[1] || /id="cm-root"[^>]*data-id="(\d+)"/.exec(html)?.[1])||null;
  const item=record({slug,title:text(data.name),year:Number((data.datePublished||'').slice(0,4))||null,poster:data.image,tmdbId,tags:(data.genre||[]).map(tag),synopsis:text(data.description),lang:data.inLanguage || null});
  const duration=/^PT(?:(\d+)H)?(?:(\d+)M)?/.exec(data.duration || '');
  if(duration)item.totalDurationSec=Number(duration[1]||0)*3600+Number(duration[2]||0)*60;
  const seen=new Map(),seasonSources={};
  for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
    let link;try{link=new URL(text(attribute(m[1],'href')||''),url);}catch{continue;}
    if(link.origin!==HDTODAY_BASE||link.pathname!==url.pathname)continue;
    const seasonValue=link.searchParams.get('s')??link.searchParams.get('season'),episodeValue=link.searchParams.get('e')??link.searchParams.get('episode');
    const season=Number(seasonValue),number=Number(episodeValue),className=attribute(m[1],'class')||'';
    if(seasonValue===null||!Number.isSafeInteger(season)||season<0)continue;
    if(/\bseason-pill\b/.test(className)||/^\s*(?:Season\s*|S)\d+\s*$/i.test(text(m[2]))){seasonSources[season]=link.href;continue;}
    if(episodeValue===null||!Number.isSafeInteger(number)||number<1||!(/\b(?:ep-card|episode)\b/.test(className)||/\b(?:Episode|E)\s*\d+\b/i.test(text(m[2]))))continue;
    const id=`${item.id}:${season}:${number}`;
    const title=text(/class="ep-card__t"[^>]*>([\s\S]*?)<\//.exec(m[2])?.[1])||`Episode ${number}`;
    seen.set(id,{id,title,season,number,sourceUrl:link.href,thumbs:item.poster,offerings:[{...item.offerings[0],id,season,number}]});
  }
  if(item.kind==='series'){
    item.episodes=[...seen.values()].sort((a,b)=>a.season-b.season||a.number-b.number);
    item.episodeCount=item.episodes.length;item.seasons=[...new Set([...Object.keys(seasonSources).map(Number),...item.episodes.map(e=>e.season)])].sort((a,b)=>a-b);
    item.seasonSources=seasonSources;
    item.episodeGuideComplete=item.seasons.every(season=>item.episodes.some(episode=>episode.season===season));
  }else item.episodes[0].durationSec=item.totalDurationSec;
  return item;
}
const cache=new Map();
export async function getHdtodayDetails(source,{signal}={}) {
  signal?.throwIfAborted();
  const url=typeof source==='string'?source:source.sourceUrl;
  const entry=cache.get(url);
  if(entry && Date.now()-entry.at<5*60e3)return entry.value;
  const value=parseHdtodayDetails(await fetchHdtodayTitleHtml(url,{signal}),url);cache.set(url,{at:Date.now(),value});
  if(cache.size>300)cache.delete(cache.keys().next().value);
  return value;
}
export async function searchHdtoday(query,{documentary=false,signal}={}) {
  const rows=JSON.parse(await request(`/api/suggest?q=${encodeURIComponent(query)}`,{signal}));
  const items=[];
  for(const r of rows){
    signal?.throwIfAborted();
    if(!slugPattern.test(r.slug||''))continue;
    let item=record({slug:r.slug,title:text(r.title),year:Number(r.year)||null,poster:r.poster});
    if(documentary){try{item=await getHdtodayDetails(item,{signal});}catch{continue;}if(!item.documentary)continue;}
    items.push(item);
  }
  return items;
}
export function hdtodayServers(id) {
  const p=parseHdtodayId(id);
  if(!p||(p.kind==='series' && p.season==null))return [];
  return HDTODAY_PLAYER_ROUTES.map(({name},index)=>{
    const params=new URLSearchParams({t:p.kind==='film'?'movie':'tv',slug:p.slug,x:String(index)});
    if(p.kind==='series'){params.set('s',String(p.season));params.set('e',String(p.number));}
    return {id:`hdtoday:${index}`,name:`HDToday · ${name}`,provider:'hdtoday',type:'embed',embedUrl:`${HDTODAY_BASE}/api/go?${params}`,availability:'unverified'};
  });
}

const playerHosts = new Set(['vidsrc.mov','vidsrc.fyi','embed.vidsrc.si','vidfast.pro','vidup.to','vidrock.net','vidnest.fun','vidlink.pro','111movies.net','multiembed.mov','mappletv.uk','moviesapi.to']);
export function parseHdtodayPlayer(html) {
  if (/<title>\s*(?:Quick check|Just a moment)/i.test(html)) return null;
  const target = /<meta\b[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*?url=([^"']+)/i.exec(html)?.[1];
  if (!target) return null;
  try {
    const url = new URL(text(target));
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && (playerHosts.has(url.hostname)||isHdtodayPlayerRoute(url.href)) ? url.href : null;
  } catch { return null; }
}
const playerCache = new Map();
// Use only numeric movie identities explicitly present in a validated source's
// player list. Two different known hosts must agree; no title-based guessing.
export function agreedMovieIdentityFromPlayers(servers=[]) {
  const identities=new Set(),hosts=new Set();
  for(const server of servers){
    try{
      const url=new URL(server.rawEmbedUrl||server.embedUrl);
      if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))continue;
      const pattern=url.hostname==='balance.medmedia03.wiki'?/^\/embed\/movie\/([1-9]\d*)\/?$/
        :['moviesapi.to','vidfast.pro','vidfast.vc','vidlink.pro'].includes(url.hostname)?/^\/movie\/([1-9]\d*)\/?$/
        :url.hostname==='vidsrc.mov'?/^\/embed\/movie\/([1-9]\d*)\/?$/:null;
      const match=pattern?.exec(url.pathname),id=Number(match?.[1]);
      if(!Number.isSafeInteger(id)||id<1)continue;
      identities.add(id);hosts.add(url.hostname.replace(/^vidfast\.vc$/,'vidfast.pro'));
    }catch{}
  }
  return identities.size===1&&hosts.size>=2?[...identities][0]:null;
}
export function documentedMovieServers({tmdbId}={}) {
  if(!Number.isSafeInteger(Number(tmdbId))||Number(tmdbId)<1)return [];
  const id=Number(tmdbId);
  return [
    {id:'vidfast:movie',name:'VidFast',provider:'vidfast',embedUrl:`https://vidfast.pro/movie/${id}?autoPlay=true`},
    {id:'vidsrc:movie',name:'VidSrc',provider:'vidsrc',embedUrl:`https://vidsrc.mov/embed/movie/${id}`},
    {id:'vidlink:movie',name:'VidLink',provider:'vidlink',embedUrl:`https://vidlink.pro/movie/${id}?autoplay=true&title=true`},
  ].map(server=>({...server,type:'embed',sandbox:null,resolution:'documented-provider-route',availability:'unverified'}));
}
export function documentedTvServers({tmdbId,season,number}={}) {
  if(!Number.isSafeInteger(Number(tmdbId)) || Number(tmdbId)<1 || !Number.isInteger(season) || season<0 || !Number.isInteger(number) || number<1)return [];
  const slot=`${Number(tmdbId)}/${season}/${number}`;
  return [
    {id:'vidsrc:tv',name:'VidSrc',provider:'vidsrc',embedUrl:`https://vidsrc.mov/embed/tv/${slot}`},
    {id:'vidfast:tv',name:'VidFast',provider:'vidfast',embedUrl:`https://vidfast.pro/tv/${slot}?autoPlay=true`},
    {id:'vidlink:tv',name:'VidLink',provider:'vidlink',embedUrl:`https://vidlink.pro/tv/${slot}`},
  ].map(server=>({...server,type:'embed',sandbox:null,resolution:'documented-provider-route',availability:'unverified'}));
}
export function hdtodayTvFallbacks(id,tmdbId) {
  const parsed=parseHdtodayId(id), numericId=Number(tmdbId);
  if(!parsed || parsed.kind!=='series' || parsed.season==null || !Number.isSafeInteger(numericId) || numericId<1)return [];
  return hdtodayServers(id).map((server,index)=>({...server,
    embedUrl:HDTODAY_PLAYER_ROUTES[index].tv.replaceAll('{id}',String(numericId)).replaceAll('{season}',String(parsed.season)).replaceAll('{episode}',String(parsed.number)),
    sandbox:null,sourceUrl:server.embedUrl,resolution:'documented-provider-route',availability:'unverified'}));
}
export function hdtodayMovieFallbacks(id,tmdbId) {
  const parsed=parseHdtodayId(id), numericId=Number(tmdbId);
  if(!parsed || parsed.kind!=='film' || !Number.isSafeInteger(numericId) || numericId<1)return [];
  return hdtodayServers(id).map((server,index)=>({...server,embedUrl:HDTODAY_PLAYER_ROUTES[index].movie.replaceAll('{id}',String(numericId)),sandbox:null,sourceUrl:server.embedUrl,resolution:'documented-provider-route',availability:'unverified'}));
}
export async function resolveHdtodayServers(id,{tmdbId,signal,fetchPlayer=path=>request(path,{timeoutMs:5000,signal})}={}) {
  const fallback=[...hdtodayTvFallbacks(id,tmdbId),...hdtodayMovieFallbacks(id,tmdbId)];
  // This public TV host was observed advancing in Flixer's Android player;
  // individual titles remain unverified until their media actually starts.
  const prioritize=rows=>rows.toSorted((a,b)=>Number(b.embedUrl.startsWith('https://vidcore.io/tv/'))-Number(a.embedUrl.startsWith('https://vidcore.io/tv/')));
  if(fallback.length)return prioritize(fallback);
  const cached = playerCache.get(id);
  if (cached && Date.now()-cached.at < 10*60e3) return cached.value;
  const choices = hdtodayServers(id), resolved = [];
  let next = 0, inferred=null, denied=false;
  await Promise.all(Array.from({length:Math.min(4,choices.length)},async()=>{
    while (next < choices.length && !inferred && !denied && !signal?.aborted) {
      const index=next++, server=choices[index];
      try {
        const target=parseHdtodayPlayer(await fetchPlayer(server.embedUrl));
        if(target){
          resolved[index]={...server,embedUrl:target,sandbox:null,sourceUrl:server.embedUrl,routeResolved:true};
          const url=new URL(target), movieId=/\/(?:embed\/)?movie\/([1-9]\d*)(?:\/|$)/.exec(url.pathname)?.[1] || (url.hostname==='multiembed.mov' && url.searchParams.get('tmdb')==='1' ? url.searchParams.get('video_id'):null);
          if(movieId)inferred=hdtodayMovieFallbacks(id,Number(movieId));
          if(!inferred?.length)inferred=null;
        }
      } catch(error) {
        // A host-wide refusal applies to every wrapper. Do not try all 44
        // indices after it has already denied this environment.
        if(/HTTP (?:401|403|429)|browser verification|rate limited/i.test(error.message))denied=true;
      }
    }
  }));
  const result=prioritize(inferred || resolved.filter(Boolean));
  if(result.length)playerCache.set(id,{at:Date.now(),value:result});
  if(playerCache.size>300)playerCache.delete(playerCache.keys().next().value);
  return result;
}
