import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const asset = name => fs.readFileSync(new URL(`../../mobile/android/app/src/main/assets/${name}`, import.meta.url), 'utf8');
function fixture({ expected = 3600, startAt = 0 } = {}) {
  const listeners = new Map(), messages = [], videos = [];
  let now = 1000;
  class Video {
    constructor({ duration = 3600, ad = false, width = 320, height = 180, hidden = false } = {}) {
      Object.assign(this, { duration, ad, width, height, currentTime: 0, paused: false, seeking: false, readyState: 4, currentSrc: 'https://cdn.example/content.mp4', parentElement: null, hidden });
      videos.push(this);
    }
    closest() { return this.ad ? {} : null; }
    getBoundingClientRect() { return { width: this.width, height: this.height, top: 0, left: 0, right: this.width, bottom: this.height }; }
  }
  const document = { addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); }, querySelectorAll: selector => selector === 'video' ? videos : [], visibilityState: 'visible' };
  const context = vm.createContext({ document, HTMLVideoElement: Video, Date: { now: () => now }, innerWidth: 400, innerHeight: 800, getComputedStyle: element => ({ display: element.hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }), DahshaPlayback: { postMessage: message => messages.push(message) }, addEventListener() {}, MutationObserver: class { observe() {} disconnect() {} }, setTimeout() {} });
  context.window = context;
  vm.runInContext(asset('player-content.js').replace('/*DAHSHA_EXPECTED_DURATION*/0', String(expected)), context);
  vm.runInContext(asset('player-health.js'), context);
  vm.runInContext(asset('player-progress.js').replace('/*DAHSHA_START_AT*/0', String(startAt)), context);
  const emit = (name, video) => { for (const fn of listeners.get(name) || []) fn({ target: video }); };
  const tick = (video, position, elapsed = 1000) => { now += elapsed; video.currentTime = position; emit('timeupdate', video); };
  return { Video, messages, tick, emit, context };
}

test('a short preroll or known ad container cannot qualify as content or write progress', () => {
  for (const setup of [{ duration: 30 }, { duration: 60 }, { duration: 3600, ad: true }]) {
    const f = fixture(), video = new f.Video(setup);
    for (let position = 1; position < 10; position++) f.tick(video, position);
    assert.deepEqual(f.messages, []);
  }
});

test('content must visibly advance before health succeeds or progress is saved', () => {
  const f = fixture(), video = new f.Video();
  f.tick(video, 5); f.tick(video, 5); f.tick(video, 5);
  assert.deepEqual(f.messages, [], 'a stagnant clock is not playback');
  f.tick(video, 6);
  assert.ok(f.messages.includes('playing'));
  assert.equal(JSON.parse(f.messages.find(message => message.startsWith('{'))).position, 6);
});

test('hidden or smaller competing video clocks do not establish content playback', () => {
  for (const hidden of [false, true]) {
    const f = fixture(), video = new f.Video({ width: 100, height: 60, hidden });
    if (!hidden) new f.Video({ width: 320, height: 180 });
    f.tick(video, 2); f.tick(video, 3);
    assert.deepEqual(f.messages, []);
  }
});

test('a larger hidden preload or known ad video cannot suppress the visible documentary', () => {
  for (const competitor of [{ hidden: true }, { ad: true }]) {
    const f = fixture(), video = new f.Video({ width: 200, height: 120 });
    new f.Video({ width: 320, height: 180, ...competitor });
    f.tick(video, 2); f.tick(video, 3);
    assert.ok(f.messages.includes('playing'));
  }
});

test('known short documentaries work while unidentified short videos remain ineligible', () => {
  const known = fixture({ expected: 20 }), clip = new known.Video({ duration: 20 });
  known.tick(clip, 1); known.tick(clip, 2);
  assert.ok(known.messages.includes('playing'));
  const unknown = fixture({ expected: 0 }), short = new unknown.Video({ duration: 20 });
  unknown.tick(short, 1); unknown.tick(short, 2);
  assert.deepEqual(unknown.messages, []);
});

test('resume seeks and progress wait for content when a player reuses its ad video element', () => {
  const f = fixture({ startAt: 120 }), video = new f.Video({ duration: 30, ad: true });
  f.emit('loadedmetadata', video);
  assert.equal(video.currentTime, 0, 'never seek an advertisement to the documentary position');
  f.tick(video, 1); f.tick(video, 2);
  assert.deepEqual(f.messages, []);
  video.duration = 3600; video.ad = false; video.currentSrc = 'https://cdn.example/documentary.mp4';
  f.emit('loadedmetadata', video);
  assert.equal(video.currentTime, 120);
  f.tick(video, 121); f.tick(video, 122);
  assert.equal(JSON.parse(f.messages.find(message => message.startsWith('{'))).position, 122);
  f.messages.length = 0;
  video.ad = true; video.duration = 45;
  f.tick(video, 1); f.tick(video, 2);
  assert.deepEqual(f.messages, [], 'an interstitial cannot overwrite the last content position');
});

test('cosmetic cleanup leaves the app document untouched and scopes promotional iframe hiding', () => {
  const untouched = { location: { hostname: 'localhost' } };
  vm.runInNewContext(asset('player-cleanup.js'), untouched);
  const callbacks = [], styled = [], frames = ['Claim your free spins now', 'Verify you are human', 'Sign in to your account', 'Documentary video player with subtitles'].map(text => ({ contentDocument: { body: { innerText: text } }, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }));
  const document = { documentElement: { appendChild: node => styled.push(node) }, getElementById: () => styled[0], createElement: () => ({}), addEventListener() {}, querySelectorAll: selector => selector === 'iframe' ? frames : [] };
  const context = { location: { hostname: 'uqload.vc' }, document, MutationObserver: class { observe() {} disconnect() {} }, setTimeout: fn => callbacks.push(fn), addEventListener() {} };
  context.window = context;
  vm.runInNewContext(asset('player-cleanup.js'), context);
  for (const fn of callbacks) fn();
  assert.ok(Object.hasOwn(frames[0].attributes, 'data-flixer-promotional-ad'));
  for (const frame of frames.slice(1)) assert.deepEqual(frame.attributes, {}, 'verification, account and video frames must remain untouched');
  assert.equal(context.open(), null, 'popups cannot replace the player');
});
