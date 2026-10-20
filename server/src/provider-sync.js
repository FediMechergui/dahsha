import { readJson, writeJson } from './store.js';
import { fetchFmoviesPage, FMOVIES_GENRES } from './fmovies.js';
import { fetchHdtodayPage } from './hdtoday.js';
import { mergeLibrary, providerRowProblem, latestDate, showUpdatedAt } from './merge-library.js';
import { getArtwork, applyProviderArtwork } from './artwork.js';
import { applyServiceMetadata, serviceMetadataFile } from './service-metadata.js';

const running=new Map();
const filename=product=>`providers-${product}.json`;
export const PROVIDERS=['fmovies','hdtoday'];
export const providerOf=id=>/^fm:/.test(String(id||''))?'fmovies':/^hd:/.test(String(id||''))?'hdtoday':null;
// Caches written before discovery dates were recorded hold the 2026-10-14 bulk import: a row counts
// as discovered only when it was first seen after this (or after that cache's last refresh, if earlier).
export const LEGACY_BASELINE='2026-10-15T00:00:00.000Z';
const isRecordValue=value=>!!value && typeof value==='object' && !Array.isArray(value);
/** Older rows have no discoveredAt: the first-seen date counts only when it is later than the bulk import. */
export function withDiscovery(row,baselineAt) {
  if(!isRecordValue(row) || 'discoveredAt' in row)return row;
  const first=latestDate(row.firstSeenAt);
  return {...row,discoveredAt:first && baselineAt && first>latestDate(baselineAt) ? first : null};
}
export function providerCache(product) {
  const cache=readJson(filename(product),{version:1,items:[],queue:[],completed:false,lastRefreshAt:null,errors:{}});
  const items=Array.isArray(cache?.items)?cache.items:[];
  const baselineAt=cache?.baselineAt || (items.length ? [LEGACY_BASELINE,cache?.lastRefreshAt].map(d=>latestDate(d)).filter(Boolean).sort()[0] : null);
  return {...cache,items:items.map(row=>withDiscovery(row,baselineAt)),queue:Array.isArray(cache?.queue)?cache.queue:[],...(baselineAt?{baselineAt}:{})};
}
/**
 * Freshness of each provider in a cache: when it was last tried, last answered without an error, last
 * added a row, and its current error. Caches written before this was recorded are estimated from the
 * old shared lastRefreshAt/errors and from row timestamps (a provider in error last answered when it
 * last wrote a row).
 */
export function providerStatus(cache) {
  const items=Array.isArray(cache?.items)?cache.items:[];
  const saved=isRecordValue(cache?.providers)?cache.providers:{};
  const errors=isRecordValue(cache?.errors)?cache.errors:{};
  const names=[...new Set([...PROVIDERS,...Object.keys(saved)])];
  const rowsOf=name=>items.filter(row=>providerOf(row?.id)===name);
  const out={};
  for(const name of names){
    const rows=rowsOf(name),own=isRecordValue(saved[name])?saved[name]:null;
    if(own){out[name]={lastAttemptAt:own.lastAttemptAt||null,lastSuccessAt:own.lastSuccessAt||null,lastNewRecordAt:own.lastNewRecordAt||null,lastError:own.lastError||null,lastErrorAt:own.lastErrorAt||null,consecutiveFailures:Number(own.consecutiveFailures)||0,records:rows.length};continue;}
    if(!rows.length && !errors[name])continue;
    const lastError=typeof errors[name]==='string'?errors[name]:null;
    const lastWrite=latestDate(...rows.flatMap(row=>[row.firstSeenAt,row.providerUpdatedAt,row.lastSeenAt]));
    out[name]={lastAttemptAt:latestDate(cache?.lastRefreshAt),lastSuccessAt:lastError?lastWrite:latestDate(cache?.lastRefreshAt)||lastWrite,
      lastNewRecordAt:latestDate(...rows.map(row=>row.firstSeenAt)),lastError,lastErrorAt:lastError?latestDate(cache?.lastRefreshAt):null,consecutiveFailures:lastError?1:0,records:rows.length};
  }
  return out;
}
/** Records one scan in the per-provider status: attempted providers, this scan's errors, and when each added a row. */
export function recordProviderPass(previous,{attempted=[],errors={},added={},at=new Date().toISOString()}={}) {
  const out={};
  for(const [name,status] of Object.entries(previous||{})){const {records,...kept}=status;out[name]=kept;}
  for(const name of attempted){
    const p=out[name]||={lastAttemptAt:null,lastSuccessAt:null,lastNewRecordAt:null,lastError:null,lastErrorAt:null,consecutiveFailures:0};
    p.lastAttemptAt=at;
    if(errors[name]){p.lastError=String(errors[name]);p.lastErrorAt=at;p.consecutiveFailures=(p.consecutiveFailures||0)+1;}
    else{p.lastSuccessAt=at;p.lastError=null;p.consecutiveFailures=0;}
    if(added[name])p.lastNewRecordAt=latestDate(p.lastNewRecordAt,added[name]);
  }
  return out;
}
/** Provider freshness for a log line, e.g. "fmovies ok at …, last new record …; hdtoday failing x12, last success … (HDToday HTTP 403)". */
export function providerFreshnessLine(sync) {
  const providers=isRecordValue(sync?.providers)?sync.providers:{};
  return Object.entries(providers).map(([name,p])=>p.lastError
    ? `${name} failing${p.consecutiveFailures>1?` x${p.consecutiveFailures}`:''}, last success ${p.lastSuccessAt||'never'} (${p.lastError})`
    : `${name} ok at ${p.lastSuccessAt||'never'}, last new record ${p.lastNewRecordAt||'never'}`).join('; ');
}
const MAX_WARNINGS=5,MAX_QUARANTINE=50;
/** Cached rows the merge can use; malformed ones are skipped with a warning (they never fail a rebuild). */
export function usableProviderRows(items,{product='dahsha',log=console.warn}={}) {
  const rows=[];let invalid=0;
  for(const row of items||[]){
    const problem=providerRowProblem(row);
    if(!problem){rows.push(row);continue;}
    if(++invalid<=MAX_WARNINGS)log(`[providers:${product}] skipped cached row ${typeof row?.id==='string'?row.id:'(no id)'}: ${problem}`);
  }
  if(invalid>MAX_WARNINGS)log(`[providers:${product}] skipped ${invalid} malformed cached rows in all`);
  return {rows,invalid};
}
/** Exact artwork.json entries cached under a provider row's id fill its empty synopsis and missing cover. */
export function applyCachedArtwork(rows,{log=console.warn}={}) {
  let artwork={};
  try{artwork=getArtwork()||{};}catch(error){log(`[providers] warning: cached artwork unavailable (${error.message})`);}
  let enriched=0;
  const out=(rows||[]).map(row=>{const entry=artwork[row.id];if(!entry)return row;const next=applyProviderArtwork(row,entry);if(next.synopsis!==row.synopsis||next.portrait!==row.portrait)enriched++;return next;});
  return {rows:out,enriched};
}
const record=value=>value && typeof value==='object' && !Array.isArray(value)?value:{};
/** Identities (provider-identities-<product>.json) of renamed shows moved to the live id (catalog.idAliases), unless that id has its own. */
export function rekeyIdentities(identities,idAliases){
  const out={...record(identities)};
  for(const [old,id] of Object.entries(record(idAliases)))if(typeof id==='string' && out[old] && !out[id]){out[id]=out[old];delete out[old];}
  return out;
}
export function mergeCachedProviders(base, product, {log=console.warn}={}) {
  const cache=providerCache(product);
  const aliases=record(readJson(`provider-aliases-${product}.json`,{}));
  const identities=rekeyIdentities(readJson(`provider-identities-${product}.json`,{}),base.idAliases);
  const enriched={...base,shows:(base.shows || []).map(s=>({...s,...identities[s.id]?.metadata}))};
  const {rows,invalid}=usableProviderRows(cache.items,{product,log});
  // Added titles, uncertain versions and matched shows with a generated synopsis all receive the artwork.
  const {rows:incoming,enriched:artwork}=applyCachedArtwork(rows,{log});
  let failed=0;
  const result=mergeLibrary(enriched,incoming,{product,aliases,onError:(row,error)=>{if(++failed<=MAX_WARNINGS)log(`[providers:${product}] could not merge ${row?.id}: ${error.message}`);}});
  if(failed>MAX_WARNINGS)log(`[providers:${product}] ${failed} cached rows could not be merged`);
  // Cached TVmaze network metadata (service-metadata-<product>.json) survives every rebuild and export.
  let services=0;
  try{services=applyServiceMetadata(result.catalog.shows,record(readJson(serviceMetadataFile(product),{})));}catch(error){log(`[providers:${product}] warning: cached service metadata not applied (${error.message})`);}
  Object.assign(result.report,{invalid,artwork,services});
  // lastRefreshAt is the newest per-provider success, so a provider in error never makes the data look fresh.
  const providers=providerStatus(cache);
  const lastRefreshAt=latestDate(...Object.values(providers).map(p=>p.lastSuccessAt));
  result.catalog.providerSync={lastRefreshAt,lastAttemptAt:latestDate(cache.lastAttemptAt,...Object.values(providers).map(p=>p.lastAttemptAt)),completed:cache.completed,remainingPartitions:cache.queue.length,errors:record(cache.errors),sourceRecords:cache.items.length,skippedRecords:invalid+failed,baselineAt:cache.baselineAt||null,providers};
  if(lastRefreshAt && (!result.catalog.generatedAt || lastRefreshAt>result.catalog.generatedAt))result.catalog.generatedAt=lastRefreshAt;
  // Show-level recency (see showUpdatedAt), kept only where it says more than latestAt: a card's recency
  // is updatedAt ?? latestAt. Recomputed on each merge, never carried over from an older one.
  for(const show of result.catalog.shows){const at=showUpdatedAt(show,result.catalog.generatedAt);if(at && at!==show.latestAt)show.updatedAt=at;else delete show.updatedAt;}
  return result;
}
export function saveMergeReport(product,report) {
  writeJson(`provider-aliases-${product}.json`,report.aliases);
  // skipped: malformed cached rows (invalid) and rows whose merge threw (failed); both are left out, never fatal.
  writeJson(`provider-matches-${product}.json`,{at:new Date().toISOString(),added:report.added,matched:report.matched,pending:report.pending,rejected:report.rejected,skipped:(report.invalid||0)+(report.failed||0),artwork:report.artwork||0,services:report.services||0});
}
function scopes(product) {
  const documentary=product==='dahsha';
  return [
    {provider:'fmovies',kind:'film',documentary,page:1},
    {provider:'fmovies',kind:'series',documentary,page:1},
    ...(documentary?[{provider:'hdtoday',documentary:true,page:1}]:[{provider:'hdtoday',kind:'film',page:1},{provider:'hdtoday',kind:'series',page:1}]),
  ];
}
async function fetchPage(job) {
  return job.provider==='fmovies'?fetchFmoviesPage(job):fetchHdtodayPage(job);
}
/**
 * Adds crawled rows to the cache map, keeping first-seen and update dates; a malformed row goes to
 * reject(row, reason) and onAdd(row, at) hears of each row new to the map. Every stored row has
 * lastSeenAt (this put), discoveredAt (now for a row new to the map when `discover` is set, i.e. one
 * found in a provider's latest listings after its first scan; otherwise null and kept) and
 * episodesAddedAt (when latestEpisode moved on from an earlier non-empty value; otherwise kept).
 */
export function putProviderRows(items,rows,{reject=()=>{},discover=false,onAdd=()=>{}}={}) {
  for(const row of rows){
    const problem=providerRowProblem(row);
    if(problem){reject(row,problem);continue;}
    const old=items.get(row.id);const now=new Date().toISOString();
    const newEpisode=!!(old?.latestEpisode && row.latestEpisode && row.latestEpisode!==old.latestEpisode);
    // HDToday cards say how long ago the title was updated; that date (never in the future) beats "now".
    const listed=latestDate(row.providerUpdatedAt),episodesAddedAt=newEpisode?(listed && listed<=now?listed:now):old?.episodesAddedAt||null;
    const next={...old,...row,tags:[...new Set([...(old?.tags||[]),...(row.tags||[])])],year:row.year||old?.year||null,firstSeenAt:old?.firstSeenAt||now,providerUpdatedAt:row.latestEpisode && row.latestEpisode!==old?.latestEpisode ? row.providerUpdatedAt||now : old?.providerUpdatedAt||row.providerUpdatedAt||now,
      lastSeenAt:now,discoveredAt:old?old.discoveredAt??null:discover?now:null};
    if(episodesAddedAt)next.episodesAddedAt=episodesAddedAt;else delete next.episodesAddedAt;
    items.set(row.id,next);
    if(!old)onAdd(row,now);
  }
  return items;
}
export async function refreshProviders({product='dahsha',full=false,pageBudget=Number(process.env.PROVIDER_SCAN_PAGES||12),log=console.log,fetch=fetchPage,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  if(running.has(product))return running.get(product);
  const promise=scan({product,full,pageBudget,log,fetchPage:fetch,sleep}).finally(()=>running.delete(product));running.set(product,promise);return promise;
}
async function scan({product,full,pageBudget,log,fetchPage,sleep}) {
  const cache=providerCache(product),items=new Map(),startedAt=new Date().toISOString();
  // Only a provider that already has cached rows can discover titles: its first scan is the bulk import.
  const known=new Set(cache.items.map(row=>providerOf(row?.id)).filter(Boolean));
  const attempted=new Set(),added={};
  // Malformed rows (a changed page layout, an older build) are kept aside in cache.quarantine, never merged.
  const quarantine=Array.isArray(cache.quarantine)?[...cache.quarantine]:[];let quarantined=0;
  const reject=(row,reason)=>{quarantined++;quarantine.push({id:typeof row?.id==='string'?row.id:null,reason,at:new Date().toISOString(),row});};
  const held=()=>quarantine.length?{quarantine:quarantine.slice(-MAX_QUARANTINE)}:{};
  for(const i of cache.items){const problem=providerRowProblem(i);if(problem)reject(i,problem);else items.set(i.id,i);}
  const errors={};let requests=0;
  const put=(rows,provider,{seed=false}={})=>putProviderRows(items,rows,{reject,discover:seed && known.has(provider),onAdd:(row,at)=>{const name=providerOf(row.id)||provider;added[name]=latestDate(added[name],at);}});
  // New releases / new episodes are refreshed independently of the long historical crawl.
  const currentYear=new Date().getUTCFullYear();
  for(const seed of scopes(product)) {
    attempted.add(seed.provider);
    try {
      const sort=seed.kind==='series'?'first_air_date.desc':'primary_release_date.desc';
      const result=await fetchPage(seed.provider==='fmovies'?{...seed,year:currentYear,sort}:{...seed,latest:true});
      put(result.items,seed.provider,{seed:true});requests++;
    }catch(e){errors[seed.provider]=e.message;}
  }
  if(!cache.queue.length && !cache.completed)cache.queue=scopes(product);
  if(full && cache.completed){cache.queue=scopes(product);cache.completed=false;}
  let scanned=0;
  while(cache.queue.length && (full || scanned<pageBudget)) {
    if(cache.queue.every(job=>errors[job.provider]))break;
    if(errors[cache.queue[0].provider]){cache.queue.push(cache.queue.shift());continue;}
    const job=cache.queue[0];attempted.add(job.provider);
    try {
      const result=await fetchPage(job);put(result.items,job.provider);requests++;scanned++;
      // Partition capped TMDB discovery by release/first-air year, then genre if necessary.
      if(job.provider==='fmovies' && job.page===1 && result.totalPages>=500 && !job.year){
        cache.queue.shift();
        const years=[...Array.from({length:currentYear+4-1900},(_,i)=>currentYear+3-i),'older'];
        cache.queue.push(...years.map(year=>({...job,year,page:1})));
      } else if(job.provider==='fmovies' && job.page===1 && result.totalPages>=500 && job.year && !job.genre){
        cache.queue.shift();
        const genres=job.documentary?[99]:Object.keys(FMOVIES_GENRES).map(Number);
        cache.queue.push(...genres.map(genre=>({...job,genre,page:1})));
      } else {
        const more=result.hasNext ?? job.page<result.totalPages;
        if(more){job.page++;cache.queue.push(cache.queue.shift());}else cache.queue.shift();
      }
      if(scanned%10===0)log(`[providers:${product}] ${items.size} records; ${cache.queue.length} scan partitions remain`);
      if(scanned%10===0)writeJson(filename(product),{...cache,items:[...items.values()],errors,completed:false,...held()});
    }catch(e){
      errors[job.provider]=e.message;
      // Keep the failed cursor for the next refresh, but let other providers make progress.
      cache.queue.push(cache.queue.shift());
      if(cache.queue.every(j=>errors[j.provider]))break;
      if(full && scanned===0 && cache.queue[0].provider===job.provider)break;
      scanned++;
    }
    await sleep(500);
  }
  const at=new Date().toISOString();
  // A provider that failed in this scan advances neither its own lastSuccessAt nor the shared lastRefreshAt.
  const providers=recordProviderPass(providerStatus(cache),{attempted,errors,added,at});
  cache.items=[...items.values()];cache.errors=errors;cache.completed=cache.queue.length===0;
  cache.providers=providers;cache.lastAttemptAt=at;
  cache.lastRefreshAt=latestDate(...Object.values(providers).map(p=>p.lastSuccessAt));
  if(!cache.baselineAt && cache.items.length)cache.baselineAt=startedAt;
  Object.assign(cache,held());
  writeJson(filename(product),cache);
  if(quarantined)log(`[providers:${product}] warning: quarantined ${quarantined} malformed rows (${quarantine.slice(-quarantined).slice(0,3).map(q=>`${q.id}: ${q.reason}`).join('; ')})`);
  log(`[providers:${product}] ${cache.items.length} source records; complete=${cache.completed}; requests=${requests}${Object.keys(errors).length?`; errors=${JSON.stringify(errors)}`:''}`);
  log(`[providers:${product}] freshness: ${providerFreshnessLine({providers:providerStatus(cache)})}`);
  return cache;
}
