const compatibleHosts=new Set(['vidsrc.mov','vidsrc.fyi','embed.vidsrc.si','vidfast.pro','vidup.to','vidrock.net','vidnest.fun','vidlink.pro','111movies.net','multiembed.mov','mappletv.uk','moviesapi.to','embos.top','vidcore.net','vidapi.xyz']);
export function playerPolicy(server) {
  if(server.requiresBrowserVerification)return null;
  try {
    const url=new URL(server.embedUrl || server.rawEmbedUrl);
    if(url.hostname==='hdtoday.sx')return null;
    if(url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&compatibleHosts.has(url.hostname))return {...server,sandbox:null};
  }catch{/* HLS and YouTube entries do not require an embed URL. */}
  return server;
}
