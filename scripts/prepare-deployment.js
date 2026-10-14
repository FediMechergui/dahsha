// Keep runtime bundles independent of platform-specific file-tracing globs.
// Preserve unwanted traced directories outside the upload tree for inspection.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const product=process.argv[2] || process.env.APP_PRODUCT || 'dahsha';
if(!['dahsha','flixer'].includes(product))throw new Error('Invalid deployment product');
const functions=path.join(root,'.vercel/output/functions/api');
const backup=path.join(root,'.vercel/trace-backup',`${product}-${Date.now()}`);
const snapshot=path.join(root,'client/public',product==='dahsha'?'data':'data-flixer','catalog.json');
if(JSON.parse(fs.readFileSync(snapshot,'utf8')).product!==product)throw new Error('Wrong deployment catalogue');
let count=0;
for(const name of fs.readdirSync(functions).filter(name=>name.endsWith('.func'))){
  const target=path.resolve(functions,name);
  if(!target.startsWith(functions+path.sep))throw new Error('Invalid function directory');
  for(const folder of ['server/data','client']){
    const source=path.resolve(target,folder),destination=path.join(backup,name,folder);
    if(!source.startsWith(target+path.sep)||!destination.startsWith(backup+path.sep))throw new Error('Invalid trace paths');
    if(fs.existsSync(source)){fs.mkdirSync(path.dirname(destination),{recursive:true});fs.renameSync(source,destination);}
  }
  fs.mkdirSync(path.join(target,'server/src'),{recursive:true});
  fs.cpSync(path.join(root,'shared'),path.join(target,'shared'),{recursive:true});
  for(const file of fs.readdirSync(path.join(root,'server/src')).filter(file=>file.endsWith('.js')))
    fs.copyFileSync(path.join(root,'server/src',file),path.join(target,'server/src',file));
  fs.copyFileSync(snapshot,path.join(target,'server',`deployment-${product}.json`));
  count++;
}
if(!count)throw new Error('No API functions built');
console.log(`[deploy] ${count} API bundles prepared with only the ${product} catalogue snapshot`);
