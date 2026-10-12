import { Innertube } from 'youtubei.js';
const yt = await Innertube.create({ lang: 'ar', location: 'AE', retrieve_player: false });
const ch = await yt.getChannel('UCVsMtEFRLoCdTnGX_OFPUpQ').catch(async () => {
  const r = await yt.resolveURL('https://www.youtube.com/@natgeoabudhabime');
  console.log('resolved', JSON.stringify(r.payload));
  return yt.getChannel(r.payload.browseId);
});
console.log('CHANNEL', ch.metadata?.title, ch.metadata?.external_id);
let pl = await ch.getPlaylists();
let all = [...pl.playlists];
while (pl.has_continuation) { pl = await pl.getContinuation(); all.push(...pl.playlists); }
console.log('COUNT', all.length);
for (const p of all) console.log(p.id, '|', p.title?.text ?? p.title, '|', p.video_count?.text ?? p.video_count_short?.text ?? '');
