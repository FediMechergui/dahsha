import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('Flixer offline search finds Happy & Gay when the user types and or omits punctuation',async()=>{
  const catalog={product:'flixer',shows:[{id:'happy-gay',title:'Happy & Gay',kind:'film',year:2014,tags:['animation']},{id:'holidays',title:'Happy Holidays',kind:'film',tags:['comedy']}]};
  const context=vm.createContext({window:{FLIXER_CONFIG:{live:false}},console,localStorage:{getItem:()=>null,setItem:()=>{}},AbortController,setTimeout,clearTimeout,fetch:async url=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(String(url).includes('/catalog.json')?catalog:String(url).includes('/universes.json')?{universes:[]}:{services:[]})})});
  for(const name of ['universes.js','tvmaze.js','api.js'])vm.runInContext(fs.readFileSync(new URL(`../../client-terrarium/js/${name}`,import.meta.url),'utf8'),context);
  const api=new context.window.Api.FlixerApi();
  for(const query of ['happy and gay','happy & gay','happy gay']){
    const result=await api.search(query);
    assert.deepEqual(Array.from(result.items,item=>item.id),['happy-gay']);
  }
  assert.equal((await api.search('...')).items.length,0);
});
