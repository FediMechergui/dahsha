import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFmoviesList, parseFmoviesDetails, parseFmoviesId, fmoviesServers } from '../src/fmovies.js';
import { parseHdtodayList, parseHdtodayDetails, parseHdtodayId, hdtodayServers, parseHdtodayPlayer, hdtodayTvFallbacks } from '../src/hdtoday.js';
import { mergeLibrary, mergeShow } from '../src/merge-library.js';
import { unifiedStream } from '../src/library-service.js';
import { leanCatalog } from '../src/export-catalog.js';

const fm = (overrides={}) => ({id:'fm:m:77',tmdbId:77,kind:'film',title:'A Shared Film',year:2024,documentary:true,tags:['documentary'],episodes:[{id:'fm:m:77',title:'A Shared Film',season:1,number:1,offerings:[{provider:'fmovies',id:'fm:m:77'}]}],offerings:[{provider:'fmovies',id:'fm:m:77',tmdbId:77,kind:'film',documentary:true}],...overrides});
const base = () => ({product:'flixer',shows:[{id:'mf:m:shared-film',title:'A Shared Film',year:2024,kind:'film',tags:['documentary'],episodes:[{id:'mf:m:shared-film',title:'A Shared Film',season:1,number:1}]}],tags:[],channels:[]});

test('HDToday public redirect pages resolve only approved HTTPS player origins',()=>{
  assert.equal(parseHdtodayPlayer('<meta http-equiv="refresh" content="0;url=https://vidlink.pro/movie/77?autoplay=true&amp;title=true">'),'https://vidlink.pro/movie/77?autoplay=true&title=true');
  assert.equal(parseHdtodayPlayer('<meta http-equiv="refresh" content="0;url=http://127.0.0.1/private">'),null);
  assert.equal(parseHdtodayPlayer('<title>Quick check</title>'),null);
});

test('blocked HDToday TV routes use documented players only with a verified numeric identity',()=>{
  const id='hd:s:tv-reacher-2pzovm4q:2:3';
  assert.deepEqual(hdtodayTvFallbacks(id,null),[]);
  assert.deepEqual(hdtodayTvFallbacks(id,'https://private'),[]);
  const options=hdtodayTvFallbacks(id,108978);
  assert.equal(options.length,12);
  assert.equal(options.filter(s=>s.resolution==='documented-provider-route').length,3);
  assert.equal(options[0].embedUrl,'https://vidsrc.mov/embed/tv/108978/2/3');
  assert.equal(options[7].embedUrl,'https://vidlink.pro/tv/108978/2/3');
});

test('uncertain versions share one card without combining episodes or confirmed identities',()=>{
  const catalog=base();catalog.shows[0].year=null;
  const result=mergeLibrary(catalog,[fm()]);
  assert.equal(result.catalog.shows.length,1);
  assert.equal(result.catalog.shows[0].versions[0].id,'fm:m:77');
  assert.equal(result.catalog.shows[0].episodes[0].offerings.length,1);
  assert.equal(result.report.aliases['fm:m:77'],undefined);
  const again=mergeLibrary(result.catalog,[fm()]);
  assert.equal(again.catalog.shows[0].versions.length,1);
  assert.equal(leanCatalog(again.catalog,'flixer').shows[0].versions[0].id,'fm:m:77');
});

test('FMovies card import preserves numeric identity, year and documentary filter evidence',()=>{
  const html='<select><option value="99" selected>Documentary</option></select>Page 1 of 2 <a href="/movie/a-shared-film-77"><article><img src="https://image.tmdb.org/t/p/w500/a.jpg"><h3>A Shared Film</h3></article><span>2024</span><span>EN</span></a>';
  const result=parseFmoviesList(html,{documentary:true});
  assert.equal(result.items[0].id,'fm:m:77');assert.equal(result.items[0].year,2024);assert.equal(result.items[0].documentary,true);assert.equal(result.totalPages,2);
  assert.throws(()=>parseFmoviesList(html.replace('value="99" selected','value="28" selected'),{documentary:true}),/filter/);
  assert.throws(()=>parseFmoviesList('<h1>Changed layout</h1>'),/pagination/);
});

test('FMovies episode parsing uses episode links, not season-selector placeholders',()=>{
  const data={'@type':'TVSeries',name:'Example Series',genre:['Documentary'],dateCreated:'2024-01-01',numberOfSeasons:2};
  const html=`<script type="application/ld+json">${JSON.stringify(data)}</script><section aria-label="Episodes"><a href="?season=1&#38;episode=1"><span>Season 1</span></a><a href="?season=2&#38;episode=1"><span>Season 2</span></a><a href="?season=1&#38;episode=1" title="First chapter">01</a><a href="?season=1&#38;episode=2" title="Second chapter">02</a></section>`;
  const result=parseFmoviesDetails(html,'https://www.f-movies.org/tv/example-series-88');
  assert.deepEqual(result.seasons,[1,2]);assert.equal(result.episodes.length,2);assert.equal(result.episodes[0].title,'First chapter');assert.equal(result.episodes[1].id,'fm:e:88:1:2');
});

test('HDToday verifies card genres and folds season labels into a series title',()=>{
  const html='<a class="bf-card" href="/watch/tv-example-series-abc12345" title="Example Series - Season 9"><img src="https://image.tmdb.org/t/p/w342/a.jpg"><span class="bf-card__genre">Documentary, Reality</span></a><a href="/genre/documentary?page=2" rel="next">Next</a>';
  const result=parseHdtodayList(html,{documentary:true});
  assert.equal(result.items[0].title,'Example Series');assert.equal(result.items[0].kind,'series');assert.equal(result.items[0].documentary,true);assert.equal(result.hasNext,true);
  assert.throws(()=>parseHdtodayList('<title>Quick check</title>'),/verification/);
});

test('HDToday structured details provide a typed external identity',()=>{
  const data={'@type':'Movie',name:'A Shared Film',genre:['Documentary'],datePublished:'2024-01-01',description:'A synopsis',duration:'PT90M'};
  const html=`<script type="application/ld+json">${JSON.stringify(data)}</script><input name="tmdb_id" value="77">`;
  const result=parseHdtodayDetails(html,'https://hdtoday.sx/watch/movie-a-shared-film-abc12345');
  assert.equal(result.tmdbId,77);assert.equal(result.documentary,true);assert.equal(result.totalDurationSec,5400);
});

test('provider IDs and generated server URLs reject arbitrary URLs and preserve episode coordinates',()=>{
  assert.equal(parseFmoviesId('fm:e:77:2:3').season,2);assert.equal(fmoviesServers('fm:e:77:2:3').length,3);
  assert.match(fmoviesServers('fm:e:77:2:3')[0].embedUrl,/mid=77&s=2&e=3/);
  assert.equal(parseFmoviesId('fm:m:../private'),null);assert.equal(fmoviesServers('fm:s:77').length,0);
  assert.equal(parseHdtodayId('hd:m:movie-a-film-abc12345').kind,'film');
  assert.equal(parseHdtodayId('hd:m:tv-a-film-abc12345'),null);
  const hd=hdtodayServers('hd:s:tv-example-abc12345:2:3');assert.equal(hd.length,12);assert.match(hd[0].embedUrl,/s=2&e=3/);
});

test('matching films keep existing show/episode IDs and append offerings without duplicates',()=>{
  const first=mergeLibrary(base(),[fm()],{product:'flixer'});
  assert.equal(first.catalog.shows.length,1);assert.equal(first.report.matched,1);
  const show=first.catalog.shows[0];assert.equal(show.id,'mf:m:shared-film');assert.equal(show.episodes[0].id,'mf:m:shared-film');assert.equal(show.episodes[0].offerings.length,2);
  const again=mergeLibrary(first.catalog,[fm()],{product:'flixer',aliases:first.report.aliases});
  assert.equal(again.catalog.shows.length,1);assert.equal(again.catalog.shows[0].episodes[0].offerings.length,2);
  const lean=leanCatalog(again.catalog,'flixer');assert.equal(lean.shows[0].offerings.length,2);assert.equal(lean.shows[0].episodes[0].offerings.length,2);
});

test('lean legacy film records gain their original episode ID, not a replacement provider ID',()=>{
  const catalog=base();catalog.shows[0].episodes=[];
  const result=mergeLibrary(catalog,[fm()],{product:'flixer'});
  assert.equal(result.catalog.shows[0].episodes[0].id,'mf:m:shared-film');
});

test('series merge by season and episode, keeping existing IDs and appending genuinely new episodes',()=>{
  const current={id:'mf:s:series',kind:'series',title:'Series',episodes:[{id:'mf:e:old-one',season:1,number:1,title:'First'}]};
  const incoming={id:'fm:s:88',kind:'series',title:'Series',episodes:[{id:'fm:e:88:1:1',season:1,number:1,title:'First'},{id:'fm:e:88:1:2',season:1,number:2,title:'Second'}],offerings:[{provider:'fmovies',id:'fm:s:88',tmdbId:88}]};
  const result=mergeShow(current,incoming);assert.equal(result.id,current.id);assert.equal(result.episodes.length,2);assert.equal(result.episodes[0].id,'mf:e:old-one');assert.equal(result.episodes[0].offerings.length,2);assert.equal(result.episodes[1].number,2);
  assert.equal(mergeShow(result,incoming).episodes.length,2);
});

test('remakes, media types, and ambiguous titles are never silently combined',()=>{
  assert.equal(mergeLibrary(base(),[fm({year:1990})]).catalog.shows.length,2);
  assert.equal(mergeLibrary(base(),[fm({kind:'series',id:'fm:s:77',episodes:[]})]).catalog.shows.length,2);
  const ambiguous=base();ambiguous.shows.push({...ambiguous.shows[0],id:'mf:m:another-copy'});
  const result=mergeLibrary(ambiguous,[fm()]);assert.equal(result.catalog.shows.length,2);assert.equal(result.report.pending.length,1);
});

test('Dahsha rejects non-documentary newcomers, while Flixer accepts them',()=>{
  const empty={shows:[],tags:[],channels:[]};const entertainment=fm({documentary:false,tags:['action']});
  assert.equal(mergeLibrary(empty,[entertainment],{product:'dahsha'}).catalog.shows.length,0);
  assert.equal(mergeLibrary(empty,[entertainment],{product:'flixer'}).catalog.shows.length,1);
});

test('confirmed aliases survive provider renames and new refresh batches',()=>{
  const initial=mergeLibrary(base(),[fm()]);
  const refreshed=mergeLibrary(initial.catalog,[fm({title:'A Renamed Film'})],{aliases:initial.report.aliases});
  assert.equal(refreshed.catalog.shows.length,1);assert.equal(refreshed.catalog.shows[0].id,'mf:m:shared-film');
});

test('unified playback returns existing and both new providers in one server list',async()=>{
  let show=mergeLibrary(base(),[fm()]).catalog.shows[0];
  show=mergeShow(show,{...fm(),id:'hd:m:movie-shared-film-abc12345',offerings:[{provider:'hdtoday',id:'hd:m:movie-shared-film-abc12345'}],episodes:[{id:'hd:m:movie-shared-film-abc12345',season:1,number:1,offerings:[{provider:'hdtoday',id:'hd:m:movie-shared-film-abc12345'}]}]});
  const catalog={product:'flixer',shows:[show]};
  const result=await unifiedStream(show.episodes[0].id,{catalog,product:'flixer',resolveTitle:async()=>show,resolveHdtoday:async id=>hdtodayServers(id),resolveMyflixer:async()=>({servers:[{id:'p2',name:'Player 2',type:'embed',embedUrl:'https://existing.example/player'}]})});
  assert.equal(result.servers.length,16);assert.ok(result.servers.some(s=>s.provider==='myflixer'));assert.ok(result.servers.some(s=>s.provider==='fmovies'));assert.ok(result.servers.some(s=>s.provider==='hdtoday'));
  const fallback=await unifiedStream(show.episodes[0].id,{catalog,product:'flixer',resolveTitle:async()=>show,resolveHdtoday:async id=>hdtodayServers(id),resolveMyflixer:async()=>{throw new Error('Offline');}});
  assert.equal(fallback.servers.length,15);
  assert.equal(await unifiedStream('fm:e:77:999:999',{showId:show.id,catalog,product:'flixer',resolveTitle:async()=>show}),null);
});

test('playback policy rejects entertainment in Dahsha and mismatched product catalogues',async()=>{
  const show=fm({documentary:false,providerMetadata:true});
  assert.equal(await unifiedStream(show.id,{catalog:{product:'dahsha',shows:[show]},product:'dahsha',resolveTitle:async()=>show}),null);
  assert.equal(await unifiedStream(show.id,{catalog:{product:'flixer',shows:[show]},product:'dahsha',resolveTitle:async()=>show}),null);
});

test('verified TV episodes retain direct providers when HDToday is unavailable',async()=>{
  const show={id:'fm:s:108978',kind:'series',tmdbId:108978,title:'Reacher',episodes:[{id:'fm:e:108978:2:3',season:2,number:3}]};
  const result=await unifiedStream(show.episodes[0].id,{catalog:{product:'flixer',shows:[show]},product:'flixer',resolveTitle:async()=>show});
  assert.equal(result.servers.filter(s=>['vidsrc','vidfast','vidlink'].includes(s.provider)).length,3);
  assert.ok(result.servers.every(s=>!s.embedUrl.includes('hdtoday.sx')));
  assert.equal(await unifiedStream('fm:e:108978:99:99',{showId:show.id,catalog:{shows:[show]},product:'flixer',resolveTitle:async()=>show}),null);
});
