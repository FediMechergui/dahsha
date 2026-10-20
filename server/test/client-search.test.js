import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { decodeEntities, episodeHeadline, isGenericEpisodeTitle, isNumberedEpisodeTitle, isPlaceholderEpisodeTitle, episodeLabel, networkInfo, newEpisodeLine } from '../../client/src/lib/text.js';
import { byRecency, discoveredOn, episodeRecency, favoriteCardIndex, favoriteIdsOf, hasRecency, liveAliases, mergeAliases, migrateStoredIds, newEpisodesBetween, providerFreshness, recencyOf, recentEpisodesOf, resolveAlias, showRecency, toggleFavorite, withChannelStats } from '../../client/src/lib/catalog-helpers.js';

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

// ── Dahsha render-side title helpers (client/src/lib/text.js) ───────────────────────────────────

test('Dahsha treats Myflixer IMDb-style "Episode #S.E" titles as numbered placeholders',()=>{
  for(const title of ['Episode #24.1','Episode #5.12','episode # 3.4','Episode 24.1','Episode #7','Episode 7'])assert.equal(isNumberedEpisodeTitle(title),true,title);
  for(const title of ['Episode #24.1','Episode #5.12'])assert.equal(isGenericEpisodeTitle(title),true,title);
  assert.equal(isPlaceholderEpisodeTitle('Episode #24.1'),true);
  assert.equal(isPlaceholderEpisodeTitle(''),true);
  assert.equal(isPlaceholderEpisodeTitle('Episode 7'),false,'a plain "Episode N" title already reads as a label');
  for(const title of ['Episode 24.1: The Return','Naples &#038; Campania','The 24.1 Files'])assert.equal(isNumberedEpisodeTitle(title),false,title);
});

test('Dahsha rebuilds empty and IMDb-style episode titles from the episode number',()=>{
  const show={title:'Hoarders',kind:'series'};
  // s_1bvdgii-style conflict: shown as S23 E81, titled 'Episode #24.1' upstream.
  assert.equal(episodeHeadline(show,{title:'Episode #24.1',season:23,number:81},{lang:'en'}).title,'Episode 81');
  assert.deepEqual(episodeHeadline(show,{title:'Episode #24.1',season:23,number:81},{lang:'en',withShow:true}),{title:'Hoarders',sub:'S23 · E81',generic:true,film:false});
  assert.equal(episodeHeadline(show,{title:'',number:3},{lang:'en'}).title,'Episode 3');
  assert.equal(episodeHeadline(show,{title:null,number:3},{lang:'ar'}).title,'الحلقة 3');
  assert.equal(episodeHeadline(show,{title:'   '},{lang:'ar',number:5}).title,'الحلقة 5','list position when the episode has no number');
  assert.equal(episodeHeadline(show,{title:'',number:2},{lang:'en',number:9}).title,'Episode 2','the episode number wins over the position');
  assert.equal(episodeHeadline(show,{title:'Episode #24.1'},{lang:'en'}).title,'Episode #24.1','nothing better is known');
  assert.equal(episodeHeadline(show,{title:''},{lang:'en'}).title,'Hoarders');
  // Real titles are untouched; films keep the show title.
  assert.equal(episodeHeadline(show,{title:'Naples &#038; Campania',number:1},{lang:'en'}).title,'Naples & Campania');
  assert.equal(episodeHeadline({title:'A Film',kind:'film'},{title:''},{lang:'en'}).title,'A Film');
  assert.equal(episodeLabel(0,'en'),'Episode 0');
  assert.equal(episodeLabel(null,'ar'),null);
  assert.equal(episodeLabel(-1,'ar'),null);
});

test('Dahsha formats TVmaze network metadata for the show page',()=>{
  assert.deepEqual(networkInfo({id:82837,svc:'TRUE CRIME',st:'Running',c:'GB'},'en'),{name:'TRUE CRIME',country:'United Kingdom',status:'Still airing',url:'https://www.tvmaze.com/shows/82837'});
  const ar=networkInfo({id:90590,svc:'Prime Video',st:'Ended'},'ar');
  assert.equal(ar.name,'Prime Video');
  assert.equal(ar.status,'انتهى عرضه');
  assert.equal(ar.country,null);
  assert.equal(networkInfo({id:1,svc:'A&amp;E',st:'To Be Determined',c:'US'},'en').name,'A&E');
  assert.equal(networkInfo({id:1,svc:'X',st:'Something new'},'en').status,null);
  assert.equal(networkInfo({id:2,svc:'5',c:'GB'},'en').name,'Channel 5','TVmaze calls Channel 5 just "5"');
  assert.equal(networkInfo({id:2,svc:'5',c:'GB'},'ar').name,'القناة 5');
  for(const value of [null,undefined,{},{svc:''},{svc:42},'Netflix'])assert.equal(networkInfo(value,'en'),null);
  assert.equal(networkInfo({svc:'BBC One',id:'7'},'en').url,null);
});

test('Dahsha decodes the entity forms Myflixer titles still carry',()=>{
  assert.equal(decodeEntities('&#8216;Twas the Fight Before Christmas'),'‘Twas the Fight Before Christmas');
  assert.equal(decodeEntities('Oscar &amp;amp; Emmy &#038; more &#215; 2'),'Oscar & Emmy & more × 2');
});

// ── Dahsha recency and provider freshness (client/src/lib/catalog-helpers.js, provider contract 6) ──

const GEN='2026-10-18T18:50:07.241Z';
test('Dahsha show recency is the newer of latestAt and the provider updatedAt, never later than the build',()=>{
  // fm:/hd: cards: latestAt null, dated only by the build's updatedAt (a discovery or a new provider episode).
  assert.equal(showRecency({id:'fm:m:9999001',latestAt:null,updatedAt:'2026-10-18T18:39:23.854Z'}),'2026-10-18T18:39:23.854Z');
  assert.equal(showRecency({latestAt:'2026-10-02T17:40:26.000Z',updatedAt:'2026-10-17T06:00:00.000Z'}),'2026-10-17T06:00:00.000Z');
  // Newer of the two even when a stale updatedAt sits beside a newer latestAt.
  assert.equal(showRecency({latestAt:'2026-10-17T06:00:00.000Z',updatedAt:'2026-10-02T17:40:26.000Z'}),'2026-10-17T06:00:00.000Z');
  // Older catalogues have no updatedAt at all: latestAt alone, as before.
  assert.equal(showRecency({latestAt:'2026-10-16T14:34:30.000Z'}),'2026-10-16T14:34:30.000Z');
  // A clock-skewed source date is capped at the catalogue build time.
  assert.equal(showRecency({latestAt:'2026-10-18T20:34:30.000Z'},GEN),GEN);
  assert.equal(showRecency({latestAt:'2026-10-18T10:00:00.000Z'},GEN),'2026-10-18T10:00:00.000Z');
  // Undated: the bulk-imported provider cards (and anything unparsable) are never recent.
  for(const show of [{id:'fm:m:1755291',latestAt:null},{latestAt:''},{latestAt:'soon',updatedAt:42},null,undefined])assert.equal(showRecency(show,GEN),null);
  assert.equal(hasRecency({id:'fm:m:1755291',latestAt:null,firstSeenAt:'2026-10-14T13:28:25.887Z',providerUpdatedAt:'2026-10-14T13:28:25.887Z'}),false,'crawl stamps are not dates');
});

test('Dahsha sorts by the stored recentAt and falls back to the fields for raw rows',()=>{
  const shows=[
    {id:'s_old',latestAt:'2026-09-01T00:00:00Z'},
    {id:'fm:m:1755291',latestAt:null},
    {id:'fm:m:9999001',latestAt:null,updatedAt:'2026-10-18T18:39:23.854Z'},
    {id:'s_yt',latestAt:'2026-10-18T16:00:31Z'},
    {id:'s_norm',latestAt:'2026-10-18T22:00:00Z',recentAt:GEN},
    {id:'hd:s:none',latestAt:'2026-10-18T23:00:00Z',recentAt:null},
  ];
  assert.deepEqual([...shows].sort(byRecency).map(s=>s.id),['s_norm','fm:m:9999001','s_yt','s_old','fm:m:1755291','hd:s:none']);
  assert.deepEqual(shows.filter(hasRecency).map(s=>s.id),['s_old','fm:m:9999001','s_yt','s_norm']);
  assert.equal(recencyOf({latestAt:'2026-10-01T00:00:00Z',recentAt:null}),null,'normalizeCatalog decided: undated');
  // Derived channel dates (channels without counts) follow the same recency.
  const [fm]=withChannelStats([{id:'fmovies'}],[{channelId:'fmovies',kind:'film',latestAt:null,updatedAt:'2026-10-18T18:39:23.854Z'},{channelId:'fmovies',kind:'film',latestAt:null}],'en');
  assert.equal(fm.latestAt,'2026-10-18T18:39:23.854Z');
  assert.equal(fm.shows,2);
});

test('Dahsha marks a card as discovered on FMovies/HDToday only when that listing is its recency',()=>{
  assert.equal(discoveredOn({id:'fm:m:9999001',updatedAt:'2026-10-18T18:39:23.854Z',discoveredAt:'2026-10-18T18:39:23.854Z'}),'fmovies');
  assert.equal(discoveredOn({id:'hd:m:x',recentAt:'2026-10-18T18:39:23.854Z',discoveredAt:'2026-10-18T18:39:23.854Z'}),'hdtoday');
  // A newer episode listing outranks the discovery: no "new on" label.
  assert.equal(discoveredOn({id:'hd:s:x',updatedAt:'2026-10-18T18:39:23.854Z',discoveredAt:'2026-10-16T00:00:00.000Z'}),null);
  for(const show of [{id:'fm:m:1',latestAt:null},{id:'s_x',latestAt:'2026-10-18T00:00:00.000Z',discoveredAt:'2026-10-18T00:00:00.000Z'},{id:'fm:m:1',discoveredAt:'bad'}])assert.equal(discoveredOn(show),null);
});

test('Dahsha orders episodes by the later of publishedAt and addedAt',()=>{
  // s_giwba2-style: every Myflixer episode inherits the series post date; S2E2 was really listed on 2026-10-12.
  const series={id:'s_giwba2',episodes:[
    {id:'mf:e:final-twist-s1e1',publishedAt:'2026-01-17T20:00:42.000Z'},
    {id:'mf:e:final-twist-s2e2',publishedAt:'2026-01-17T20:00:42.000Z',addedAt:'2026-10-12T08:00:00.000Z'},
  ]};
  const yt={id:'s_yt',episodes:[{id:'61ODlrzb7Pk',publishedAt:'2026-10-11T16:00:31Z'},{id:'aaaaaaaaaaa',publishedAt:null},{id:'bbbbbbbbbbb',addedAt:'bad'}]};
  assert.equal(episodeRecency(series.episodes[1]),'2026-10-12T08:00:00.000Z');
  assert.equal(episodeRecency({publishedAt:'2026-10-12T08:00:00.000Z',addedAt:'2026-10-01T00:00:00.000Z'}),'2026-10-12T08:00:00.000Z');
  assert.equal(episodeRecency({publishedAt:'2026-10-12T08:00:00Z'}),'2026-10-12T08:00:00Z','without addedAt the string is used as is');
  assert.equal(episodeRecency({addedAt:'2026-10-12T08:00:00.000Z'}),'2026-10-12T08:00:00.000Z');
  assert.equal(episodeRecency({id:'x'}),null);
  const recent=recentEpisodesOf([yt,series],{perShow:2,limit:40});
  assert.deepEqual(recent.map(x=>x.episode.id),['mf:e:final-twist-s2e2','61ODlrzb7Pk','mf:e:final-twist-s1e1']);
  assert.ok(recent.every(x=>Object.keys(x).join()==='show,episode'));
  // New-episode toasts after a static deploy name the newest discovery first.
  const fresh=newEpisodesBetween({shows:[{id:'s_giwba2',episodes:[series.episodes[0]]},{id:'s_yt',episodes:[]}]},{shows:[series,yt]});
  assert.deepEqual(fresh.map(x=>x.episode.id),['mf:e:final-twist-s2e2','61ODlrzb7Pk','aaaaaaaaaaa','bbbbbbbbbbb']);
});

test('Dahsha reads per-provider freshness and falls back to the shared fields of older catalogues',()=>{
  const now=Date.parse('2026-10-18T19:00:00.000Z');
  const sync={lastRefreshAt:'2026-10-18T18:39:23.854Z',errors:{hdtoday:'HDToday HTTP 403'},providers:{
    fmovies:{lastAttemptAt:'2026-10-18T18:39:23.854Z',lastSuccessAt:'2026-10-18T18:39:23.854Z',lastNewRecordAt:'2026-10-16T18:36:09.302Z',lastError:null,lastErrorAt:null,consecutiveFailures:0,records:1779},
    hdtoday:{lastAttemptAt:'2026-10-18T18:39:23.854Z',lastSuccessAt:'2026-10-14T20:33:56.051Z',lastNewRecordAt:'2026-10-14T20:33:56.051Z',lastError:'HDToday HTTP 403',lastErrorAt:'2026-10-18T18:39:23.854Z',consecutiveFailures:1,records:814},
  }};
  assert.deepEqual(providerFreshness(sync,'fmovies',now),{legacy:false,ok:true,lastSuccessAt:'2026-10-18T18:39:23.854Z',lastNewRecordAt:'2026-10-16T18:36:09.302Z',lastAttemptAt:'2026-10-18T18:39:23.854Z',lastError:null,consecutiveFailures:0,stale:false});
  const hd=providerFreshness(sync,'hdtoday',now);
  assert.equal(hd.lastSuccessAt,'2026-10-14T20:33:56.051Z','its own last success, not the shared lastRefreshAt');
  assert.equal(hd.ok,false); assert.equal(hd.stale,true); assert.equal(hd.consecutiveFailures,1);
  // Failing for less than a day is an error but not yet stale (the CI warning rule).
  assert.equal(providerFreshness({providers:{hdtoday:{lastSuccessAt:'2026-10-18T06:00:00.000Z',lastError:'HDToday HTTP 403'}}},'hdtoday',now).stale,false);
  assert.equal(providerFreshness({providers:{hdtoday:{lastSuccessAt:null,lastError:'HDToday HTTP 403'}}},'hdtoday',now).stale,true,'never answered');
  // Older catalogues: only lastRefreshAt (stamped even on failure) and errors.
  const legacy={lastRefreshAt:'2026-10-18T12:45:41.505Z',errors:{hdtoday:'HDToday HTTP 403'},sourceRecords:2593};
  assert.deepEqual(providerFreshness(legacy,'fmovies',now),{legacy:true,ok:true,lastSyncAt:'2026-10-18T12:45:41.505Z',lastError:null});
  assert.deepEqual(providerFreshness(legacy,'hdtoday',now),{legacy:true,ok:false,lastSyncAt:'2026-10-18T12:45:41.505Z',lastError:'HDToday HTTP 403'});
  // Myflixer is not part of providerSync, and nothing is invented from missing or malformed data.
  for(const [value,id] of [[sync,'myflixer'],[legacy,'myflixer'],[null,'fmovies'],['x','fmovies'],[sync,'']])assert.equal(providerFreshness(value,id,now),null);
  assert.equal(providerFreshness({providers:{fmovies:{lastSuccessAt:'never',lastError:7}}},'fmovies',now).lastSuccessAt,null);
});

test('Dahsha removes a favourite stored under a version or offering id from the holder card',()=>{
  // fm:s:32608 was a provider card; it is now an uncertain version of s_xgjqzn. fm:m:777 is listed as a
  // version too but is a live card of its own; mf:s:x is an offering of the holder.
  const holder={id:'s_xgjqzn',title:'Ancient Aliens',versions:[{id:'fm:s:32608'},{id:'fm:m:777'}],offerings:[{id:'mf:s:x',provider:'myflixer'}]};
  const other={id:'fm:m:777',title:'Ancient Aliens'};
  const index=favoriteCardIndex([holder,other]);
  assert.equal(index.get('fm:s:32608'),holder); assert.equal(index.get('mf:s:x'),holder); assert.equal(index.get('fm:m:777'),other,'a live card is its own favourite');
  const ids=favoriteIdsOf(holder,{cardOf:(id)=>index.get(id)});
  assert.deepEqual(ids,['s_xgjqzn','mf:s:x','fm:s:32608']);
  // The heart on the holder page: one click removes the old id (it was "In My List"), the next adds the holder.
  let favs=['fm:s:32608','s_other'];
  favs=toggleFavorite(favs,holder.id,ids); assert.deepEqual(favs,['s_other']);
  favs=toggleFavorite(favs,holder.id,ids); assert.deepEqual(favs,['s_xgjqzn','s_other']);
  // Stored under both: one removal drops both, so My List no longer lists the card.
  assert.deepEqual(toggleFavorite(['s_xgjqzn','fm:s:32608','mf:s:x'],holder.id,ids),[]);
  assert.deepEqual(toggleFavorite(['fm:m:777'],holder.id,ids),['s_xgjqzn','fm:m:777'],'another card\'s favourite is kept');
  // The catalogue row may carry versions the full record lacks; the first card listing an id holds it.
  const second={id:'s_second',versions:[{id:'fm:s:32608'}]};
  assert.deepEqual(favoriteIdsOf({id:'s_xgjqzn'},{rows:[holder],cardOf:(id)=>favoriteCardIndex([holder,second,other]).get(id)}),['s_xgjqzn','mf:s:x','fm:s:32608']);
  assert.deepEqual(favoriteIdsOf(second,{cardOf:(id)=>favoriteCardIndex([holder,second,other]).get(id)}),['s_second']);
  assert.deepEqual(toggleFavorite(['a'],'b'),['b','a']); assert.deepEqual(toggleFavorite(['b','a'],'b'),['a']);
});

test('Dahsha never migrates favourites off an id that is live in a loaded section of another deploy',()=>{
  const section=(lang,ids,idAliases)=>({lang,idAliases,shows:ids.map((id)=>({id,lang}))});
  // Case 1, an id comes back: deploy N renamed s_X → s_Y, deploy N+1 renames it back (show-ids.js swaps the alias).
  // Arabic is still on N (s_Y live); English loaded after N+1.
  const arN=section('ar',['s_Y'],{s_X:'s_Y'}), enN1=section('en',['s_en'],{s_Y:'s_X'});
  assert.equal(resolveAlias('s_Y',mergeAliases([arN,enN1])),'s_X','the plain union moves the live id');
  let map=liveAliases([arN,enN1]);
  assert.deepEqual(map,{s_X:'s_Y'});
  assert.deepEqual(migrateStoredIds({favorites:['s_Y'],progress:{e1:{showId:'s_Y'}}},map),{favorites:['s_Y'],progress:{e1:{showId:'s_Y'}},changed:false});
  // Once Arabic is on N+1 too, the rename applies.
  map=liveAliases([section('ar',['s_X'],{s_Y:'s_X'}),enN1]);
  assert.deepEqual(migrateStoredIds({favorites:['s_Y']},map).favorites,['s_X']);
  // Case 2, a plain rename: English renames s_A → s_B at N+1; English is still on N, Arabic on N+1.
  const enN=section('en',['s_A'],{}), arN1=section('ar',['s_ar'],{s_A:'s_B'});
  assert.deepEqual(liveAliases([enN,arN1]),{});
  assert.equal(migrateStoredIds({favorites:['s_A']},liveAliases([enN,arN1])).changed,false);
  assert.deepEqual(migrateStoredIds({favorites:['s_A']},liveAliases([section('en',['s_B'],{s_A:'s_B'}),arN1])).favorites,['s_B']);
  // An offering id of a live card counts as live (it opens that card), and a chain stops at a live id.
  const withOffering={lang:'en',idAliases:{'fm:m:1':'s_Z',s_Q:'s_W',s_W:'s_V'},shows:[{id:'s_W',offerings:[{id:'fm:m:1'}]}]};
  assert.deepEqual(liveAliases([withOffering]),{s_Q:'s_W'});
  assert.deepEqual(liveAliases([section('en',['s_1'],{})]),{});
  assert.deepEqual(liveAliases([]),{});
});

test('Dahsha new-episode toasts headline an empty Myflixer episode title with the show',()=>{
  // The server-mode diff row of a new Myflixer episode whose 'Episode 2' placeholder is exported as ''.
  const visible=(s)=>s.replace(/[⁦-⁩]/g,'');
  const row={id:'mf:e:outback-truckers-s1e2',title:'',showId:'s_1cy8bz5',showTitle:'Outback Truckers',channel:'Myflixer'};
  const line=newEpisodeLine({title:row.showTitle},{title:row.title,season:row.season,number:row.number},{lang:'en',channel:row.channel});
  assert.equal(visible(line),'Outback Truckers (Myflixer)');
  assert.doesNotMatch(visible(line),/^\s*—/);
  // With the number (diff rows that carry it, the static toast): the same label as the episode cards.
  assert.equal(visible(newEpisodeLine({title:'Outback Truckers'},{title:'',season:1,number:2},{lang:'en',channel:'Myflixer'})),'Outback Truckers — S1 · E2 (Myflixer)');
  assert.equal(visible(newEpisodeLine({title:'Outback Truckers'},{title:'',season:1,number:2},{lang:'ar'})),'Outback Truckers — الموسم 1 · الحلقة 2');
  assert.equal(visible(newEpisodeLine({title:'Outback Truckers'},{title:'Episode 2',season:1,number:2},{lang:'en'})),'Outback Truckers — Episode 2','a numbered title stays the label, as on the cards');
  // A real episode title leads, the show follows; the show prefix is not repeated.
  assert.equal(visible(newEpisodeLine({title:'Ocean Giants'},{title:'Whales'},{lang:'en',channel:'Ocean Channel'})),'Whales — Ocean Giants (Ocean Channel)');
  assert.equal(visible(newEpisodeLine({title:'Ocean Giants'},{title:'Ocean Giants - Whales'},{lang:'en'})),'Whales — Ocean Giants');
  assert.match(newEpisodeLine({title:'Ocean Giants'},{title:'Whales'},{lang:'en'}),/^⁨Whales⁩ — ⁨Ocean Giants⁩$/,'each part is bidi-isolated');
});
