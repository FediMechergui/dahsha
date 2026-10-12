import { Innertube } from 'youtubei.js';
const yt = await Innertube.create({ lang: 'ar', location: 'AE', retrieve_player: false });
const ch = await yt.getChannel('UCLiTe0aOHShx7hXGyqZ9UIw');
let pl = await ch.getPlaylists();
const p = pl.playlists[0];
console.log('TYPE', p.type);
console.log(JSON.stringify(p, (k,v)=> (k==='runs'||k==='sources'&&Array.isArray(v)&&v.length>3)?undefined:v, 1).slice(0, 4000));
