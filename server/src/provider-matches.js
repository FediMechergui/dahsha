import { readJson, writeJson } from './store.js';
import { mergeLibrary, titleKey } from './merge-library.js';
import { getTitleDetails } from './myflixer.js';
import { searchHdtoday } from './hdtoday.js';
import { safeRemoteFetch } from './stream-security.js';

export async function resolveProviderMatches(base,product,{limit=150,log=console.log}={}) {
  const cache=readJson(`providers-${product}.json`,{items:[]});
  const identities=readJson(`provider-identities-${product}.json`,{});
  const enriched={...base,shows:base.shows.map(s=>({...s,...identities[s.id]?.metadata}))};
  const {report}=mergeLibrary(enriched,cache.items,{product,aliases:readJson(`provider-aliases-${product}.json`,{})});
  const existing=new Map(base.shows.map(s=>[s.id,s]));
  const incoming=new Map(cache.items.map(s=>[s.id,s]));
  const jobs=[],seen=new Set();
  for(const pending of report.pending){
    const row=incoming.get(pending.id);
    if(row?.id.startsWith('hd:')&&!row.year)jobs.push({source:row});
    for(const id of pending.candidates){
      if(seen.has(id))continue;seen.add(id);
      const show=existing.get(id);
      const verified=identities[id];
      if(verified && Date.now()-verified.at<24*3600e3)continue;
      const mf=show?.offerings?.find(o=>o.provider==='myflixer')?.id || (show?.kind==='film'?show?.episodes?.find(e=>e.id.startsWith('mf:m:'))?.id:show?.episodes?.find(e=>e.id.startsWith('mf:e:'))?.id);
      if(mf)jobs.push({show,mf});
    }
  }
  let cursor=0,confirmed=0;
  await Promise.all(Array.from({length:Math.min(4,jobs.length,limit)},async()=>{
    while(cursor<Math.min(jobs.length,limit)){
      const job=jobs[cursor++];
      try{
        if(job.source){
          const hits=await searchHdtoday(job.source.title);
          const hit=hits.find(r=>r.id===job.source.id&&r.year);
          if(hit){Object.assign(job.source,{year:hit.year,title:hit.title});confirmed++;}
          continue;
        }
        let mf=job.mf;
        if(mf.startsWith('mf:e:')){
          const response=await safeRemoteFetch(`https://myflixerz.day/episodes/${mf.slice(5)}/`,{headers:{'User-Agent':'Mozilla/5.0'}});
          if(!response.ok){await response.body?.cancel();continue;}
          const html=await response.text();
          const parents=[...new Set([...html.matchAll(/href="(?:https:\/\/myflixerz\.day)?\/series\/([a-z0-9-]+)\/?"/gi)].map(m=>m[1]))];
          if(parents.length!==1)continue;
          mf=`mf:s:${parents[0]}`;
        }
        const detail=await getTitleDetails(mf);
        if(detail && detail.kind===job.show.kind && [job.show.title,...(job.show.altTitles||[])].some(t=>titleKey(t)===titleKey(detail.title)) && detail.year){
          identities[job.show.id]={at:Date.now(),metadata:{year:detail.year,offerings:[...(job.show.offerings||[]).filter(o=>o.provider!=='myflixer'),{provider:'myflixer',id:mf,kind:detail.kind,sourceUrl:detail.sourceUrl}]}};
          confirmed++;
        }else identities[job.show.id]={at:Date.now(),metadata:{}};
      }catch{ /* uncertainty is retained in the match queue, never resolved by guessing */ }
    }
  }));
  writeJson(`provider-identities-${product}.json`,identities);writeJson(`providers-${product}.json`,cache);
  log(`[matches:${product}] ${confirmed} identities clarified; ${Math.min(jobs.length,limit)} candidates checked`);
  return identities;
}
