import { refreshProviders, mergeCachedProviders, saveMergeReport, providerStatus } from '../server/src/provider-sync.js';
import { readJson, writeJson } from '../server/src/store.js';
import { writeCatalog } from '../server/src/export-catalog.js';
import { resolveProviderMatches } from '../server/src/provider-matches.js';
import { enrichServices } from '../server/src/service-metadata.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback;};
const requested=option('--product',process.env.APP_PRODUCT||'dahsha');
if(!['both','dahsha','flixer'].includes(requested))throw new Error('Invalid product');
const STALE_HOURS=24;
/** A provider in error whose last success is over a day old (or that failed 3 scans running) is flagged in the CI run. */
function warnStaleProviders(product,cache,now=Date.now()){
  for(const [name,p] of Object.entries(providerStatus(cache))){
    if(!p.lastError)continue;
    const age=p.lastSuccessAt?(now-Date.parse(p.lastSuccessAt))/36e5:Infinity;
    if(age<STALE_HOURS && p.consecutiveFailures<3)continue;
    const since=p.lastSuccessAt?`since ${p.lastSuccessAt}`:'ever';
    const msg=`${name} has not answered ${since} (${p.consecutiveFailures} failed scan${p.consecutiveFailures===1?'':'s'} in a row, last error: ${p.lastError}); its ${p.records} cached ${product} titles are not being updated`;
    console.warn(process.env.GITHUB_ACTIONS==='true'?`\n::warning title=${name} provider stale::${msg}`:`[providers:${product}] warning: ${msg}`);
  }
}
for(const product of requested==='both'?['dahsha','flixer']:[requested]){
  const cache=await refreshProviders({product,full:args.includes('--full'),pageBudget:Number(option('--pages','24'))});
  warnStaleProviders(product,cache);
  const out=path.join(root,'client/public',product==='dahsha'?'data':'data-flixer');
  const file=path.join(out,'catalog.json');
  let base=readJson(product==='dahsha'?'catalog.json':'flixer-catalog.json',null);
  if(!base && fs.existsSync(file))base=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!base?.shows?.length)throw new Error(`Export the existing ${product} catalogue first`);
  // Use existing full records where possible; never overwrite details with a lean list.
  if(product==='flixer' && !readJson('flixer-catalog.json',null)){
    const dir=path.join(out,'shows');
    base.shows=base.shows.map(show=>{try{return {...show,...JSON.parse(fs.readFileSync(path.join(dir,`${encodeURIComponent(show.id)}.json`),'utf8'))};}catch{return show;}});
  }
  // Identity checks only clarify uncertain matches: a failure keeps the cached identities and still exports.
  try{await resolveProviderMatches(base,product,{limit:Number(option('--matches','150'))});}
  catch(error){console.warn(`[${product}] warning: provider identity checks failed (${error.message}); cached identities kept`);}
  // mergeCachedProviders also applies cached artwork and TVmaze metadata and skips malformed rows.
  const merged=mergeCachedProviders(base,product);saveMergeReport(product,merged.report);
  // TVmaze lookups are an optional extra: a failure there must not discard the merged export.
  try{
    const services=await enrichServices(merged.catalog,{limit:Number(option('--services','100'))});
    console.log(`[${product}] ${services} series received verified network/service metadata`);
  }catch(error){console.warn(`[${product}] warning: service metadata lookups failed (${error.message}); cached metadata kept`);}
  writeJson(product==='dahsha'?'catalog.json':'flixer-catalog.json',merged.catalog);
  writeCatalog(out,merged.catalog,product);
  const {report}=merged;
  console.log(`[${product}] ${report.matched} provider titles matched; ${report.added} added; ${report.pending.length} uncertain versions grouped; ${report.artwork||0} rows took cached artwork; ${(report.invalid||0)+(report.failed||0)} rows skipped; ${merged.catalog.shows.filter(s=>s.discoveredAt && /^(fm|hd):/.test(s.id)).length} provider titles dated by discovery; complete=${cache.completed}`);
}
