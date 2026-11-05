import test from 'node:test';
import assert from 'node:assert/strict';
import {createNetlifyHandler} from '../src/netlify-handler.js';
import {dataDirectory} from '../src/store.js';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const manifest={product:'dahsha',generatedAt:'2026-11-05T00:00:00Z'};
const saved={id:'fm:m:123',documentary:true,kind:'film',title:'A documentary',episodes:[{id:'fm:m:123'}]};
const request=(path,options)=>new Request('https://dahsha.netlify.app'+path,options);

test('Netlify builds use the restored snapshot while deployed functions use writable temporary storage',()=>{
  assert.equal(dataDirectory({NETLIFY:'true'}),path.resolve(fileURLToPath(new URL('../data/',import.meta.url))));
  assert.equal(dataDirectory({NETLIFY:'true',AWS_LAMBDA_FUNCTION_NAME:'dahsha-api'}),path.join(os.tmpdir(),'stream-library-dahsha'));
  assert.equal(dataDirectory({NETLIFY:'true',AWS_LAMBDA_FUNCTION_NAME:'dahsha-api',DATA_DIR:'explicit-cache'}),'explicit-cache');
});

test('Dahsha hydrates only the requested documentary and preserves repeated provider URLs',async()=>{
  const lookups=[];
  const handle=createNetlifyHandler({readManifest:async()=>manifest,readTitle:async id=>{lookups.push(id);return saved;},handlers:{title:(req,res)=>{
    assert.deepEqual(req.query.source,['https://source.test/one','https://source.test/two']);
    assert.deepEqual(req.catalog.shows,[saved]);assert.equal(req.catalog.product,'dahsha');
    assert.equal(req.catalog.idAliases['old-title'],saved.id);
    res.setHeader('Cache-Control','public, s-maxage=180');res.json(saved);
  }}});
  const response=await handle(request('/api/title?id=old-title&source=https%3A%2F%2Fsource.test%2Fone&source=https%3A%2F%2Fsource.test%2Ftwo'));
  assert.equal(response.status,200);assert.deepEqual(lookups,['old-title']);
  assert.equal(response.headers.get('Netlify-Vary'),'query');assert.match(response.headers.get('Netlify-CDN-Cache-Control'),/durable/);
  assert.deepEqual(await response.json(),saved);
});

test('Dahsha resolves episode owners and forces direct transport without trusting forwarded origins',async()=>{
  const handle=createNetlifyHandler({readManifest:async()=>manifest,readTitle:async id=>{assert.equal(id,'fm:e:123:1:2');return saved;},handlers:{stream:(req,res)=>{
    assert.equal(req.query.transport,'direct');assert.equal(req.headers['x-forwarded-host'],'dahsha.netlify.app');
    assert.equal(req.headers['x-forwarded-proto'],'https');assert.deepEqual(req.catalog.shows,[saved]);
    res.setHeader('Cache-Control','no-store');res.json({servers:[]});
  }}});
  const response=await handle(request('/api/stream?id=fm:e:123:1:2&transport=proxy',{headers:{'X-Forwarded-Host':'untrusted.test','X-Forwarded-Proto':'http'}}));
  assert.equal(response.status,200);assert.equal(response.headers.get('Netlify-CDN-Cache-Control'),null);
});

test('missing or wrong-product runtime data fails without reading a bundled catalogue',async()=>{
  for(const value of [null,{...manifest,product:'flixer'}]){
    const handle=createNetlifyHandler({readManifest:async()=>value,readTitle:async()=>assert.fail('No cross-product title read'),handlers:{title:()=>assert.fail('No full catalogue fallback')}});
    const response=await handle(request('/api/title?id=fm:m:123'));
    assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
});

test('the lightweight API rejects video proxying, writes and invalid IDs before any title work',async()=>{
  const handle=createNetlifyHandler({readManifest:async()=>assert.fail('No catalogue load'),handlers:{stream:()=>assert.fail('No media proxy'),title:()=>assert.fail('No title load')}});
  for(const [path,method,status] of [['/api/stream?proxy=1','GET',410],['/api/title?id=a','POST',405],['/api/title?id=a&id=b','GET',400],['/api/title','GET',400],['/api/unknown','GET',404]])assert.equal((await handle(request(path,{method}))).status,status);
  assert.equal((await handle(request('/api/title',{method:'OPTIONS'}))).status,204);
});

test('HEAD returns headers without a body and endpoint errors remain uncached',async()=>{
  const handle=createNetlifyHandler({handlers:{catalogue:(_req,res)=>{res.setHeader('Cache-Control','public, s-maxage=60');res.status(503).json({error:'Retry'});}}});
  const response=await handle(request('/api/catalogue',{method:'HEAD'}));
  assert.equal(response.status,503);assert.equal(await response.text(),'');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Netlify-CDN-Cache-Control'),null);
});
