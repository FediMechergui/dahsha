import catalogue from '../../api/catalogue.js';
import title from '../../api/title.js';
import stream from '../../api/stream.js';
import {checkRuntimeManifest, getRuntimeTitle} from './dahsha-runtime-source.js';

// Browsing/search remain on the device. Playback hydrates a single documentary,
// never the complete catalogue, and media bytes travel directly to the player.
export function createNetlifyHandler({handlers={catalogue,title,stream},readManifest=checkRuntimeManifest,readTitle=getRuntimeTitle}={}) {
  return async request => {
    const url=new URL(request.url);
    const headers=new Headers({'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'*','X-Content-Type-Options':'nosniff'});
    const reply=(body,status=200)=>{
      const resultHeaders=new Headers(headers);
      resultHeaders.set('Content-Type','application/json; charset=utf-8');resultHeaders.set('Cache-Control','no-store');
      resultHeaders.delete('Netlify-CDN-Cache-Control');
      return new Response(request.method==='HEAD'?null:JSON.stringify(body),{status,headers:resultHeaders});
    };
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(!['GET','HEAD'].includes(request.method))return reply({error:'Method not allowed'},405);
    const name=url.pathname.replace(/^\/api\//,'');
    if(name==='health')return reply({ok:true,service:'dahsha-api',product:'dahsha',hosting:'netlify',catalogue:'independent-publication'});
    const handler=Object.hasOwn(handlers,name)?handlers[name]:null;
    if(!handler)return reply({error:'Unknown API endpoint'},404);
    const query=Object.create(null);
    for(const [key,value] of url.searchParams)query[key]===undefined?query[key]=value:query[key]=[].concat(query[key],value);
    if(name==='stream'&&query.proxy!==undefined)return reply({error:'Media is delivered directly to the player. Resolve the episode again.'},410);
    if(name==='stream')query.transport='direct';
    const req={method:request.method,url:url.pathname+url.search,query,headers:{...Object.fromEntries(request.headers),host:url.host,'x-forwarded-host':url.host,'x-forwarded-proto':url.protocol.slice(0,-1)}};
    let status=200,body=null,ended=false;
    const res={setHeader:(key,value)=>headers.set(key,String(value)),getHeader:key=>headers.get(key),status(code){status=code;return this},json(value){headers.set('Content-Type','application/json; charset=utf-8');body=JSON.stringify(value);ended=true;return this},end(value){body=value??null;ended=true;return this}};
    try {
      if(name==='title'||name==='stream') {
        const id=name==='stream'?query.showId||query.id:query.id;
        if(typeof id!=='string'||!id||id.length>350)return reply({error:'Invalid title or episode ID'},400);
        const manifest=await readManifest();
        if(!manifest||manifest.product!=='dahsha')return reply({error:'Documentary catalogue temporarily unavailable'},503);
        const saved=await readTitle(id);
        req.catalog={product:'dahsha',generatedAt:saved?._catalogueGeneratedAt||manifest.generatedAt,shows:saved?[saved]:[],channels:[],tags:[],idAliases:saved&&id!==saved.id?{[id]:saved.id}:{}};
      }
      await handler(req,res);
      if(!ended)throw Error('Endpoint did not complete');
    } catch(error) {
      console.warn('[dahsha-api]',name,error.message);
      return reply({error:'Source temporarily unavailable; try another server'},502);
    }
    const cache=headers.get('Cache-Control');
    if(status>=200&&status<300&&cache&&!/no-store|private/.test(cache)){
      headers.set('Netlify-CDN-Cache-Control',cache+', durable');headers.set('Netlify-Vary','query');
    }
    if(status>=400)headers.set('Cache-Control','no-store');
    return new Response(request.method==='HEAD'?null:body,{status,headers});
  };
}
export const handleNetlifyRequest=createNetlifyHandler();
