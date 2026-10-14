import { safeRemoteFetch } from './stream-security.js';
import { text } from './fmovies.js';

export const HDTODAY_BASE = 'https://hdtoday.sx';
const servers = ['vidsrc.mov','vidsrc.fyi','VIP','vidfast','vidup','vidrock','vidnest','vidlink','111movies','multiembed','mappletv','moviesapi'];
const slugPattern = /^(movie|tv)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function parseHdtodayId(id) {
  const m = /^hd:([ms]):([a-z0-9]+(?:-[a-z0-9]+)*)(?::(\d+):([1-9]\d*))?$/.exec(String(id));
  if (!m || !slugPattern.test(m[2]) || (m[1] === 'm') !== m[2].startsWith('movie-')) return null;
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
async function request(path,{timeoutMs=12000}={}) {
  if(Date.now()<retryAt)throw new Error('HDToday rate limited; cached data retained until retry');
  const url=new URL(path,HDTODAY_BASE);
  if(url.origin!==HDTODAY_BASE)throw new Error('Invalid HDToday URL');
  const r=await safeRemoteFetch(url.href,{timeoutMs,headers:{'User-Agent':'Mozilla/5.0','Referer':HDTODAY_BASE+'/home','Accept':'text/html,application/json;q=0.9,*/*;q=0.8'}});
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
  const seen=new Map();
  for(const m of html.matchAll(/href="([^"<>]*(?:\?|&(?:amp;)?)(?:s|season)=\d+[^"<>]*)"/g)){
    const link=new URL(text(m[1]),url);
    if(link.origin!==HDTODAY_BASE||link.pathname!==url.pathname)continue;
    const season=Number(link.searchParams.get('s')??link.searchParams.get('season'));
    const number=Number(link.searchParams.get('e')??link.searchParams.get('episode'));
    if(!Number.isInteger(season)||!Number.isInteger(number)||number<1)continue;
    const id=`${item.id}:${season}:${number}`;
    seen.set(id,{id,title:`Episode ${number}`,season,number,sourceUrl:link.href,thumbs:item.poster,offerings:[{...item.offerings[0],id,season,number}]});
  }
  if(item.kind==='series'){
    item.episodes=[...seen.values()].sort((a,b)=>a.season-b.season||a.number-b.number);
    item.episodeCount=item.episodes.length;item.seasons=[...new Set(item.episodes.map(e=>e.season))];
  }else item.episodes[0].durationSec=item.totalDurationSec;
  return item;
}
const cache=new Map();
export async function getHdtodayDetails(source) {
  const url=typeof source==='string'?source:source.sourceUrl;
  const entry=cache.get(url);
  if(entry && Date.now()-entry.at<5*60e3)return entry.value;
  const value=parseHdtodayDetails(await request(url),url);cache.set(url,{at:Date.now(),value});
  if(cache.size>300)cache.delete(cache.keys().next().value);
  return value;
}
export async function searchHdtoday(query,{documentary=false}={}) {
  const rows=JSON.parse(await request(`/api/suggest?q=${encodeURIComponent(query)}`));
  const items=[];
  for(const r of rows){
    if(!slugPattern.test(r.slug||''))continue;
    let item=record({slug:r.slug,title:text(r.title),year:Number(r.year)||null,poster:r.poster});
    if(documentary){try{item=await getHdtodayDetails(item);}catch{continue;}if(!item.documentary)continue;}
    items.push(item);
  }
  return items;
}
export function hdtodayServers(id) {
  const p=parseHdtodayId(id);
  if(!p||(p.kind==='series' && p.season==null))return [];
  return servers.map((name,index)=>{
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
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && playerHosts.has(url.hostname) ? url.href : null;
  } catch { return null; }
}
const playerCache = new Map();
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
  const slot=`${numericId}/${parsed.season}/${parsed.number}`;
  const urls={0:`https://vidsrc.mov/embed/tv/${slot}`,3:`https://vidfast.pro/tv/${slot}?autoPlay=true`,7:`https://vidlink.pro/tv/${slot}`};
  return hdtodayServers(id).flatMap((server,index)=>urls[index] ? [{...server,embedUrl:urls[index],sandbox:null,sourceUrl:server.embedUrl,resolution:'documented-provider-route'}] : []);
}
export function hdtodayMovieFallbacks(id,tmdbId) {
  const parsed=parseHdtodayId(id), numericId=Number(tmdbId);
  if(!parsed || parsed.kind!=='film' || !Number.isSafeInteger(numericId) || numericId<1)return [];
  // Routes observed in HDToday's public movie redirect responses.
  const urls=[`https://vidsrc.mov/embed/movie/${numericId}`,`https://vidsrc.fyi/embed/movie/${numericId}`,
    `https://embed.vidsrc.si/embed/movie/${numericId}?autoplay=1&ds_lang=en`,
    `https://vidfast.pro/movie/${numericId}?autoPlay=true`,`https://vidup.to/movie/${numericId}?autoPlay=true`,
    `https://vidrock.net/movie/${numericId}`,`https://vidnest.fun/movie/${numericId}`,`https://vidlink.pro/movie/${numericId}?autoplay=true&title=true`,
    `https://111movies.net/movie/${numericId}`,`https://multiembed.mov/?video_id=${numericId}&tmdb=1`,
    `https://mappletv.uk/embed/movie/${numericId}`,`https://moviesapi.to/movie/${numericId}`];
  return hdtodayServers(id).map((server,index)=>({...server,embedUrl:urls[index],sandbox:null,sourceUrl:server.embedUrl,resolution:'verified-provider-route'}));
}
export async function resolveHdtodayServers(id,{tmdbId,fetchPlayer=path=>request(path,{timeoutMs:5000})}={}) {
  const fallback=[...hdtodayTvFallbacks(id,tmdbId),...hdtodayMovieFallbacks(id,tmdbId)];
  if(fallback.length)return fallback;
  const cached = playerCache.get(id);
  if (cached && Date.now()-cached.at < 10*60e3) return cached.value;
  const choices = hdtodayServers(id), resolved = [];
  let next = 0, inferred=null;
  await Promise.all(Array.from({length:Math.min(4,choices.length)},async()=>{
    while (next < choices.length && !inferred) {
      const index=next++, server=choices[index];
      try {
        const target=parseHdtodayPlayer(await fetchPlayer(server.embedUrl));
        if(target){
          resolved[index]={...server,embedUrl:target,sandbox:null,sourceUrl:server.embedUrl,routeResolved:true};
          const url=new URL(target), movieId=/\/(?:embed\/)?movie\/([1-9]\d*)(?:\/|$)/.exec(url.pathname)?.[1] || (url.hostname==='multiembed.mov' && url.searchParams.get('tmdb')==='1' ? url.searchParams.get('video_id'):null);
          if(movieId)inferred=hdtodayMovieFallbacks(id,Number(movieId));
          if(!inferred?.length)inferred=null;
        }
      } catch { /* Never return HDToday wrapper pages as iframe players. */ }
    }
  }));
  const result=inferred || resolved.filter(Boolean);
  if(result.length)playerCache.set(id,{at:Date.now(),value:result});
  if(playerCache.size>300)playerCache.delete(playerCache.keys().next().value);
  return result;
}
