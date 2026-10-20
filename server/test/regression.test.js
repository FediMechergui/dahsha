// scripts/check-regression.js: per-source drops, the peak history that catches slow erosion, empty
// sources and classification counts, plus the workflow wiring around the provider step and the
// snapshot save.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PEAK_DAYS, countCatalog, statusCounts, sourceStats, configuredSources, compareSources, emptySources, evaluate, formatReport,
  peakMetrics, historyOf, peakOf, updateHistory, workflowCommand, parseArgs, check, main,
} from '../../scripts/check-regression.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOUR = 36e5;
const START = Date.parse('2026-10-19T00:17:00Z');

const SOURCES = { sources: [
  { type: 'channel', id: 'UCbig', title: 'Big Channel', lang: 'en' },
  { type: 'channel', id: 'UCfront', title: 'FRONTLINE PBS | Official', lang: 'en' },
  { type: 'channel', id: 'UCsmall', title: 'Small Channel', lang: 'en' },
  { type: 'channel', id: 'UCnew', title: 'New Channel', lang: 'ar' },
  { type: 'myflixer', id: 'myflixer', title: 'Myflixer Documentaries', lang: 'en' },
] };
const configured = configuredSources(SOURCES);

/** A catalogue with `shows` shows of `episodes` episodes each per channel; fmovies/hdtoday rows use their prefixes. */
function catalogue(spec, { generatedAt = '2026-10-19T00:30:00.000Z', extra = [] } = {}) {
  const shows = [];
  for (const [channel, [count, per = 1]] of Object.entries(spec)) {
    const prefix = channel === 'myflixer' ? 'mf:e:' : channel === 'fmovies' ? 'fm:m:' : channel === 'hdtoday' ? 'hd:m:' : '';
    for (let i = 0; i < count; i++) {
      shows.push({ id: `${channel}-${i}`, title: `${channel} ${i}`, channelId: channel, episodes: Array.from({ length: per }, (_, j) => ({ id: `${prefix}${channel}-${i}-${j}` })) });
    }
  }
  shows.push(...extra);
  const episodes = shows.reduce((sum, s) => sum + s.episodes.length, 0);
  return {
    product: 'dahsha', generatedAt,
    channels: SOURCES.sources.map((s) => ({ id: s.id, title: s.title })),
    sources: [...SOURCES.sources, { id: 'fmovies', title: 'FMovies' }],
    stats: { shows: shows.length, episodes },
    shows,
  };
}
const statusOf = (catalog, stats = {}) => ({ product: 'dahsha', static: true, generatedAt: catalog.generatedAt, refreshing: false, stats: { ...catalog.stats, ...stats } });
const BEFORE = { UCbig: [400, 2], UCfront: [40, 1], UCsmall: [10, 1], myflixer: [300, 3], fmovies: [200, 1] };

test('countCatalog counts every source with its own episodes once, and the classified shows', () => {
  const shared = { id: 'UCbig-dup', title: 'dup', channelId: 'UCbig', classification: { status: 'uncertain' }, episodes: [{ id: 'UCbig-0-0' }, { id: 'mf:e:extra' }] };
  const counts = countCatalog(catalogue({ UCbig: [3, 2], myflixer: [2, 2], fmovies: [1, 1] }, { extra: [shared, { id: 's_x', channelId: 'UCbig', classification: { status: 'documentary' }, episodes: [] }] }));
  assert.equal(counts.shows, 8);
  assert.equal(counts.episodes, 12); // UCbig-0-0 is counted once
  assert.deepEqual(counts.bySource.youtube, { shows: 5, episodes: 6 });
  assert.deepEqual(counts.bySource.myflixer, { shows: 2, episodes: 5 }); // mf:e:extra sits on a YouTube show
  assert.deepEqual(counts.byChannel.UCbig, { title: 'Big Channel', shows: 5, episodes: 6 });
  assert.deepEqual(counts.byChannel.myflixer, { title: 'Myflixer Documentaries', shows: 2, episodes: 4 });
  assert.deepEqual(counts.byChannel.fmovies, { title: 'FMovies', shows: 1, episodes: 1 });
  assert.deepEqual(counts.classifiedShows, { documentary: 1, uncertain: 1 });
  assert.equal(counts.statsBySource, null);
});

test('statusCounts reads stats.bySource in the contract form and in the old per-group form', () => {
  const contract = { shows: 500, episodes: 900, bySource: { UCbig: { title: 'Big Channel', shows: 400, episodes: 800 }, UCfront: { title: 'FRONTLINE', shows: 40, episodes: 40 }, myflixer: { title: 'Myflixer', shows: 60, episodes: 60 } }, classification: { documentary: 358, uncertain: 377 } };
  const counts = statusCounts({ stats: contract });
  assert.deepEqual(counts.bySource.youtube, { shows: 440, episodes: 840 });
  assert.deepEqual(counts.bySource.myflixer, { shows: 60, episodes: 60 });
  assert.equal(counts.sources.UCfront.shows, 40);
  assert.deepEqual(counts.classification, { documentary: 358, uncertain: 377 });
  const legacy = statusCounts({ stats: { shows: 1, episodes: 2, bySource: { youtube: { shows: 1, episodes: 2 } } } });
  assert.deepEqual(legacy.bySource.youtube, { shows: 1, episodes: 2 });
  assert.equal(legacy.sources, null);
  // Generation 37's status.json: no bySource, no classification.
  const gen37 = statusCounts({ stats: { shows: 15328, series: 3200, films: 12128, episodes: 68875, channels: 26 } });
  assert.equal(gen37.bySource, null);
  assert.equal(gen37.classification, null);
  assert.equal(sourceStats({ bySource: { UCbig: 'junk', UCx: { shows: 'many' } } }), null);
  assert.equal(statusCounts({}), null);
});

test('a configured source that loses more than 25% fails even when the YouTube total stays within 5%', () => {
  const before = catalogue(BEFORE);
  const after = catalogue({ ...BEFORE, UCfront: [20, 1] }); // 450 -> 430 YouTube shows: -4.4%
  const args = { previous: statusOf(before), restored: countCatalog(before), nextStatus: statusOf(after), nextCatalogCounts: countCatalog(after), sources: configured };
  const old = evaluate(args);
  assert.equal(old.ok, true, 'the totals alone let this through');
  const result = evaluate({ ...args, perSource: true });
  assert.equal(result.ok, false);
  assert.deepEqual(result.regressions.map((r) => [r.check, r.metric]), [['restored snapshot', 'sources.UCfront.episodes']]);
  assert.equal(result.regressions[0].change, -0.5);
  assert.equal(result.rows.find((r) => r.metric === 'sources.UCfront.shows').guarded, false, 'show counts are reported only');
  const forced = evaluate({ ...args, perSource: true, force: true });
  assert.equal(forced.ok, true);
  assert.equal(forced.forced, true);
  const report = formatReport(result);
  assert.match(report, /FAILED/);
  assert.match(report, /\| restored snapshot \| FRONTLINE PBS \\\| Official \(UCfront\) \| episodes \| 40 \| 20 \| -50\.0% \| \*\*REGRESSION\*\* \|/);
  assert.match(report, /\| restored snapshot \| FRONTLINE PBS \\\| Official \(UCfront\) \| shows \| 40 \| 20 \| -50\.0% \| info \|/);
});

test('a channel whose shows merge under new grouping rules passes while its episodes stay', () => {
  // Generation 37 rebuilt with this tree's catalogue code: VICE News 682 -> 396 shows, all 3,253 episodes kept.
  const before = { UCvice: { title: 'VICE News', shows: 682, episodes: 3253 } };
  const after = { UCvice: { title: 'VICE News', shows: 396, episodes: 3253 } };
  const result = compareSources(before, after, { configured: new Set(['UCvice']) });
  assert.deepEqual(result.regressions, []);
  assert.deepEqual(result.rows.map((r) => [r.field, r.guarded, Number(r.change.toFixed(3))]), [['shows', false, -0.419], ['episodes', true, 0]]);
  const lost = compareSources(before, { UCvice: { title: 'VICE News', shows: 682, episodes: 2000 } }, { configured: new Set(['UCvice']) });
  assert.deepEqual(lost.regressions.map((r) => r.metric), ['sources.UCvice.episodes']);
});

test('small sources, removed sources and provider rows are reported but not guarded; empty sources warn', () => {
  const before = catalogue({ ...BEFORE, UCgone: [50, 1] });
  const after = catalogue({ UCbig: [400, 2], UCfront: [40, 1], UCsmall: [0], myflixer: [300, 3], fmovies: [100, 1] });
  const result = evaluate({ restored: countCatalog(before), nextStatus: statusOf(after), nextCatalogCounts: countCatalog(after), sources: configured, perSource: true });
  const row = (id) => result.rows.find((r) => r.metric === `sources.${id}.shows`);
  assert.equal(row('UCsmall').guarded, false);
  assert.equal(row('UCgone').configured, false);
  assert.equal(row('fmovies').configured, false);
  assert.equal(row('fmovies').change, -0.5);
  assert.equal(result.regressions.some((r) => r.source), false);
  assert.deepEqual(result.emptySources.map((s) => s.id), ['UCsmall', 'UCnew']);
  assert.ok(result.warnings.includes('New Channel (UCnew) is in sources.json but has no show in this export'));
  const report = formatReport(result);
  assert.match(report, /FMovies \(fmovies\) \| shows \| 200 \| 100 \| -50\.0% \| provider, totals only \|/);
  assert.match(report, /UCgone \| shows \| 50 \| 0 \| -100\.0% \| not in sources\.json \|/);
  assert.match(report, /Small Channel \(UCsmall\) \| episodes \| 10 \| 0 \| -100\.0% \| small source \|/);
  assert.match(report, /Small Channel \(UCsmall\) \| shows \| 10 \| 0 \| -100\.0% \| info \|/);
  const compared = compareSources({ UCa: { shows: 100, episodes: 100 } }, {}, { configured: null });
  assert.equal(compared.regressions.length, 1, 'a source missing from the fresh export counts as 0');
  assert.deepEqual(emptySources(null, {}), []);
});

test('a source whose episodes all sit in another source\'s show (one programme group) is not empty', () => {
  // الدحيح: one show presented by AJ+ كبريت; Museum of The Future's season 2 episodes carry its channelId.
  const daheeh = { id: 's_1nkbn9f', title: 'الدحيح', channelId: 'UCbig', episodes: [{ id: 'aj_sell____', channelId: 'UCbig' }, { id: 'mo_worm____', channelId: 'UCnew' }, { id: 'mo_comp____', channelId: 'UCnew' }] };
  const after = catalogue({ UCbig: [400, 2], UCfront: [40, 1], UCsmall: [10, 1], myflixer: [300, 3] }, { extra: [daheeh] });
  const counts = countCatalog(after);
  assert.deepEqual(counts.contributed, { UCnew: 2 }, 'the presenting channel\'s own episodes are not counted twice');
  assert.deepEqual(counts.byChannel.UCbig, { title: 'Big Channel', shows: 401, episodes: 801 }, 'the show stays counted under the presenting channel, its episodes under the channels that uploaded them');
  assert.deepEqual(counts.byChannel.UCnew, { title: 'New Channel', shows: 0, episodes: 2 });
  const result = evaluate({ nextStatus: statusOf(after), nextCatalogCounts: counts, sources: configured, perSource: true });
  assert.deepEqual(result.emptySources, []);
  assert.deepEqual(emptySources(configured, counts.byChannel).map((s) => s.id), ['UCnew'], 'without the contributions it would warn');
  assert.deepEqual(emptySources(configured, counts.byChannel, { UCnew: 0 }).map((s) => s.id), ['UCnew']);
});

test('a channel is guarded on the episodes it uploaded to a programme group\'s show, not on its own shows only', () => {
  // Run 1 of the channels added 2026-10-19: الدحيح presented by AJ+ كبريت with 286 AJ+, 332 New Media
  // and 49 Museum of The Future episodes; New Media's own shows روح (14) and كوانتوبيديا (12).
  const [AJ, NMA, MOF] = ['UCbig', 'UCnew', 'UCsmall'];
  const eps = (prefix, n, channelId) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${String(i).padStart(7, '0')}`, channelId }));
  const run = ({ rouh = 14, quanto = 12 } = {}) => catalogue({ UCbig: [13, 100] }, { extra: [
    { id: 's_1nkbn9f', title: 'الدحيح', channelId: AJ, episodes: [...eps('aj', 286, AJ), ...eps('nm', 332, NMA), ...eps('mo', 49, MOF)] },
    { id: 's_rouh', title: 'روح', channelId: NMA, episodes: eps('rouh', rouh) },
    { id: 's_quanto', title: 'كوانتوبيديا', channelId: NMA, episodes: eps('quan', quanto) },
  ] });
  const first = countCatalog(run());
  assert.deepEqual(first.byChannel[NMA], { title: 'New Channel', shows: 2, episodes: 358 });
  assert.deepEqual(first.byChannel[MOF], { title: 'Small Channel', shows: 0, episodes: 49 });
  assert.deepEqual(first.byChannel[AJ], { title: 'Big Channel', shows: 14, episodes: 1586 });
  assert.deepEqual(first.contributed, { [NMA]: 332, [MOF]: 49 });
  assert.equal(first.bySource.youtube.episodes, 1300 + 667 + 26, 'the group totals count every episode once');
  // Run 2: 7 of New Media's 26 own rows gone (-27%), its 332 الدحيح episodes intact: -2% of its count.
  const next = countCatalog(run({ rouh: 10, quanto: 9 }));
  const history = updateHistory([], peakMetrics(statusOf(run()), first), { now: new Date(START) });
  const result = evaluate({ restored: first, nextStatus: statusOf(run({ rouh: 10, quanto: 9 })), nextCatalogCounts: next, sources: configured, perSource: true, history, now: new Date(START + 6 * HOUR) });
  assert.equal(result.ok, true, formatReport(result));
  assert.deepEqual(result.rows.filter((r) => r.source === NMA && r.field === 'episodes').map((r) => [r.check, r.previous, r.next, r.guarded]), [['restored snapshot', 358, 351, true], ['7-day peak', 358, 351, true]]);
  assert.ok(!result.emptySources.some((s) => s.id === MOF), 'a channel with no show of its own is not empty while its episodes are in the show');
  // The museum's 49 episodes are guarded too: the show's loss of them trips the check.
  const gone = run(); gone.shows[13].episodes = gone.shows[13].episodes.filter((e) => e.channelId !== MOF);
  const lost = evaluate({ restored: first, nextStatus: statusOf(gone), nextCatalogCounts: countCatalog(gone), sources: configured, perSource: true, history, now: new Date(START + 6 * HOUR) });
  assert.deepEqual(lost.regressions.map((r) => [r.check, r.metric]), [['restored snapshot', `sources.${MOF}.episodes`], ['7-day peak', `sources.${MOF}.episodes`]]);
  assert.ok(lost.emptySources.some((s) => s.id === MOF));
});

test('with stats.bySource on both sides the live deploy is compared source by source', () => {
  const by = (front) => ({ UCbig: { title: 'Big Channel', shows: 400, episodes: 800 }, UCfront: { title: 'FRONTLINE PBS | Official', shows: front, episodes: front } });
  const previous = { stats: { shows: 640, episodes: 1240, bySource: by(40) } };
  const nextStatus = { stats: { shows: 625, episodes: 1225, bySource: by(25) } };
  const result = evaluate({ previous, nextStatus, perSource: true, sources: configured });
  assert.deepEqual(result.regressions.map((r) => [r.check, r.metric]), [['live deploy', 'sources.UCfront.episodes']]);
  assert.ok(result.rows.some((r) => r.metric === 'youtube.shows' && r.check === 'live deploy'), 'YouTube totals come from the per-source counts');
  const before = evaluate({ previous: { stats: { shows: 640, episodes: 1240 } }, nextStatus, perSource: true, sources: configured });
  assert.equal(before.ok, true);
  assert.ok(before.warnings.includes('live deploy has no stats.bySource, so its sources were not compared one by one'));
});

/** Counts of a run where YouTube holds `factor` of its starting size and Myflixer stays put. */
function erodedRun(factor) {
  const yt = { shows: Math.round(8000 * factor), episodes: Math.round(20000 * factor) };
  const mf = { shows: 4800, episodes: 45000 };
  const counts = {
    shows: yt.shows + mf.shows, episodes: yt.episodes + mf.episodes,
    bySource: { youtube: yt, myflixer: mf, fmovies: { shows: 0, episodes: 0 }, hdtoday: { shows: 0, episodes: 0 } },
    byChannel: { UCbig: { title: 'Big Channel', ...yt }, myflixer: { title: 'Myflixer Documentaries', ...mf } },
  };
  return { counts, status: { product: 'dahsha', stats: { shows: counts.shows, episodes: counts.episodes } } };
}

test('the peak history catches an erosion of 1% per run that never trips the per-run limit', () => {
  let history = [];
  let previous = erodedRun(1);
  history = updateHistory(history, peakMetrics(previous.status, previous.counts), { now: new Date(START) });
  let failedAt = null;
  for (let run = 1; run <= 40 && !failedAt; run++) {
    const now = new Date(START + run * 6 * HOUR);
    const next = erodedRun(0.99 ** run);
    const args = { previous: previous.status, restored: previous.counts, nextStatus: next.status, nextCatalogCounts: next.counts, perSource: true, sources: configured, now };
    const perRun = evaluate(args);
    assert.equal(perRun.ok, true, `run ${run} passes the per-run checks on their own`);
    const result = evaluate({ ...args, history });
    if (!result.ok) { failedAt = { run, result }; break; }
    history = updateHistory(history, peakMetrics(next.status, next.counts), { now });
    previous = next;
  }
  assert.ok(failedAt, 'the erosion is caught');
  assert.equal(failedAt.run, 11, 'after 11 runs (2.75 days) YouTube is 10.5% below its peak');
  const metrics = failedAt.result.regressions.map((r) => `${r.check}:${r.metric}`);
  assert.deepEqual(metrics, ['7-day peak:youtube.shows', '7-day peak:youtube.episodes']);
  assert.match(formatReport(failedAt.result), /\| 7-day peak \(2026-10-19\) \| youtube\.shows \| 8,000 \| 7,163 \| -10\.5% \| \*\*REGRESSION\*\* \|/);
});

test('the history keeps one entry per UTC day with its highest values, inside the window', () => {
  let history = [];
  for (let day = 0; day < 10; day++) {
    for (const [hour, value] of [[1, 100 + day], [13, 90 + day]]) history = updateHistory(history, { 'youtube.shows': value, shows: 1000 }, { now: new Date(START + (day * 24 + hour) * HOUR) });
  }
  assert.equal(history.length, PEAK_DAYS);
  assert.deepEqual(history.map((e) => e.metrics['youtube.shows']), [103, 104, 105, 106, 107, 108, 109]);
  assert.equal(history.at(-1).day, '2026-10-28');
  const peak = peakOf([{ day: '2026-10-10', metrics: { shows: 9999 } }, ...history], { now: new Date('2026-10-28T12:00:00Z') });
  assert.deepEqual(peak.shows, { value: 1000, day: '2026-10-22' }, 'entries older than the window are ignored');
  assert.deepEqual(peak['youtube.shows'], { value: 109, day: '2026-10-28' });
  assert.equal(updateHistory(history, { shows: 5 }, { now: new Date('2026-10-28T20:00:00Z'), reset: true }).length, 1);
});

test('an older baseline without history seeds the peak with its totals', () => {
  // server/data/deploy-baseline.json of generation 37.
  const gen37 = { product: 'dahsha', generatedAt: '2026-10-18T18:50:07.241Z', stats: { shows: 15328, series: 3200, films: 12128, episodes: 68875, channels: 26 }, savedAt: '2026-10-18T18:50:12.126Z' };
  assert.deepEqual(historyOf(gen37), [{ day: '2026-10-18', at: '2026-10-18T18:50:12.126Z', metrics: { shows: 15328, episodes: 68875 } }]);
  assert.deepEqual(historyOf({ history: [{ day: 'bad' }, { day: '2026-10-18', metrics: { shows: 1 } }] }), [{ day: '2026-10-18', metrics: { shows: 1 } }]);
  assert.deepEqual(historyOf(null), []);
});

test('classification counts are printed from stats.classification, or counted in the export', () => {
  const after = catalogue({ UCbig: [2, 1] });
  const withStats = evaluate({ previous: { stats: { shows: 2, episodes: 2, classification: { documentary: 300, uncertain: 400 } } }, nextStatus: statusOf(after, { classification: { documentary: 358, uncertain: 377 } }) });
  assert.match(formatReport(withStats), /Classification: 358 documentary, 377 uncertain \(before: 300 documentary, 400 uncertain\)\./);
  assert.ok(withStats.rows.some((r) => r.metric === 'classification.uncertain' && !r.guarded && r.previous === 400 && r.next === 377));
  after.shows[0].classification = { status: 'documentary' };
  const counted = evaluate({ nextStatus: statusOf(after), nextCatalogCounts: countCatalog(after) });
  assert.match(formatReport(counted), /Classification \(stats\.classification absent; .*\): 1 documentary, 0 uncertain\./);
});

test('workflow commands escape the message and the title', () => {
  assert.equal(workflowCommand('error', 'Catalogue regression: shows, episodes', 'HISTORY shows 287 -> 182 (-36.6%)\nnext line'), '::error title=Catalogue regression%3A shows%2C episodes::HISTORY shows 287 -> 182 (-36.6%25)%0Anext line');
});

test('unknown options and missing values are rejected', () => {
  assert.deepEqual(parseArgs(['--live', 'none', '--write-baseline', '--source-min', '30']), { command: 'check', live: 'none', 'write-baseline': true, 'source-min': '30' });
  assert.deepEqual(parseArgs(['record', '--out', 'x.json']), { command: 'record', out: 'x.json' });
  assert.throws(() => parseArgs(['--threshhold', '0.1']), /unknown option --threshhold/);
  assert.throws(() => parseArgs(['--restored']), /--restored needs a value/);
  assert.throws(() => parseArgs(['--restored', '--force']), /--restored needs a value/);
  assert.throws(() => parseArgs(['stray']), /unexpected argument stray/);
});

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dahsha-regression-')); }
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Runs check() with console output and the GitHub files captured; env changes are undone afterwards. */
async function runCheck(argv, { env = {}, now } = {}) {
  const dir = tempDir();
  const files = { GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'), GITHUB_OUTPUT: path.join(dir, 'output.txt') };
  const saved = Object.fromEntries(['GITHUB_ACTIONS', 'REGRESSION_FORCE', ...Object.keys(files), ...Object.keys(env)].map((k) => [k, process.env[k]]));
  const lines = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  Object.assign(process.env, files, env);
  for (const key of ['log', 'warn', 'error']) console[key] = (...args) => lines.push(args.join(' '));
  try {
    const code = await check(parseArgs(argv), { now });
    const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
    return { code, lines, summary: read(files.GITHUB_STEP_SUMMARY), output: read(files.GITHUB_OUTPUT) };
  } finally {
    Object.assign(console, original);
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('check: a passing run stores the baseline with its history; a per-source drop is refused; force restarts the history', async () => {
  const dir = tempDir();
  try {
    const exportDir = path.join(dir, 'export');
    const baseline = path.join(dir, 'deploy-baseline.json');
    const sources = path.join(dir, 'sources.json');
    const restored = path.join(dir, 'restored-counts.json');
    writeJson(sources, SOURCES);
    const before = catalogue(BEFORE);
    writeJson(path.join(dir, 'server-catalog.json'), before);
    writeJson(baseline, { product: 'dahsha', generatedAt: before.generatedAt, stats: before.stats, savedAt: '2026-10-18T18:50:12.126Z' });
    assert.equal(await main(['record', '--out', restored, '--catalog', path.join(dir, 'server-catalog.json')]), 0);
    assert.equal(readJson(restored).byChannel.UCfront.shows, 40);
    const common = ['--data', exportDir, '--live', 'none', '--baseline', baseline, '--sources', sources, '--restored', restored, '--write-baseline'];

    const grown = catalogue({ ...BEFORE, UCbig: [402, 2] });
    writeJson(path.join(exportDir, 'catalog.json'), grown);
    writeJson(path.join(exportDir, 'status.json'), statusOf(grown));
    const pass = await runCheck(common, { now: new Date('2026-10-19T00:50:00Z'), env: { GITHUB_ACTIONS: 'true' } });
    assert.equal(pass.code, 0);
    assert.match(pass.output, /regression=false\nempty_sources=1\n/);
    assert.match(pass.summary, /stored baseline has no per-source counts, so youtube was compared with the restored snapshot only/);
    assert.ok(pass.lines.includes('::warning title=Source without shows::New Channel (UCnew) is listed in sources.json but has no show in this export.'));
    let stored = readJson(baseline);
    assert.equal(stored.stats.shows, grown.stats.shows);
    assert.deepEqual(stored.history.map((e) => e.day), ['2026-10-18', '2026-10-19']);
    assert.equal(stored.history.at(-1).metrics['source:UCfront.shows'], 40);
    assert.equal(stored.history.at(-1).metrics['youtube.shows'], 452);

    const dropped = catalogue({ ...BEFORE, UCbig: [402, 2], UCfront: [25, 1] });
    writeJson(path.join(exportDir, 'catalog.json'), dropped);
    writeJson(path.join(exportDir, 'status.json'), statusOf(dropped));
    const refused = await runCheck(common, { now: new Date('2026-10-19T06:50:00Z'), env: { GITHUB_ACTIONS: 'true' } });
    assert.equal(refused.code, 1);
    assert.match(refused.output, /regression=true/);
    assert.match(refused.summary, /FRONTLINE PBS \\\| Official \(UCfront\) \| episodes \| 40 \| 25 \| -37\.5% \| \*\*REGRESSION\*\*/);
    const error = refused.lines.find((line) => line.startsWith('::error '));
    assert.match(error, /^::error title=Catalogue regression::FRONTLINE PBS \| Official episodes 40 -> 25 \(-37\.5%25, vs restored snapshot\)/);
    assert.deepEqual(readJson(baseline), stored, 'a refused run leaves the baseline alone');

    const forced = await runCheck(common, { now: new Date('2026-10-19T07:10:00Z'), env: { REGRESSION_FORCE: '1' } });
    assert.equal(forced.code, 0);
    assert.ok(forced.lines.some((line) => /peak history restarted/.test(line)));
    stored = readJson(baseline);
    assert.equal(stored.history.length, 1);
    assert.equal(stored.history[0].metrics['source:UCfront.shows'], 25);

    // The next run restores the forced data: the accepted counts are the new peak.
    assert.equal(await main(['record', '--out', restored, '--catalog', path.join(exportDir, 'catalog.json')]), 0);
    const after = await runCheck(common, { now: new Date('2026-10-19T08:00:00Z') });
    assert.equal(after.code, 0);
    assert.equal(readJson(baseline).history[0].metrics['source:UCfront.episodes'], 25);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('check: a missing export is a usage error, not a pass', async () => {
  const dir = tempDir();
  try {
    const result = await runCheck(['--data', dir, '--live', 'none', '--baseline', path.join(dir, 'b.json')]);
    assert.equal(result.code, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- workflow wiring ---------------------------------------------------------------------------------
const workflow = (name) => fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8');
/** The text of every step ("      - ..." blocks) of a workflow, keyed by its name. */
function steps(text) {
  const out = {};
  for (const block of text.split(/\n(?=      - )/).slice(1)) {
    const name = /name: (.+)/.exec(block)?.[1]?.trim();
    if (name) out[name] = block;
  }
  return out;
}

test('workflows: the force input overrides the regression check only, never the snapshot cache checks', () => {
  for (const name of ['refresh.yml', 'poll.yml']) {
    const text = workflow(name);
    const save = steps(text)['Save data snapshot'];
    assert.ok(save, `${name} saves the snapshot`);
    assert.doesNotMatch(save, /inputs\.force|--force/, `${name}: force does not reach snapshot save`);
    assert.match(save, /inputs\.allow_snapshot_shrink && '--allow-shrink'/);
    assert.match(save, /steps\.guard\.outcome == 'success'/);
    assert.match(text, /allow_snapshot_shrink:\n\s+description:/);
    assert.match(text, /REGRESSION_FORCE: \$\{\{ inputs\.force && '1' \|\| '' \}\}/);
  }
});

test('workflows: a failed or hung provider step is contained and its caches are put back', () => {
  const text = workflow('refresh.yml');
  const all = steps(text);
  const names = Object.keys(all);
  const provider = all['Refresh Dahsha providers'];
  assert.match(provider, /id: providers/);
  assert.match(provider, /continue-on-error: true/);
  assert.match(provider, /timeout-minutes: 30/);
  const backup = names.indexOf('Back up provider caches');
  const restore = names.indexOf('Restore provider caches after a failure');
  assert.ok(backup >= 0 && backup < names.indexOf('Refresh Dahsha providers') && restore > names.indexOf('Refresh Dahsha providers'));
  assert.ok(restore < names.indexOf('Regression check') && names.indexOf('Regression check') < names.indexOf('Save data snapshot'));
  assert.match(all['Restore provider caches after a failure'], /steps\.providers\.outcome == 'failure'/);
  for (const file of ['providers-dahsha.json', 'provider-aliases-dahsha.json', 'provider-identities-dahsha.json', 'provider-matches-dahsha.json', 'service-metadata-dahsha.json', 'catalog.json']) {
    assert.match(text, new RegExp(`PROVIDER_CACHE_FILES: [^\\n]*\\b${file.replace(/[.-]/g, '\\$&')}\\b`), `${file} is backed up`);
  }
  assert.match(all['Report provider failure'], /exit 1/, 'a provider failure turns the run red so it is emailed');
  assert.equal(names.at(-1), 'Report provider failure', 'after the deploy and the snapshot save');
  assert.match(all['Refresh from YouTube'], /ARTWORK_MAX_PER_RUN: '1500'/);
  assert.match(all['Warn when TMDB is not configured'], /if: env\.TMDB_API_KEY == ''/);
  assert.match(all['Warn when TMDB is not configured'], /^\s+echo "::warning title=TMDB enrichment disabled::/m);
});

test('workflows: tests run on push and pull_request, the live data is watched, dependencies are updated', () => {
  const tests = workflow('test.yml');
  assert.match(tests, /^on:\n  push:/m);
  assert.match(tests, /^  pull_request:/m);
  assert.match(tests, /npm ci --prefix server/);
  assert.match(tests, /run: npm test/);
  const keepalive = workflow('keepalive.yml');
  assert.match(keepalive, /\/data\/status\.json/);
  assert.match(keepalive, /MAX_AGE_HOURS: '12'/);
  const dependabot = fs.readFileSync(path.join(root, '.github', 'dependabot.yml'), 'utf8');
  for (const [ecosystem, directory] of [['npm', '/server'], ['npm', '/client'], ['github-actions', '/']]) {
    assert.match(dependabot, new RegExp(`package-ecosystem: ${ecosystem}\\n\\s+directory: ${directory.replace('/', '\\/')}\\n\\s+schedule:\\n\\s+interval: weekly`));
  }
});
