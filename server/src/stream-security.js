import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

const localKey = randomBytes(32);
function key() {
  if (process.env.STREAM_PROXY_SECRET) return process.env.STREAM_PROXY_SECRET;
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error('Set STREAM_PROXY_SECRET to enable stream proxying in production');
  }
  return localKey;
}
function signature(url, expires) {
  return createHmac('sha256', key()).update(`${expires}\n${url}`).digest('hex');
}
export function proxyUrl(prefix, url, expires = Math.floor(Date.now() / 1000) + 21600) {
  return `${prefix}?proxy=1&url=${encodeURIComponent(url)}&expires=${expires}&sig=${signature(url, expires)}`;
}
export function verifyProxy(url, expires, sig) {
  if (!/^\d+$/.test(String(expires)) || Number(expires) < Date.now() / 1000 || Number(expires) > Date.now() / 1000 + 21660) return false;
  if (typeof sig !== 'string' || !/^[a-f0-9]{64}$/.test(sig)) return false;
  return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(signature(url, expires), 'hex'));
}
export function validMediaId(id) {
  return typeof id === 'string' && /^mf:[mse]:[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(id) && id.length <= 300;
}
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const scriptJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

const blocked = new BlockList();
for (const [ip, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(ip, bits, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [ip, bits] of [['2001::',32],['2001:db8::',32],['2002::',16]]) blocked.addSubnet(ip, bits, 'ipv6');
export function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

// Pin the validated DNS result to the connection, and revalidate every redirect.
export async function safeRemoteFetch(input, { headers = {}, redirects = 5 } = {}) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('Invalid media destination');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('Private media destinations are blocked');
  const chosen = addresses[0];
  const upstream = await new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      headers,
      agent: false,
      lookup: (_host, opts, cb) => opts?.all ? cb(null, [chosen]) : cb(null, chosen.address, chosen.family),
      signal: AbortSignal.timeout(30000),
    }, resolve);
    request.on('error', reject);
    request.end();
  });
  if ([301,302,303,307,308].includes(upstream.statusCode) && upstream.headers.location) {
    upstream.destroy();
    if (redirects <= 0) throw new Error('Too many media redirects');
    return safeRemoteFetch(new URL(upstream.headers.location, url).href, { headers, redirects: redirects - 1 });
  }
  const response = new Response([204,304].includes(upstream.statusCode) ? null : Readable.toWeb(upstream), {
    status: upstream.statusCode,
    headers: Object.fromEntries(Object.entries(upstream.headers).filter(([,v]) => v != null).map(([k,v]) => [k, Array.isArray(v) ? v.join(', ') : v])),
  });
  Object.defineProperty(response, 'url', { value: url.href });
  return response;
}
