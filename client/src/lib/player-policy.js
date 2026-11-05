const compatibleHosts=new Set(['vidsrc.mov','vidsrc.fyi','embed.vidsrc.si','vidfast.pro','vidup.to','vidrock.net','vidnest.fun','vidlink.pro','111movies.net','multiembed.mov','mappletv.uk','moviesapi.to','embos.top','emboser.com','vidcore.net','vidapi.xyz']);
export function playerPolicy(server) {
  if(!server||typeof server!=='object')return null;
  if(server.requiresBrowserVerification)return null;
  try {
    const url=new URL(server.embedUrl || server.rawEmbedUrl);
    if(url.hostname==='hdtoday.sx')return null;
    if(url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&compatibleHosts.has(url.hostname))return {...server,sandbox:null};
  }catch{/* HLS and YouTube entries do not require an embed URL. */}
  return server;
}

export const directType=server=>{
  const type=String(server?.type||server?.format||'').toLowerCase(),mime=String(server?.mimeType||'').toLowerCase(),url=server?.streamUrl||server?.rawStreamUrl||server?.uri||'';
  if(type==='dash'||mime.includes('dash+xml')||/\.mpd(?:[?#]|$)/i.test(url))return 'dash';
  if(type==='hls'||mime.includes('mpegurl')||/\.m3u8(?:[?#]|$)/i.test(url))return 'hls';
  return ['mp4','file','video'].includes(type)||url?'mp4':null;
};
export function playbackServers(data,base=''){
  const absolute=value=>{try{if(!value)return null;const url=new URL(value,base||globalThis.location?.origin);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
  let rows=Array.isArray(data?.servers)?data.servers:[];
  if(!rows.length&&data?.streams?.length)rows=data.streams.map((row,i)=>({...row,id:row.id??i,streamUrl:row.uri||row.proxyUri}));
  if(!rows.length&&(data?.streamUrl||data?.embedUrl))rows=[data];
  const result=[],seen=new Set();
  for(const [index,row]of rows.entries()){
    const server=playerPolicy(row);if(!server)continue;
    if(server.type==='youtube'&&/^[\w-]{11}$/.test(server.videoId)){const key='youtube:'+server.videoId;if(!seen.has(key)){seen.add(key);result.push({...server,id:server.id||key,name:server.name||'YouTube'});}continue;}
    const streamUrl=absolute(server.rawStreamUrl||server.streamUrl),embedUrl=absolute(server.rawEmbedUrl||server.embedUrl);
    const identity=streamUrl||embedUrl;if(!identity||seen.has(identity))continue;seen.add(identity);
    result.push({...server,id:server.id??index,name:server.name||`Server ${index+1}`,streamUrl,embedUrl,type:streamUrl?directType({...server,streamUrl}):'embed'});
  }
  return result;
}
export const MAX_AUTOMATIC_SOURCES=4;
const sourceKey=server=>server?.type==='youtube'?`youtube:${server.videoId}`:`${server?.provider||''}:${server?.streamUrl||server?.embedUrl||''}`;
const hostOf=server=>{try{return new URL(server.streamUrl||server.embedUrl).hostname;}catch{return server.type||'';}};
function priority(server,videoId,history){
  const state=history?.status(videoId,server)||{};
  const host=hostOf(server),url=server.embedUrl||'';
  const knownPublicRoute=/^https:\/\/vidfast\.(?:pro|vc)\/(?:movie\/[1-9]\d*|tv\/[1-9]\d*\/\d+\/[1-9]\d*)(?:[/?#]|$)/.test(url);
  const tvRoute=/^https:\/\/vidcore\.io\/tv\//.test(url);
  return [state.failed?1:0,server.streamUrl?0:state.successful?1:knownPublicRoute?2:tvRoute?3:4,host];
}
function rankedServerIndices(servers,videoId,history,attempted=new Set(),current=-1){
  const usedProviders=new Set([...attempted].map(index=>servers[index]?.provider).filter(Boolean));
  const usedHosts=new Set([...attempted].map(index=>servers[index]&&hostOf(servers[index])).filter(Boolean));
  return servers.map((server,index)=>({server,index})).filter(({index})=>!attempted.has(index)).sort((a,b)=>{
    const pa=priority(a.server,videoId,history),pb=priority(b.server,videoId,history);
    const order=index=>current<0?index:(index-current+servers.length)%servers.length;
    return pa[0]-pb[0]||pa[1]-pb[1]||Number(usedProviders.has(a.server.provider))-Number(usedProviders.has(b.server.provider))||Number(usedHosts.has(pa[2]))-Number(usedHosts.has(pb[2]))||order(a.index)-order(b.index);
  }).map(row=>row.index);
}
export function preferredServer(servers,videoId,history){
  const youtube=/^[\w-]{11}$/.test(videoId)?servers.findIndex(server=>server.type==='youtube'):-1;
  if(youtube>=0)return youtube;
  return rankedServerIndices(servers,videoId,history)[0]??0;
}
export function nextServer(servers,current,attempted,options){
  if(options)return rankedServerIndices(servers,options.videoId,options.history,attempted,current)[0]??-1;
  for(let offset=1;offset<=servers.length;offset++){const index=(current+offset)%servers.length;if(!attempted.has(index))return index;}
  return -1;
}
export function validProgress(position,duration){return Number.isFinite(position)&&Number.isFinite(duration)&&position>=0&&duration>0&&position<=duration+1;}

/** Success means sustained content progress, never an opened page, seek or short advertisement. */
export function createPlaybackEvidence({expectedDurationSec=0,now=Date.now}={}){
  let previous=null,started=0,travel=0,confirmed=false;
  return {observe({position,duration,playing=false}={}){
    const minimum=expectedDurationSec>0?expectedDurationSec*.6:120;
    if(!playing||!validProgress(position,duration)||position<=0||duration<minimum){previous=null;travel=0;return false;}
    const at=now(),elapsed=previous?(at-previous.at)/1000:0,delta=previous?position-previous.position:0;
    if(!previous||delta<0||delta>Math.max(5,elapsed*2+2)||Math.abs(duration-previous.duration)>2){started=at;travel=0;}
    else travel+=delta;
    previous={position,duration,at};
    if(!confirmed&&travel>=6&&at-started>=5000){confirmed=true;return true;}return false;
  }};
}

/** Small local hints only. No provider URLs or viewing history are sent to a server. */
export function createPlaybackHistory({storage,now=Date.now}={}){
  const key='dahsha.player-sources.v1';let rows=[];
  try{storage??=globalThis.localStorage;const text=storage?.getItem(key);if(text&&text.length<=65536){const data=JSON.parse(text);if(data.version===1&&Array.isArray(data.rows))rows=data.rows.filter(row=>typeof row.videoId==='string'&&typeof row.source==='string'&&row.source.length<=8192).slice(-64);}}catch{}
  const find=(videoId,server)=>rows.find(row=>row.videoId===videoId&&row.source===sourceKey(server));
  const write=(videoId,server,kind)=>{
    const source=sourceKey(server);if(!videoId||!source||source.length>8192)return;
    const row={...find(videoId,server),videoId,source,[kind]:now()};rows=rows.filter(item=>item.videoId!==videoId||item.source!==source);rows.push(row);
    rows=rows.slice(-64);let data=JSON.stringify({version:1,rows});while(data.length>65536&&rows.length){rows.shift();data=JSON.stringify({version:1,rows});}
    try{storage?.setItem(key,data);}catch{}
  };
  return {
    status(videoId,server){const row=find(videoId,server);if(!row)return {};const success=Number(row.successAt)||0,failure=Number(row.failedAt)||0;return {successful:success>0&&success>=failure&&now()-success<30*86400e3,failed:failure>success&&now()-failure<15*60e3};},
    success(videoId,server){write(videoId,server,'successAt');},
    failure(videoId,server){write(videoId,server,'failedAt');},
  };
}

export function playbackFailureText(value,lang='en'){
  const ar=lang==='ar',code=value?.sourceError||value?.code||'',message=String(value?.message||'');
  if(code==='BROWSER_VERIFICATION')return ar?'المصدر يطلب تحقق المتصفح.':'This source requires browser verification.';
  if(code==='STARTUP_TIMEOUT')return ar?'لم يبدأ المصدر تشغيل الفيديو في الوقت المحدد.':'This source did not start the video in time.';
  if(code==='SOURCE_UNAVAILABLE')return ar?'الفيديو غير متاح على هذا المصدر.':'This source has no available video.';
  if(code==='UNSUPPORTED_NATIVE'||/not supported|not implemented|unavailable plugin/i.test(message))return ar?'هذا المصدر غير مدعوم داخل التطبيق.':'This source is not supported by the in-app player.';
  if(value?.httpStatus>=400)return ar?`رفض المصدر التشغيل (HTTP ${value.httpStatus}).`:`The source refused playback (HTTP ${value.httpStatus}).`;
  return ar?'تعذر تشغيل هذا المصدر.':'This source could not play the video.';
}
