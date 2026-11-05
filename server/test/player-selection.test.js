import test from 'node:test';
import assert from 'node:assert/strict';
import {preferredServer,nextServer,createPlaybackHistory,createPlaybackEvidence,playbackFailureText,MAX_AUTOMATIC_SOURCES} from '../../client/src/lib/player-policy.js';
import {agreedMovieIdentityFromPlayers,documentedMovieServers} from '../src/hdtoday.js';
import {unifiedStream} from '../src/library-service.js';

const embed=(id,provider,host='player.example')=>({id,provider,type:'embed',embedUrl:`https://${host}/movie/77`});
const fixture=()=>[embed('mf1','myflixer','one.example'),embed('mf2','myflixer','two.example'),embed('fm1','fmovies','three.example'),embed('hd1','hdtoday','four.example'),embed('fast','hdtoday','vidfast.pro')];
const storage=()=>{let data='';return {getItem:()=>data,setItem:(_key,value)=>{data=value;},data:()=>JSON.parse(data)};};

test('observed public movie route precedes unverified wrappers without changing source labels',()=>{
  const rows=fixture();assert.equal(preferredServer(rows,'hd:m:test'),4);
  assert.equal(preferredServer(rows.slice(0,4),'hd:m:test'),0);
  rows.push({id:'file',provider:'myflixer',type:'mp4',streamUrl:'https://cdn.example/film.mp4'});
  assert.equal(preferredServer(rows,'hd:m:test'),5);
  assert.equal(rows[4].provider,'hdtoday');assert.equal(MAX_AUTOMATIC_SOURCES,4);
  const imdb={...rows[4],embedUrl:'https://vidfast.pro/movie/tt123456'};
  assert.equal(preferredServer([imdb,rows[4]],'mf:m:test'),1);
});

test('failover varies provider and host, excludes tried routes, and respects a temporary failure cooldown',()=>{
  const rows=fixture(),memo=createPlaybackHistory({storage:storage(),now:()=>10000});
  const attempted=new Set([4,0]);
  assert.equal(nextServer(rows,0,attempted,{videoId:'episode',history:memo}),2);
  attempted.add(2);assert.equal(nextServer(rows,2,attempted,{videoId:'episode',history:memo}),3);
  memo.failure('episode',rows[4]);assert.equal(preferredServer(rows,'episode',memo),0);
  assert.equal(nextServer(rows,4,new Set(rows.map((_row,index)=>index)),{videoId:'episode',history:memo}),-1);
});

test('successful sources are remembered only for their episode and exact route; hints expire and remain bounded',()=>{
  const disk=storage();let clock=10000;const rows=fixture(),memo=createPlaybackHistory({storage:disk,now:()=>clock});
  memo.success('first',rows[2]);assert.equal(preferredServer(rows,'first',memo),2);assert.equal(preferredServer(rows,'other',memo),4);
  assert.equal(memo.status('first',{...rows[2],embedUrl:'https://three.example/movie/88'}).successful,undefined);
  clock++;memo.failure('first',rows[2]);assert.equal(memo.status('first',rows[2]).failed,true);
  clock+=15*60*1000;assert.equal(memo.status('first',rows[2]).failed,false);
  memo.success('first',rows[2]);assert.equal(createPlaybackHistory({storage:disk,now:()=>clock}).status('first',rows[2]).successful,true);
  clock+=30*86400*1000;assert.equal(memo.status('first',rows[2]).successful,false);
  for(let i=0;i<90;i++)memo.success(`episode-${i}`,rows[0]);assert.equal(disk.data().rows.length,64);
  assert.doesNotThrow(()=>createPlaybackHistory({storage:{getItem(){throw Error('Disabled');},setItem(){throw Error('Full');}}}).failure('episode',rows[0]));
});

test('source success requires sustained real content progress and excludes ad clocks, page opens and seek jumps',()=>{
  let clock=0;const evidence=createPlaybackEvidence({expectedDurationSec:3600,now:()=>clock});
  assert.equal(evidence.observe({position:1,duration:30,playing:true}),false);
  clock=1000;assert.equal(evidence.observe({position:100,duration:3600,playing:false}),false);
  clock=2000;assert.equal(evidence.observe({position:100,duration:3600,playing:true}),false);
  clock=3000;assert.equal(evidence.observe({position:1000,duration:3600,playing:true}),false);
  clock=4000;assert.equal(evidence.observe({position:1001,duration:3600,playing:true}),false);
  clock=9000;assert.equal(evidence.observe({position:1006,duration:3600,playing:true}),true);
  clock=10000;assert.equal(evidence.observe({position:1007,duration:3600,playing:true}),false);
  const unknown=createPlaybackEvidence({now:()=>clock});assert.equal(unknown.observe({position:9,duration:30,playing:true}),false);
  const short=createPlaybackEvidence({expectedDurationSec:30,now:()=>clock});assert.equal(short.observe({position:1,duration:30,playing:true}),false);
  clock+=6000;assert.equal(short.observe({position:7,duration:30,playing:true}),true);
});

test('errors describe the current source without leaking raw URLs or claiming every route works',()=>{
  assert.match(playbackFailureText({sourceError:'BROWSER_VERIFICATION'}),/browser verification/);
  assert.match(playbackFailureText({sourceError:'HTTP_ERROR',httpStatus:403}),/HTTP 403/);
  assert.match(playbackFailureText({message:'not implemented'}),/not supported/);
  assert.equal(playbackFailureText({message:'https://private.example/token'}).includes('private'),false);
});

test('movie identity inference requires agreement from distinct exact supported numeric routes',()=>{
  const link=embed('a','myflixer','moviesapi.to'),other={...link,embedUrl:'https://balance.medmedia03.wiki/embed/movie/77'};
  assert.equal(agreedMovieIdentityFromPlayers([link,other]),77);
  for(const rows of [[link],[link,link],[link,{...other,embedUrl:'https://balance.medmedia03.wiki/embed/movie/88'}],[link,{...other,embedUrl:'https://balance.medmedia03.wiki.evil.example/embed/movie/77'}],[link,{...other,embedUrl:'https://balance.medmedia03.wiki/embed/movie/tt77'}],[link,{...other,embedUrl:'https://balance.medmedia03.wiki/tv/77/1/1'}]])assert.equal(agreedMovieIdentityFromPlayers(rows),null);
  assert.equal(agreedMovieIdentityFromPlayers([embed('a','myflixer','vidfast.pro'),embed('b','myflixer','vidfast.vc')]),null);
  for(const tmdbId of [null,0,-1,'tt77',Infinity])assert.deepEqual(documentedMovieServers({tmdbId}),[]);
});

test('documentary films receive accurately labeled alternatives only from saved or source-agreed numeric identities',async()=>{
  const show={id:'saved-film',kind:'film',documentary:true,providerMetadata:true,tmdbId:77,offerings:[{provider:'fmovies',id:'fm:m:77',tmdbId:77}],episodes:[{id:'fm:m:77',season:1,number:1}]};
  const options={showId:show.id,catalog:{product:'dahsha',shows:[show]},product:'dahsha'};
  const result=await unifiedStream('fm:m:77',options),fallback=result.servers.filter(server=>['vidfast','vidsrc','vidlink'].includes(server.provider));
  assert.equal(fallback.length,3);assert.ok(fallback.every(server=>server.availability==='unverified'&&server.embedUrl.includes('/77')));
  const sourceShow={...show,tmdbId:null,offerings:[{provider:'myflixer',id:'mf:m:film'}],episodes:[{id:'mf:m:film',season:1,number:1}]};
  const sourceOptions={...options,catalog:{product:'dahsha',shows:[sourceShow]},resolveMyflixer:async()=>({servers:[embed('one','myflixer','moviesapi.to'),{id:'two',embedUrl:'https://balance.medmedia03.wiki/embed/movie/77',type:'embed'}]})};
  const sourceResult=await unifiedStream('mf:m:film',sourceOptions);assert.equal(sourceResult.servers.filter(server=>server.provider==='vidfast').length,1);assert.equal(sourceShow.tmdbId,null);
  const legacy={...sourceShow,documentary:undefined,providerMetadata:undefined,tags:['documentary']};
  const legacyResult=await unifiedStream('mf:m:film',{...sourceOptions,catalog:{product:'dahsha',shows:[legacy]}});assert.equal(legacyResult.servers.filter(server=>server.provider==='vidfast').length,1);
  const noIdentity=await unifiedStream('mf:m:film',{...sourceOptions,resolveMyflixer:async()=>({servers:[embed('one','myflixer','moviesapi.to')]})});assert.equal(noIdentity.servers.length,1);
  assert.equal(await unifiedStream('fm:m:77',{...options,catalog:{product:'dahsha',shows:[{...show,documentary:false}]}}),null);
});
