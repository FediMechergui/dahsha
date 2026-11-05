import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {refreshSeriesEpisodes,verifiedGuideEpisodes,fetchEpisodeGuide} from '../src/episode-refresh.js';

const now=Date.parse('2026-11-05T14:00:00Z'),before='2026-11-04T00:00:00.000Z';
const episode=(owner,season,number,extra={})=>({id:owner.startsWith('fm:')?`fm:e:${owner.split(':')[2]}:${season}:${number}`:`${owner}:${season}:${number}`,season,number,title:`Episode ${number}`,...extra});
const series=(id='fm:s:77',extra={})=>({id,kind:'series',title:'Documentary series',year:2024,documentary:true,tags:['documentary'],sourceUrl:id.startsWith('fm:')?'https://www.f-movies.org/tv/documentary-series-77':'https://hdtoday.sx/watch/tv-documentary-abc12345',episodes:[],seasons:[],...extra});
const options={now,intervalMs:0};

test('first guide imports real episode links without presenting the historical import as new releases',async()=>{
  const old=series(),fresh=series(old.id,{episodes:[episode(old.id,1,1),episode(old.id,3,7)]});
  const {items,report}=await refreshSeriesEpisodes([old],{...options,resolveDetails:async()=>fresh});
  assert.deepEqual(items[0].episodes.map(e=>e.id),['fm:e:77:1:1','fm:e:77:3:7']);
  assert.equal(items[0].episodeCount,2);
  assert.equal(items[0].episodeGuideInitializedAt,new Date(now).toISOString());
  assert.equal(items[0].episodesAddedAt,undefined);
  assert.equal(items[0].latestEpisode,undefined);
  assert.equal(report.addedEpisodes,2);assert.equal(report.changedShows,0);
  assert.deepEqual(old.episodes,[],'input cache is unchanged');
});

test('a later season advances recency, but filling an old gap does not',async()=>{
  const old=series('fm:s:77',{episodes:[episode('fm:s:77',1,1),episode('fm:s:77',2,4)],episodeGuideInitializedAt:before,episodesAddedAt:before});
  const backfill=series(old.id,{episodes:[episode(old.id,1,2)]});
  const first=await refreshSeriesEpisodes([old],{...options,resolveDetails:async()=>backfill});
  assert.equal(first.items[0].episodesAddedAt,before);assert.equal(first.report.changedShows,0);
  const fresh=series(old.id,{episodes:[episode(old.id,3,1)]});
  const second=await refreshSeriesEpisodes(first.items,{...options,resolveDetails:async()=>fresh});
  assert.equal(second.items[0].episodesAddedAt,new Date(now).toISOString());
  assert.equal(second.items[0].episodes.length,4);assert.equal(second.report.changedShows,1);
});

test('guide updates retain episode IDs and metadata when a response is partial',async()=>{
  const old=series('fm:s:77',{episodes:[episode('fm:s:77',1,1,{title:'The ocean',synopsis:'Verified cached synopsis'})],episodeGuideInitializedAt:before});
  const fresh=series(old.id,{episodes:[episode(old.id,2,1)],episodeGuideComplete:false,episodeSeasonChecks:{2:new Date(now).toISOString()},providerErrors:[{season:3,error:'FMovies HTTP 503'}]});
  const {items,report}=await refreshSeriesEpisodes([old],{...options,resolveDetails:async()=>fresh});
  assert.equal(items[0].episodes[0].id,old.episodes[0].id);
  assert.equal(items[0].episodes[0].synopsis,'Verified cached synopsis');
  assert.equal(items[0].episodes.length,2);
  assert.equal(items[0].episodeGuideInitializedAt,before);
  assert.equal(items[0].episodeGuideComplete,false);
  assert.match(items[0].episodesLastError,/503/);assert.equal(report.errors.length,1);
});

test('empty pages and mismatched identities/documentary genres preserve cached guides',async()=>{
  const old=series('fm:s:77',{episodes:[episode('fm:s:77',1,1)],episodesRefreshedAt:before,episodesAddedAt:before});
  for(const fresh of [series(),series('fm:s:88',{episodes:[episode('fm:s:88',1,1)]}),series(old.id,{kind:'film'}),series(old.id,{documentary:false,episodes:[episode(old.id,1,2)]})]){
    const {items,report}=await refreshSeriesEpisodes([old],{...options,resolveDetails:async()=>fresh});
    assert.deepEqual(items[0].episodes,old.episodes);
    assert.equal(items[0].episodesRefreshedAt,before);assert.equal(items[0].episodesAddedAt,before);
    assert.equal(report.errors.length,1);assert.equal(report.succeeded,0);
  }
});

test('episode IDs, ownership and numeric slots must all agree',()=>{
  const fm=series(),hd=series('hd:s:tv-documentary-abc12345');
  assert.deepEqual(verifiedGuideEpisodes(fm,[episode('fm:s:88',1,1),episode(fm.id,1,1,{number:2}),{id:fm.id,season:1,number:1},episode(fm.id,-1,1)]),[]);
  const valid=episode(hd.id,2,3,{offerings:[{provider:'hdtoday',id:`${hd.id}:2:3`},{provider:'hdtoday',id:'hd:s:tv-other-abc12345:2:3'}]});
  assert.equal(verifiedGuideEpisodes(hd,[valid])[0].offerings.length,1);
  assert.equal(verifiedGuideEpisodes(hd,[episode('hd:s:tv-other-abc12345',2,3)]).length,0);
});

test('a provider denial stops further requests in its lane without blocking the other provider',async()=>{
  const hd=series('hd:s:tv-documentary-abc12345');
  const calls=[];
  const {items,report}=await refreshSeriesEpisodes([series(),series('fm:s:78'),hd,series('hd:s:tv-other-abc12345')],{
    ...options,concurrency:1,resolveDetails:async row=>{calls.push(row.id);if(row.id.startsWith('hd:'))throw Error('HDToday HTTP 403');return {...row,episodes:[episode(row.id,1,1)]};},
  });
  assert.deepEqual(calls,['fm:s:77',hd.id,'fm:s:78']);
  assert.equal(report.checked,3);assert.equal(report.deferred,1);
  assert.deepEqual(report.skippedProviders,['hdtoday']);assert.equal(items[3].episodesCheckedAt,undefined);
});

test('time limits abort stalled requests and leave independently successful guides available',async()=>{
  const rows=[series(),series('hd:s:tv-documentary-abc12345')];let cancelled=false;
  const started=performance.now();
  const result=await refreshSeriesEpisodes(rows,{...options,timeoutMs:20,budgetMs:1000,resolveDetails:(row,{signal})=>{
    if(row.id.startsWith('hd:'))return {...row,episodes:[episode(row.id,1,1)]};
    signal.addEventListener('abort',()=>{cancelled=true;});return new Promise(()=>{});
  }});
  assert.ok(performance.now()-started<1000);assert.equal(cancelled,true);
  assert.equal(result.report.succeeded,1);assert.equal(result.report.errors.length,1);
  assert.equal(result.items[1].episodes.length,1);assert.deepEqual(result.items[0].episodes,[]);
});

test('global budget and interval prevent unbounded or repeated work',async()=>{
  let calls=0;
  const rows=Array.from({length:20},(_,index)=>series(`fm:s:${index+1}`));
  const result=await refreshSeriesEpisodes(rows,{...options,budgetMs:15,timeoutMs:100,concurrency:1,resolveDetails:()=>{calls++;return new Promise(()=>{});}});
  assert.equal(calls,1);assert.equal(result.report.deferred,19);
  await refreshSeriesEpisodes([series('fm:s:1',{episodesCheckedAt:new Date(now-1000).toISOString()})],{now,resolveDetails:()=>{throw Error('must not be called');}});
});

test('oldest check is rotated fairly across providers, with explicit count and documentary gates',async()=>{
  const called=[];
  const rows=[series('fm:s:1',{episodesCheckedAt:before}),series('fm:s:2'),series('fm:s:3',{documentary:false}),series('hd:s:tv-show-abc12345'),series('fm:m:4',{kind:'film'})];
  const result=await refreshSeriesEpisodes(rows,{...options,limit:2,concurrency:1,resolveDetails:async row=>{called.push(row.id);return {...row,episodes:[episode(row.id,1,1)]};}});
  assert.deepEqual(called,['fm:s:2','hd:s:tv-show-abc12345']);assert.equal(result.report.deferred,1);
});

test('long FMovies guides rotate a bounded set of actual season pages without inventing missing slots',async()=>{
  const calls=[],at=new Date(now).toISOString(),signal=new AbortController().signal;
  const old=series('fm:s:77');
  const fetch=async(row,options)=>{
    calls.push(options.season??'default');
    assert.equal(options.allSeasons,false);assert.ok(options.signal);
    const season=options.season??1;
    return {...row,seasons:[1,2,3,4,5,6,7],episodes:[episode(row.id,season,1),episode(row.id,season,7)]};
  };
  const first=await fetchEpisodeGuide(old,{signal,at,fmoviesDetails:fetch});
  assert.deepEqual(calls,['default',7,6,5,4]);
  assert.equal(first.episodes.length,10);assert.equal(first.episodeGuideComplete,false);
  assert.ok(first.episodes.every(ep=>[1,7].includes(ep.number)),'gaps are not manufactured');
  calls.length=0;
  const next=await fetchEpisodeGuide(first,{signal,at:new Date(now+3600000).toISOString(),fmoviesDetails:fetch});
  assert.deepEqual(calls,['default',3,2,7,6]);
  assert.equal(next.episodeGuideComplete,true);
  assert.equal(Object.keys(next.episodeSeasonChecks).length,7);
});

test('a failed season preserves successful pages and leaves that checkpoint pending',async()=>{
  const row=series(),signal=new AbortController().signal;
  const fresh=await fetchEpisodeGuide(row,{signal,at:new Date(now).toISOString(),fmoviesDetails:async(_,{season=1})=>{
    if(season===2)throw Error('FMovies HTTP 503');
    return {...row,seasons:[1,2,3],episodes:[episode(row.id,season,1)]};
  }});
  assert.deepEqual(fresh.episodes.map(e=>e.season).sort(),[1,3]);
  assert.equal(fresh.episodeSeasonChecks[2],undefined);
  assert.equal(fresh.episodeGuideComplete,false);assert.equal(fresh.providerErrors.length,1);
});

test('HDToday guide rotation uses exact observed same-title season URLs and keeps only real episode cards',async()=>{
  const row=series('hd:s:tv-documentary-abc12345'),calls=[],signal=new AbortController().signal;
  const seasonSources={1:row.sourceUrl+'?s=1&e=1',2:row.sourceUrl+'?season=2&episode=1&dv1=1',3:row.sourceUrl+'?s=3&e=1'};
  const fresh=await fetchEpisodeGuide(row,{signal,at:new Date(now).toISOString(),hdtodayDetails:async source=>{
    calls.push(source);const season=typeof source==='string'?Number(new URL(source).searchParams.get('s')??new URL(source).searchParams.get('season')):1;
    return {...row,seasonSources,seasons:[1,2,3],episodeGuideComplete:false,episodes:[episode(row.id,season,7)]};
  }});
  assert.deepEqual(calls,[row,seasonSources[3],seasonSources[2]]);
  assert.equal(fresh.episodeGuideComplete,true);assert.equal(fresh.episodes.length,3);
  assert.ok(fresh.episodes.every(episode=>episode.number===7),'season links must not invent episode1');
  assert.deepEqual(Object.keys(fresh.episodeSeasonChecks),['1','2','3']);
});

test('HDToday never guesses missing season URLs or follows foreign titles/origins',async()=>{
  const row=series('hd:s:tv-documentary-abc12345'),signal=new AbortController().signal;
  for(const seasonSource of [undefined,'https://evil.test/watch/tv-documentary-abc12345?s=2&e=1','https://hdtoday.sx/watch/tv-other-abc12345?s=2&e=1',row.sourceUrl+'?s=99&e=1']){
    let calls=0;
    const fresh=await fetchEpisodeGuide(row,{signal,at:new Date(now).toISOString(),hdtodayDetails:async()=>{calls++;return {...row,seasonSources:{2:seasonSource},seasons:[1,2],episodes:[episode(row.id,1,3)]};}});
    assert.equal(calls,1);assert.equal(fresh.episodes.length,1);assert.equal(fresh.episodeGuideComplete,false);
    assert.equal(fresh.providerErrors[0].provider,'hdtoday');
  }
});

test('listing cards preserve saved guides and the scheduled scan writes newly resolved episodes to its cache',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dahsha-episodes-'));
  process.env.DATA_DIR=dir;
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {putProviderRows,refreshProviders}=await import('../src/provider-sync.js');
  const old=series('fm:s:77',{episodes:[episode('fm:s:77',1,1)],episodeCount:1,seasons:[1],episodeGuideInitializedAt:before,discoveredAt:null,firstSeenAt:before});
  const map=new Map([[old.id,old]]);
  putProviderRows(map,[series()]);
  assert.deepEqual(map.get(old.id).episodes.map(e=>e.id),['fm:e:77:1:1']);
  assert.deepEqual(map.get(old.id).seasons,[1]);
  const hd=series('hd:s:tv-documentary-abc12345',{latestEpisode:'2:5',episodesAddedAt:before});
  const hdMap=new Map([[hd.id,hd]]);
  putProviderRows(hdMap,[{...hd,latestEpisode:'1:2'}]);
  assert.equal(hdMap.get(hd.id).episodesAddedAt,before,'an older listing card must not become a new release');
  assert.equal(hdMap.get(hd.id).latestEpisode,'2:5','historical pages cannot roll the latest cursor backwards');
  putProviderRows(hdMap,[hd]);
  assert.equal(hdMap.get(hd.id).episodesAddedAt,before,'the unchanged latest card remains unchanged on the next pass');
  fs.writeFileSync(path.join(dir,'providers-dahsha.json'),JSON.stringify({items:[old],completed:true,queue:[],errors:{}}));
  const cache=await refreshProviders({pageBudget:0,fetch:async job=>({items:job.provider==='fmovies'&&job.kind==='series'?[series()]:[],hasNext:false,totalPages:1}),sleep:async()=>{},log:()=>{},episodeOptions:{...options,resolveDetails:async row=>({...row,episodes:[episode(row.id,1,2)]})}});
  assert.equal(cache.items[0].episodes.length,2);
  assert.equal(cache.episodeRefresh.addedEpisodes,1);
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'providers-dahsha.json'),'utf8'));
  assert.deepEqual(saved.items[0].episodes.map(e=>e.id),['fm:e:77:1:1','fm:e:77:1:2']);
});
