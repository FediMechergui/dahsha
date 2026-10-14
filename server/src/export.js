import { mergeCachedProviders, refreshProviders, saveMergeReport } from './provider-sync.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT } from './product.js';
import { writeCatalog } from './export-catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args=process.argv.slice(2);
const out = path.resolve(args.find(a=>!a.startsWith('--')) || path.join(root, 'client/public', PRODUCT === 'dahsha' ? 'data' : 'data-flixer'));
try {
  let catalog;
  if (PRODUCT === 'dahsha') {
    const { Catalogue } = await import('./scheduler.js');
    const c = new Catalogue();
    if (!c.getCatalog()) c.rebuild();
    catalog = c.getCatalog();
  } else {
    const { fetchFullCatalog } = await import('./myflixer.js');
    const { readJson, writeJson } = await import('./store.js');
    const file=path.join(root,'client/public/data-flixer/catalog.json');
    const fs=await import('node:fs');
    const previous=readJson('flixer-catalog.json',fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null);
    if(args.includes('--cached') && previous) catalog=previous;
    else {
      const fresh=await fetchFullCatalog();
      const byId=new Map((previous?.shows||[]).map(show=>[show.id,show]));
      const { mergeShow } = await import('./merge-library.js');
      for(const show of fresh.shows)byId.set(show.id,byId.has(show.id)?mergeShow(byId.get(show.id),show):show);
      catalog={...fresh,shows:[...byId.values()]};
    }
    writeJson('flixer-catalog.json',catalog);
  }
  const merged = mergeCachedProviders(catalog, PRODUCT);
  catalog = merged.catalog; saveMergeReport(PRODUCT, merged.report);
  writeCatalog(out, catalog, PRODUCT);
  console.log(`[${PRODUCT}] exported ${catalog.shows.length} titles to ${out}`);
} catch (error) {
  console.error(`[${PRODUCT}] export failed: ${error.message}`);
  process.exitCode = 1;
}
