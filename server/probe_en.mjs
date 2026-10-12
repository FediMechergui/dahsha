import { Innertube } from 'youtubei.js';
const yt = await Innertube.create({ lang: 'en', location: 'US', retrieve_player: false });
const handles = ['@NatGeo','@DWDocumentary','@fern-tv','@hoog-youtube','@JCS','@frontline','@HISTORY','@FreeDocumentaryHistory','@kurzgesagt','@VICENews','@veritasium'];
const dur = s => { if(!s) return 0; const p=String(s).split(':').map(Number); return p.some(isNaN)?0:p.reduce((a,b)=>a*60+b,0); };
for (const h of handles) {
  try {
    const r = await yt.resolveURL(`https://www.youtube.com/${h}`);
    const id = r.payload.browseId;
    const ch = await yt.getChannel(id);
    console.log('\n=====', h, id, '|', ch.metadata?.title, '| subs', ch.header?.content?.metadata?.metadata_rows?.[1]?.metadata_parts?.[0]?.text?.text ?? '');
    let all = [];
    if (ch.has_playlists) { let pl = await ch.getPlaylists(); all = [...pl.playlists]; let g=0; while (pl.has_continuation && g++<20) { pl = await pl.getContinuation(); all.push(...pl.playlists); } }
    console.log('playlists:', all.length);
    all.slice(0,10).forEach(p => console.log('  PL', p.metadata?.title?.text ?? p.title?.text, '|', p.content_image?.primary_thumbnail?.overlays?.[0]?.badges?.[0]?.text ?? p.video_count?.text));
    let v = await ch.getVideos(); let vids = [...v.videos]; let g=0;
    while (v.has_continuation && g++<2) { v = await v.getContinuation(); vids.push(...v.videos); }
    const rows = vids.map(x => ({ title: x.metadata?.title?.text ?? x.title?.text, d: dur(x.content_image?.overlays?.[0]?.badges?.[0]?.text ?? x.duration?.text) }));
    const long = rows.filter(r => r.d >= 420);
    console.log('videos sampled:', rows.length, '| >=7min:', long.length);
    long.slice(0, 14).forEach(r => console.log('  ', Math.round(r.d/60)+'m |', r.title));
  } catch (e) { console.log('ERR', h, e.message); }
}
