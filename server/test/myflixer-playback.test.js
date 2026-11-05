import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveMyflixerStream} from '../src/myflixer.js';

const page='<iframe id="main-player" src="https://sv2.nontongo.stream/soap/movie/tt12345"></iframe>'+[
  ['Player 1','https://sv2.nontongo.stream/soap/movie/tt12345'],
  ['Player 2','https://balance.medmedia03.wiki/embed/movie/12345'],
  ['Player 7','https://moviesapi.to/movie/12345'],
].map(([name,url])=>`<button class="player-tab-btn" data-player-url="${url}">${name}</button>`).join('');

test('a stalled optional Soap lookup preserves every already listed Myflixer player and aborts its request',async()=>{
  let cancelled=false;
  const fetchImpl=async(url,{signal})=>url.startsWith('https://myflixerz.day/')?new Response(page):new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>{cancelled=true;reject(signal.reason);},{once:true});
  });
  const result=await resolveMyflixerStream('mf:m:documentary','/api/stream',{transport:'direct',fetchImpl,extractionTimeoutMs:20});
  assert.equal(cancelled,true);
  assert.equal(result.error,undefined);
  assert.deepEqual(result.servers.map(server=>server.name),['Player 1','Player 2','Player 7']);
});

test('a fast direct source stays preferred while the other listed players remain available',async()=>{
  const fetchImpl=async url=>new Response(url.startsWith('https://myflixerz.day/')?page:
    url.includes('/soap/')?'const cfg = {"tmdbId":12345,"type":"movie","servers":[{"movie_url":"https://media.example/movie/{tmdb_id}"}]};':
    'const sources = [{"file":"https://cdn.example/content.m3u8","html":"HD"}];');
  const result=await resolveMyflixerStream('mf:m:documentary','/api/stream',{transport:'direct',fetchImpl});
  assert.equal(result.servers[0].streamUrl,'https://cdn.example/content.m3u8');
  assert.equal(result.servers.length,3);
  assert.deepEqual(result.servers.slice(1).map(server=>server.name),['Player 2','Player 7']);
});

test('a denied Myflixer page is reported without inventing players',async()=>{
  let requests=0;
  const result=await resolveMyflixerStream('mf:m:documentary','/api/stream',{transport:'direct',fetchImpl:async()=>{requests++;return new Response('',{status:403});}});
  assert.equal(requests,1);assert.equal(result.error,'HTTP 403');assert.deepEqual(result.servers,[]);
});
