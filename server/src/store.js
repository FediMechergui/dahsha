// JSON persistence under server/data. Writes are atomic (tmp + rename).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export function dataDirectory(env=process.env) {
  // NETLIFY is also set during builds, which must read their restored snapshot.
  // Lambda's runtime marker identifies the read-only deployed filesystem.
  return env.DATA_DIR || (env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME ? path.join(os.tmpdir(), `stream-library-${env.APP_PRODUCT || 'dahsha'}`) : path.resolve(__dirname, '../data'));
}
export const DATA_DIR = dataDirectory();
fs.mkdirSync(DATA_DIR, { recursive: true });

export function readJson(name, fallback) {
  const file = path.join(DATA_DIR, name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[store] ${name}: ${e.message}`);
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

export function writeJson(name, data) {
  const file = path.join(DATA_DIR, name);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

export const DEFAULT_SOURCES = {
  sources: [
    {
      type: 'channel',
      id: 'UCLiTe0aOHShx7hXGyqZ9UIw',
      title: 'Nat Geo Abu Dhabi',
      url: 'https://www.youtube.com/@natgeoabudhabime',
      addedAt: '2026-10-12T00:00:00.000Z',
    },
  ],
};

export const DEFAULT_OVERRIDES = {
  // Episodes shorter than this are treated as promos/clips and never listed as episodes.
  minEpisodeSeconds: 420,
  // Map alternative spellings to a canonical show title (normalized comparison).
  aliases: {},
  // Per-show overrides keyed by show id (see catalog.json) or by exact show title.
  shows: {},
};
