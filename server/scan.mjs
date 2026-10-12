import { Innertube } from 'youtubei.js';
import fs from 'fs';
const yt = await Innertube.create({ lang: 'ar', location: 'AE', retrieve_player: false });
const rows = JSON.parse(fs.readFileSync('../playlists_dump.json','utf8'));
const parseDur = s => { if(!s) return 0; const p = s.trim().split(':').map(Number); if (p.some(isNaN)) return 0; return p.reduce((a,b)=>a*60+b,0); };
const out = []; let done = 0;
async function worker(q) {
  while (q.length) {
    const r = q.shift();
    try {
      let pl = await yt.getPlaylist(r.id);
      let vids = [...pl.videos];
      while (pl.has_continuation) { pl = await pl.getContinuation(); vids.push(...pl.videos); }
      out.push({ id: r.id, title: pl.info.title ?? r.title, thumb: pl.info.thumbnails?.[0]?.url, last_updated: pl.info.last_updated,
        videos: vids.map(v => ({ id: v.content_id, title: v.metadata?.title?.text, dur: parseDur(v.content_image?.overlays?.[0]?.badges?.[0]?.text),
          rel: v.metadata?.metadata?.metadata_rows?.[1]?.metadata_parts?.map(p=>p.text?.text).join(' • ') })) });
    } catch (e) { out.push({ id: r.id, title: r.title, error: e.message, videos: [] }); }
    if (++done % 40 === 0) console.log('done', done);
  }
}
const q = [...rows];
await Promise.all([1,2,3,4,5].map(() => worker(q)));
fs.writeFileSync('../scan.json', JSON.stringify(out, null, 1));
const full = out.filter(p => p.videos.some(v => v.dur >= 420));
console.log('playlists', out.length, '| with >=7min episodes', full.length, '| errors', out.filter(p=>p.error).length);
console.log('total videos', out.reduce((a,p)=>a+p.videos.length,0), '| episodes >=7min', out.reduce((a,p)=>a+p.videos.filter(v=>v.dur>=420).length,0));
// publish date check
const v = full[0].videos.find(v=>v.dur>=420);
const fi = await yt.getInfo(v.id);
console.log('getInfo published:', fi.primary_info?.published?.text, '| rel', fi.primary_info?.relative_date?.text, '| basic start', fi.basic_info?.start_timestamp);
console.log('desc', fi.secondary_info?.description?.text?.slice(0,200));
