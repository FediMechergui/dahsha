import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverLibrary } from '../src/library-service.js';
import { parseHdtodayList } from '../src/hdtoday.js';
import { fmoviesServers } from '../src/fmovies.js';

const row=(id,title='Shared',extra={})=>({id,title,kind:'film',year:2024,tags:['animation'],...extra});
test('discovery combines all three providers, preserves canonical IDs and survives one failure',async()=>{
  const result=await discoverLibrary({product:'flixer',kind:'film',page:2,genre:'animation',catalog:{shows:[row('mf:m:shared')]},fetchers:[
    async()=>({items:[row('fm:m:12','Shared',{offerings:[{provider:'fmovies',id:'fm:m:12',tmdbId:12}]})],totalPages:5}),
    async()=>{throw new Error('Rate limited');},
    async()=>({items:[row('mf:m:new','New')],totalPages:8}),
  ]});
  assert.deepEqual(result.items.map(s=>s.id),['mf:m:shared','mf:m:new']);
  assert.equal(result.items[0].offerings.length,2);
  assert.equal(result.totalPages,8);
  assert.equal(result.providerErrors[0].provider,'hdtoday');
});
test('discovery retains documentary policy and never caches complete provider failure as empty success',async()=>{
  const result=await discoverLibrary({product:'dahsha',catalog:{shows:[]},fetchers:[async()=>({items:[row('fm:m:12'),row('fm:m:13','Documentary',{documentary:true,tags:['documentary']})],totalPages:1})]});
  assert.deepEqual(result.items.map(s=>s.id),['fm:m:13']);
  await assert.rejects(discoverLibrary({catalog:{shows:[]},fetchers:[async()=>{throw new Error('offline');}]}),/unavailable/);
});
test('HDToday updates import the advertised episode without inventing earlier episodes',()=>{
  const {items}=parseHdtodayList('<a class="bf-card" href="/watch/tv-example-abcd1234" title="Example - Season 6"><span class="bf-card__genre">Animation</span><span class="bf-card__stamp"><b>S6 E5</b><span>18 h ago</span></span></a>',{kind:'series'});
  assert.equal(items[0].title,'Example');
  assert.deepEqual(items[0].episodes.map(e=>[e.season,e.number]),[[6,5]]);
  assert.ok(items[0].providerUpdatedAt);
});
test('each FMovies player receives its required iframe policy',()=>{
  for(const id of ['fm:m:12','fm:e:12:2:4']) assert.ok(fmoviesServers(id).every(s=>s.sandbox===null));
});
