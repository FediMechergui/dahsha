import { Innertube } from 'youtubei.js';
import fs from 'fs';
const yt = await Innertube.create({ lang: 'ar', location: 'AE', retrieve_player: false });
const scan = JSON.parse(fs.readFileSync('../scan.json','utf8'));
const mega = scan.find(p => p.title === 'حلقات كاملة');
console.log('=== MEGA sample titles (first 25, then every 20th)');
mega.videos.slice(0,25).forEach(v => console.log(' ', v.dur, '|', v.title, '|', v.rel));
mega.videos.filter((_,i)=>i%20===0).forEach(v => console.log(' ', v.dur, '|', v.title));
console.log('no-pipe titles:', mega.videos.filter(v=>!v.title.includes('|')).length, mega.videos.filter(v=>!v.title.includes('|')).slice(0,10).map(v=>v.title));
console.log('\n=== descriptions');
const picks = [mega.videos[1].id, mega.videos[50].id, mega.videos[150].id, scan.find(p=>p.title==='الطاه المغامر').videos.find(v=>v.dur>=420).id];
for (const id of picks) {
  const r = await yt.actions.execute('/player', { videoId: id, client: 'WEB', parse: false });
  const d = r.data ?? r;
  const mf = d.microformat?.playerMicroformatRenderer;
  console.log('\n#', id, '| publishDate', mf?.publishDate, '| uploadDate', mf?.uploadDate, '| category', mf?.category, '| len', d.videoDetails?.lengthSeconds);
  console.log(d.videoDetails?.shortDescription);
}
