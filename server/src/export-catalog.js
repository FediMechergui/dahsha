import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as artwork from './artwork.js';

const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const timeOf = value => typeof value === 'string' && value ? Date.parse(value) : NaN;
/**
 * An episode's discovery date (addedAt) as exported: only for non-YouTube episodes (Myflixer and the
 * web providers; a YouTube publish date is exact), only when it is later than the publish date, and only
 * when the catalogue counted it in the show's latestAt (catalog.js takes max(publishedAt, addedAt)). A
 * first-seen stamp from a bulk import fails the last test and is left out. undefined when not exported.
 */
export function exportedAddedAt(episode, show) {
  const added = timeOf(episode?.addedAt);
  if (!Number.isFinite(added) || /^[\w-]{11}$/.test(String(episode?.id || ''))) return undefined;
  const published = timeOf(episode.publishedAt), latest = timeOf(show?.latestAt);
  if (Number.isFinite(published) && added <= published) return undefined;
  return Number.isFinite(latest) && added <= latest ? episode.addedAt : undefined;
}
/** A full show record as written to shows/<id>.json: episode addedAt follows the same rule as the lean catalogue. */
export function exportedShow(show) {
  if (!Array.isArray(show?.episodes) || !show.episodes.some(e => e && e.addedAt !== undefined)) return show;
  return { ...show, episodes: show.episodes.map(e => {
    if (!e || e.addedAt === undefined) return e;
    const addedAt = exportedAddedAt(e, show);
    if (addedAt === e.addedAt) return e;
    const { addedAt: _dropped, ...rest } = e;
    return addedAt === undefined ? rest : { ...rest, addedAt };
  }) };
}
/** Enrichment sources this environment can use (artwork.js), e.g. no "tmdb" when TMDB_API_KEY is unset. */
export function enrichmentStatus(env = process.env) {
  const enabled = typeof artwork.artworkEnabled === 'function' ? !!artwork.artworkEnabled() : env.ARTWORK !== '0';
  const sources = !enabled ? [] : typeof artwork.artworkSources === 'function' ? [...artwork.artworkSources()]
    : [...(env.TMDB_API_KEY ? ['tmdb'] : []), 'tvmaze', 'wikidata', 'wikipedia'];
  return { artwork: enabled, sources, tmdb: sources.includes('tmdb') };
}
/**
 * status.json: generation time and stats (with stats.bySource and stats.classification when the
 * catalogue carries them), the number of show id aliases, the enrichment sources in use and the
 * per-provider freshness from catalog.providerSync.
 */
export function exportStatus(catalog, product, { enrichment = enrichmentStatus() } = {}) {
  const sync = isRecord(catalog.providerSync) ? catalog.providerSync : null;
  return {
    product, static: true, generatedAt: catalog.generatedAt, refreshing: false, stats: catalogStats(catalog),
    idAliasCount: isRecord(catalog.idAliases) ? Object.keys(catalog.idAliases).length : 0,
    enrichment,
    ...(sync ? { providerSync: sync } : {}),
  };
}

// catalog.stats as built (bySource and classification included), else counted from the shows.
const catalogStats = catalog => catalog.stats || {
  shows: (catalog.shows || []).length,
  films: (catalog.shows || []).filter(s => s.kind === 'film').length,
  series: (catalog.shows || []).filter(s => s.kind === 'series').length,
  episodes: (catalog.shows || []).reduce((sum, s) => sum + (s.episodeCount || 0), 0),
  channels: catalog.channels?.length || 0,
};

const pick = (record, keys) => Object.fromEntries(keys.filter(key => record[key] !== undefined).map(key => [key, record[key]]));
/**
 * The episodes of an uncertain version (show.versions[]), i.e. the ids its own page /show/<versionId>
 * plays and stores progress under: its own episodes, or for a provider film without any, the film itself
 * (as library-service unifiedTitle plays it). Series versions without a cached guide list none.
 */
export function versionEpisodes(version) {
  if (Array.isArray(version?.episodes) && version.episodes.length) return version.episodes.filter(e => e && typeof e.id === 'string');
  if (version?.kind !== 'film' || !/^(mf:m|fm:m|hd:m):/.test(String(version.id || ''))) return [];
  return [{ id: version.id, title: version.title, season: 1, number: 1, ...(version.sourceUrl ? { sourceUrl: version.sourceUrl } : {}), offerings: Array.isArray(version.offerings) ? version.offerings : [] }];
}
// seasonLabel and channelId are set only on the episodes of a show carried by several channels of one
// programme group (catalog.js showGroupOf): the show page groups by the label before shows/<id>.json
// loads, and the regression check credits each episode's own channel.
const leanEpisode = (episode, show) => ({
  ...pick(episode, ['id','title','season','seasonLabel','number','durationSec','views','publishedAt','offerings','sourceUrl','classification','channelId']),
  addedAt: exportedAddedAt(episode, show),
  thumbs: /^(mf|fm|hd):/.test(episode.id) && episode.thumbs?.custom ? { custom: episode.thumbs.custom } : undefined,
});
/**
 * A version as the lean catalogue lists it. Its episodes (versionEpisodes) are listed so every id a
 * version page stores progress under is reachable from catalog.shows[].versions[].episodes, like card
 * episodes are from catalog.shows[].episodes; the poster lets it be drawn as its own entry.
 */
const leanVersion = version => ({
  ...pick(version, ['id','title','year','sourceUrl','offerings','kind','documentary','providerMetadata','tags','lang','tmdbId','imdbId']),
  poster: version.poster?.custom ? { custom: version.poster.custom } : undefined,
  episodes: versionEpisodes(version).map(episode => leanEpisode(episode, version)),
  uncertainMatch: true,
});
/** Every playable provider id the export lists (stream-ids.json): card episodes and version episodes. */
export function streamIds(shows) {
  const crawled = id => /^(mf|fm|hd):/.test(id);
  return [...new Set((shows || []).flatMap(show => [
    ...(show.episodes || []).map(e => e?.id),
    ...(show.versions || []).flatMap(v => versionEpisodes(v).map(e => e.id)),
  ]).filter(id => typeof id === 'string' && crawled(id)))];
}

export function leanCatalog(catalog, product) {
  const payload = { ...catalog, product, stats: catalogStats(catalog) };
  return { ...payload, shows: (payload.shows || []).map(show => ({
    ...pick(show, ['id','wpId','slug','kind','title','year','lang','contentLang','tags','primaryTag','episodeCount','seasons','totalDurationSec','totalViews','latestAt','updatedAt','latestEpisode','firstAt','publishedAt','portrait','synopsisGenerated','tvm','tmdbId','imdbId','documentary','offerings','firstSeenAt','providerUpdatedAt','providerMetadata','sourceUrl','classification']),
    // Only a real discovery date; the null of a bulk-imported provider row is not exported.
    discoveredAt: show.discoveredAt || undefined,
    versions: (show.versions || []).filter(v => v && typeof v.id === 'string').map(leanVersion),
    channelId: show.channelId || show.channel?.id,
    posterId: show.posterVideoId || show.posterId,
    poster: show.poster?.custom ? { custom: show.poster.custom } : undefined,
    blurb: show.synopsis?.slice(0, 280) || show.blurb || '',
    episodes: (show.episodes || []).map(episode => leanEpisode(episode, show)),
  })) };
}

// Prepare a complete export beside its destination, then swap it in with rollback.
export function writeCatalog(outDir, catalog, product) {
  if (!catalog.shows?.length) throw new Error(`Refusing to export an empty ${product} catalogue`);
  outDir = path.resolve(outDir);
  const stage = `${outDir}.stage-${randomUUID()}`;
  const backup = `${outDir}.backup-${randomUUID()}`;
  const payload = { ...catalog, product };
  const lean = leanCatalog(catalog, product);
  let moved = false;
  try {
    fs.mkdirSync(path.join(stage, 'shows'), { recursive: true });
    if(product==='flixer')for(const name of ['universes.json','services.json']){
      const existing=path.join(outDir,name);
      const fallback=new URL(`../../client-terrarium/data/${name}`,import.meta.url);
      const source=fs.existsSync(existing)?existing:fallback;
      if(fs.existsSync(source))fs.copyFileSync(source,path.join(stage,name));
    }
    for (const lang of ['', '.ar', '.en']) {
      const section = product === 'dahsha' && lang ? { ...lean, lang: lang.slice(1), shows: lean.shows.filter(s => s.lang === lang.slice(1)) } : lean;
      fs.writeFileSync(path.join(stage, `catalog${lang}.json`), JSON.stringify(section));
    }
    if(product==='flixer') {
      const index={...lean,lite:true,shows:lean.shows.map(({episodes,seasons,versions,offerings,blurb,...show})=>({...show,firstEpisodeId:episodes?.[0]?.id}))};
      fs.writeFileSync(path.join(stage,'index.json'),JSON.stringify(index));
      const updated=show=>[show.updatedAt,show.latestEpisode?show.providerUpdatedAt:null,show.latestAt,show.publishedAt].filter(Boolean).sort().pop() || '';
      const recent=[...index.shows].sort((a,b)=>updated(b).localeCompare(updated(a)));
      fs.writeFileSync(path.join(stage,'bootstrap.json'),JSON.stringify({...index,shows:recent.slice(0,600)}));
    }
    const cards = new Set(payload.shows.map(show => show.id));
    for (const show of payload.shows) {
      fs.writeFileSync(path.join(stage, 'shows', `${encodeURIComponent(show.id)}.json`), JSON.stringify(exportedShow(show)));
      // A version's page lists the same episodes as its lean entry (versionEpisodes); a card of the same
      // id always keeps its own page, whatever the order of the shows.
      for (const version of show.versions || []) if (typeof version?.id === 'string' && !cards.has(version.id)) fs.writeFileSync(path.join(stage, 'shows', `${encodeURIComponent(version.id)}.json`), JSON.stringify({ ...version, episodes: versionEpisodes(version) }));
    }
    if (product === 'dahsha') fs.writeFileSync(path.join(stage, 'stream-ids.json'), JSON.stringify(streamIds(payload.shows)));
    fs.writeFileSync(path.join(stage, 'status.json'), JSON.stringify(exportStatus(payload, product)));
    if (fs.existsSync(outDir)) { fs.renameSync(outDir, backup); moved = true; }
    fs.renameSync(stage, outDir);
  } catch (error) {
    if (moved && !fs.existsSync(outDir)) fs.renameSync(backup, outDir);
    throw error;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    if (fs.existsSync(outDir)) fs.rmSync(backup, { recursive: true, force: true });
  }
}
