import { titleKey } from './merge-library.js';

// Networks are title metadata, never inferred from the streaming player host.
export async function enrichServices(catalog,{limit=100,fetchJson=async url=>{
  const response=await fetch(url,{signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error(`TVmaze HTTP ${response.status}`);
  return response.json();
}}={}) {
  const candidates=catalog.shows.filter(show=>show.kind==='series'&&!show.tvm&&(!show.serviceCheckedAt||Date.now()-Date.parse(show.serviceCheckedAt)>7*86400e3));
  candidates.sort((a,b)=>Number(/^(fm|hd):/.test(b.id))-Number(/^(fm|hd):/.test(a.id)));
  const queue=candidates.slice(0,limit);
  let matched=0;
  await Promise.all(Array.from({length:3},async()=>{
    while(queue.length){
      const show=queue.shift();
      try{
        const results=await fetchJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(show.title)}`);
        const exact=results.map(row=>row.show).filter(row=>titleKey(row.name)===titleKey(show.title)&&(!show.year||Number(String(row.premiered||'').slice(0,4))===Number(show.year)));
        if(exact.length===1){
          const row=exact[0];
          show.tvm={id:row.id,w:row.weight||0,r:row.rating?.average||0,svc:row.webChannel?.name||row.network?.name||null,img:row.image?.medium,st:row.status,c:row.webChannel?.country?.code||row.network?.country?.code};matched++;
        }
        show.serviceCheckedAt=new Date().toISOString();
      }catch{/* Preserve this candidate for a later retry. */}
      await new Promise(resolve=>setTimeout(resolve,200));
    }
  }));
  return matched;
}
