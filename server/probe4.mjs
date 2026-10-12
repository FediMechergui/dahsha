import { Innertube } from 'youtubei.js';
const yt = await Innertube.create({ lang: 'ar', location: 'AE', retrieve_player: false });
const info = await yt.getPlaylist('PLaZg-cX28hcTfRKrRFxxUK_1pmUGKojzZ'); // رحلة إلى الأعماق (4)
console.log('TITLE', info.info.title, '| thumbs', info.info.thumbnails?.map(t=>t.url+' '+t.width).slice(0,3));
for (const v of info.videos) {
  const rows = v.metadata?.metadata?.metadata_rows?.map(r => r.metadata_parts.map(p => p.text?.text).join(' • '));
  console.log('-', v.content_id, '|', v.metadata?.title?.text, '|', v.content_image?.overlays?.[0]?.badges?.[0]?.text, '|', JSON.stringify(rows));
}
const vid = info.videos[0].content_id;
let t = Date.now();
const bi = await yt.getBasicInfo(vid);
console.log('getBasicInfo ms', Date.now()-t);
console.log('keys', Object.keys(bi));
const b = bi.basic_info;
console.log('basic keys', Object.keys(b));
console.log('dur', b.duration, '| title', b.title, '| views', b.view_count, '| start', b.start_timestamp, '| keywords', b.keywords?.slice(0,8));
console.log('desc:', (b.short_description||'').slice(0,600));
console.log('thumbs', b.thumbnail?.map(t=>t.url.split('?')[0]+' '+t.width).slice(0,4));
console.log('playability', bi.playability_status?.status, bi.playability_status?.reason);
t = Date.now();
const full = await yt.getInfo(vid).catch(e => ({err: e.message}));
console.log('getInfo ms', Date.now()-t, full.err || '');
if (!full.err) { console.log('published', full.primary_info?.published?.text, '| relative', full.primary_info?.relative_date?.text); console.log('desc full', full.secondary_info?.description?.text?.slice(0,300)); }
