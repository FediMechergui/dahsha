// Offline, reviewed episode-link evidence for existing Dahsha documentaries.
// Never creates titles, refreshes source dates, or claims that a video is playable.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const defaultSeed=path.join(root,'server/config/dahsha-reviewed-guides.json');
const MAX_CACHE_BYTES=64*1024*1024,MAX_SEED_BYTES=4*1024*1024,MAX_EPISODES=20000;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const titleKey=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const hash=value=>createHash('sha256').update(value).digest('hex');
const date=value=>Date.parse(value||'')||0;
const newest=(a,b)=>date(a)>=date(b)?a:b;
const episodeId=id=>/^fm:e:([1-9]\d*):(\d+):([1-9]\d*)$/.exec(String(id||''));
function titleUrl(value,id,{legacy=false}={}){
  try{
    const url=new URL(value);
    if(!['https://www.f-moviess.org',...(legacy?['https://www.f-movies.org']:[])].includes(url.origin)||url.username||url.password||url.search||url.hash||!new RegExp(`^/tv/[a-z0-9-]+-${id}$`).test(url.pathname))return null;
    return 'https://www.f-moviess.org'+url.pathname;
  }catch{return null;}
}

export function validateReviewedGuides(seed){
  if(!object(seed)||seed.version!==1||seed.product!=='dahsha'||!Number.isFinite(Date.parse(seed.reviewedAt))||!Array.isArray(seed.guides)||seed.guides.length>500)throw Error('Invalid reviewed documentary guide seed');
  const seen=new Set();let episodes=0;
  for(const guide of seed.guides){
    const id=/^fm:s:([1-9]\d*)$/.exec(guide?.id||'');
    if(!id||!Number.isSafeInteger(Number(id[1]))||seen.has(guide.id)||guide.kind!=='series'||guide.documentary!==true||typeof guide.title!=='string'||!titleKey(guide.title)||!Number.isInteger(guide.year)||guide.year<1888||guide.year>2100||typeof guide.complete!=='boolean'||!Number.isFinite(Date.parse(guide.observedAt))||date(guide.observedAt)>date(seed.reviewedAt)||titleUrl(guide.sourceUrl,id[1])!==guide.sourceUrl||!Array.isArray(guide.episodes)||!guide.episodes.length)throw Error('Invalid reviewed guide: '+guide?.id);
    const ids=new Set(),slots=new Set();
    for(const episode of guide.episodes){
      const parsed=episodeId(episode?.id),slot=`${episode?.season}:${episode?.number}`;
      if(!parsed||parsed[1]!==id[1]||!Number.isSafeInteger(episode.season)||episode.season<0||!Number.isSafeInteger(episode.number)||episode.number<1||episode.id!==`fm:e:${id[1]}:${episode.season}:${episode.number}`||ids.has(episode.id)||slots.has(slot)||typeof episode.title!=='string'||!episode.title.trim()||episode.title.length>2000||Object.keys(episode).some(key=>!['id','season','number','title','sourceUrl'].includes(key)))throw Error('Invalid reviewed episode ownership: '+episode?.id);
      const url=new URL(episode.sourceUrl);
      const title=new URL(guide.sourceUrl);
      if(url.origin!==title.origin||url.pathname!==title.pathname||url.username||url.password||url.hash||[...url.searchParams.keys()].sort().join(',')!=='episode,season'||url.searchParams.get('season')!==String(episode.season)||url.searchParams.get('episode')!==String(episode.number))throw Error('Invalid observed episode URL: '+episode.id);
      ids.add(episode.id);slots.add(slot);episodes++;
    }
    seen.add(guide.id);
  }
  if(episodes>MAX_EPISODES)throw Error('Reviewed guide episode limit exceeded');
  return seed;
}

export function applyReviewedGuides(cache,seed){
  validateReviewedGuides(seed);
  if(!object(cache)||!Array.isArray(cache.items)||cache.items.length>250000||cache.product&&cache.product!=='dahsha')throw Error('Invalid Dahsha provider cache');
  const indices=new Map(),updates=new Map();
  cache.items.forEach((row,index)=>{if(typeof row?.id==='string')indices.set(row.id,indices.has(row.id)?null:index);});
  const report={reviewed:seed.guides.length,beforeRows:cache.items.length,afterRows:cache.items.length,eligible:0,applied:0,addedEpisodes:0,reasons:{},changes:[],skipped:[]};
  const skip=(guide,reason)=>{report.reasons[reason]=(report.reasons[reason]||0)+1;report.skipped.push({id:guide.id,reason});};
  for(const guide of seed.guides){
    const index=indices.get(guide.id);
    if(index===undefined){skip(guide,'missing');continue;}
    if(index===null){skip(guide,'duplicate_id');continue;}
    const row=cache.items[index],tmdb=Number(guide.id.split(':')[2]);
    if(row.documentary!==true){skip(guide,'not_documentary');continue;}
    if(row.kind!==guide.kind){skip(guide,'kind_mismatch');continue;}
    if(titleKey(row.title)!==titleKey(guide.title)){skip(guide,'title_mismatch');continue;}
    if(!row.year||Number(row.year)!==guide.year){skip(guide,'year_mismatch');continue;}
    if(titleUrl(row.sourceUrl,tmdb,{legacy:true})!==guide.sourceUrl){skip(guide,'source_mismatch');continue;}
    if(row.offerings!=null&&!Array.isArray(row.offerings)||row.episodes!=null&&!Array.isArray(row.episodes)||row.seasons!=null&&!Array.isArray(row.seasons)){skip(guide,'invalid_existing_guide');continue;}
    if(row.tmdbId!=null&&Number(row.tmdbId)!==tmdb||(row.offerings||[]).some(offer=>!object(offer)||offer.provider==='fmovies'&&(offer.id!==guide.id||offer.tmdbId!=null&&Number(offer.tmdbId)!==tmdb))){skip(guide,'identity_conflict');continue;}
    const existing=row.episodes||[],byId=new Map(),slots=new Map();let conflict=false;
    for(const episode of existing){
      if(!object(episode)||typeof episode.id!=='string'||byId.has(episode.id)){conflict=true;break;}
      byId.set(episode.id,episode);
      if(Number.isInteger(episode.season)&&Number.isInteger(episode.number))slots.set(`${episode.season}:${episode.number}`,episode.id);
    }
    for(const episode of guide.episodes){
      const old=byId.get(episode.id),other=slots.get(`${episode.season}:${episode.number}`);
      if(old&&(old.season!==episode.season||old.number!==episode.number)||other&&other!==episode.id)conflict=true;
    }
    if(conflict){skip(guide,'episode_conflict');continue;}
    const added=guide.episodes.filter(episode=>!byId.has(episode.id)).map(episode=>({...episode,offerings:[{provider:'fmovies',id:episode.id,tmdbId:tmdb,kind:'series',documentary:true,season:episode.season,number:episode.number,sourceUrl:guide.sourceUrl}]}));
    const episodes=added.length?[...existing,...added].sort((a,b)=>(a.season??Infinity)-(b.season??Infinity)||(a.number??Infinity)-(b.number??Infinity)):existing;
    const next={...row,episodes,episodeCount:episodes.length,seasons:[...new Set([...(row.seasons||[]),...episodes.map(episode=>episode.season).filter(Number.isInteger)])].sort((a,b)=>a-b),
      episodesCheckedAt:newest(row.episodesCheckedAt,guide.observedAt),episodesRefreshedAt:newest(row.episodesRefreshedAt,guide.observedAt),episodeSeasonChecks:{...row.episodeSeasonChecks}};
    for(const season of new Set(guide.episodes.map(episode=>episode.season)))next.episodeSeasonChecks[season]=newest(next.episodeSeasonChecks[season],guide.observedAt);
    if(Math.max(date(row.episodesCheckedAt),date(row.episodesRefreshedAt))<=date(guide.observedAt)){
      next.episodeGuideComplete=guide.complete;
      if(guide.complete&&!row.episodeGuideInitializedAt)next.episodeGuideInitializedAt=guide.observedAt;
    }
    // No latestAt/providerUpdatedAt/episodesAddedAt/discoveredAt changes: this is historical evidence.
    if(JSON.stringify(next)===JSON.stringify(row)){skip(guide,'unchanged');continue;}
    updates.set(index,next);report.eligible++;report.addedEpisodes+=added.length;
    report.changes.push({id:guide.id,addedEpisodes:added.length});
  }
  return {cache:updates.size?{...cache,items:cache.items.map((row,index)=>updates.get(index)||row)}:cache,report};
}

function readBounded(file,limit){if(fs.statSync(file).size>limit)throw Error('Guide input exceeds size limit: '+path.basename(file));return fs.readFileSync(file);}
export function applyGuideFile({dataDir=process.env.DATA_DIR||path.join(root,'server/data'),seedFile=defaultSeed,apply=false}={}){
  const seed=validateReviewedGuides(JSON.parse(readBounded(seedFile,MAX_SEED_BYTES)));
  const file=path.join(path.resolve(dataDir),'providers-dahsha.json');
  if(!fs.existsSync(file))return {reviewed:seed.guides.length,eligible:0,applied:0,addedEpisodes:0,reasons:{missing:seed.guides.length},skipped:[],changes:[],dryRun:!apply};
  const original=readBounded(file,MAX_CACHE_BYTES),beforeSha256=hash(original);
  const {cache,report}=applyReviewedGuides(JSON.parse(original),seed);
  Object.assign(report,{dryRun:!apply,beforeSha256,afterSha256:beforeSha256});
  if(!apply||!report.eligible)return report;
  const output=JSON.stringify(cache);
  if(Buffer.byteLength(output)>MAX_CACHE_BYTES)throw Error('Reviewed guide cache exceeds size limit');
  if(hash(readBounded(file,MAX_CACHE_BYTES))!==beforeSha256)throw Error('Provider cache changed during guide review; no changes written');
  const temporary=file+'.guides-'+randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,output,{flag:'wx'});fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  report.applied=report.eligible;report.afterSha256=hash(output);return report;
}

export function main(args=process.argv.slice(2)){
  if(process.env.APP_PRODUCT&&process.env.APP_PRODUCT!=='dahsha')throw Error('Reviewed guides are reserved for Dahsha');
  const options={};let reportFile;
  for(let index=0;index<args.length;index++){
    const argument=args[index];
    if(argument==='--apply')options.apply=true;
    else if(argument==='--dry-run')options.apply=false;
    else if(['--data-dir','--seed-file','--report'].includes(argument)){
      const value=args[++index];if(!value||value.startsWith('--'))throw Error('Missing value for '+argument);
      if(argument==='--report')reportFile=value;else options[argument==='--data-dir'?'dataDir':'seedFile']=value;
    }else throw Error('Unknown guide option: '+argument);
  }
  const report=applyGuideFile(options);
  if(reportFile){fs.mkdirSync(path.dirname(path.resolve(reportFile)),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');}
  const {changes,skipped,...summary}=report;console.log('[guides:dahsha] '+JSON.stringify(summary));
  if(skipped.some(row=>!['unchanged','missing'].includes(row.reason)))console.warn('[guides:dahsha] Skipped conflicting rows: '+JSON.stringify(skipped.filter(row=>!['unchanged','missing'].includes(row.reason))));
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{main();}catch(error){console.error('[guides:dahsha] '+error.message);process.exitCode=1;}
