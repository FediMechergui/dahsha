import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackTitleFallback,PLAYBACK_STATIC_ORIGIN} from '../src/playback-title-fallback.js';
import {createNetlifyHandler} from '../src/netlify-handler.js';

const generation='2026-11-05T12:00:26.071Z';
const status=()=>({product:'dahsha',static:true,generatedAt:generation,stats:{shows:17897}});
const legacy=()=>({id:'s_108xb7w',kind:'film',lang:'en',title:'Lust for Gold: A Race Against Time',tags:['documentary'],channel:{id:'myflixer'},episodes:[{id:'mf:m:lust-for-gold-a-race-against-time'}]});
const modern=(id='fm:m:123')=>({id,kind:'film',lang:'en',title:'A documentary',documentary:true,providerMetadata:true,episodes:[{id}]});
function fixture({row=legacy(),snapshot=status(),...options}={}){
  const requests=[];
  const read=createPlaybackTitleFallback({...options,fetchImpl:async(url,init)=>{
    requests.push({url,init});
    const value=new URL(url).pathname==='/data/status.json'?snapshot:row;
    return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  }});
  return {read,requests};
}

test('playback fallback accepts legacy tagged Myflixer documentaries and reports the real deployment generation',async()=>{
  const {read,requests}=fixture(),row=legacy();
  const saved=await read(row.id,row.episodes[0].id);
  assert.equal(saved.id,row.id);assert.equal(saved._catalogueGeneratedAt,generation);
  assert.equal(requests.length,3);
  assert.equal(requests[0].url,requests[2].url,'generation is checked before and after the title');
  assert.ok(requests.every(({url,init})=>new URL(url).origin===PLAYBACK_STATIC_ORIGIN&&init.redirect==='error'&&init.cache==='no-store'));
});

test('provider filenames receive two URL encodings, and neither path-like IDs nor unlisted episodes can be authorized',async()=>{
  const row=modern(),{read,requests}=fixture({row});
  assert.equal((await read(row.id,row.id)).id,row.id);
  assert.equal(new URL(requests[1].url).pathname,'/data/shows/fm%253Am%253A123.json');
  assert.equal(await read(row.id,'fm:e:123:99:99'),null);
  for(const id of ['../status','https://evil.test/','a%2fb','a\\b','a\u0000b'])assert.equal(await read(id,row.id),null);
  assert.equal(requests.length,3,'invalid requests and absent episodes cannot trigger an arbitrary fetch');
});

test('fallback rejects wrong title IDs, non-documentaries, malformed rows, languages and generation stamps',async()=>{
  for(const row of [
    {...legacy(),id:'s_other'}, {...legacy(),documentary:false}, {...legacy(),tags:['comedy']},
    {...legacy(),providerMetadata:true}, {...legacy(),episodes:[]}, {...legacy(),episodes:[{id:null}]},
    {...legacy(),lang:'fr'}, {...legacy(),product:'flixer'}, {...legacy(),_catalogueGeneratedAt:'2026-01-01T00:00:00Z'},
  ]){
    const {read}=fixture({row});await assert.rejects(read(legacy().id,legacy().episodes[0].id),/documentary|title/);
  }
  const {read}=fixture({row:{...modern(),documentary:undefined,tags:['documentary']}});
  await assert.rejects(read('fm:m:123','fm:m:123'),/verified documentary/);
});

test('wrong products and changing deployment generations are never stamped as current',async()=>{
  const bad=fixture({snapshot:{...status(),product:'flixer'}});
  await assert.rejects(bad.read(legacy().id,legacy().episodes[0].id),/generation/);
  assert.equal(bad.requests.length,1);
  let checks=0;
  const read=createPlaybackTitleFallback({fetchImpl:async url=>new Response(JSON.stringify(new URL(url).pathname==='/data/status.json'?{...status(),generatedAt:checks++? '2026-11-05T12:30:00Z':generation}:legacy()))});
  await assert.rejects(read(legacy().id,legacy().episodes[0].id),/generation changed/);
});

test('lookup deadline aborts stalled fetches, including implementations that ignore cancellation',async()=>{
  let signal;
  const read=createPlaybackTitleFallback({timeoutMs:15,fetchImpl:(_url,init)=>{signal=init.signal;return new Promise(()=>{});}});
  const start=performance.now();await assert.rejects(read(legacy().id,legacy().episodes[0].id),/timed out/);
  assert.ok(signal.aborted);assert.ok(performance.now()-start<1000);
});

test('fallback cache coalesces concurrent requests, expires promptly and bounds retained titles',async()=>{
  let now=Date.parse(generation);const {read,requests}=fixture({now:()=>now,cacheMs:100});
  await Promise.all([read(legacy().id,legacy().episodes[0].id),read(legacy().id,legacy().episodes[0].id)]);
  assert.equal(requests.length,3);
  now+=101;await read(legacy().id,legacy().episodes[0].id);assert.equal(requests.length,6);
  let calls=0;
  const capped=createPlaybackTitleFallback({maxEntries:1,fetchImpl:async url=>{
    calls++;const path=new URL(url).pathname;
    return new Response(JSON.stringify(path==='/data/status.json'?status():modern(decodeURIComponent(decodeURIComponent(path.split('/').at(-1).replace(/\.json$/,''))))));
  }});
  await capped('fm:m:1','fm:m:1');await capped('fm:m:2','fm:m:2');await capped('fm:m:1','fm:m:1');assert.equal(calls,9);
});

test('missing static titles, oversized bodies and unexpected response origins fail closed',async()=>{
  for(const mode of ['missing','large','foreign']){
    const read=createPlaybackTitleFallback({fetchImpl:async url=>{
      if(new URL(url).pathname==='/data/status.json')return new Response(JSON.stringify(status()));
      if(mode==='missing')return new Response('',{status:404});
      const response=new Response(JSON.stringify(legacy()),{headers:mode==='large'?{'content-length':String(5*1024*1024)}:{}});
      if(mode==='foreign')Object.defineProperty(response,'url',{value:'https://evil.test/title.json'});
      return response;
    }});
    if(mode==='missing')assert.equal(await read(legacy().id,legacy().episodes[0].id),null);
    else await assert.rejects(read(legacy().id,legacy().episodes[0].id),/too large|origin/);
  }
});

test('a stalled live stream lookup recovers from a pinned title without changing any browsing endpoint',async()=>{
  const {read,requests}=fixture();let calls=0;
  const handle=createNetlifyHandler({hydrationTimeoutMs:15,readManifest:()=>new Promise(()=>{}),readPlaybackFallback:read,handlers:{stream:(req,res)=>{
    calls++;assert.equal(req.catalog.generatedAt,generation);assert.equal(req.catalog.shows[0].id,legacy().id);
    assert.equal(req.query.transport,'direct');res.json({servers:[]});
  },catalogue:(_req,res)=>res.status(503).json({error:'Live unavailable'})}});
  const response=await handle(new Request('https://evil.test/api/stream?id=mf:m:lust-for-gold-a-race-against-time&showId=s_108xb7w&source=https://evil.test/source',{headers:{'X-Forwarded-Host':'another.test'}}));
  assert.equal(response.status,200);assert.equal(response.headers.get('X-Dahsha-Catalogue-Source'),'deployment-playback-fallback');
  assert.equal(calls,1);assert.ok(requests.every(({url})=>new URL(url).origin===PLAYBACK_STATIC_ORIGIN));
  const count=requests.length;
  assert.equal((await handle(new Request('https://dahsha.netlify.app/api/catalogue?part=status'))).status,503);
  assert.equal(requests.length,count,'homepage/catalogue must not receive static recovery data');
});

test('live titles take priority; missing IDs, wrong products, denials and player errors do not use fallback',async()=>{
  const manifest={product:'dahsha',generatedAt:generation};let recovered=0;
  for(const mode of ['live','missing','product','denied','player']){
    const handle=createNetlifyHandler({readManifest:async()=>mode==='product'?{...manifest,product:'flixer'}:manifest,
      readTitle:async()=>{if(mode==='denied')throw Error('Catalogue source HTTP 403');return mode==='missing'?null:legacy();},
      readPlaybackFallback:async()=>{recovered++;return legacy();},handlers:{stream:(req,res)=>{
        if(mode==='player')return res.status(502).json({error:'Provider HTTP 403'});
        res.status(req.catalog.shows.length?200:404).json({servers:[]});
      }}});
    const response=await handle(new Request('https://dahsha.netlify.app/api/stream?id=mf:m:lust-for-gold-a-race-against-time&showId=s_108xb7w'));
    assert.equal(response.status,{live:200,missing:404,product:503,denied:502,player:502}[mode]);
  }
  assert.equal(recovered,0);
});

test('title-page and status requests never fall back, even when the live manifest is missing',async()=>{
  let calls=0;
  const handle=createNetlifyHandler({readManifest:async()=>null,readPlaybackFallback:async()=>{calls++;return legacy();},handlers:{title:()=>assert.fail('No static title page'),catalogue:(_req,res)=>res.status(503).json({error:'Live unavailable'})}});
  for(const path of ['/api/title?id=s_108xb7w','/api/catalogue?part=manifest','/api/catalogue?part=status'])assert.equal((await handle(new Request(PLAYBACK_STATIC_ORIGIN+path))).status,503);
  assert.equal(calls,0);
});
