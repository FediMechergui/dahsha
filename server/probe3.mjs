import { Innertube } from 'youtubei.js';
import fs from 'fs';
const yt = await Innertube.create({ lang: 'ar', location: 'AE', retrieve_player: false });
const ch = await yt.getChannel('UCLiTe0aOHShx7hXGyqZ9UIw');
let pl = await ch.getPlaylists();
let all = [...pl.playlists];
while (pl.has_continuation) { pl = await pl.getContinuation(); all.push(...pl.playlists); }
const rows = all.map(p => ({
  id: p.content_id,
  title: p.metadata?.title?.text,
  count: p.content_image?.primary_thumbnail?.overlays?.[0]?.badges?.[0]?.text,
  thumb: p.content_image?.primary_thumbnail?.image?.[0]?.url
}));
fs.writeFileSync('../playlists_dump.json', JSON.stringify(rows, null, 1));
rows.forEach((r,i) => console.log(i, r.id, '|', r.title, '|', r.count));
// probe one playlist
const first = rows.find(r => /[0-9]{2}/.test(r.count||'')) || rows[1];
console.log('\n=== PLAYLIST', first.title);
const info = await yt.getPlaylist(first.id);
console.log('INFO keys', Object.keys(info.info));
console.log('desc', info.info.description, '| total', info.info.total_items, '| views', info.info.views, '| last', info.info.last_updated);
const v = info.videos[0];
console.log('VTYPE', v.type);
console.log(JSON.stringify(v, (k,val)=> (k==='runs')?undefined:val, 1).slice(0, 3000));
