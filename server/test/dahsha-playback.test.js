import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackServers,preferredServer,nextServer,validProgress} from '../../client/src/lib/player-policy.js';
import {unifiedStream} from '../src/library-service.js';

test('Dahsha preserves direct MP4, DASH and HLS links and source headers, preferring direct over named embeds',()=>{
  const servers=playbackServers({servers:[
    {id:'old',name:'Player 2',type:'embed',embedUrl:'https://vidlink.pro/movie/1'},
    {id:'file',type:'file',streamUrl:'https://cdn.example/documentary.mp4',headers:{Referer:'https://source.example/'}},
    {id:'dash',type:'dash',streamUrl:'https://cdn.example/documentary.mpd'},
    {id:'hls',type:'hls',streamUrl:'/api/stream?proxy=1',rawStreamUrl:'https://cdn.example/documentary.m3u8'},
    {id:'duplicate',type:'hls',streamUrl:'https://cdn.example/documentary.m3u8'},
    {id:'blocked',type:'embed',embedUrl:'https://hdtoday.sx/api/go?id=1'},
    {id:'unsafe',type:'embed',embedUrl:'javascript:alert(1)'},
  ]},'https://dahsha.netlify.app');
  assert.equal(servers.length,4);assert.equal(preferredServer(servers,'mf:m:documentary'),1);
  assert.deepEqual(servers.map(server=>server.type),['embed','mp4','dash','hls']);assert.equal(servers[1].headers.Referer,'https://source.example/');assert.equal(servers[3].streamUrl,'https://cdn.example/documentary.m3u8');
  assert.equal(playbackServers({streams:[{uri:'https://cdn.example/signed-playlist?id=1',mimeType:'application/x-mpegURL'}]})[0].type,'hls');
});

test('YouTube remains preferred for its original episode and failover visits each alternative at most once',()=>{
  const servers=playbackServers({servers:[{id:'direct',type:'mp4',streamUrl:'https://cdn.example/movie.mp4'},{id:'youtube',type:'youtube',videoId:'abcdefghijk'},{id:'embed',type:'embed',embedUrl:'https://vidsrc.mov/embed/movie/1'}]});
  assert.equal(preferredServer(servers,'abcdefghijk'),1);assert.equal(nextServer(servers,1,new Set([1])),2);assert.equal(nextServer(servers,2,new Set([1,2])),0);assert.equal(nextServer(servers,0,new Set([0,1,2])),-1);
  assert.equal(validProgress(120,3600),true);for(const [position,duration]of [[NaN,3600],[1,Infinity],[-1,100],[200,100],[1,0]])assert.equal(validProgress(position,duration),false);
});

test('Dahsha direct transport reaches Myflixer without changing documentary authorization or episode identity',async()=>{
  const show={id:'legacy-documentary',kind:'film',title:'Documentary',documentary:true,tags:['documentary'],episodes:[{id:'mf:m:documentary',season:1,number:1}],offerings:[{provider:'myflixer',id:'mf:m:documentary'}]};
  let options;
  const resolved=await unifiedStream('mf:m:documentary',{showId:show.id,catalog:{product:'dahsha',shows:[show]},product:'dahsha',transport:'direct',resolveTitle:async()=>show,resolveMyflixer:async(id,prefix,settings)=>{assert.equal(id,'mf:m:documentary');options=settings;return {servers:[{id:'hls',name:'Source',type:'hls',streamUrl:'https://cdn.example/show.m3u8',headers:{Referer:'https://source.example/'}}]};}});
  assert.equal(options.transport,'direct');assert.equal(resolved.servers[0].streamUrl,'https://cdn.example/show.m3u8');assert.equal(resolved.servers[0].headers.Referer,'https://source.example/');assert.equal(resolved.showId,show.id);
  const unavailable=await unifiedStream('mf:m:documentary',{showId:show.id,catalog:{product:'dahsha',shows:[show]},product:'dahsha',transport:'direct',resolveTitle:async()=>show,resolveMyflixer:async()=>({servers:[],error:'HTTP 403'})});assert.equal(unavailable.servers.length,0);assert.deepEqual(unavailable.providerErrors,[{provider:'myflixer',error:'HTTP 403'}]);
  const entertainment={...show,id:'fm:m:1',providerMetadata:true,documentary:false,tags:['comedy']};
  assert.equal(await unifiedStream('mf:m:documentary',{showId:entertainment.id,catalog:{product:'dahsha',shows:[entertainment]},product:'dahsha',transport:'direct',resolveTitle:async()=>entertainment}),null);
});

test('a stalled source cannot hold up verified cached FMovies alternatives or trigger full title hydration',async()=>{
  const show={id:'saved-documentary',kind:'series',title:'Documentary',documentary:true,tmdbId:77,offerings:[{provider:'fmovies',id:'fm:s:77',tmdbId:77}],episodes:[{id:'mf:e:documentary-s2e3',season:2,number:3}]};
  let signal;const started=Date.now();
  const result=await unifiedStream(show.episodes[0].id,{showId:show.id,catalog:{product:'dahsha',shows:[show]},product:'dahsha',providerTimeoutMs:30,resolveTitle:()=>{throw Error('Saved episode should not hydrate its full show');},resolveMyflixer:(_id,_prefix,options)=>{signal=options.signal;return new Promise(()=>{});}});
  assert.ok(Date.now()-started<1000);assert.equal(signal.aborted,true);assert.ok(result.servers.some(server=>server.provider==='fmovies'));assert.ok(result.servers.every(server=>!server.embedUrl||!server.embedUrl.includes('undefined')));assert.equal(result.providerErrors[0].provider,'myflixer');assert.match(result.providerErrors[0].error,/timed out/);
});

test('missing episodes have a bounded hydration deadline and are never fabricated from caller coordinates',async()=>{
  let signal;const show={id:'fm:s:77',kind:'series',title:'Documentary',documentary:true,episodes:[]};
  await assert.rejects(unifiedStream('fm:e:77:99:99',{showId:show.id,catalog:{product:'dahsha',shows:[show]},product:'dahsha',titleTimeoutMs:20,resolveTitle:(_id,options)=>{signal=options.signal;return new Promise(()=>{});}}),/timed out/);assert.equal(signal.aborted,true);
});
