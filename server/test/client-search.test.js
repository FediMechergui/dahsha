import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('Flixer offline search finds Happy & Gay when the user types and or omits punctuation',async()=>{
  const catalog={product:'flixer',shows:[{id:'happy-gay',title:'Happy & Gay',kind:'film',year:2014,tags:['animation']},{id:'holidays',title:'Happy Holidays',kind:'film',tags:['comedy']}]};
  const context=vm.createContext({window:{FLIXER_CONFIG:{live:false},dispatchEvent:()=>{}},console,localStorage:{getItem:()=>null,setItem:()=>{}},AbortController,setTimeout,clearTimeout,CustomEvent:class {},fetch:async url=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify((/\/(catalog|bootstrap|index)\.json/.test(String(url)))?catalog:String(url).includes('/universes.json')?{universes:[]}:{services:[]})})});
  for(const name of ['universes.js','tvmaze.js','api.js'])vm.runInContext(fs.readFileSync(new URL(`../../client-terrarium/js/${name}`,import.meta.url),'utf8'),context);
  const api=new context.window.Api.FlixerApi();
  for(const query of ['happy and gay','happy & gay','happy gay']){
    const result=await api.search(query);
    assert.deepEqual(Array.from(result.items,item=>item.id),['happy-gay']);
  }
  assert.equal((await api.search('...')).items.length,0);
});


test('Flixer renders its bootstrap before a delayed full index and keeps scroll pages distinct',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const initial={product:'flixer',shows:[{id:'one',kind:'film',title:'One',tags:['animation']}]};
  const requests=[];
  const context=vm.createContext({window:{FLIXER_CONFIG:{live:false},dispatchEvent:()=>{}},console,URLSearchParams,CustomEvent:class {},localStorage:{getItem:()=>null,setItem:()=>{}},AbortController,setTimeout,clearTimeout,fetch:async url=>{
    requests.push(String(url));
    if(String(url).includes('/index.json')) await gate;
    const body=String(url).includes('/index.json')?{product:'flixer',shows:Array.from({length:60},(_,i)=>({id:'item'+i,kind:'film',title:'Item '+i,tags:['animation']}))}:String(url).includes('/bootstrap.json')?initial:{};
    return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(body)};
  }});
  for(const name of ['universes.js','tvmaze.js','api.js'])vm.runInContext(fs.readFileSync(new URL(`../../client-terrarium/js/${name}`,import.meta.url),'utf8'),context);
  const api=new context.window.Api.FlixerApi();
  const startup=await api.catalog();
  assert.equal(startup.shows.length,1);
  assert.equal(requests.some(url=>url.includes('/catalog.json')),false);
  release(); await api._indexReady;
  const filters={genres:['animation']};
  const first=await api.discover('movie',filters,1),second=await api.discover('movie',filters,2);
  assert.equal(first.items.length,24); assert.equal(second.items.length,24);
  assert.equal(second.items.some(item=>first.items.some(prior=>item.id===prior.id)),false);
});


test('Flixer latest updates browse includes both media types and does not wait for auxiliary metadata',async()=>{
  let releaseMetadata;
  const metadata=new Promise(resolve=>{releaseMetadata=resolve;});
  const requests=[];
  const catalog={product:'flixer',shows:[
    {id:'movie',kind:'film',title:'Old movie, new update',publishedAt:'2020-01-01',latestAt:'2026-09-01',providerUpdatedAt:'2026-12-01',firstSeenAt:'2026-12-01'},
    {id:'series',kind:'series',title:'Updated series',publishedAt:'2025-01-01',latestAt:'2026-10-01'},
    {id:'added',kind:'film',title:'Recently added',publishedAt:'2026-08-01'}
  ]};
  const context=vm.createContext({window:{FLIXER_CONFIG:{live:false},dispatchEvent:()=>{}},console,URLSearchParams,CustomEvent:class {},localStorage:{getItem:()=>null,setItem:()=>{}},AbortController,setTimeout,clearTimeout,fetch:async input=>{
    const url=String(input);requests.push(url);
    if(url.includes('/services.json')||url.includes('/universes.json'))await metadata;
    const body=url.includes('/api/discover')?{items:[],totalPages:1}:url.includes('/index.json')||url.includes('/bootstrap.json')?catalog:{};
    return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(body)};
  }});
  for(const name of ['universes.js','tvmaze.js','api.js'])vm.runInContext(fs.readFileSync(new URL(`../../client-terrarium/js/${name}`,import.meta.url),'utf8'),context);
  const api=new context.window.Api.FlixerApi();await api.catalog();await api._indexReady;
  api.liveEnabled=true;
  const updated=await api.discover('all',{sort:'updated'},1);
  assert.deepEqual(Array.from(updated.items,item=>item.id),['series','movie','added']);
  const calls=requests.filter(url=>url.includes('/api/discover')).map(url=>new URL(url,'https://example.com'));
  assert.deepEqual(calls.map(url=>url.searchParams.get('kind')).sort(),['film','series']);
  assert.ok(calls.every(url=>url.searchParams.get('latest')==='true'));
  api.liveEnabled=false;
  const added=await api.discover('all',{sort:'added'},1);
  assert.deepEqual(Array.from(added.items,item=>item.id),['added','series','movie']);
  releaseMetadata();await api._metadataReady;
});
