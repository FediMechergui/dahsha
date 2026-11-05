import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { androidVersion, writeAndroidVersion, MAX_ANDROID_VERSION_CODE } from '../../scripts/android-version.js';

test('Dahsha release tags produce a clean Android name and an upgrade code above 1.8.2', () => {
  for (const tag of ['dahsha-v1.8.3', 'v1.8.3', '1.8.3']) assert.deepEqual(androidVersion(tag), { name: '1.8.3', code: 10803 });
  assert.ok(androidVersion('dahsha-v1.8.3').code > 1016, 'must upgrade the already-published 1.8.2 APK');
});

test('codes increase through patch, minor and major rollovers without collisions', () => {
  const releases = ['0.0.1', '0.99.99', '1.0.0', '1.8.3', '1.8.99', '1.9.0', '1.99.99', '2.0.0'];
  const codes = releases.map(tag => androidVersion(tag).code);
  assert.equal(new Set(codes).size, releases.length);
  assert.ok(codes.every((value, index) => index === 0 || value > codes[index - 1]));
  for (const tag of ['1.8.100', '1.100.0', '0.100.0']) assert.throws(() => androidVersion(tag), /below 100/);
});

test('invalid, noncanonical and prerelease tags cannot silently choose an Android code', () => {
  for (const tag of [undefined, null, 10803, '', 'main', 'flixer-v1.8.3', 'dahsha-v1.8', '1.8.3.4', '01.8.3', '1.08.3', '1.8.03', '-1.8.3', '1.8.3-beta', '1.8.3+build', '1.8.3\n', '1.8.3\r\n', '1.8.3\nAPP_VERSION_CODE=1', ' 1.8.3']) assert.throws(() => androidVersion(tag), /Release tag/);
});

test('version codes obey Android positivity and the Play Store upper bound', () => {
  assert.equal(androidVersion('210000.0.0').code, MAX_ANDROID_VERSION_CODE);
  for (const tag of ['0.0.0', '210000.0.1', '210001.0.0', '9007199254740991.0.0', '9007199254740992.0.0']) assert.throws(() => androidVersion(tag));
});

test('CI environment output preserves earlier settings and writes only validated version fields', () => {
  const root = path.resolve(os.tmpdir()), dir = fs.mkdtempSync(path.join(root, 'dahsha-version-'));
  try {
    const file = path.join(dir, 'github-env'); fs.writeFileSync(file, 'EXISTING=value\n');
    assert.deepEqual(writeAndroidVersion('dahsha-v1.8.3', file), { name: '1.8.3', code: 10803 });
    assert.equal(fs.readFileSync(file, 'utf8'), 'EXISTING=value\nAPP_VERSION_NAME=1.8.3\nAPP_VERSION_CODE=10803\n');
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => writeAndroidVersion('1.8.100', file));
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'a rejected version must leave the workflow environment untouched');
    assert.throws(() => writeAndroidVersion('1.8.3', ''), /GITHUB_ENV/);
  } finally {
    assert.ok(path.resolve(dir).startsWith(root + path.sep) && path.basename(dir).startsWith('dahsha-version-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the release workflow derives both Android version fields from the release tag', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/android.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node scripts\/android-version\.js "\$RELEASE_TAG"/);
  assert.doesNotMatch(workflow, /APP_VERSION_CODE:.*run_number|1000 \+ GITHUB_RUN_NUMBER/);
});
