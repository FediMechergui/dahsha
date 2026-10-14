import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function leanCatalog(catalog, product) {
  const payload = { ...catalog, product, stats: catalog.stats || {
    shows: catalog.shows.length,
    films: catalog.shows.filter(s => s.kind === 'film').length,
    series: catalog.shows.filter(s => s.kind === 'series').length,
    episodes: catalog.shows.reduce((sum, s) => sum + (s.episodeCount || 0), 0),
    channels: catalog.channels?.length || 0,
  } };
  const pick = (record, keys) => Object.fromEntries(keys.filter(key => record[key] !== undefined).map(key => [key, record[key]]));
  return { ...payload, shows: payload.shows.map(show => ({
    ...pick(show, ['id','wpId','slug','kind','title','year','lang','contentLang','tags','primaryTag','episodeCount','seasons','totalDurationSec','totalViews','latestAt','firstAt','publishedAt','portrait','synopsisGenerated','tvm','tmdbId','imdbId','documentary','offerings','providerUpdatedAt','providerMetadata','sourceUrl']),
    versions: (show.versions || []).map(v => ({...pick(v,['id','title','year','sourceUrl','offerings','kind','documentary','providerMetadata','tags','lang','tmdbId','imdbId']),uncertainMatch:true})),
    channelId: show.channelId || show.channel?.id,
    posterId: show.posterVideoId || show.posterId,
    poster: show.poster?.custom ? { custom: show.poster.custom } : undefined,
    blurb: show.synopsis?.slice(0, 280) || show.blurb || '',
    episodes: (show.episodes || []).map(episode => ({
      ...pick(episode, ['id','title','season','number','durationSec','views','publishedAt','offerings','sourceUrl']),
      thumbs: /^(mf|fm|hd):/.test(episode.id) && episode.thumbs?.custom ? { custom: episode.thumbs.custom } : undefined,
    })),
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
    for (const show of payload.shows) {
      fs.writeFileSync(path.join(stage, 'shows', `${encodeURIComponent(show.id)}.json`), JSON.stringify(show));
      for (const version of show.versions || []) fs.writeFileSync(path.join(stage, 'shows', `${encodeURIComponent(version.id)}.json`), JSON.stringify(version));
    }
    if (product === 'dahsha') fs.writeFileSync(path.join(stage, 'stream-ids.json'), JSON.stringify([...new Set(payload.shows.flatMap(show => (show.episodes || []).filter(e => /^(mf|fm|hd):/.test(e.id)).map(e => e.id)))]));
    fs.writeFileSync(path.join(stage, 'status.json'), JSON.stringify({ product, static: true, generatedAt: payload.generatedAt, refreshing: false, stats: payload.stats }));
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
