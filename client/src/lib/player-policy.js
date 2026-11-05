const compatibleHosts=new Set(['vidsrc.mov','vidsrc.fyi','embed.vidsrc.si','vidfast.pro','vidup.to','vidrock.net','vidnest.fun','vidlink.pro','111movies.net','multiembed.mov','mappletv.uk','moviesapi.to','embos.top','vidcore.net','vidapi.xyz']);
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
export function preferredServer(servers,videoId){
  const youtube=/^[\w-]{11}$/.test(videoId)?servers.findIndex(server=>server.type==='youtube'):-1;
  if(youtube>=0)return youtube;
  const direct=servers.findIndex(server=>server.streamUrl);return direct>=0?direct:0;
}
export function nextServer(servers,current,attempted){
  for(let offset=1;offset<=servers.length;offset++){const index=(current+offset)%servers.length;if(!attempted.has(index))return index;}
  return -1;
}
export function validProgress(position,duration){return Number.isFinite(position)&&Number.isFinite(duration)&&position>=0&&duration>0&&position<=duration+1;}
