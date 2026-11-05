// Shared content checks for playback health and saved progress. A preroll clock
// must not qualify as the documentary merely because a <video> is advancing.
((expectedDurationSec)=>{
 const expected=Number.isFinite(expectedDurationSec)&&expectedDurationSec>0?expectedDurationSec:0;
 const ads='.ytp-ad-showing,.jw-flag-ads,.jw-ad-container,.vjs-ad-playing,.vjs-ad-loading,.ima-ad-container,.ad-container,#ad-container,#ads-container,.advertisement,[data-ad-slot],[data-ad-client],[data-is-ad="true"],[aria-label="Advertisement"]';
 const observed=new WeakMap();
 const signature=video=>`${video.currentSrc||''}|${video.duration}`;
 const visibleArea=video=>{
  const box=video.getBoundingClientRect();
  if(box.width<80||box.height<40||box.bottom<=0||box.right<=0||box.top>=innerHeight||box.left>=innerWidth)return 0;
  for(let el=video;el;el=el.parentElement){const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden'||style.opacity==='0')return 0;}
  return box.width*box.height;
 };
 const eligible=video=>{
  if(!(video instanceof HTMLVideoElement)||!Number.isFinite(video.duration)||video.duration<=0||video.closest(ads))return false;
  // Permit genuine short clips when their catalogue duration is known. For
  // longer documentaries only a lower bound is used, allowing extended cuts.
  if(expected>0){
   if(video.duration<Math.max(.1,expected*.5))return false;
   if(expected<=90&&Math.abs(video.duration-expected)>Math.max(5,expected*.25))return false;
  }else if(video.duration<=30)return false;
  const area=visibleArea(video);if(!area)return false;
  return ![...document.querySelectorAll('video')].some(other=>other!==video&&!other.closest(ads)&&visibleArea(other)>area);
 };
 const observe=video=>{
  if(!eligible(video)||video.paused||video.seeking||!Number.isFinite(video.currentTime)||video.currentTime<=0)return false;
  const key=signature(video),now=Date.now();let state=observed.get(video);
  if(!state||state.key!==key||video.currentTime<state.last-1){state={key,first:video.currentTime,last:video.currentTime,at:now,played:false};observed.set(video,state);return false;}
  if(video.currentTime>state.last+.1){state.last=video.currentTime;if(now-state.at>=750&&video.currentTime-state.first>=.5)state.played=true;}
  return state.played;
 };
 window.DahshaContentVideo={eligible,observe,hasPlayed:video=>eligible(video)&&observed.get(video)?.key===signature(video)&&observed.get(video)?.played===true};
})(/*DAHSHA_EXPECTED_DURATION*/0);
