// Regression guard for Dahsha deliveries (contract C8), plus the small helpers the deploy paths
// share (catalogue fingerprint, deploy marker).
//
//   node scripts/check-regression.js [check] [--data <dir>] [--live <url>|none] [--baseline <file>]
//                                    [--restored <file>] [--write-baseline] [--threshold 0.05] [--force]
//       Compares the fresh export (<data>/status.json, default client/public/data) with the live
//       deploy (<live>/data/status.json, falling back to the baseline file kept in the snapshot) and,
//       with --restored, with the YouTube counts recorded right after the snapshot restore. Exits 1
//       when total or YouTube shows/episodes drop by more than the threshold (REGRESSION_THRESHOLD,
//       default 5%) unless REGRESSION_FORCE=1 or --force. --write-baseline stores the passing export
//       as the new baseline (server/data/deploy-baseline.json, which the snapshot carries).
//   node scripts/check-regression.js record --out <file> [--catalog server/data/catalog.json]
//       Records per-source counts of the restored catalogue for a later --restored comparison.
//   node scripts/check-regression.js changed [--data <dir>] [--live <url>|none]
//       Prints changed=true|false: does the fresh export differ from what production serves?
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIVE_BASE = process.env.DAHSHA_LIVE_URL || 'https://dahsha.vercel.app';
export const DEFAULT_THRESHOLD = 0.05;
export const SOURCES = ['youtube', 'myflixer', 'fmovies', 'hdtoday'];
// Totals alone cannot be the guard: provider growth hid a 3,097-episode YouTube loss in October.
export const GUARDED = [['shows'], ['episodes'], ['youtube', 'shows'], ['youtube', 'episodes']];
const YOUTUBE_ONLY = GUARDED.filter((metric) => metric[0] === 'youtube');
const INFO = SOURCES.filter((s) => s !== 'youtube').flatMap((s) => [[s, 'shows'], [s, 'episodes']]);
const PROVIDER_CHANNELS = new Set(['myflixer', 'fmovies', 'hdtoday']);
const EPISODE_PREFIX = { mf: 'myflixer', fm: 'fmovies', hd: 'hdtoday' };

export const isTruthy = (value) => /^(1|true|yes)$/i.test(String(value ?? '').trim());
export const dataDirectory = () => path.resolve(process.env.DATA_DIR || path.join(root, 'server', 'data'));

export function episodeSource(id) {
  const prefix = /^([a-z]+):/.exec(String(id))?.[1];
  return prefix ? EPISODE_PREFIX[prefix] || 'other' : 'youtube';
}

export function showSource(show) {
  const channel = show?.channelId || show?.channel?.id;
  if (PROVIDER_CHANNELS.has(channel)) return channel;
  if (channel) return 'youtube';
  const fromId = episodeSource(show?.id);
  return fromId === 'youtube' ? 'other' : fromId;
}

/** Per-source counts computed the same way for any catalogue (full server copy or lean export). */
export function countCatalog(catalog) {
  const bySource = Object.fromEntries(SOURCES.map((s) => [s, { shows: 0, episodes: 0 }]));
  const seen = new Set();
  for (const show of catalog?.shows || []) {
    const source = showSource(show);
    if (bySource[source]) bySource[source].shows++;
    for (const episode of show.episodes || []) {
      if (!episode?.id || seen.has(episode.id)) continue;
      seen.add(episode.id);
      const from = episodeSource(episode.id);
      if (bySource[from]) bySource[from].episodes++;
    }
  }
  return { shows: catalog?.shows?.length || 0, episodes: seen.size, bySource };
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function statusCounts(status) {
  const stats = status?.stats;
  if (!stats || typeof stats !== 'object') return null;
  return { shows: finite(stats.shows), episodes: finite(stats.episodes), bySource: stats.bySource && typeof stats.bySource === 'object' ? stats.bySource : null };
}

const valueOf = (counts, [a, b]) => finite(b ? counts?.bySource?.[a]?.[b] : counts?.[a]);

/** Compares two count sets; a guarded metric regresses when it drops by more than `threshold`. */
export function compareCounts(previous, next, { threshold = DEFAULT_THRESHOLD, label = 'previous', metrics = GUARDED, info = [] } = {}) {
  const rows = [];
  const warnings = new Set();
  for (const [metric, guarded] of [...metrics.map((m) => [m, true]), ...info.map((m) => [m, false])]) {
    const name = metric.join('.');
    const before = valueOf(previous, metric);
    const after = valueOf(next, metric);
    if (before === null || before <= 0) {
      if (guarded && metric.length > 1 && !previous?.bySource) warnings.add(`${label} has no per-source counts, so ${metric[0]} was not compared`);
      continue;
    }
    if (after === null) {
      if (guarded) warnings.add(`the fresh export has no ${name} count, so it was not compared with ${label}`);
      continue;
    }
    const change = (after - before) / before;
    rows.push({ check: label, metric: name, previous: before, next: after, change, guarded, regression: guarded && -change > threshold });
  }
  return { rows, regressions: rows.filter((row) => row.regression), warnings: [...warnings] };
}

/**
 * previous: status.json of the live deploy or of the stored baseline (C8).
 * restored: countCatalog() of the catalogue restored from the snapshot, compared with the
 * fresh export's catalogue on YouTube only, so the guard works before status.json has bySource.
 */
export function evaluate({ previous = null, previousLabel = 'live deploy', restored = null, nextStatus, nextCatalogCounts = null, threshold = DEFAULT_THRESHOLD, force = false }) {
  const checks = [];
  const warnings = [];
  const next = statusCounts(nextStatus);
  if (!next) throw new Error('the fresh export has no status.json stats');
  if (statusCounts(previous)) checks.push(compareCounts(statusCounts(previous), next, { threshold, label: previousLabel, info: INFO }));
  else warnings.push('no previous deploy or baseline was available, so totals were not compared');
  if (restored && !restored.missing && nextCatalogCounts) checks.push(compareCounts(restored, nextCatalogCounts, { threshold, label: 'restored snapshot', metrics: YOUTUBE_ONLY }));
  const rows = checks.flatMap((check) => check.rows);
  const regressions = rows.filter((row) => row.regression);
  warnings.push(...checks.flatMap((check) => check.warnings));
  return { ok: !regressions.length || Boolean(force), forced: Boolean(force) && regressions.length > 0, rows, regressions, warnings, threshold };
}

const fmt = (n) => Number(n).toLocaleString('en-US');
const pct = (n) => `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;

export function formatReport(result, { title = 'Dahsha regression check' } = {}) {
  const verdict = result.regressions.length ? (result.forced ? 'FORCED (regression overridden)' : 'FAILED') : 'passed';
  const lines = [`### ${title}: ${verdict}`, '', `A guarded count may not drop by more than ${(result.threshold * 100).toFixed(1)}%.`, ''];
  if (result.rows.length) {
    lines.push('| Compared with | Metric | Before | After | Change | |', '|---|---|---:|---:|---:|---|');
    for (const row of result.rows) lines.push(`| ${row.check} | ${row.metric} | ${fmt(row.previous)} | ${fmt(row.next)} | ${pct(row.change)} | ${row.regression ? '**REGRESSION**' : row.guarded ? 'ok' : 'info'} |`);
    lines.push('');
  }
  for (const warning of result.warnings) lines.push(`- Note: ${warning}`);
  if (result.regressions.length && !result.forced) lines.push('', 'Nothing was deployed and the data snapshot was not saved. If the drop is intended, re-run the workflow with `force` (or set `REGRESSION_FORCE=1`).');
  return lines.join('\n') + '\n';
}

/**
 * Stable content hash of an exported catalogue: show/episode identity and the fields people see.
 * Volatile values (generatedAt, view counts, provider sync stamps) are left out on purpose so an
 * hourly poll that found nothing new does not redeploy.
 */
export function fingerprintCatalog(catalog) {
  const hash = crypto.createHash('sha256');
  const byId = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
  const aliases = Object.entries(catalog?.idAliases || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const channels = [...(catalog?.channels || [])].sort(byId).map((c) => [c.id, c.title, c.shows, c.episodes, c.latestAt]);
  hash.update(JSON.stringify([catalog?.product || null, aliases, channels]));
  for (const show of [...(catalog?.shows || [])].sort(byId)) {
    hash.update(JSON.stringify([
      show.id, show.title, show.kind, show.lang, show.episodeCount, show.latestAt, show.portrait ?? null,
      show.posterId ?? show.posterVideoId ?? null, show.poster?.custom ?? null, show.blurb ?? null, show.tags ?? null,
      (show.episodes || []).map((e) => [e.id, e.title, e.season ?? null, e.number ?? null, e.publishedAt ?? null, e.durationSec ?? null]),
    ]) + '\n');
  }
  return hash.digest('hex');
}

/** data/deploy.json: what a deployment was built from, so later builds can compare. */
export function deployMarker({ catalog, status, generation = null, builtBy = 'unknown', commit = null, now = new Date() }) {
  return {
    product: catalog?.product || status?.product || null,
    generatedAt: status?.generatedAt || catalog?.generatedAt || null,
    fingerprint: fingerprintCatalog(catalog),
    dataGeneration: finite(generation),
    builtBy,
    commit,
    builtAt: now.toISOString(),
  };
}

/** True when production was built from a newer snapshot generation than this build's data. */
export function compareGeneration(liveMarker, generation) {
  const live = finite(liveMarker?.dataGeneration);
  const mine = finite(generation);
  if (live === null || mine === null) return { older: false, known: false, live, mine };
  return { older: mine < live, known: true, live, mine };
}

export async function fetchJson(url, { timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
  try {
    const target = new URL(url);
    target.searchParams.set('ts', String(Date.now())); // bypass the CDN copy (status.json max-age=300)
    const response = await fetchImpl(target, { signal: AbortSignal.timeout(timeoutMs), headers: { 'cache-control': 'no-cache' } });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    return { value: await response.json() };
  } catch (error) {
    return { error: error.message };
  }
}

export function readJsonFile(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, file);
}

function githubFile(name, text) {
  const file = process.env[name];
  if (file) { try { fs.appendFileSync(file, text); } catch (error) { console.warn(`[regression] cannot write ${name}: ${error.message}`); } }
}

function parseArgs(argv) {
  const commands = new Set(['check', 'record', 'changed']);
  const flags = new Set(['--force', '--write-baseline']);
  const options = { command: commands.has(argv[0]) ? argv[0] : 'check' };
  for (let i = commands.has(argv[0]) ? 1 : 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    if (flags.has(arg)) options[arg.slice(2)] = true;
    else options[arg.slice(2)] = argv[++i];
  }
  return options;
}

const liveUrl = (options, file) => (options.live === 'none' ? null : `${(options.live || LIVE_BASE).replace(/\/+$/, '')}/data/${file}`);

async function check(options) {
  const dataDir = path.resolve(options.data || path.join(root, 'client', 'public', 'data'));
  const baselineFile = path.resolve(options.baseline || path.join(dataDirectory(), 'deploy-baseline.json'));
  const threshold = Number(options.threshold ?? process.env.REGRESSION_THRESHOLD ?? DEFAULT_THRESHOLD);
  if (!(threshold >= 0 && threshold < 1)) throw new Error(`invalid threshold ${threshold}`);
  const force = Boolean(options.force) || isTruthy(process.env.REGRESSION_FORCE);
  const nextStatus = readJsonFile(path.join(dataDir, 'status.json'));
  if (!statusCounts(nextStatus)) { console.error(`[regression] no exported status.json with stats in ${dataDir}`); return 2; }

  let previous = null, previousLabel = 'live deploy';
  const url = liveUrl(options, 'status.json');
  if (url) {
    const live = await fetchJson(url);
    if (live.value && statusCounts(live.value)) previous = live.value;
    else console.warn(`[regression] live status unavailable (${live.error || 'no stats'}) - falling back to the stored baseline`);
  }
  if (!previous) {
    previous = readJsonFile(baselineFile);
    previousLabel = 'stored baseline';
    if (!statusCounts(previous)) previous = null;
  }
  const restored = options.restored ? readJsonFile(path.resolve(options.restored)) : null;
  const nextCatalogCounts = restored && !restored.missing ? countCatalog(readJsonFile(path.join(dataDir, 'catalog.json'))) : null;
  const result = evaluate({ previous, previousLabel, restored, nextStatus, nextCatalogCounts, threshold, force });

  const report = formatReport(result);
  console.log(report);
  githubFile('GITHUB_STEP_SUMMARY', report + '\n');
  githubFile('GITHUB_OUTPUT', `regression=${result.regressions.length ? 'true' : 'false'}\n`);
  if (!result.ok) {
    const worst = result.regressions.map((r) => `${r.metric} ${fmt(r.previous)} -> ${fmt(r.next)} (${pct(r.change)}, vs ${r.check})`).join('; ');
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Catalogue regression::${worst}. Not deploying; snapshot not saved. Re-run with force if intended.`);
    else console.error(`[regression] refusing: ${worst}`);
    return 1;
  }
  if (result.forced) console.warn('[regression] regression overridden by force');
  if (options['write-baseline']) {
    writeJsonFile(baselineFile, { product: nextStatus.product || null, generatedAt: nextStatus.generatedAt || null, stats: nextStatus.stats, savedAt: new Date().toISOString() });
    console.log(`[regression] baseline stored in ${baselineFile}`);
  }
  return 0;
}

function record(options) {
  if (!options.out) throw new Error('record needs --out <file>');
  const file = path.resolve(options.catalog || path.join(dataDirectory(), 'catalog.json'));
  const catalog = readJsonFile(file);
  const counts = catalog?.shows ? { ...countCatalog(catalog), generatedAt: catalog.generatedAt || null } : { missing: true };
  writeJsonFile(path.resolve(options.out), counts);
  console.log(counts.missing ? `[regression] no catalogue at ${file} - nothing recorded` : `[regression] restored catalogue: ${fmt(counts.shows)} shows, YouTube ${fmt(counts.bySource.youtube.shows)} shows / ${fmt(counts.bySource.youtube.episodes)} episodes`);
  return 0;
}

async function changed(options) {
  const dataDir = path.resolve(options.data || path.join(root, 'client', 'public', 'data'));
  const catalog = readJsonFile(path.join(dataDir, 'catalog.json'));
  if (!catalog?.shows) { console.error(`[regression] no exported catalogue in ${dataDir}`); return 2; }
  const fingerprint = fingerprintCatalog(catalog);
  const url = liveUrl(options, 'deploy.json');
  const live = url ? await fetchJson(url) : { error: 'live comparison disabled' };
  const isChanged = !live.value?.fingerprint || live.value.fingerprint !== fingerprint;
  const reason = live.value?.fingerprint ? (isChanged ? 'the catalogue differs from production' : 'production already serves this catalogue') : `production fingerprint unavailable (${live.error || 'no fingerprint'})`;
  console.log(`changed=${isChanged} - ${reason}`);
  githubFile('GITHUB_OUTPUT', `changed=${isChanged}\nfingerprint=${fingerprint}\n`);
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.command === 'record') return record(options);
  if (options.command === 'changed') return changed(options);
  return check(options);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
// exitCode, not exit(): exiting while fetch sockets close aborts Node on Windows.
if (invoked) {
  main().then((code) => { process.exitCode = code; }, (error) => { console.error(`[regression] ${error.message}`); process.exitCode = 2; });
}
