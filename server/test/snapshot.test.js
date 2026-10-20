import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ARCHIVE, MANIFEST, MANIFEST_ASSET, SHRINK_LIMITS, LOCAL_SHRINK_LIMITS,
  planSave, restoreWarnings, countLosses, describeLosses, cacheCounts, createArchive, save, restore, main,
} from '../../scripts/snapshot.js';

// Generation 37 as CI published it on 2026-10-18 (scratchpad base snapshot).
const PUBLISHED = {
  version: 1, generation: 37, savedAt: '2026-10-18T18:54:43.614Z', by: 'ci',
  runUrl: 'https://github.com/FediMechergui/dahsha/actions/runs/39155877988',
  counts: { details: 99853, seen: 99843, playlists: 2592, playlistVideos: 168192, artworkMatched: 2471, providerItems: 2593, catalogShows: 15328, youtubeShows: 8023, youtubeEpisodes: 20792 },
};
const remote = (manifest = PUBLISHED, extra = {}) => ({ exists: true, hasArchive: true, manifest, ...extra });
const restored = (generation = 37) => ({ version: 1, generation, restoredAt: '2026-10-18T19:00:00.000Z' });
const grown = { ...PUBLISHED.counts, details: 99901, seen: 99890, playlistVideos: 168300, artworkMatched: 2480, catalogShows: 15340 };
// The machine's own server/data in October: the Oct 12 artwork.json and an old seen.json.
const stale = { ...PUBLISHED.counts, seen: 8952, artworkMatched: 8 };
const BYPASS = /--(force|overwrite-newer|allow-shrink)/;

test('a save outside CI is refused even when the caches grew, and the refusal reports the counts', () => {
  const plan = planSave({ ci: false, restored: restored(), remote: remote(), local: grown });
  assert.equal(plan.ok, false);
  assert.equal(plan.problems.length, 1);
  assert.match(plan.problems[0], /reserved for the CI workflows/);
  assert.match(plan.message, /no count is lower than in the published snapshot \(generation 37\)/);
  assert.doesNotMatch(plan.message, BYPASS);
});

test('a refused local save lists what it would lose, even without --force', () => {
  const plan = planSave({ ci: false, restored: restored(), remote: remote(), local: stale });
  assert.equal(plan.ok, false);
  assert.match(plan.message, /would lose: seen 99843 -> 8952, artworkMatched 2471 -> 8/);
  assert.deepEqual(plan.losses.map((l) => l.key), ['seen', 'artworkMatched']);
});

test('a forced upload that shrinks artwork is refused; --force only overrides the CI-origin check', () => {
  const plan = planSave({ ci: false, force: true, restored: restored(), remote: remote(), local: stale });
  assert.equal(plan.ok, false);
  assert.ok(!plan.problems.some((p) => /reserved for the CI/.test(p)));
  assert.ok(plan.problems.includes('artworkMatched would shrink from 2471 to 8'));
  assert.ok(plan.problems.includes('seen would shrink from 99843 to 8952'));
  assert.match(plan.message, /artworkMatched 2471 -> 8/);
  assert.doesNotMatch(plan.message, BYPASS);
  // Outside CI any drop of a guarded cache is refused, not only drops beyond the CI limits.
  const slight = planSave({ ci: false, force: true, restored: restored(), remote: remote(), local: { ...grown, artworkMatched: 2470 } });
  assert.deepEqual(slight.problems, ['artworkMatched would shrink from 2471 to 2470']);
  assert.ok(Object.values(LOCAL_SHRINK_LIMITS).every((limit) => limit === 0));
  // A cache file missing locally counts as 0.
  const missing = planSave({ ci: false, force: true, restored: restored(), remote: remote(), local: { ...grown, artworkMatched: null } });
  assert.deepEqual(missing.problems, ['artworkMatched would shrink from 2471 to 0']);
});

test('only an explicit allowShrink accepts a shrinking upload', () => {
  const plan = planSave({ ci: false, force: true, allowShrink: true, restored: restored(), remote: remote(), local: stale });
  assert.equal(plan.ok, true);
  assert.equal(plan.generation, 38);
  assert.equal(plan.losses.length, 2); // still reported to the caller
});

test('a CI save keeps the tolerant limits, and the workflow force input does not skip them', () => {
  for (const force of [false, true]) {
    const sharp = planSave({ ci: true, force, restored: restored(), remote: remote(), local: stale });
    assert.equal(sharp.ok, false, `force=${force}`);
    assert.match(sharp.message, /artworkMatched 2471 -> 8/);
    assert.doesNotMatch(sharp.message, BYPASS);
  }
  const within = planSave({ ci: true, restored: restored(), remote: remote(), local: { ...grown, artworkMatched: Math.ceil(2471 * (1 - SHRINK_LIMITS.artworkMatched)) } });
  assert.equal(within.ok, true);
});

test('a newer published generation is refused, forced or not', () => {
  for (const [ci, force] of [[true, false], [false, true], [true, true]]) {
    const plan = planSave({ ci, force, restored: restored(36), remote: remote(), local: grown });
    assert.equal(plan.ok, false);
    assert.equal(plan.problems.length, 1);
    assert.match(plan.problems[0], /generation 37, saved 2026-10-18T18:54:43\.614Z by https:\/\/github\.com\/FediMechergui\/dahsha\/actions\/runs\/39155877988\) is newer than the one restored here \(generation 36\)/);
    assert.doesNotMatch(plan.message, BYPASS);
  }
  assert.equal(planSave({ ci: true, overwriteNewer: true, restored: restored(36), remote: remote(), local: grown }).ok, true);
});

test('a data directory that was never restored is refused, forced or not', () => {
  const plan = planSave({ ci: false, force: true, restored: null, remote: remote(), local: stale });
  assert.equal(plan.ok, false);
  assert.match(plan.problems[0], /was not restored from the published snapshot/);
  assert.match(plan.message, /artworkMatched 2471 -> 8/);
});

test('a CI save with normal growth is accepted as the next generation', () => {
  const plan = planSave({ ci: true, restored: restored(), remote: remote(), local: grown });
  assert.deepEqual(plan, { ok: true, problems: [], losses: [], message: '', generation: 38 });
  // First save ever: no release yet.
  assert.equal(planSave({ ci: true, restored: null, remote: { exists: false }, local: grown }).generation, 1);
});

test('outside CI a published snapshot without counts cannot be replaced', () => {
  const plan = planSave({ ci: false, force: true, restored: restored(0), remote: remote(null), local: grown });
  assert.equal(plan.ok, false);
  assert.match(plan.problems.join('\n'), /no cache counts to compare with/);
  assert.equal(planSave({ ci: true, restored: restored(0), remote: remote(null), local: grown }).ok, true);
});

test('countLosses and restoreWarnings compare against the published manifest', () => {
  assert.deepEqual(countLosses({ a: 3, b: 2, c: null }, { a: 1, b: 5 }), [{ key: 'a', before: 3, after: 1 }]);
  assert.equal(describeLosses([{ key: 'artworkMatched', before: 2466, after: 8 }, { key: 'seen', before: 99838, after: 8952 }]), 'artworkMatched 2466 -> 8, seen 99838 -> 8952');
  assert.deepEqual(restoreWarnings(PUBLISHED, { generation: 37 }, PUBLISHED.counts), []);
  // Catalogue counts depend on the counting code, so they do not warn after a restore.
  assert.deepEqual(restoreWarnings(PUBLISHED, { generation: 37 }, { ...PUBLISHED.counts, youtubeShows: 1 }), []);
  const [mismatch, below] = restoreWarnings(PUBLISHED, { generation: 34, savedAt: '2026-10-18T16:50:00Z' }, stale);
  assert.match(mismatch, /archive holds generation 34 \(saved 2026-10-18T16:50:00Z\) but the published manifest is generation 37/);
  assert.match(below, /below the published manifest \(generation 37\): seen 99843 -> 8952, artworkMatched 2471 -> 8/);
  assert.match(restoreWarnings(null, { generation: 37 }, PUBLISHED.counts)[0], /no data-snapshot\.json/);
});

// ---- save()/restore() with a stand-in for gh: nothing here talks to GitHub. ----

const tmp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-snapshot-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const writeJson = (dir, name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
function dataDir(t, { artwork = 1, manifest = { version: 1, generation: 5, restoredAt: '2026-10-18T00:00:00.000Z' } } = {}) {
  const dir = tmp(t);
  writeJson(dir, 'details.json', { a: {}, b: {} });
  writeJson(dir, 'seen.json', { a: 1, b: 1 });
  writeJson(dir, 'playlists.json', { P1: { videos: [{ id: 'a' }, { id: 'b' }] } });
  writeJson(dir, 'artwork.json', Object.fromEntries(Array.from({ length: artwork }, (_, i) => [`s_${i}`, { source: 'tvmaze' }])));
  if (manifest) writeJson(dir, MANIFEST, manifest);
  return dir;
}
const published = (generation, counts) => JSON.stringify({ version: 1, generation, savedAt: '2026-10-18T12:00:00.000Z', by: 'ci', counts });
function fakeGh({ assets = [ARCHIVE, MANIFEST_ASSET], files = {}, fail = {} } = {}) {
  const calls = [], uploads = [];
  const run = (args, opts = {}) => {
    const action = args[1];
    calls.push(action);
    if (fail[action]) return { status: 1, stderr: fail[action] };
    if (action === 'view') return { status: 0, stdout: JSON.stringify({ assets: assets.map((name) => ({ name })) }) };
    if (action === 'download') {
      const name = args[args.indexOf('--pattern') + 1];
      if (!(name in files)) return { status: 1, stderr: `no asset ${name}` };
      fs.writeFileSync(path.join(args[args.indexOf('--dir') + 1], name), files[name]);
      return { status: 0 };
    }
    if (action === 'upload') { uploads.push({ name: args[3], body: fs.readFileSync(path.join(opts.cwd, args[3])) }); return { status: 0 }; }
    return { status: 0 };
  };
  return { run, calls, uploads };
}
const capture = () => { const lines = []; return { lines, text: () => lines.join('\n'), log: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) }; };

test('save refuses a forced local upload that would shrink artwork, without uploading or touching the data dir', (t) => {
  const dir = dataDir(t, { artwork: 1 });
  const before = fs.readFileSync(path.join(dir, MANIFEST), 'utf8');
  const gh = fakeGh({ files: { [MANIFEST_ASSET]: published(5, { details: 2, seen: 2, playlistVideos: 2, artworkMatched: 3 }) } });
  const out = capture();
  assert.equal(save(dir, { force: true }, { env: {}, run: gh.run, out }), 1);
  assert.deepEqual(gh.calls, ['view', 'download']);
  assert.match(out.text(), /artworkMatched would shrink from 3 to 1/);
  assert.match(out.text(), /would lose: artworkMatched 3 -> 1/);
  assert.doesNotMatch(out.text(), BYPASS);
  assert.equal(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(dir, ARCHIVE)));
});

test('save outside CI is refused even when gh cannot reach the release, and says so', (t) => {
  const dir = dataDir(t);
  const gh = fakeGh({ fail: { view: 'gh: To get started with GitHub CLI, please run: gh auth login' } });
  const out = capture();
  assert.equal(save(dir, {}, { env: {}, run: gh.run, out }), 1);
  assert.match(out.text(), /reserved for the CI workflows/);
  assert.match(out.text(), /could not be read to compare counts \(cannot read release data-snapshot: gh: To get started/);
  // Forced, the unreadable release is an error rather than a blind upload.
  assert.throws(() => save(dir, { force: true }, { env: {}, run: gh.run, out }), /cannot read release/);
  assert.deepEqual(gh.calls, ['view', 'view']);
});

test('a CI save with growth uploads the archive, then the manifest, as the next generation', (t) => {
  const dir = dataDir(t, { artwork: 4 });
  const gh = fakeGh({ files: { [MANIFEST_ASSET]: published(5, { details: 2, seen: 2, playlistVideos: 2, artworkMatched: 3 }) } });
  const out = capture();
  const env = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '42', GITHUB_REPOSITORY: 'FediMechergui/dahsha', GITHUB_WORKFLOW: 'Poll YouTube feeds' };
  assert.equal(save(dir, { force: true }, { env, run: gh.run, out }), 0);
  assert.deepEqual(gh.uploads.map((u) => u.name), [ARCHIVE, MANIFEST_ASSET]);
  const manifest = JSON.parse(gh.uploads[1].body);
  assert.equal(manifest.generation, 6);
  assert.equal(manifest.by, 'ci');
  assert.deepEqual(manifest.overrides, ['force']);
  assert.equal(manifest.counts.artworkMatched, 4);
  assert.equal(manifest.runUrl, 'https://github.com/FediMechergui/dahsha/actions/runs/42');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')).generation, 6);
  assert.ok(!fs.existsSync(path.join(dir, ARCHIVE)));
  assert.match(out.text(), /--force only lets a save run outside CI/);
});

test('a failed upload leaves the restored manifest in place so a retry plans the same generation', (t) => {
  const dir = dataDir(t, { artwork: 4 });
  const before = fs.readFileSync(path.join(dir, MANIFEST), 'utf8');
  const gh = fakeGh({ files: { [MANIFEST_ASSET]: published(5, { artworkMatched: 3 }) }, fail: { upload: 'HTTP 502' } });
  assert.throws(() => save(dir, {}, { env: { CI: 'true' }, run: gh.run, out: capture() }), /uploading data-snapshot\.tar\.gz failed/);
  assert.equal(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'), before);
});

test('restore warns when the archive is below the published manifest', (t) => {
  const source = dataDir(t, { artwork: 2, manifest: { version: 1, generation: 4, savedAt: '2026-10-17T00:00:00.000Z', counts: {} } });
  const archive = fs.readFileSync(createArchive(source, ['details.json', 'seen.json', 'playlists.json', 'artwork.json', MANIFEST]));
  const target = tmp(t);
  const gh = fakeGh({ files: { [ARCHIVE]: archive, [MANIFEST_ASSET]: published(5, { details: 2, seen: 2, playlists: 1, playlistVideos: 2, artworkMatched: 9 }) } });
  const out = capture();
  assert.equal(restore(target, { env: { GITHUB_ACTIONS: 'true' }, run: gh.run, out }), 0);
  assert.deepEqual(cacheCounts(target).artworkMatched, 2);
  const warnings = out.lines.filter((line) => line.startsWith('::warning title=Snapshot restore::'));
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /archive holds generation 4 .* published manifest is generation 5/);
  assert.match(warnings[1], /artworkMatched 9 -> 2$/);
  // A restore that matches the manifest stays quiet.
  const quiet = fakeGh({ files: { [ARCHIVE]: archive, [MANIFEST_ASSET]: published(4, { details: 2, seen: 2, artworkMatched: 2 }) } });
  const calm = capture();
  assert.equal(restore(tmp(t), { env: { GITHUB_ACTIONS: 'true' }, run: quiet.run, out: calm }), 0);
  assert.ok(!calm.lines.some((line) => line.includes('::warning')));
});

test('cacheCounts reads every guarded cache, and a catalogue it cannot count does not stop it', (t) => {
  const dir = dataDir(t, { artwork: 3 });
  writeJson(dir, 'artwork.json', { a: { source: 'tvmaze' }, b: { source: 'wikipedia', confidence: 'fuzzy' }, c: { misses: 2 }, d: null });
  writeJson(dir, 'providers-dahsha.json', { items: [{ id: 'x' }, { id: 'y' }] });
  writeJson(dir, 'catalog.json', { shows: [null] }); // countCatalog throws on a null show
  assert.deepEqual(cacheCounts(dir), { details: 2, seen: 2, playlists: 1, playlistVideos: 2, artworkMatched: 2, providerItems: 2, catalogShows: null, youtubeShows: null, youtubeEpisodes: null });
  // Missing files are null, which planSave treats as 0 against a published count.
  assert.deepEqual(Object.values(cacheCounts(tmp(t))), Array(9).fill(null));
});

test('unknown flags are rejected before anything runs', () => {
  const gh = fakeGh();
  const error = console.error;
  console.error = () => {};
  try {
    assert.equal(main(['save', '--allow-shrinks'], { run: gh.run }), 1);
    assert.equal(main(['restore', '--force'], { run: gh.run }), 1);
  } finally { console.error = error; }
  assert.deepEqual(gh.calls, []);
});
