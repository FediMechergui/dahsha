import test from 'node:test';
import assert from 'node:assert/strict';
import { thumbnailCandidates } from '../../client/src/lib/thumbnails.js';
import { playerPolicy } from '../../client/src/lib/player-policy.js';

test('Dahsha skips missing image sizes and retains YouTube and show artwork fallbacks',()=>{
  assert.deepEqual(thumbnailCandidates({hq:'https://example.com/hq.jpg'},null,'sd'),['https://example.com/hq.jpg']);
  const urls=thumbnailCandidates({custom:'https://example.com/broken.jpg'},'dxroVYk0NKY','sd',{custom:'https://example.com/show.jpg'});
  assert.equal(urls[0],'https://example.com/broken.jpg');
  assert.ok(urls.includes('https://i.ytimg.com/vi/dxroVYk0NKY/hqdefault.jpg'));
  assert.equal(urls.at(-1),'https://example.com/show.jpg');
  assert.deepEqual(thumbnailCandidates(null,'fm:m:123'),[]);
});
test('Dahsha handles known player iframe requirements while dropping blocked wrappers',()=>{
  assert.equal(playerPolicy({embedUrl:'https://vidsrc.mov/embed/movie/123'}).sandbox,null);
  assert.equal(playerPolicy({embedUrl:'https://vidcore.net/movie/123'}).sandbox,null);
  assert.equal(playerPolicy({embedUrl:'https://hdtoday.sx/api/go?id=123'}),null);
  assert.equal(playerPolicy({requiresBrowserVerification:true}),null);
  assert.equal(playerPolicy({embedUrl:'https://unknown.example/player'}).sandbox,undefined);
});
