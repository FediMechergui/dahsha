// Track the approved player's visible content video, without extracting media URLs.
((startAt)=>{
 const sought=new WeakSet(),played=new WeakSet(),sent=new WeakMap();
 const eligible=video=>{
  if(!(video instanceof HTMLVideoElement)||!Number.isFinite(video.duration)||video.duration<=30||video.closest('.ytp-ad-showing,.jw-flag-ads,.vjs-ad-playing,.ad-container,[data-ad-slot]'))return false;
  const box=video.getBoundingClientRect();if(box.width<80||box.height<40||box.bottom<=0||box.right<=0||box.top>=innerHeight||box.left>=innerWidth)return false;
  for(let el=video;el;el=el.parentElement){const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden'||style.opacity==='0')return false;}
  return ![...document.querySelectorAll('video')].some(other=>other!==video&&other.getBoundingClientRect().width*other.getBoundingClientRect().height>box.width*box.height);
 };
 const seek=video=>{
  if(!eligible(video)||sought.has(video)||video.readyState<1)return;
  if(startAt>0&&startAt<video.duration-2){try{video.currentTime=startAt;sought.add(video);}catch{}}else sought.add(video);
 };
 const report=(video,final=false,ended=false)=>{
  if(!eligible(video))return;seek(video);
  if(video.seeking||!Number.isFinite(video.currentTime)||video.currentTime<=0)return;
  if(!video.paused)played.add(video);
  if(!played.has(video))return;
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
