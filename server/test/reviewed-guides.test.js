import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {applyReviewedGuides,validateReviewedGuides,applyGuideFile} from '../../scripts/apply-reviewed-guides.js';
import {stampCatalogueGeneration} from '../src/catalogue-generation.js';

const observed='2026-11-05T14:30:44.444Z',older='2026-11-01T00:00:00.000Z',newer='2026-11-06T00:00:00.000Z';
const source='https://www.f-moviess.org/tv/documentary-77';
const episode=(number=1)=>({id:`fm:e:77:1:${number}`,season:1,number,title:`Observed episode ${number}`,sourceUrl:`${source}?season=1&episode=${number}`});
const guide=()=>({id:'fm:s:77',title:'Documentary',year:2020,kind:'series',documentary:true,sourceUrl:source,observedAt:observed,complete:true,episodes:[episode(1),episode(7)]});
const seed=()=>({version:1,product:'dahsha',reviewedAt:'2026-11-05T15:00:00Z',guides:[guide()]});
const row=(extra={})=>({...guide(),sourceUrl:source.replace('f-moviess','f-movies'),episodes:[],seasons:[],episodeCount:0,firstSeenAt:older,providerUpdatedAt:older,latestAt:older,discoveredAt:null,episodesAddedAt:older,synopsis:'Current synopsis',portrait:'https://image.example/latest.jpg',...extra});

test('reviewed sparse links enrich only the exact existing documentary without filling episode gaps or changing recency',()=>{
  const before=row(),cache={items:[before],lastRefreshAt:older,providers:{fmovies:{lastError:'HTTP 403'}}};
  const result=applyReviewedGuides(cache,seed());
  assert.equal(result.report.addedEpisodes,2);assert.equal(result.cache.items.length,1);
  const after=result.cache.items[0];assert.deepEqual(after.episodes.map(ep=>ep.number),[1,7]);
  for(const field of ['id','title','year','kind','documentary','firstSeenAt','providerUpdatedAt','latestAt','discoveredAt','episodesAddedAt','synopsis','portrait','sourceUrl'])assert.deepEqual(after[field],before[field],field);
  assert.deepEqual(result.cache.providers,cache.providers);assert.equal(result.cache.lastRefreshAt,older);
  assert.equal(after.episodesCheckedAt,observed);assert.equal(after.episodeGuideInitializedAt,observed);
  assert.equal(after.episodes[0].offerings[0].id,episode().id);
  assert.deepEqual(before.episodes,[]);
});

test('double application is idempotent and preserves all existing newer episode metadata',()=>{
  const existing={...episode(1),title:'Newer title',synopsis:'Newer synopsis',publishedAt:newer,offerings:[{provider:'fmovies',id:episode(1).id,custom:'keep'}]};
  const before=row({episodes:[existing],seasons:[1,5],episodesCheckedAt:newer,episodesRefreshedAt:newer,episodeSeasonChecks:{1:newer,5:newer},episodeGuideComplete:false,episodeGuideInitializedAt:older,episodesLastError:'Hosted request denied'});
  const first=applyReviewedGuides({items:[before]},seed());const after=first.cache.items[0];
  assert.deepEqual(after.episodes[0],existing);assert.deepEqual(after.seasons,[1,5]);
  for(const field of ['episodesCheckedAt','episodesRefreshedAt','episodeGuideComplete','episodeGuideInitializedAt','episodesLastError'])assert.equal(after[field],before[field]);
  assert.deepEqual(after.episodeSeasonChecks,before.episodeSeasonChecks);
  const second=applyReviewedGuides(first.cache,seed());assert.equal(second.report.eligible,0);assert.equal(second.cache,first.cache);assert.deepEqual(second.report.reasons,{unchanged:1});
});

test('missing, duplicate, wrong title/year/kind/documentary/source and identity-conflicting rows are skipped',()=>{
  const variants=[['missing',[]],['duplicate_id',[row(),row()]],['title_mismatch',[row({title:'Different'})]],['year_mismatch',[row({year:null})]],['kind_mismatch',[row({kind:'film'})]],['not_documentary',[row({documentary:false})]],['source_mismatch',[row({sourceUrl:'https://evil.test/tv/documentary-77'})]],['identity_conflict',[row({tmdbId:88})]],['invalid_existing_guide',[row({episodes:'bad'})]]];
  for(const [reason,items]of variants){const cache={items};const result=applyReviewedGuides(cache,seed());assert.equal(result.cache,cache);assert.equal(result.report.reasons[reason],1,reason);assert.equal(result.report.addedEpisodes,0);}
});

test('conflicting existing episode IDs or slots cannot acquire reviewed links',()=>{
  for(const episodes of [[{...episode(1),number:2}],[{...episode(1),id:'fm:e:88:1:1'}],[episode(1),episode(1)]]){
    const cache={items:[row({episodes})]},result=applyReviewedGuides(cache,seed());
    assert.equal(result.cache,cache);assert.equal(result.report.reasons.episode_conflict,1);
  }
});

test('seed validation requires canonical observed URLs, exact ownership, distinct slots and documentary evidence',()=>{
  const invalid=[
    value=>value.product='flixer',value=>value.guides.push(guide()),value=>value.guides[0].documentary=false,
    value=>value.guides[0].sourceUrl=source.replace('f-moviess','f-movies'),
    value=>value.guides[0].episodes[0].id='fm:e:88:1:1',value=>value.guides[0].episodes[0].id='fm:e:77:01:1',
    value=>value.guides[0].episodes[0].number=2,value=>value.guides[0].episodes.push(episode(1)),
    value=>value.guides[0].episodes[0].sourceUrl='https://evil.test/tv/documentary-77?season=1&episode=1',
    value=>value.guides[0].episodes[0].sourceUrl=source+'?season=1&episode=7',
    value=>value.guides[0].episodes[0].sourceUrl=source+'?season=1&episode=1&target=other',
    value=>value.guides[0].episodes[0].addedAt=newer,
  ];
  for(const change of invalid){const value=seed();change(value);assert.throws(()=>validateReviewedGuides(value));}
});

test('guide files are dry-run by default, atomic on apply and byte-stable on repeated application',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dahsha-reviewed-guides-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'providers-dahsha.json'),seedFile=path.join(dir,'reviewed.json');
  fs.writeFileSync(seedFile,JSON.stringify(seed()));fs.writeFileSync(file,JSON.stringify({items:[row()]}));
  const original=fs.readFileSync(file,'utf8');const dry=applyGuideFile({dataDir:dir,seedFile});
  assert.equal(dry.applied,0);assert.equal(dry.eligible,1);assert.equal(fs.readFileSync(file,'utf8'),original);
  const first=applyGuideFile({dataDir:dir,seedFile,apply:true});assert.equal(first.applied,1);
  const output=fs.readFileSync(file,'utf8');const second=applyGuideFile({dataDir:dir,seedFile,apply:true});
  assert.equal(second.applied,0);assert.equal(fs.readFileSync(file,'utf8'),output);
  assert.equal(second.beforeSha256,first.afterSha256);
});

test('checked-in evidence contains exactly the reviewed99 series and3678 real episode links',()=>{
  const value=validateReviewedGuides(JSON.parse(fs.readFileSync(new URL('../config/dahsha-reviewed-guides.json',import.meta.url),'utf8')));
  assert.equal(value.guides.length,99);assert.equal(value.guides.reduce((sum,guide)=>sum+guide.episodes.length,0),3678);
  assert.deepEqual(value.guides.find(guide=>guide.id==='fm:s:10029').episodes.filter(ep=>ep.season===1).map(ep=>ep.number),[1,2,3,7,18]);
});

test('both GitHub workflows apply reviewed guides after restoring data and before publication',()=>{
  for(const name of ['poll','refresh']){
    const text=fs.readFileSync(new URL(`../../.github/workflows/${name}.yml`,import.meta.url),'utf8');
    assert.ok(text.indexOf('node scripts/snapshot.js restore')<text.indexOf('node scripts/apply-reviewed-guides.js --apply'));
    assert.ok(text.indexOf('node scripts/apply-reviewed-guides.js --apply')<text.indexOf('node scripts/publish-runtime.js'));
  }
});

test('a successful export advances generation even after source failures, without changing provider or title dates',()=>{
  const before={generatedAt:observed,providerSync:{lastRefreshAt:older,providers:{fmovies:{lastError:'HTTP 403',lastSuccessAt:older}}},shows:[{latestAt:older,episodesAddedAt:older}]};
  const next=stampCatalogueGeneration(before,{previousGeneratedAt:observed,now:dateValue(older)});
  assert.equal(Date.parse(next.generatedAt),Date.parse(observed)+1);
  assert.equal(next.providerSync,before.providerSync);assert.equal(next.shows,before.shows);assert.equal(before.generatedAt,observed);
  assert.equal(stampCatalogueGeneration(before,{now:Date.parse(newer)}).generatedAt,newer);
});
function dateValue(value){return Date.parse(value);}
