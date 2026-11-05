import {getFmoviesDetails, parseFmoviesId} from './fmovies.js';
import {getHdtodayDetails, parseHdtodayId} from './hdtoday.js';
import {mergeShow, providerRowProblem, latestDate} from './merge-library.js';

const providerOf = row => /^fm:s:/.test(row?.id) ? 'fmovies' : /^hd:s:/.test(row?.id) ? 'hdtoday' : null;
const timeOf = value => Date.parse(value || '') || 0;
const bounded = (value, fallback, max) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Math.floor(Number(value)))) : fallback;
const slotOrder = (a, b) => a.season - b.season || a.number - b.number;
const denied = error => /\b(?:403|429)\b|browser verification|rate limit|access denied/i.test(error);

async function withinBudget(work, milliseconds, parentSignal) {
  const controller = new AbortController();
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  signal.throwIfAborted();
  let timer, onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason || new Error('Episode guide request aborted'));
    signal.addEventListener('abort', onAbort, {once:true});
    timer = setTimeout(() => controller.abort(new Error('Episode guide request timed out')), Math.ceil(milliseconds));
  });
  try { return await Promise.race([Promise.resolve().then(() => work(signal)), aborted]); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
}

/** Only IDs actually returned by the provider parser, belonging to this exact series/slot. */
export function verifiedGuideEpisodes(row, episodes) {
  const parse = providerOf(row) === 'fmovies' ? parseFmoviesId : parseHdtodayId;
  const owner = parse(row.id), seen = new Map();
  if (!owner || owner.kind !== 'series' || owner.season != null) return [];
  for (const episode of episodes || []) {
    const id = parse(episode?.id);
    if (!id || id.kind !== 'series' || !Number.isSafeInteger(id.season) || id.season < 0 ||
        !Number.isSafeInteger(id.number) || id.number < 1 || id.season !== episode.season || id.number !== episode.number) continue;
    if (owner.tmdbId ? id.tmdbId !== owner.tmdbId : id.slug !== owner.slug) continue;
    // An episode may never acquire an unrelated provider route through guide enrichment.
    const offerings = (episode.offerings || []).filter(entry => entry.provider === providerOf(row) && entry.id === episode.id);
    seen.set(episode.id, {...episode, offerings});
  }
  return [...seen.values()].sort(slotOrder);
}

/** Limit season-page work as well as title count. The saved checks rotate long guides across runs. */
export async function fetchEpisodeGuide(row, {signal, at, fmoviesDetails=getFmoviesDetails, hdtodayDetails=getHdtodayDetails}) {
  const provider=providerOf(row);
  const first=await withinBudget(inner=>provider==='hdtoday'?hdtodayDetails(row,{signal:inner}):fmoviesDetails(row,{allSeasons:false,signal:inner}),8000,signal);
  const fresh={...first,episodes:[...(first.episodes||[])],...(first.providerErrors?{providerErrors:[...first.providerErrors]}:{})};
  if (fresh.id !== row.id || fresh.kind !== 'series' || fresh.documentary !== true) throw new Error('Episode guide identity or documentary mismatch');
  const checks = {...row.episodeSeasonChecks};
  const episodes = new Map((fresh.episodes || []).map(episode => [episode.id, episode]));
  for (const season of new Set(fresh.episodes.map(episode => episode.season))) checks[season] = at;
  const pending = fresh.seasons.filter(season => !fresh.episodes.some(episode => episode.season === season))
    .sort((a,b) => timeOf(checks[a]) - timeOf(checks[b]) || b - a).slice(0,4);
  let cursor = 0, stopped = false;
  await Promise.all(Array.from({length:Math.min(2,pending.length)}, async () => {
    while (cursor < pending.length && !signal.aborted && !stopped) {
      const season = pending[cursor++];
      try {
        let observed;
        if(provider==='hdtoday'){
          // Use only the exact season navigation href advertised by this title. A season
          // number alone is not permission to manufacture either a URL or an episode.
          try{observed=new URL(fresh.seasonSources?.[season]);}catch{throw Error('No observed HDToday season URL');}
          if(observed.origin!=='https://hdtoday.sx'||observed.username||observed.password||observed.hash||
            observed.pathname!==`/watch/${parseHdtodayId(row.id)?.slug}`||Number(observed.searchParams.get('s')??observed.searchParams.get('season'))!==season)throw Error('Invalid observed HDToday season URL');
        }
        const page = await withinBudget(inner => provider==='hdtoday'?hdtodayDetails(observed.href,{signal:inner}):fmoviesDetails(row, {allSeasons:false, season, signal:inner}), 6000, signal);
        if (page.id !== row.id || page.documentary !== true) throw new Error('Season identity or documentary mismatch');
        const valid = verifiedGuideEpisodes(row, page.episodes).filter(episode => episode.season === season);
        if (!valid.length) throw new Error('Season page contains no verified episode links');
        for (const episode of valid) episodes.set(episode.id, episode);
        checks[season] = at;
      } catch (error) {
        (fresh.providerErrors ||= []).push({provider, season, error:error.message});
        if (denied(error.message)) stopped = true;
      }
    }
  }));
  fresh.episodes = [...episodes.values()];
  fresh.episodeSeasonChecks = checks;
  fresh.episodeGuideComplete = fresh.seasons.every(season => checks[season]);
  return fresh;
}

/** Background-only work: never called on an app/API request. A denial retains the cached guide. */
export async function refreshSeriesEpisodes(rows, {
  limit = 48, now = Date.now(), intervalMs = 2*3600000, concurrency = 3,
  timeoutMs = 25000, budgetMs = 120000, skipProviders = new Set(), resolveDetails = fetchEpisodeGuide,
} = {}) {
  limit = bounded(limit,48,240); concurrency = Math.max(1,bounded(concurrency,3,4));
  timeoutMs = Math.max(1,bounded(timeoutMs,25000,30000)); budgetMs = Math.max(1,bounded(budgetMs,120000,180000));
  const at = new Date(now).toISOString(), started = performance.now();
  const report = {checked:0, succeeded:0, addedEpisodes:0, changedShows:0, errors:[], deferred:0, skippedProviders:[...skipProviders]};
  const lanes = new Map();
  for (const row of rows) {
    const provider = providerOf(row);
    if (!provider || row.kind !== 'series' || row.documentary !== true || skipProviders.has(provider) || providerRowProblem(row)) continue;
    const checked = timeOf(row.episodesCheckedAt);
    if (checked && now - checked < intervalMs) continue;
    if (!lanes.has(provider)) lanes.set(provider, []);
    lanes.get(provider).push(row);
  }
  for (const lane of lanes.values()) lane.sort((a,b) => timeOf(a.episodesCheckedAt) - timeOf(b.episodesCheckedAt) ||
    timeOf(b.providerUpdatedAt) - timeOf(a.providerUpdatedAt) || a.id.localeCompare(b.id));
  const jobs = [], positions = new Map([...lanes.keys()].map(provider => [provider,0]));
  while (jobs.length < limit) {
    let added = false;
    for (const [provider,lane] of lanes) {
      const position = positions.get(provider);
      if (position < lane.length && jobs.length < limit) { jobs.push(lane[position]); positions.set(provider,position+1); added = true; }
    }
    if (!added) break;
  }
  const updates = new Map(), blocked = new Set(skipProviders);
  let cursor = 0;
  await Promise.all(Array.from({length:Math.min(concurrency,jobs.length)}, async () => {
    while (cursor < jobs.length) {
      const remaining = budgetMs - (performance.now() - started);
      if (remaining <= 0) break;
      const row = jobs[cursor++], provider = providerOf(row);
      if (blocked.has(provider)) continue;
      report.checked++;
      try {
        const fresh = await withinBudget(signal => resolveDetails(row, {signal,at}), Math.min(timeoutMs,remaining));
        if (providerRowProblem(fresh) || fresh.id !== row.id || fresh.kind !== 'series' || fresh.documentary !== true) {
          throw new Error('Episode guide identity or documentary mismatch');
        }
        const episodes = verifiedGuideEpisodes(row, fresh.episodes);
        if (!episodes.length) throw new Error('No verified episode links; cached guide retained');
        const oldEpisodes = verifiedGuideEpisodes(row,row.episodes), oldIds = new Set(oldEpisodes.map(episode => episode.id));
        const added = episodes.filter(episode => !oldIds.has(episode.id));
        const merged = mergeShow(row, {...fresh,episodes});
        merged.episodesCheckedAt = at;
        merged.episodesRefreshedAt = at;
        merged.episodeGuideComplete = fresh.episodeGuideComplete !== false && !fresh.providerErrors?.length;
        if (fresh.episodeSeasonChecks) merged.episodeSeasonChecks = {...row.episodeSeasonChecks,...fresh.episodeSeasonChecks};
        if (merged.episodeGuideComplete) merged.episodeGuideInitializedAt ||= at;
        // A historical first guide, newly found old seasons and gap-filling are not new releases.
        const latest = oldEpisodes.at(-1);
        const newContent = row.episodeGuideInitializedAt && latest ? added.filter(episode => slotOrder(episode,latest)>0) : [];
        if (newContent.length) {
          merged.episodesAddedAt = latestDate(row.episodesAddedAt,at);
          merged.providerUpdatedAt = at;
          report.changedShows++;
        }
        // Listing cursors and guide IDs use different formats. Do not mix them into latestEpisode.
        merged.latestEpisode = row.latestEpisode;
        merged.episodeGuideLatest = verifiedGuideEpisodes(row,merged.episodes).at(-1)?.id || null;
        const warnings = (fresh.providerErrors || []).map(error => ({id:row.id,provider,error:String(error.error || error.message || 'Partial episode guide')}));
        if (warnings.length) {
          merged.episodesLastError = warnings.map(error => error.error).join('; ').slice(0,500);
          report.errors.push(...warnings);
          if (warnings.some(error => denied(error.error))) blocked.add(provider);
        } else delete merged.episodesLastError;
        updates.set(row.id,merged);
        report.addedEpisodes += added.length;
        report.succeeded++;
      } catch (error) {
        const message = String(error.message || error);
        updates.set(row.id,{...row,episodesCheckedAt:at,episodesLastError:message});
        report.errors.push({id:row.id,provider,error:message});
        if (denied(message)) blocked.add(provider);
      }
    }
  }));
  report.deferred = [...lanes.values()].reduce((total,lane) => total+lane.length,0) - report.checked;
  report.skippedProviders = [...blocked];
  return {items:rows.map(row => updates.get(row.id) || row), report};
}
