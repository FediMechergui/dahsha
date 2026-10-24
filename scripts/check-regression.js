// Regression guard for Dahsha deliveries (contract C8), plus the small helpers the deploy paths
// share (catalogue fingerprint, deploy marker).
//
//   node scripts/check-regression.js [check] [--data <dir>] [--live <url>|none] [--baseline <file>]
//                                    [--restored <file>] [--sources <file>] [--write-baseline] [--force]
//                                    [--threshold 0.05] [--source-threshold 0.25] [--source-min 20]
//                                    [--peak-threshold 0.10] [--peak-days 7]
//       Compares the fresh export (<data>/status.json and catalog.json, default client/public/data) with
//         - the live deploy (<live>/data/status.json, falling back to the baseline file kept in the snapshot);
//         - with --restored, the counts recorded right after the snapshot restore;
//         - the peak of the passing runs of the last --peak-days days (the history in the baseline file),
//           so an erosion that stays under the per-run threshold on every run is still caught.
//       Exits 1, unless REGRESSION_FORCE=1 or --force, when
//         - total or YouTube shows/episodes drop by more than the threshold (REGRESSION_THRESHOLD,
//           default 5%) against the live deploy or the restored snapshot;
//         - one of them is more than REGRESSION_PEAK_THRESHOLD (default 10%) below its peak;
//         - a source of sources.json that had at least REGRESSION_SOURCE_MIN (default 20) episodes loses
//           more than REGRESSION_SOURCE_THRESHOLD (default 25%) of them, against any of the three.
//           Per-source counts come from stats.bySource when both sides carry it (contract 3) and are
//           otherwise counted from the catalogues; either way an episode counts for the channel that
//           uploaded it (its channelId in a programme group's show, else the show's channel). A source's
//           show count is reported, not guarded: titles merge or split when the grouping rules change
//           (VICE News 682 -> 396 shows, 3,253 episodes kept). FMovies/HDToday and sources no longer
//           configured are reported, not guarded.
//       Sources of sources.json (--sources, default server/data/sources.json) without a single show (and
//       without episodes in another source's show, by their channelId) are
//       reported as warnings (::warning in Actions), and the documentary / uncertain classification counts
//       are printed: stats.classification when present, else the shows' own classification counted in the
//       export.
//       --write-baseline stores the passing export and the updated peak history as the new baseline
//       (server/data/deploy-baseline.json, which the snapshot carries). A forced pass over a regression
//       restarts the history from the accepted counts.
//   node scripts/check-regression.js record --out <file> [--catalog server/data/catalog.json]
//       Records per-source counts of the restored catalogue for a later --restored comparison.
//   node scripts/check-regression.js changed [--data <dir>] [--live <url>|none]
//       Prints changed=true|false: does the fresh export differ from what production serves?
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIVE_BASE = process.env.DAHSHA_LIVE_URL || 'https://dahsha.netlify.app';
export const DEFAULT_THRESHOLD = 0.05;
// One source may lose this share of its episodes in a run (or below its peak) once it has at least
// SOURCE_MIN_COUNT of them; smaller sources are reported only. The October outage emptied whole
// channels (HISTORY lost 44% of its episodes, FRONTLINE 38%) while YouTube as a whole lost 18%.
export const SOURCE_THRESHOLD = 0.25;
export const SOURCE_MIN_COUNT = 20;
// Per-source fields that can fail the check; show counts change with the grouping rules.
export const SOURCE_GUARDED_FIELDS = ['episodes'];
// Totals and YouTube counts may sit at most this far below their peak of the last PEAK_DAYS days of
// passing runs: the October erosion lost ~1% per run (3,097 YouTube episodes over 14 runs).
export const PEAK_THRESHOLD = 0.10;
export const PEAK_DAYS = 7;
export const SOURCES = ['youtube', 'myflixer', 'fmovies', 'hdtoday'];
// Totals alone cannot be the guard: provider growth hid a 3,097-episode YouTube loss in October.
export const GUARDED = [['shows'], ['episodes'], ['youtube', 'shows'], ['youtube', 'episodes']];
const YOUTUBE_ONLY = GUARDED.filter((metric) => metric[0] === 'youtube');
const INFO = [
  ...SOURCES.filter((s) => s !== 'youtube').flatMap((s) => [[s, 'shows'], [s, 'episodes']]),
  ['classification', 'documentary'], ['classification', 'uncertain'],
];
const PROVIDER_CHANNELS = new Set(['myflixer', 'fmovies', 'hdtoday']);
// Provider rows scraped by the best-effort provider step: guarded by the totals, not per source.
const PROVIDER_ONLY = new Set(['fmovies', 'hdtoday']);
const EPISODE_PREFIX = { mf: 'myflixer', fm: 'fmovies', hd: 'hdtoday' };
const FIELDS = ['shows', 'episodes'];
const DAY = 864e5;

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

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function sourceTitles(catalog) {
  const titles = {};
  for (const s of [...(catalog?.channels || []), ...(catalog?.sources || [])]) if (s?.id && (s.title || s.short)) titles[s.id] = s.title || s.short;
  return titles;
}

/** stats.classification ({documentary, uncertain}, contract 3) or null. */
export function classificationOf(stats) {
  const c = stats?.classification;
  if (!isObject(c)) return null;
  const out = { documentary: finite(c.documentary), uncertain: finite(c.uncertain) };
  return out.documentary === null && out.uncertain === null ? null : out;
}

/** stats.bySource as {[sourceId]: {title, shows, episodes}} (contract 3); null when absent or in the old per-group form. */
export function sourceStats(stats) {
  const map = stats?.bySource;
  if (!isObject(map) || 'youtube' in map) return null;
  const out = {};
  for (const [id, v] of Object.entries(map)) {
    if (!isObject(v) || (finite(v.shows) === null && finite(v.episodes) === null)) continue;
    out[id] = { title: typeof v.title === 'string' && v.title ? v.title : id, shows: finite(v.shows) ?? 0, episodes: finite(v.episodes) ?? 0 };
  }
  return Object.keys(out).length ? out : null;
}

/** Per-source counts summed into the youtube / myflixer / fmovies / hdtoday groups. */
export function groupTotals(perSource) {
  const groups = Object.fromEntries(SOURCES.map((s) => [s, { shows: 0, episodes: 0 }]));
  for (const [id, v] of Object.entries(perSource || {})) {
    const group = PROVIDER_CHANNELS.has(id) ? id : 'youtube';
    groups[group].shows += finite(v?.shows) ?? 0;
    groups[group].episodes += finite(v?.episodes) ?? 0;
  }
  return groups;
}

/**
 * Per-source counts computed the same way for any catalogue (full server copy or lean export):
 * bySource per group (youtube, myflixer, fmovies, hdtoday), byChannel per source id ({title, shows,
 * episodes}: the shows it presents and the episodes it uploaded, an episode of the show's own kind
 * being credited to its channelId when it carries one, else to the show's channel, as stats.bySource
 * counts them), contributed (per source id, the episodes it gives another source's show: a programme
 * group's show carries each episode's channelId, so New Media Academy Life's episodes of الدحيح are
 * its own count and its guard, although AJ+ كبريت presents the show), classifiedShows (shows built
 * from classified uploads, by show.classification.status), plus stats.bySource and
 * stats.classification when the catalogue carries them.
 */
export function countCatalog(catalog) {
  const bySource = Object.fromEntries(SOURCES.map((s) => [s, { shows: 0, episodes: 0 }]));
  const titles = sourceTitles(catalog);
  const byChannel = {};
  const contributed = {};
  const classifiedShows = { documentary: 0, uncertain: 0 };
  const seen = new Set();
  const rowOf = (id, title = null) => (byChannel[id] ??= { title: titles[id] || title || id, shows: 0, episodes: 0 });
  for (const show of catalog?.shows || []) {
    const source = showSource(show);
    if (bySource[source]) bySource[source].shows++;
    const status = show?.classification?.status;
    if (status === 'documentary' || status === 'uncertain') classifiedShows[status]++;
    const channel = show?.channelId || show?.channel?.id;
    const own = channel ? rowOf(channel, show?.channel?.title) : null;
    if (own) own.shows++;
    for (const episode of show.episodes || []) {
      if (!episode?.id || seen.has(episode.id)) continue;
      seen.add(episode.id);
      const from = episodeSource(episode.id);
      if (bySource[from]) bySource[from].episodes++;
      if (!own || from !== source) continue;
      const by = typeof episode.channelId === 'string' && episode.channelId ? episode.channelId : channel;
      rowOf(by).episodes++;
      if (by !== channel) contributed[by] = (contributed[by] || 0) + 1;
    }
  }
  return {
    shows: catalog?.shows?.length || 0, episodes: seen.size, bySource, byChannel, contributed, classifiedShows,
    statsBySource: sourceStats(catalog?.stats), classification: classificationOf(catalog?.stats),
  };
}

export function statusCounts(status) {
  const stats = status?.stats;
  if (!isObject(stats)) return null;
  const legacy = isObject(stats.bySource) && 'youtube' in stats.bySource ? stats.bySource : null;
  const sources = sourceStats(stats);
  return { shows: finite(stats.shows), episodes: finite(stats.episodes), bySource: legacy || (sources ? groupTotals(sources) : null), sources, classification: classificationOf(stats) };
}

const valueOf = (counts, [a, b]) => finite(!b ? counts?.[a] : a === 'classification' ? counts?.classification?.[b] : counts?.bySource?.[a]?.[b]);

/** Compares two count sets; a guarded metric regresses when it drops by more than `threshold`. */
export function compareCounts(previous, next, { threshold = DEFAULT_THRESHOLD, label = 'previous', metrics = GUARDED, info = [], fallback = null } = {}) {
  const rows = [];
  const warnings = new Set();
  for (const [metric, guarded] of [...metrics.map((m) => [m, true]), ...info.map((m) => [m, false])]) {
    const name = metric.join('.');
    const before = valueOf(previous, metric);
    const after = valueOf(next, metric);
    if (before === null || before <= 0) {
      if (guarded && metric.length > 1 && !previous?.bySource) warnings.add(`${label} has no per-source counts, so ${metric[0]} was ${fallback ? `compared with ${fallback} only` : 'not compared'}`);
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

/** Configured source ids (sources.json, else the catalogue's own list without the provider rows). */
export function configuredSources(sources, catalog = null) {
  const list = Array.isArray(sources) ? sources : Array.isArray(sources?.sources) ? sources.sources : null;
  if (list) return list.filter((s) => s?.id && !s.disabled && s.enabled !== false);
  const own = (catalog?.sources || []).filter((s) => s?.id && !PROVIDER_ONLY.has(s.id) && !s.disabled && s.enabled !== false);
  return own.length ? own : null;
}

/**
 * Per-source comparison: maps of {[sourceId]: {title, shows, episodes}}. A source absent from `next`
 * has 0. Only configured sources (all, when `configured` is null) with at least `minCount` before are
 * guarded; a regression is a drop of more than `threshold`.
 */
export function compareSources(previous, next, { threshold = SOURCE_THRESHOLD, minCount = SOURCE_MIN_COUNT, label = 'previous', configured = null } = {}) {
  const rows = [];
  if (!isObject(previous) || !isObject(next)) return { rows, regressions: [] };
  for (const [id, before] of Object.entries(previous)) {
    const active = !configured || configured.has(id);
    const title = next[id]?.title || before?.title || id;
    for (const field of FIELDS) {
      const was = finite(before?.[field]);
      if (was === null || was <= 0) continue;
      const now = finite(next[id]?.[field]) ?? 0;
      const change = (now - was) / was;
      const guarded = active && was >= minCount && SOURCE_GUARDED_FIELDS.includes(field);
      rows.push({ check: label, metric: `sources.${id}.${field}`, source: id, title, field, previous: was, next: now, change, guarded, configured: active, regression: guarded && -change > threshold });
    }
  }
  return { rows, regressions: rows.filter((row) => row.regression) };
}

/**
 * Configured sources that have no show at all in the fresh catalogue, nor episodes in another source's
 * show (`contributed`, countCatalog: Museum of The Future's season of الدحيح, presented by AJ+ كبريت).
 */
export function emptySources(sources, counts, contributed = null) {
  if (!Array.isArray(sources) || !isObject(counts)) return [];
  const gives = (id) => (finite(isObject(contributed) ? contributed[id] : null) ?? 0) > 0;
  return sources.filter((s) => s?.id && !((finite(counts[s.id]?.shows) ?? 0) > 0) && !gives(s.id)).map((s) => ({ id: s.id, title: s.title || s.short || s.id }));
}

// ---- peak history (deploy-baseline.json `history`) ----------------------------------------------------
const dayKey = (date) => new Date(date).toISOString().slice(0, 10);
const validDay = (entry) => isObject(entry) && typeof entry.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.day) && isObject(entry.metrics);

/** The counts the history tracks: totals, YouTube and each source's shows/episodes ("source:<id>.<field>"). */
export function peakMetrics(status, catalogCounts) {
  const metrics = {};
  const put = (name, value) => { if (finite(value) !== null) metrics[name] = value; };
  put('shows', status?.stats?.shows);
  put('episodes', status?.stats?.episodes);
  if (catalogCounts) {
    for (const field of FIELDS) put(`youtube.${field}`, catalogCounts.bySource?.youtube?.[field]);
    for (const [id, v] of Object.entries(catalogCounts.byChannel || {})) for (const field of FIELDS) put(`source:${id}.${field}`, v?.[field]);
  }
  return metrics;
}

/** The history of a baseline file; an older baseline without one seeds it with its own totals. */
export function historyOf(baseline) {
  if (Array.isArray(baseline?.history)) return baseline.history.filter(validDay);
  const counts = statusCounts(baseline);
  const at = Date.parse(baseline?.savedAt || baseline?.generatedAt || '');
  if (!counts || !Number.isFinite(at)) return [];
  const metrics = {};
  if (counts.shows !== null) metrics.shows = counts.shows;
  if (counts.episodes !== null) metrics.episodes = counts.episodes;
  return Object.keys(metrics).length ? [{ day: dayKey(at), at: new Date(at).toISOString(), metrics }] : [];
}

/** Highest value of every metric over the days of the window (today included): {name: {value, day}}. */
export function peakOf(history, { now = new Date(), days = PEAK_DAYS } = {}) {
  const since = dayKey(now.getTime() - days * DAY);
  const peak = {};
  for (const entry of history || []) {
    if (!validDay(entry) || entry.day <= since) continue;
    for (const [name, value] of Object.entries(entry.metrics)) if (finite(value) !== null && !(peak[name]?.value >= value)) peak[name] = { value, day: entry.day };
  }
  return peak;
}

/** Adds this run to the history: one entry per UTC day holding that day's highest values. */
export function updateHistory(history, metrics, { now = new Date(), days = PEAK_DAYS, reset = false } = {}) {
  const day = dayKey(now);
  const since = dayKey(now.getTime() - Math.max(1, days || PEAK_DAYS) * DAY);
  const valid = reset ? [] : (history || []).filter(validDay);
  const today = valid.find((e) => e.day === day)?.metrics || {};
  const merged = { ...today };
  for (const [name, value] of Object.entries(metrics || {})) if (finite(value) !== null) merged[name] = Math.max(value, finite(merged[name]) ?? value);
  return [...valid.filter((e) => e.day > since && e.day !== day), { day, at: now.toISOString(), metrics: merged }].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Compares this run with the peak: totals/YouTube with `threshold`, sources like compareSources. */
export function comparePeak(peak, metrics, { threshold = PEAK_THRESHOLD, sourceThreshold = SOURCE_THRESHOLD, minCount = SOURCE_MIN_COUNT, configured = null, titles = {}, label = 'peak' } = {}) {
  const rows = [];
  for (const [name, { value: before, day }] of Object.entries(peak || {})) {
    if (!(before > 0)) continue;
    const source = /^source:(.+)\.(shows|episodes)$/.exec(name);
    if (source) {
      const [, id, field] = source;
      const now = finite(metrics[name]) ?? 0;
      const change = (now - before) / before;
      const active = !configured || configured.has(id);
      const guarded = active && before >= minCount && SOURCE_GUARDED_FIELDS.includes(field);
      rows.push({ check: label, metric: `sources.${id}.${field}`, source: id, title: titles[id] || id, field, previous: before, next: now, change, guarded, configured: active, peakDay: day, regression: guarded && -change > sourceThreshold });
      continue;
    }
    const guarded = GUARDED.some((m) => m.join('.') === name);
    const now = finite(metrics[name]);
    if (!guarded || now === null) continue;
    const change = (now - before) / before;
    rows.push({ check: label, metric: name, previous: before, next: now, change, guarded, peakDay: day, regression: -change > threshold });
  }
  return { rows, regressions: rows.filter((row) => row.regression) };
}

/**
 * previous: status.json of the live deploy or of the stored baseline (C8).
 * restored: countCatalog() of the catalogue restored from the snapshot, compared with the
 * fresh export's catalogue on YouTube only, so the guard works before status.json has bySource.
 * perSource: also compare every source (stats.bySource when both sides have it, else the catalogues'
 * byChannel counts) and report configured sources with no show. history: the baseline's peak history.
 */
export function evaluate({
  previous = null, previousLabel = 'live deploy', restored = null, nextStatus, nextCatalogCounts = null, threshold = DEFAULT_THRESHOLD, force = false,
  perSource = false, sources = null, sourceThreshold = SOURCE_THRESHOLD, sourceMin = SOURCE_MIN_COUNT,
  history = null, peakThreshold = PEAK_THRESHOLD, peakDays = PEAK_DAYS, now = new Date(),
}) {
  const checks = [];
  const warnings = [];
  const next = statusCounts(nextStatus);
  if (!next) throw new Error('the fresh export has no status.json stats');
  const prev = statusCounts(previous);
  const configured = sources ? new Set(sources.map((s) => s.id)) : null;
  const sourceOptions = { threshold: sourceThreshold, minCount: sourceMin, configured };
  const compared = {};
  const sourceCheck = (before, after, label) => {
    const check = compareSources(before, after, { ...sourceOptions, label });
    compared[label] = Object.keys(before).length;
    checks.push(check);
  };
  if (prev) {
    const fallback = restored && !restored.missing && nextCatalogCounts ? 'the restored snapshot' : null;
    checks.push(compareCounts(prev, next, { threshold, label: previousLabel, info: INFO, fallback }));
    if (perSource && prev.sources && next.sources) sourceCheck(prev.sources, next.sources, previousLabel);
    else if (perSource && next.sources) warnings.push(`${previousLabel} has no stats.bySource, so its sources were not compared one by one`);
  } else warnings.push('no previous deploy or baseline was available, so totals were not compared');
  if (restored && !restored.missing && nextCatalogCounts) {
    checks.push(compareCounts(restored, nextCatalogCounts, { threshold, label: 'restored snapshot', metrics: YOUTUBE_ONLY }));
    if (perSource) {
      const both = restored.statsBySource && nextCatalogCounts.statsBySource;
      const before = both ? restored.statsBySource : restored.byChannel;
      const after = both ? nextCatalogCounts.statsBySource : nextCatalogCounts.byChannel;
      if (before && after) sourceCheck(before, after, 'restored snapshot');
    }
  }
  if (history && peakDays > 0) {
    const peak = peakOf(history, { now, days: peakDays });
    const titles = Object.fromEntries(Object.entries(nextCatalogCounts?.byChannel || {}).map(([id, v]) => [id, v.title]));
    if (Object.keys(peak).length) {
      const label = `${peakDays}-day peak`;
      const check = comparePeak(peak, peakMetrics(nextStatus, nextCatalogCounts), { threshold: peakThreshold, sourceThreshold, minCount: sourceMin, configured, titles, label });
      if (!perSource) { check.rows = check.rows.filter((row) => !row.source); check.regressions = check.regressions.filter((row) => !row.source); }
      compared[label] = Object.keys(peak).filter((name) => name.startsWith('source:') && name.endsWith('.shows')).length;
      checks.push(check);
    }
  }
  const empty = perSource ? emptySources(sources, nextCatalogCounts?.byChannel || next.sources, nextCatalogCounts?.contributed) : [];
  for (const s of empty) warnings.push(`${s.title} (${s.id}) is in sources.json but has no show in this export`);
  const rows = checks.flatMap((check) => check.rows);
  const regressions = rows.filter((row) => row.regression);
  warnings.push(...checks.flatMap((check) => check.warnings || []));
  return {
    ok: !regressions.length || Boolean(force), forced: Boolean(force) && regressions.length > 0, rows, regressions, warnings, threshold,
    ...(perSource ? { sourceThreshold, sourceMin, sourcesCompared: compared } : {}),
    ...(history && peakDays > 0 ? { peakThreshold, peakDays } : {}),
    emptySources: empty, classification: next.classification, previousClassification: prev?.classification || null,
    classifiedShows: nextCatalogCounts?.classifiedShows || null,
  };
}

const fmt = (n) => Number(n).toLocaleString('en-US');
const pct = (n) => `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
const rowName = (row) => (row.source ? `${row.title} ${row.field}` : row.metric);
// Channel titles may contain "|" (FRONTLINE PBS | Official), which would split a Markdown table cell.
const cell = (text) => String(text).replace(/\|/g, '\\|');
const sourceLabel = (row) => cell(row.title && row.title !== row.source ? `${row.title} (${row.source})` : row.source);
const sourceState = (row) => (row.regression ? '**REGRESSION**'
  : !row.configured ? (PROVIDER_ONLY.has(row.source) ? 'provider, totals only' : 'not in sources.json')
    : row.guarded ? 'ok' : !SOURCE_GUARDED_FIELDS.includes(row.field) ? 'info' : 'small source');
const ERROR_ROWS = 6;

export function formatReport(result, { title = 'Dahsha regression check' } = {}) {
  const verdict = result.regressions.length ? (result.forced ? 'FORCED (regression overridden)' : 'FAILED') : 'passed';
  const limits = [`by more than ${(result.threshold * 100).toFixed(1)}% in one run`];
  if (result.peakDays) limits.push(`more than ${(result.peakThreshold * 100).toFixed(1)}% below its ${result.peakDays}-day peak`);
  const lines = [`### ${title}: ${verdict}`, '', `A guarded count may not drop ${limits.join(' or sit ')}.`];
  if (result.sourceThreshold !== undefined) lines.push(`A source with at least ${fmt(result.sourceMin)} episodes may not lose more than ${(result.sourceThreshold * 100).toFixed(1)}% of them; its show count is reported only, since titles merge or split when the grouping rules change.`);
  lines.push('');
  const main = result.rows.filter((row) => !row.source);
  if (main.length) {
    lines.push('| Compared with | Metric | Before | After | Change | |', '|---|---|---:|---:|---:|---|');
    for (const row of main) lines.push(`| ${row.check}${row.peakDay ? ` (${row.peakDay})` : ''} | ${row.metric} | ${fmt(row.previous)} | ${fmt(row.next)} | ${pct(row.change)} | ${row.regression ? '**REGRESSION**' : row.guarded ? 'ok' : 'info'} |`);
    lines.push('');
  }
  if (result.sourcesCompared) {
    const sourceRows = result.rows.filter((row) => row.source);
    // Only drops worth a look: the full per-source table would be ~150 rows on every run.
    const notable = sourceRows.filter((row) => row.regression || row.next === 0 || -row.change > result.threshold)
      .sort((a, b) => Number(b.regression) - Number(a.regression) || a.change - b.change);
    const counted = Object.entries(result.sourcesCompared).map(([label, n]) => `${n} with ${label}`).join(', ');
    if (!counted) lines.push('Per source: nothing to compare with.', '');
    else if (!notable.length) lines.push(`Per source: compared ${counted}; no source dropped by more than ${(result.threshold * 100).toFixed(1)}%.`, '');
    else {
      lines.push(`Per source: compared ${counted}. Drops of more than ${(result.threshold * 100).toFixed(1)}%:`, '', '| Compared with | Source | Metric | Before | After | Change | |', '|---|---|---|---:|---:|---:|---|');
      for (const row of notable) lines.push(`| ${row.check}${row.peakDay ? ` (${row.peakDay})` : ''} | ${sourceLabel(row)} | ${row.field} | ${fmt(row.previous)} | ${fmt(row.next)} | ${pct(row.change)} | ${sourceState(row)} |`);
      lines.push('');
    }
  }
  const counts = (c) => `${c.documentary === null ? '?' : fmt(c.documentary)} documentary, ${c.uncertain === null ? '?' : fmt(c.uncertain)} uncertain`;
  if (result.classification) {
    const before = result.previousClassification ? ` (before: ${counts(result.previousClassification)})` : '';
    lines.push(`Classification: ${counts(result.classification)}${before}.`, '');
  } else if (result.classifiedShows) lines.push(`Classification (stats.classification absent; shows built from classified uploads, counted in the export): ${counts(result.classifiedShows)}.`, '');
  for (const warning of result.warnings) lines.push(`- Note: ${warning}`);
  if (result.regressions.length && !result.forced) lines.push('', 'Nothing was deployed and the data snapshot was not saved. If the drop is intended, re-run the workflow with `force` (or set `REGRESSION_FORCE=1`); a forced pass also restarts the peak history.');
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
      // updatedAt: a provider date-only change (new episodesAddedAt, a discovery) also counts as a change.
      show.id, show.title, show.kind, show.lang, show.episodeCount, show.latestAt, show.updatedAt ?? null, show.portrait ?? null,
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

// GitHub reads a workflow command only at the start of a line. Its message escapes %, CR and LF, and
// a property (the title) also escapes ":" and ",".
const escapeData = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (text) => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
export const workflowCommand = (kind, title, message) => `::${kind} title=${escapeProperty(title)}::${escapeData(message)}`;

const FLAGS = new Set(['force', 'write-baseline']);
const VALUE_OPTIONS = new Set(['data', 'live', 'baseline', 'restored', 'sources', 'threshold', 'source-threshold', 'source-min', 'peak-threshold', 'peak-days', 'out', 'catalog']);

export function parseArgs(argv) {
  const commands = new Set(['check', 'record', 'changed']);
  const options = { command: commands.has(argv[0]) ? argv[0] : 'check' };
  for (let i = commands.has(argv[0]) ? 1 : 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    const name = arg.slice(2);
    if (FLAGS.has(name)) options[name] = true;
    else if (!VALUE_OPTIONS.has(name)) throw new Error(`unknown option ${arg}`);
    else if (i + 1 >= argv.length || String(argv[i + 1]).startsWith('--')) throw new Error(`${arg} needs a value`);
    else options[name] = argv[++i];
  }
  return options;
}

const liveUrl = (options, file) => (options.live === 'none' ? null : `${(options.live || LIVE_BASE).replace(/\/+$/, '')}/data/${file}`);

function share(options, flag, envName, fallback) {
  const raw = options[flag] ?? process.env[envName];
  const value = raw === undefined || String(raw).trim() === '' ? fallback : Number(raw);
  if (!(value >= 0 && value < 1)) throw new Error(`invalid ${flag} ${raw}`);
  return value;
}

function count(options, flag, envName, fallback) {
  const raw = options[flag] ?? process.env[envName];
  const value = raw === undefined || String(raw).trim() === '' ? fallback : Number(raw);
  if (!(Number.isInteger(value) && value >= 0)) throw new Error(`invalid ${flag} ${raw}`);
  return value;
}

export async function check(options, { now = new Date(), fetchImpl } = {}) {
  const dataDir = path.resolve(options.data || path.join(root, 'client', 'public', 'data'));
  const baselineFile = path.resolve(options.baseline || path.join(dataDirectory(), 'deploy-baseline.json'));
  const threshold = share(options, 'threshold', 'REGRESSION_THRESHOLD', DEFAULT_THRESHOLD);
  const sourceThreshold = share(options, 'source-threshold', 'REGRESSION_SOURCE_THRESHOLD', SOURCE_THRESHOLD);
  const peakThreshold = share(options, 'peak-threshold', 'REGRESSION_PEAK_THRESHOLD', PEAK_THRESHOLD);
  const sourceMin = count(options, 'source-min', 'REGRESSION_SOURCE_MIN', SOURCE_MIN_COUNT);
  const peakDays = count(options, 'peak-days', 'REGRESSION_PEAK_DAYS', PEAK_DAYS);
  const force = Boolean(options.force) || isTruthy(process.env.REGRESSION_FORCE);
  const nextStatus = readJsonFile(path.join(dataDir, 'status.json'));
  if (!statusCounts(nextStatus)) { console.error(`[regression] no exported status.json with stats in ${dataDir}`); return 2; }
  const nextCatalog = readJsonFile(path.join(dataDir, 'catalog.json'));
  const nextCatalogCounts = nextCatalog?.shows ? countCatalog(nextCatalog) : null;
  if (!nextCatalogCounts) console.warn(`[regression] no exported catalog.json in ${dataDir} - YouTube and per-source counts were not compared`);
  const sourcesFile = path.resolve(options.sources || path.join(dataDirectory(), 'sources.json'));
  const sources = configuredSources(readJsonFile(sourcesFile), nextCatalog);

  const baseline = readJsonFile(baselineFile);
  let previous = null, previousLabel = 'live deploy';
  const url = liveUrl(options, 'status.json');
  if (url) {
    const live = await fetchJson(url, fetchImpl ? { fetchImpl } : undefined);
    if (live.value && statusCounts(live.value)) previous = live.value;
    else console.warn(`[regression] live status unavailable (${live.error || 'no stats'}) - falling back to the stored baseline`);
  }
  if (!previous && statusCounts(baseline)) {
    previous = baseline;
    previousLabel = 'stored baseline';
  }
  const history = historyOf(baseline);
  const restored = options.restored ? readJsonFile(path.resolve(options.restored)) : null;
  const result = evaluate({
    previous, previousLabel, restored, nextStatus, nextCatalogCounts, threshold, force,
    perSource: true, sources, sourceThreshold, sourceMin, history, peakThreshold, peakDays, now,
  });

  const report = formatReport(result);
  console.log(report);
  githubFile('GITHUB_STEP_SUMMARY', report + '\n');
  githubFile('GITHUB_OUTPUT', `regression=${result.regressions.length ? 'true' : 'false'}\nempty_sources=${result.emptySources.length}\n`);
  if (process.env.GITHUB_ACTIONS) for (const s of result.emptySources) console.log(workflowCommand('warning', 'Source without shows', `${s.title} (${s.id}) is listed in sources.json but has no show in this export.`));
  if (!result.ok) {
    const listed = result.regressions.map((r) => `${rowName(r)} ${fmt(r.previous)} -> ${fmt(r.next)} (${pct(r.change)}, vs ${r.check})`);
    const worst = listed.slice(0, ERROR_ROWS).join('; ') + (listed.length > ERROR_ROWS ? `; and ${listed.length - ERROR_ROWS} more (see the step summary)` : '');
    if (process.env.GITHUB_ACTIONS) console.log(workflowCommand('error', 'Catalogue regression', `${worst}. Not deploying; snapshot not saved. Re-run with force if intended.`));
    else console.error(`[regression] refusing: ${worst}`);
    return 1;
  }
  if (result.forced) console.warn('[regression] regression overridden by force');
  if (options['write-baseline']) {
    const reset = result.forced;
    const updated = updateHistory(reset ? [] : history, peakMetrics(nextStatus, nextCatalogCounts), { now, days: peakDays, reset });
    writeJsonFile(baselineFile, { product: nextStatus.product || null, generatedAt: nextStatus.generatedAt || null, stats: nextStatus.stats, savedAt: now.toISOString(), history: updated });
    console.log(`[regression] baseline stored in ${baselineFile}${reset ? ' (peak history restarted from these counts)' : ''}`);
  }
  return 0;
}

function record(options) {
  if (!options.out) throw new Error('record needs --out <file>');
  const file = path.resolve(options.catalog || path.join(dataDirectory(), 'catalog.json'));
  const catalog = readJsonFile(file);
  const counts = catalog?.shows ? { ...countCatalog(catalog), generatedAt: catalog.generatedAt || null } : { missing: true };
  writeJsonFile(path.resolve(options.out), counts);
  const classified = counts.classification || counts.classifiedShows;
  console.log(counts.missing ? `[regression] no catalogue at ${file} - nothing recorded` : `[regression] restored catalogue: ${fmt(counts.shows)} shows, YouTube ${fmt(counts.bySource.youtube.shows)} shows / ${fmt(counts.bySource.youtube.episodes)} episodes, ${fmt(Object.keys(counts.byChannel).length)} sources${classified ? `; classification ${classified.documentary ?? '?'} documentary / ${classified.uncertain ?? '?'} uncertain` : ''}`);
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
