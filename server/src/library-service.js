import { mergeCachedProviders } from './provider-sync.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT } from './product.js';
import { DATA_DIR, readJson } from './store.js';
import { mergeLibrary, mergeShow, episodeOfferings, showOfferings } from './merge-library.js';
import { getFmoviesDetails, parseFmoviesId, searchFmovies, fmoviesServers, FMOVIES_BASE, fetchFmoviesPage } from './fmovies.js';
import { documentedTvServers, getHdtodayDetails, parseHdtodayId, searchHdtoday, resolveHdtodayServers, HDTODAY_BASE, fetchHdtodayPage } from './hdtoday.js';
import { getTitleDetails, searchContent, resolveMyflixerStream } from './myflixer.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
let liveResolver, loaded, loadedStamp;
export const validPlaybackId = id => typeof id === 'string' && id.length <= 350 && (/^mf:[mse]:[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(id) || /^[\w-]{11}$/.test(id) || !!parseFmoviesId(id) || !!parseHdtodayId(id));
export function setLiveLibrary(resolver) { liveResolver=resolver; }
export function readLibrary() {
  const live=liveResolver?.();if(live)return live;
  const folder=PRODUCT==='dahsha'?'data':'data-flixer';
  const dist=PRODUCT==='dahsha'?'dist':'dist-flixer';
  const candidates=process.env.VERCEL?[path.join(root,`server/deployment-${PRODUCT}.json`)]:[
    ...(process.env.DATA_DIR?[path.join(DATA_DIR,PRODUCT==='dahsha'?'catalog.json':'flixer-catalog.json')]:[]),
    path.join(root,`client/public/${folder}/catalog.json`),path.join(root,`client/${dist}/data/catalog.json`),
  ];
  const file=candidates.find(f=>fs.existsSync(f));
  if(!file)return {product:PRODUCT,shows:[],tags:[],channels:[]};
  const providerFile=path.join(DATA_DIR,`providers-${PRODUCT}.json`);
  const stamp=`${file}:${fs.statSync(file).mtimeMs}:${!process.env.VERCEL && fs.existsSync(providerFile)?fs.statSync(providerFile).mtimeMs:''}`;
  if(stamp!==loadedStamp){loaded=JSON.parse(fs.readFileSync(file,'utf8'));if(!process.env.VERCEL)loaded=mergeCachedProviders(loaded,PRODUCT).catalog;loadedStamp=stamp;}
  return loaded;
}
function locate(catalog,id) {
  for (const show of catalog.shows || []) {
    if (show.id===id || show.offerings?.some(o=>o.id===id)) return show;
    const version=show.versions?.find(v=>v.id===id || v.offerings?.some(o=>o.id===id));
    if (version) return version;
  }
  return null;
}
function trustedSource(id,source) {
  if(typeof source!=='string')return null;
  try{
    const url=new URL(source);
    const fm=parseFmoviesId(id),hd=parseHdtodayId(id);
    if(fm && url.origin===FMOVIES_BASE && new RegExp(`^/${fm.kind==='film'?'movie':'tv'}/[a-z0-9-]+-${fm.tmdbId}/?$`,'i').test(url.pathname))return url.origin+url.pathname;
    if(hd && url.origin===HDTODAY_BASE && url.pathname===`/watch/${hd.slug}`)return url.origin+url.pathname;
  }catch{}
  return null;
}
const hydrated=new Map();
export async function unifiedTitle(id,{source, catalog=readLibrary(), product=PRODUCT}={}) {
  if(typeof id!=='string'||id.length>350)return null;
  if(catalog.product && catalog.product!==product)return null;
  const sourceList=[...new Set((Array.isArray(source)?source:[source]).filter(s=>typeof s==='string' && s.length<1500))].slice(0,4);
  const base=locate(catalog,id);
  if(product==='dahsha' && !base && /^mf:/.test(id))return null;
  if(!base && !/^mf:[ms]:[a-z0-9-]+$/i.test(id) && !parseFmoviesId(id) && !parseHdtodayId(id))return null;
  const key=`${product}:${catalog.generatedAt || ''}:${id}:${JSON.stringify(sourceList)}`;
  const entry=hydrated.get(key);
  if(entry && Date.now()-entry.at<3*60e3)return entry.promise;
  const promise=(async()=>{
    let result=base?{...base,synopsis:base.synopsis||base.blurb||'',episodes:base.episodes||[],offerings:showOfferings(base)}:null;
    if(/^mf:[ms]:/.test(id)){
      try{const fresh=await getTitleDetails(id);if(fresh)result=result?mergeShow(result,fresh):fresh;}catch(e){if(!result)throw e;}
    }
    if(!result){
      const verified=sourceList.map(url=>trustedSource(id,url)).find(Boolean);
      if(parseFmoviesId(id)&&verified)result=await getFmoviesDetails(verified);
      else if(parseHdtodayId(id)&&verified)result=await getHdtodayDetails(verified);
    }
    if(!result)return null;
    if(product==='dahsha'&&(!base || result.providerMetadata || /^(fm|hd):/.test(result.id))&&result.documentary!==true)return null;
    // A live discovery result may have matched a canonical title after the deployment snapshot.
    // Revalidate that offering against fetched metadata instead of trusting caller descriptors.
    for(const sourceUrl of sourceList){
    if(base && !result.offerings?.some(o=>o.sourceUrl===sourceUrl)){
      try{
        const url=new URL(sourceUrl);let extra;
        if(url.origin===FMOVIES_BASE && /^\/(movie|tv)\/[a-z0-9-]+-\d+\/?$/i.test(url.pathname))extra=await getFmoviesDetails(url.origin+url.pathname);
        else if(url.origin===HDTODAY_BASE && /^\/watch\/(movie|tv)-[a-z0-9-]+$/.test(url.pathname)){
          try{extra=await getHdtodayDetails(url.origin+url.pathname);}
          catch{
            const suggested=await searchHdtoday(result.title);
            const candidate=suggested.find(s=>s.sourceUrl===url.origin+url.pathname);
            if(candidate){
              const verification=mergeLibrary({shows:[result],tags:[],channels:[]},[candidate],{product:'flixer'});
              if(verification.report.aliases[candidate.id]===result.id)extra={...candidate,documentary:product==='dahsha'?true:candidate.documentary};
            }
          }
        }
        if(extra){const matched=mergeLibrary({shows:[result],tags:[],channels:[]},[extra],{product});if(matched.report.aliases[extra.id]===result.id)result=matched.catalog.shows[0];}
      }catch{ /* source errors cannot replace or authorize a different title */ }
    }
    }
    const errors=[], blocked=new Set();
    for(const provider of showOfferings(result)){
      try{
        let fresh;
        if(provider.provider==='myflixer' && provider.id!==id)fresh=await getTitleDetails(provider.id);
        if(provider.provider==='fmovies')fresh=await getFmoviesDetails(provider);
        if(provider.provider==='hdtoday')fresh=await getHdtodayDetails(provider);
        if(fresh){
          errors.push(...(fresh.providerErrors || []));
          if(product==='dahsha'&&fresh.documentary!==true){blocked.add(provider.id);errors.push({provider:provider.provider,error:'Not classified as documentary'});continue;}
          result=mergeShow(result,fresh);
        }
      }catch(e){errors.push({provider:provider.provider,error:e.message});}
    }
    // A blocked HDToday TV detail page must not prevent a verified catalogue
    // identity from supplying its real episode guide and public player IDs.
    if(result.kind==='series' && (!result.episodes?.length || !result.tmdbId)){
      try{
        const candidates=await searchFmovies(result.title,{documentary:product==='dahsha'});
        for(const candidate of candidates.filter(s=>s.kind==='series')){
          const verified=mergeLibrary({shows:[result],tags:[],channels:[]},[candidate],{product});
          if(verified.report.aliases[candidate.id]!==result.id){
            if(verified.report.pending.length)result.versions=verified.catalog.shows[0].versions;
            continue;
          }
          const details=await getFmoviesDetails(candidate);
          if(product==='dahsha' && !details.documentary)continue;
          result=mergeShow(result,details);break;
        }
      }catch(error){errors.push({provider:'fmovies',error:error.message});}
    }
    result.offerings=showOfferings(result).filter(o=>!blocked.has(o.id));
    result.episodes=(result.episodes||[]).map(episode=>{
      let offerings=episodeOfferings(episode).filter(o=>!blocked.has(o.id) && ![...blocked].some(id=>o.provider==='hdtoday' && o.id.startsWith(id+':') || o.provider==='fmovies' && parseFmoviesId(id)?.tmdbId===parseFmoviesId(o.id)?.tmdbId));
      for(const o of showOfferings(result)){
        if(result.kind==='film'&&(['fmovies','hdtoday'].includes(o.provider) || o.provider==='myflixer' && /^mf:m:/.test(o.id)))offerings.push({...o,id:o.id});
        else if(result.kind==='series'&&Number.isInteger(episode.season)&&Number.isInteger(episode.number)){
          if(o.provider==='fmovies')offerings.push({...o,id:`fm:e:${o.tmdbId}:${episode.season}:${episode.number}`,season:episode.season,number:episode.number});
          if(o.provider==='hdtoday')offerings.push({...o,id:`${o.id}:${episode.season}:${episode.number}`,season:episode.season,number:episode.number});
        }
      }
      return {...episode,showId:result.id,offerings:[...new Map(offerings.map(o=>[`${o.provider}:${o.id}`,o])).values()]};
    });
    return {...result,providerErrors:errors,episodeCount:result.episodes.length,providersHydratedAt:new Date().toISOString()};
  })();
  hydrated.set(key,{at:Date.now(),promise});if(hydrated.size>300)hydrated.delete(hydrated.keys().next().value);
  try{return await promise;}catch(e){hydrated.delete(key);throw e;}
}
export async function unifiedSearch(query,{product=PRODUCT,catalog=readLibrary()}={}) {
  const q=String(query||'').trim();if(!q)return [];
  const results=await Promise.allSettled([
    product==='flixer'?searchContent(q):Promise.resolve([]),
    searchFmovies(q,{documentary:product==='dahsha'}),searchHdtoday(q,{documentary:product==='dahsha'}),
  ]);
  const rows=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
  const {catalog:merged,report}=mergeLibrary(catalog,rows,{product,aliases:readJson(`provider-aliases-${product}.json`,{})});
  const ids=new Set(rows.map(r=>report.aliases[r.id]||r.id));
  return merged.shows.filter(s=>ids.has(s.id)||s.title?.toLowerCase().includes(q.toLowerCase()));
}
export function libraryPage(catalog,{kind,page=1,perPage=24,genre,year,search}={}) {
  page=Math.max(1,Math.floor(Number(page)||1));perPage=Math.min(100,Math.max(1,Math.floor(Number(perPage)||24)));
  let items=(catalog.shows||[]).filter(s=>!kind||s.kind===kind);
  if(genre)items=items.filter(s=>s.tags?.includes(String(genre).toLowerCase()));
  if(year)items=items.filter(s=>Number(s.year)===Number(year));
  if(search)items=items.filter(s=>s.title?.toLowerCase().includes(String(search).toLowerCase()));
  return {items:items.slice((page-1)*perPage,page*perPage),page,total:items.length,totalPages:Math.ceil(items.length/perPage)};
}
export function libraryHome(catalog=readLibrary()) {
  const recent={...catalog,shows:[...(catalog.shows||[])].sort((a,b)=>String(b.providerUpdatedAt||b.latestAt||b.publishedAt||'').localeCompare(String(a.providerUpdatedAt||a.latestAt||a.publishedAt||'')))};
  const trendingMovies=libraryPage(recent,{kind:'film',perPage:16}).items;
  const trendingSeries=libraryPage(recent,{kind:'series',perPage:16}).items;
  return {featured:trendingMovies[0]||trendingSeries[0]||null,trendingMovies,trendingSeries,rails:[
    {id:'trending-movies',title:'Latest movies',items:trendingMovies},
    {id:'trending-series',title:'Latest series',items:trendingSeries},
    ...['action','sci-fi','comedy','horror'].map(genre=>({id:genre,title:genre,items:libraryPage(recent,{kind:'film',genre,perPage:12}).items})),
  ]};
}
export async function discoverLibrary({kind='film',page=1,genre,year,product=PRODUCT,catalog=readLibrary()}={}) {
  if(!['film','series'].includes(kind))throw new Error('Invalid catalogue kind');
  page=Math.min(500,Math.max(1,Math.floor(Number(page)||1)));
  const documentary=product==='dahsha';
  const results=await Promise.allSettled([fetchFmoviesPage({kind,page,genre,year,documentary}),fetchHdtodayPage({kind,page,documentary,genre})]);
  const rows=results.flatMap(r=>r.status==='fulfilled'?r.value.items:[]);
  const {catalog:merged,report}=mergeLibrary(catalog,rows,{product,aliases:readJson(`provider-aliases-${product}.json`,{})});
  const ids=new Set(rows.map(row=>report.aliases[row.id]||row.id));
  const items=merged.shows.filter(s=>ids.has(s.id)&&s.kind===kind&&(!year||Number(s.year)===Number(year))&&(!genre||documentary||s.tags?.includes(genre)));
  return {items,page,totalPages:Math.max(page,...results.filter(r=>r.status==='fulfilled').map(r=>r.value.totalPages)),providerErrors:results.map((r,i)=>r.status==='rejected'?{provider:i?'hdtoday':'fmovies',error:r.reason.message}:null).filter(Boolean)};
}
export async function unifiedStream(id,{showId,source,prefix='/api/stream',catalog=readLibrary(),product=PRODUCT,resolveTitle=unifiedTitle,resolveMyflixer=resolveMyflixerStream,resolveHdtoday=resolveHdtodayServers}={}) {
  if(catalog.product && catalog.product!==product)return null;
  let base=showId?locate(catalog,showId):catalog.shows?.find(s=>s.episodes?.some(e=>e.id===id||e.offerings?.some(o=>o.id===id)));
  if(!base && !showId && /^mf:m:/.test(id))base=locate(catalog,id);
  const fm=parseFmoviesId(id),hd=parseHdtodayId(id);
  const targetId=showId||base?.id||(fm?`fm:${fm.kind==='film'?'m':'s'}:${fm.tmdbId}`:hd?`hd:${hd.kind==='film'?'m':'s'}:${hd.slug}`:id);
  const title=await resolveTitle(targetId,{source,catalog,product});
  let episode=title?.episodes?.find(e=>e.id===id||e.offerings?.some(o=>o.id===id));
  if(!episode && title?.kind==='film' && (id===title.id||title.offerings?.some(o=>o.id===id)))episode=title.episodes[0];
  // Never authorize arbitrary episode slots from caller-supplied offering descriptors.
  if(!episode)return null;
  if(product==='dahsha'&&(!base || title.providerMetadata || /^(fm|hd):/.test(title.id))&&title.documentary!==true)return null;
  const offers=episodeOfferings(episode);
  const results=await Promise.allSettled(offers.map(async o=>{
    if(o.provider==='fmovies')return fmoviesServers(o.id);
    if(o.provider==='hdtoday')return resolveHdtoday(o.id,{tmdbId:title.tmdbId || title.offerings?.find(provider=>provider.provider==='fmovies')?.tmdbId});
    if(o.provider==='youtube')return [{id:`youtube:${o.id}`,name:'YouTube',provider:'youtube',type:'youtube',videoId:o.id}];
    if(o.provider==='myflixer'){
      const resolved=await resolveMyflixer(o.id,prefix);
      return (resolved.servers||[]).map(s=>({...s,id:`myflixer:${s.id}`,name:`Myflixer · ${s.name}`,provider:'myflixer'}));
    }
    return [];
  }));
  const servers=[],seen=new Set();
  for(const r of results)if(r.status==='fulfilled')for(const server of r.value){const identity=server.streamUrl||server.embedUrl||`youtube:${server.videoId}`;if(!seen.has(identity)){seen.add(identity);servers.push(server);}}
  if(title.kind==='series')for(const server of documentedTvServers({tmdbId:title.tmdbId || title.offerings?.find(o=>o.provider==='fmovies')?.tmdbId,season:episode.season,number:episode.number})){
    if(!seen.has(server.embedUrl)){seen.add(server.embedUrl);servers.push(server);}
  }
  return {id,showId:title.id,servers,streamUrl:servers.find(s=>s.type==='hls')?.streamUrl||null,providerErrors:title.providerErrors};
}
