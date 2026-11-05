import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {applyReviewedIdentities,applyIdentityFile,validateReviewedIdentities} from '../../scripts/apply-reviewed-identities.js';

const fact=(n=1)=>({id:`hd:m:movie-documentary-${n}abcd`,title:`Documentary ${n}`,kind:'film',year:2020,tmdbId:100+n,documentary:true,sourceUrl:`https://hdtoday.sx/watch/movie-documentary-${n}abcd`,evidence:{provider:'fmovies',id:`fm:m:${100+n}`,sourceUrl:`https://www.f-movies.org/movie/documentary-${100+n}`}});
const seed=facts=>({version:1,product:'dahsha',reviewedAt:'2026-11-05T13:33:57.163Z',facts});
const row=(f=fact())=>({...f,evidence:undefined,tmdbId:null,episodes:[{id:f.id,season:1,number:1,publishedAt:'2020-01-01'}],offerings:[{provider:'hdtoday',id:f.id}],providerUpdatedAt:'2020-02-01',firstSeenAt:'2020-02-02',recentUpdate:{kind:'episodes',at:'2020-02-03'}});

test('reviewed identity enrichment changes only tmdbId on an existing documentary row',()=>{
  const first=row(),untouched={id:'unrelated',title:'Other documentary',documentary:true,episodes:[]};
  const cache={version:1,items:[first,untouched],lastRefreshAt:'2020-03-01',queue:[{provider:'hdtoday',page:7}],errors:{hdtoday:'HTTP 403'}};
  const before=structuredClone(cache),result=applyReviewedIdentities(cache,seed([fact()]));
  assert.equal(result.report.eligible,1);assert.deepEqual(result.cache,{...before,items:[{...before.items[0],tmdbId:101},before.items[1]]});
  assert.deepEqual(cache,before,'input snapshot is unchanged');
  assert.equal(result.cache.items[0].episodes,first.episodes);assert.equal(result.cache.items[0].offerings,first.offerings);assert.equal(result.cache.items[1],untouched);
  assert.equal(result.report.beforeRows,result.report.afterRows);
});

test('missing, uncertain and conflicting identities are reported without changing rows',()=>{
  const facts=Array.from({length:10},(_,index)=>fact(index+1)),rows=facts.slice(0,9).map(f=>row(f));
  rows[0].documentary=false;rows[1].kind='series';rows[2].title='Different title';rows[3].year=2021;rows[4].year=null;rows[5].sourceUrl='https://hdtoday.sx/watch/movie-other';rows[6].tmdbId=999;
  rows[7].offerings.push({provider:'fmovies',id:'fm:m:999',tmdbId:999});rows.push({...rows[8]});
  const cache={items:rows},result=applyReviewedIdentities(cache,seed(facts));
  assert.equal(result.report.eligible,0);assert.equal(result.cache,cache);
  assert.deepEqual(result.report.reasons,{not_documentary:1,kind_mismatch:1,title_mismatch:1,year_mismatch:2,source_mismatch:1,identity_conflict:2,duplicate_id:1,missing:1});
});

test('a matching existing identity is idempotent and never rewrites dates or episodes',()=>{
  const cache={items:[{...row(),tmdbId:101}]},result=applyReviewedIdentities(cache,seed([fact()]));
  assert.equal(result.cache,cache);assert.equal(result.report.eligible,0);assert.deepEqual(result.report.reasons,{unchanged:1});
});

test('identity seeds require documentary classification, source corroboration and unambiguous typed IDs',()=>{
  const good=seed([fact()]);assert.equal(validateReviewedIdentities(good),good);
  for(const changed of [
    {...good,product:'flixer'}, {...good,facts:[fact(),fact()]},
    seed([{...fact(),documentary:false}]),seed([{...fact(),kind:'series'}]),seed([{...fact(),tmdbId:1.5}]),
    seed([{...fact(),sourceUrl:'https://other.example/watch/movie-documentary-1abcd'}]),
    seed([{...fact(),evidence:{...fact().evidence,id:'fm:m:999'}}]),
    seed([{...fact(),evidence:{...fact().evidence,sourceUrl:'https://www.f-movies.org/movie/documentary-101?redirect=http://127.0.0.1'}}]),
  ])assert.throws(()=>validateReviewedIdentities(changed));
  assert.throws(()=>applyReviewedIdentities({product:'flixer',items:[row()]},good),/Invalid Dahsha/);
});

test('file application is dry-run by default, atomic on apply, and byte-stable on repeat',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dahsha-reviewed-identities-'));
  try{
    const cacheFile=path.join(dir,'providers-dahsha.json'),seedFile=path.join(dir,'seed.json');
    fs.writeFileSync(cacheFile,JSON.stringify({items:[row()],lastRefreshAt:'2020-01-01'},null,2));fs.writeFileSync(seedFile,JSON.stringify(seed([fact()])));
    const before=fs.readFileSync(cacheFile),dry=applyIdentityFile({dataDir:dir,seedFile});
    assert.equal(dry.eligible,1);assert.equal(dry.applied,0);assert.equal(dry.dryRun,true);assert.deepEqual(fs.readFileSync(cacheFile),before);
    const applied=applyIdentityFile({dataDir:dir,seedFile,apply:true}),after=fs.readFileSync(cacheFile);
    assert.equal(applied.applied,1);assert.notEqual(applied.beforeSha256,applied.afterSha256);assert.equal(JSON.parse(after).items[0].tmdbId,101);
    const repeated=applyIdentityFile({dataDir:dir,seedFile,apply:true});assert.equal(repeated.applied,0);assert.deepEqual(fs.readFileSync(cacheFile),after);
    assert.deepEqual(fs.readdirSync(dir).sort(),['providers-dahsha.json','seed.json']);
    fs.writeFileSync(seedFile,JSON.stringify(seed([{...fact(),documentary:false}])));
    assert.throws(()=>applyIdentityFile({dataDir:dir,seedFile,apply:true}));assert.deepEqual(fs.readFileSync(cacheFile),after);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('missing snapshots are reported and cannot create new catalogue rows',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dahsha-reviewed-missing-'));
  try{
    const seedFile=path.join(dir,'seed.json');fs.writeFileSync(seedFile,JSON.stringify(seed([fact()])));
    const report=applyIdentityFile({dataDir:dir,seedFile,apply:true});
    assert.equal(report.applied,0);assert.deepEqual(report.reasons,{missing:1});assert.equal(fs.existsSync(path.join(dir,'providers-dahsha.json')),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('checked-in reviewed seed contains 109 unique documentary identities with source evidence',()=>{
  const reviewed=JSON.parse(fs.readFileSync(new URL('../config/dahsha-reviewed-identities.json',import.meta.url),'utf8'));
  assert.equal(validateReviewedIdentities(reviewed).facts.length,109);
  assert.ok(reviewed.facts.every(fact=>fact.id.startsWith('hd:')&&fact.documentary&&fact.evidence.provider==='fmovies'));
});

test('reapplying after a provider listing restores its omitted identity without changing the fresh observation',async()=>{
  const {putProviderRows}=await import('../src/provider-sync.js');
  const known={...row(),tmdbId:101},items=new Map([[known.id,known]]);
  putProviderRows(items,[{...known,tmdbId:null,providerUpdatedAt:'2026-11-05T12:00:00Z'}]);
  const refreshed=items.get(known.id);assert.equal(refreshed.tmdbId,null);
  const before=structuredClone(refreshed),result=applyReviewedIdentities({items:[refreshed]},seed([fact()]));
  assert.equal(result.report.eligible,1);assert.deepEqual(result.cache.items[0],{...before,tmdbId:101});
});
