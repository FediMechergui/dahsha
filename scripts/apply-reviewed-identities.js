// Offline metadata repair for existing Dahsha documentaries. Dry-run by default.
// No requests, new titles, episode changes, offering changes or recency changes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const defaultSeed=path.join(root,'server/config/dahsha-reviewed-identities.json');
const MAX_CACHE_BYTES=64*1024*1024,MAX_SEED_BYTES=512*1024,MAX_FACTS=500;
const titleKey=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const numericId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
const hash=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);

export function validateReviewedIdentities(seed){
  if(!object(seed)||seed.version!==1||seed.product!=='dahsha'||!Number.isFinite(Date.parse(seed.reviewedAt))||!Array.isArray(seed.facts)||seed.facts.length>MAX_FACTS)throw Error('Invalid reviewed Dahsha identity seed');
  const seen=new Set();
  for(const fact of seed.facts){
    const id=/^hd:([ms]):((?:movie|tv)-[a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(fact?.id||'');
    const kind=id?.[1]==='m'?'film':'series',type=kind==='film'?'movie':'tv';
    if(!id||!id[2].startsWith(type+'-')||seen.has(fact.id)||fact.kind!==kind||fact.documentary!==true||typeof fact.title!=='string'||!titleKey(fact.title)||!Number.isInteger(fact.year)||fact.year<1888||fact.year>2100||!Number.isSafeInteger(fact.tmdbId)||fact.tmdbId<1)throw Error('Invalid or duplicate reviewed identity: '+fact?.id);
    if(fact.sourceUrl!==`https://hdtoday.sx/watch/${id[2]}`||fact.evidence?.provider!=='fmovies'||fact.evidence.id!==`fm:${id[1]}:${fact.tmdbId}`)throw Error('Missing identity evidence: '+fact.id);
    const evidence=new URL(fact.evidence.sourceUrl);
    if(evidence.origin!=='https://www.f-movies.org'||evidence.username||evidence.password||evidence.search||evidence.hash||!new RegExp(`^/${type}/[a-z0-9-]+-${fact.tmdbId}/?$`).test(evidence.pathname))throw Error('Invalid identity evidence URL: '+fact.id);
    seen.add(fact.id);
  }
  return seed;
}

export function applyReviewedIdentities(cache,seed){
  validateReviewedIdentities(seed);
  if(!object(cache)||!Array.isArray(cache.items)||cache.items.length>250000||cache.product&&cache.product!=='dahsha')throw Error('Invalid Dahsha provider cache');
  const indices=new Map(),updated=new Map();
  cache.items.forEach((row,index)=>{if(typeof row?.id==='string'){const previous=indices.get(row.id);indices.set(row.id,previous===undefined?index:null);}});
  const report={reviewed:seed.facts.length,beforeRows:cache.items.length,afterRows:cache.items.length,eligible:0,applied:0,reasons:{},changes:[],skipped:[]};
  const skip=(fact,reason)=>{report.reasons[reason]=(report.reasons[reason]||0)+1;report.skipped.push({id:fact.id,reason});};
  for(const fact of seed.facts){
    const index=indices.get(fact.id);
    if(index===undefined){skip(fact,'missing');continue;}
    if(index===null){skip(fact,'duplicate_id');continue;}
    const row=cache.items[index];
    if(row.documentary!==true){skip(fact,'not_documentary');continue;}
    if(row.kind!==fact.kind){skip(fact,'kind_mismatch');continue;}
    if(titleKey(row.title)!==titleKey(fact.title)){skip(fact,'title_mismatch');continue;}
    if(!row.year||Number(row.year)!==fact.year){skip(fact,'year_mismatch');continue;}
    if(row.sourceUrl!==fact.sourceUrl){skip(fact,'source_mismatch');continue;}
    const identities=[row.tmdbId,...(row.offerings||[]).filter(offer=>offer.provider==='fmovies').flatMap(offer=>[offer.tmdbId,/^fm:[ms]:(\d+)$/.exec(offer.id||'')?.[1]])].filter(value=>value!=null&&value!=='');
    if(identities.some(value=>!numericId(value)||Number(value)!==fact.tmdbId)){skip(fact,'identity_conflict');continue;}
    if(numericId(row.tmdbId)){skip(fact,'unchanged');continue;}
    updated.set(index,{...row,tmdbId:fact.tmdbId});
    report.changes.push({id:fact.id,tmdbId:fact.tmdbId});report.eligible++;
  }
  return {cache:updated.size?{...cache,items:cache.items.map((row,index)=>updated.get(index)||row)}:cache,report};
}

function readBounded(file,max){
  const size=fs.statSync(file).size;if(size>max)throw Error('Identity input exceeds size limit: '+path.basename(file));
  return fs.readFileSync(file);
}

export function applyIdentityFile({dataDir=process.env.DATA_DIR||path.join(root,'server/data'),seedFile=defaultSeed,apply=false}={}){
  const seed=validateReviewedIdentities(JSON.parse(readBounded(seedFile,MAX_SEED_BYTES).toString('utf8')));
  const file=path.join(path.resolve(dataDir),'providers-dahsha.json');
  if(!fs.existsSync(file))return {reviewed:seed.facts.length,beforeRows:0,afterRows:0,eligible:0,applied:0,reasons:{missing:seed.facts.length},changes:[],skipped:seed.facts.map(fact=>({id:fact.id,reason:'missing'})),dryRun:!apply};
  const original=readBounded(file,MAX_CACHE_BYTES),beforeHash=hash(original);
  const {cache,report}=applyReviewedIdentities(JSON.parse(original.toString('utf8')),seed);
  report.dryRun=!apply;report.beforeSha256=beforeHash;report.afterSha256=beforeHash;
  if(!apply||!report.eligible)return report;
  const output=JSON.stringify(cache);
  if(Buffer.byteLength(output)>MAX_CACHE_BYTES)throw Error('Enriched identity cache exceeds size limit');
  if(hash(readBounded(file,MAX_CACHE_BYTES))!==beforeHash)throw Error('Provider cache changed during identity review; no changes written');
  const temporary=file+'.identity-'+randomUUID()+'.tmp';
  try{
    fs.writeFileSync(temporary,output,{flag:'wx'});fs.renameSync(temporary,file);
  }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  report.applied=report.eligible;report.afterSha256=hash(output);return report;
}

export function main(args=process.argv.slice(2)){
  if(process.env.APP_PRODUCT&&process.env.APP_PRODUCT!=='dahsha')throw Error('Reviewed identities are reserved for Dahsha');
  const options={};let reportFile;
  for(let index=0;index<args.length;index++){
    const argument=args[index];
    if(argument==='--apply')options.apply=true;
    else if(argument==='--dry-run')options.apply=false;
    else if(['--data-dir','--seed-file','--report'].includes(argument)){
      const value=args[++index];if(!value||value.startsWith('--'))throw Error('Missing value for '+argument);
      if(argument==='--report')reportFile=value;else options[argument==='--data-dir'?'dataDir':'seedFile']=value;
    }else throw Error('Unknown identity option: '+argument);
  }
  const report=applyIdentityFile(options);
  if(reportFile){fs.mkdirSync(path.dirname(path.resolve(reportFile)),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');}
  const {changes,skipped,...summary}=report;console.log('[identities:dahsha] '+JSON.stringify(summary));
  if(skipped.some(row=>!['unchanged','missing'].includes(row.reason)))console.warn('[identities:dahsha] Skipped mismatched/conflicting rows: '+JSON.stringify(skipped.filter(row=>!['unchanged','missing'].includes(row.reason))));
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{main();}catch(error){console.error('[identities:dahsha] '+error.message);process.exitCode=1;}
