import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyUrl, verifyProxy, isPublicAddress, safeRemoteFetch, validMediaId, scriptJson, escapeHtml } from '../src/stream-security.js';
import { handleStreamProxy, handleEmbedPlayer, rewriteM3u8 } from '../src/myflixer.js';

test('proxy tokens reject modified destinations, signatures and expired requests', () => {
  const url = new URL(proxyUrl('https://example.com/api/stream', 'https://cdn.example/video?a=1%25'));
  const q = url.searchParams;
  assert.ok(verifyProxy(q.get('url'), q.get('expires'), q.get('sig')));
  assert.equal(verifyProxy('http://127.0.0.1/private', q.get('expires'), q.get('sig')), false);
  assert.equal(verifyProxy(q.get('url'), '1', q.get('sig')), false);
  assert.equal(verifyProxy(q.get('url'), q.get('expires'), 'bad'), false);
});

test('private, mapped, reserved and local addresses are rejected', async () => {
  for (const ip of ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  await assert.rejects(safeRemoteFetch('http://127.0.0.1/private'), /Private/);
  await assert.rejects(safeRemoteFetch('file:///etc/passwd'), /Invalid/);
});

test('HLS playlists sign segments, variant playlists and encryption keys', () => {
  const result = rewriteM3u8('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n../720/index.m3u8\nsegment.ts', 'https://cdn.example/a/master.m3u8', '/api/stream');
  for (const match of result.matchAll(/\/api\/stream\?[^"\n]+/g)) {
    const q = new URL(match[0], 'https://app.example').searchParams;
    assert.ok(verifyProxy(q.get('url'), q.get('expires'), q.get('sig')));
  }
  assert.equal([...result.matchAll(/sig=/g)].length, 3);
});

test('unsigned proxy calls and executable embed identifiers fail before fetching', async () => {
  const response = () => ({ code: null, setHeader() {}, status(code) { this.code = code; return this; }, send(body) { this.body = body; return this; } });
  let res = response();
  await handleStreamProxy('http://127.0.0.1/private', { query: {}, headers: {} }, res);
  assert.equal(res.code, 403);
  res = response();
  await handleEmbedPlayer('mf:m:</title><script>alert(1)</script>', {}, res);
  assert.equal(res.code, 400);
  assert.equal(validMediaId('mf:m:valid-movie'), true);
  assert.equal(validMediaId('mf:m:../private'), false);
  assert.ok(!scriptJson(['</script>']).includes('<'));
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
});
