export function thumbnailCandidates(thumbs, videoId, start='max', fallbackThumbs) {
  const supplied=typeof thumbs==='string'?{custom:thumbs}:thumbs || {};
  const inferred=/\/vi\/([\w-]{11})\//.exec(Object.values(supplied).join(' '))?.[1];
  const id=/^[\w-]{11}$/.test(videoId || '')?videoId:inferred;
  const youtube=id?Object.fromEntries(Object.entries({max:'maxresdefault',sd:'sddefault',hq:'hqdefault',mq:'mqdefault',default:'default'}).map(([key,size])=>[key,`https://i.ytimg.com/vi/${id}/${size}.jpg`])):{};
  const sizes=['max','sd','hq','mq','default'];
  const first=Math.max(0,sizes.indexOf(start));
  const keys=['custom',...sizes.slice(first),...sizes.slice(0,first)];
  const fallback=typeof fallbackThumbs==='string'?{custom:fallbackThumbs}:fallbackThumbs || {};
  return [...new Set([...keys.map(key=>supplied[key]),...keys.map(key=>youtube[key]),...keys.map(key=>fallback[key])].filter(value=>typeof value==='string'&&value.trim()))];
}
