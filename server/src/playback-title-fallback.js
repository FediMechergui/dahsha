import {providerRowProblem} from './merge-library.js';

// This is only a playback recovery source. It must never supply browsing indexes,
// status responses, arbitrary origins, aliases or an episode absent from the saved title.
export const PLAYBACK_STATIC_ORIGIN='https://dahsha.netlify.app';
const SHOW_BYTES=4*1024*1024,STATUS_BYTES=128*1024;
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=350&&/^[A-Za-z0-9:_-]+$/.test(id);
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);

function validateStatus(value,now){
  if(!record(value)||value.product!=='dahsha'||value.static!==true||!Number.isSafeInteger(value.stats?.shows)||value.stats.shows<1||
    !Number.isFinite(Date.parse(value.generatedAt))||Date.parse(value.generatedAt)>now+300000)throw Error('Invalid deployed documentary generation');
  return value.generatedAt;
}
function validateTitle(row,id,generation){
  if(providerRowProblem(row))throw Error('Invalid deployed documentary title');
  const wrongProduct=row.product!==undefined&&row.product!=='dahsha';
  const wrongGeneration=row._catalogueGeneratedAt!==undefined&&row._catalogueGeneratedAt!==generation;
  if(row.id!==id||wrongProduct||wrongGeneration||!['ar','en'].includes(row.lang)||!Array.isArray(row.episodes)||!row.episodes.length||
    row.episodes.some(episode=>!validId(episode.id)))throw Error('Invalid deployed documentary title');
  // Legacy Myflixer programme IDs are hashes and carry a documentary tag. Provider-led
  // titles retain the stricter explicit documentary flag used by unifiedStream.
  const providerLed=row.providerMetadata||/^(fm|hd):/.test(row.id);
  if(row.documentary===false||(providerLed?row.documentary!==true:row.documentary!==true&&!row.tags?.includes('documentary')))throw Error('Deployed title is not a verified documentary');
  return {...row,_catalogueGeneratedAt:generation};
}
function ownsEpisode(row,id){
  return row.episodes.some(episode=>episode.id===id||episode.offerings?.some(offering=>offering.id===id))||
    row.kind==='film'&&(row.id===id||row.offerings?.some(offering=>offering.id===id));
}
async function readJson(fetchImpl,url,limit,signal){
  const response=await fetchImpl(url,{signal,redirect:'error',cache:'no-store',headers:{Accept:'application/json'}});
  if(!response.ok){await response.body?.cancel();const error=Error(`Deployed documentary HTTP ${response.status}`);error.status=response.status;throw error;}
  if(response.url&&new URL(response.url).origin!==PLAYBACK_STATIC_ORIGIN)throw Error('Unexpected deployed documentary origin');
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('Deployed documentary response too large');}
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>limit)throw Error('Deployed documentary response too large');chunks.push(chunk);}
  return {value:JSON.parse(Buffer.concat(chunks).toString('utf8')),bytes};
}

export function createPlaybackTitleFallback({fetchImpl=fetch,now=Date.now,timeoutMs=2500,cacheMs=30000,maxEntries=32,maxCacheBytes=8*1024*1024}={}){
  const cache=new Map(),loading=new Map();let bytes=0;
  async function load(id){
    const controller=new AbortController();let timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=Error('Deployed documentary lookup timed out');controller.abort(error);reject(error);},Math.max(1,Math.min(2500,timeoutMs)));});
    const work=(async()=>{
      const statusUrl=`${PLAYBACK_STATIC_ORIGIN}/data/status.json?playback=${Math.floor(now()/30000)}`;
      const before=await readJson(fetchImpl,statusUrl,STATUS_BYTES,controller.signal);
      const generation=validateStatus(before.value,now());
      // Exported filenames themselves contain encodeURIComponent(id), so HTTP needs a second encoding.
      const url=`${PLAYBACK_STATIC_ORIGIN}/data/shows/${encodeURIComponent(encodeURIComponent(id))}.json?generation=${encodeURIComponent(generation)}`;
      const title=await readJson(fetchImpl,url,SHOW_BYTES,controller.signal);
      const row=validateTitle(title.value,id,generation);
      const after=await readJson(fetchImpl,statusUrl,STATUS_BYTES,controller.signal);
      if(validateStatus(after.value,now())!==generation)throw Error('Deployed documentary generation changed during lookup');
      return {row,bytes:title.bytes,at:now()};
    })();
    try{return await Promise.race([work,deadline]);}
    finally{clearTimeout(timer);controller.abort();}
  }
  return async (id,episodeId)=>{
    if(!validId(id)||!validId(episodeId))return null;
    let entry=cache.get(id);
    if(entry&&now()-entry.at>=Math.max(1,Math.min(30000,cacheMs))){cache.delete(id);bytes-=entry.bytes;entry=null;}
    if(!entry){
      if(!loading.has(id)){
        if(loading.size>=4)throw Error('Deployed documentary lookup busy');
        const pending=load(id).then(value=>{
          if(value.bytes<=maxCacheBytes){cache.set(id,value);bytes+=value.bytes;while(cache.size>Math.max(1,Math.min(32,maxEntries))||bytes>maxCacheBytes){const key=cache.keys().next().value;bytes-=cache.get(key).bytes;cache.delete(key);}}
          return value;
        }).finally(()=>loading.delete(id));
        loading.set(id,pending);
      }
      try{entry=await loading.get(id);}catch(error){if(error.status===404)return null;throw error;}
    }else{cache.delete(id);cache.set(id,entry);}
    return ownsEpisode(entry.row,episodeId)?entry.row:null;
  };
}

export const readPlaybackTitleFallback=createPlaybackTitleFallback();
