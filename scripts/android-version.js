import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_ANDROID_VERSION_CODE = 2100000000;

/** A release's numeric code must increase independently of workflow run numbers. */
export function androidVersion(tag) {
  const match = /^(?:dahsha-v|v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(typeof tag === 'string' ? tag : '');
  if (!match || match[0] !== tag) throw Error('Release tag must be dahsha-vMAJOR.MINOR.PATCH, vMAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH');
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger) || minor >= 100 || patch >= 100) throw Error('Android release components must be integers; minor and patch must be below 100');
  const code = major * 10000 + minor * 100 + patch;
  if (!Number.isSafeInteger(code) || code < 1 || code > MAX_ANDROID_VERSION_CODE) throw Error(`Android version code must be between 1 and ${MAX_ANDROID_VERSION_CODE}`);
  return { name: `${major}.${minor}.${patch}`, code };
}

export function writeAndroidVersion(tag, envFile) {
  const version = androidVersion(tag);
  if (typeof envFile !== 'string' || !envFile) throw Error('GITHUB_ENV is required to set the Android release version');
  fs.appendFileSync(envFile, `APP_VERSION_NAME=${version.name}\nAPP_VERSION_CODE=${version.code}\n`);
  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const version = writeAndroidVersion(process.argv[2] || process.env.RELEASE_TAG, process.env.GITHUB_ENV);
    console.log(`Android version ${version.name} (${version.code})`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
