// Track the approved player's visible content video, without extracting media URLs.
((startAt)=>{
 const sought=new WeakSet(),sent=new WeakMap();
 const eligible=video=>window.DahshaContentVideo?.eligible(video)===true;
 const seek=video=>{
  if(!eligible(video)||sought.has(video)||video.readyState<1)return;
  if(startAt>0&&startAt<video.duration-2){try{video.currentTime=startAt;sought.add(video);}catch{}}else sought.add(video);
 };
 const report=(video,final=false,ended=false)=>{
  if(!eligible(video))return;seek(video);
  if(video.seeking||!Number.isFinite(video.currentTime)||video.currentTime<=0)return;
  if(!video.paused)window.DahshaContentVideo.observe(video);
  if(!window.DahshaContentVideo.hasPlayed(video))return;
  const now=Date.now();if(!final&&now-(sent.get(video)||0)<2000)return;sent.set(video,now);
  try{DahshaPlayback.postMessage(JSON.stringify({type:'progress',position:video.currentTime,duration:video.duration,playing:!video.paused,final,ended}));}catch{}
 };
 document.addEventListener('loadedmetadata',event=>seek(event.target),true);
 document.addEventListener('canplay',event=>seek(event.target),true);
 document.addEventListener('timeupdate',event=>report(event.target),true);
 document.addEventListener('pause',event=>report(event.target,true),true);
 document.addEventListener('ended',event=>report(event.target,true,true),true);
 const flush=()=>{for(const video of document.querySelectorAll('video'))report(video,true);};
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush();});
 window.addEventListener('pagehide',flush);
})(/*DAHSHA_START_AT*/0);
