import { refreshProviders, mergeCachedProviders, saveMergeReport } from '../server/src/provider-sync.js';
import { readJson, writeJson } from '../server/src/store.js';
import { writeCatalog } from '../server/src/export-catalog.js';
import { resolveProviderMatches } from '../server/src/provider-matches.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback;};
const requested=option('--product',process.env.APP_PRODUCT||'both');
if(!['both','dahsha','flixer'].includes(requested))throw new Error('Invalid product');
for(const product of requested==='both'?['dahsha','flixer']:[requested]){
  const cache=await refreshProviders({product,full:args.includes('--full'),pageBudget:Number(option('--pages','24'))});
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
  await resolveProviderMatches(base,product,{limit:Number(option('--matches','150'))});
  const merged=mergeCachedProviders(base,product);saveMergeReport(product,merged.report);
  writeJson(product==='dahsha'?'catalog.json':'flixer-catalog.json',merged.catalog);
  writeCatalog(out,merged.catalog,product);
  console.log(`[${product}] ${merged.report.matched} provider titles matched; ${merged.report.added} added; ${merged.report.pending.length} uncertain versions grouped; complete=${cache.completed}`);
}
