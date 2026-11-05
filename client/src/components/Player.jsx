import {useEffect,useRef,useState} from 'react';
import {useLang} from '../lib/i18n.jsx';
import {api,API_BASE} from '../lib/api.js';
import {playbackServers,preferredServer,nextServer,validProgress,MAX_AUTOMATIC_SOURCES,createPlaybackHistory,createPlaybackEvidence,playbackFailureText} from '../lib/player-policy.js';

let youtubeApi;
function loadYoutube(){
  if(window.YT?.Player)return Promise.resolve(window.YT);
  if(youtubeApi)return youtubeApi;
  const promise=new Promise((resolve,reject)=>{
    const previous=window.onYouTubeIframeAPIReady;
    let script=document.querySelector('script[data-dahsha-youtube]');
    const timer=setTimeout(()=>finish(Error('YouTube player did not load')),15000);
    const ready=()=>{previous?.();finish();};
    function finish(error){clearTimeout(timer);if(window.onYouTubeIframeAPIReady===ready)window.onYouTubeIframeAPIReady=previous;if(error){script?.remove();reject(error);}else resolve(window.YT);}
    window.onYouTubeIframeAPIReady=ready;
    if(!script){script=document.createElement('script');script.dataset.dahshaYoutube='1';script.src='https://www.youtube.com/iframe_api';script.async=true;script.onerror=()=>finish(Error('YouTube player unavailable'));document.head.appendChild(script);}
  });
  youtubeApi=promise;promise.catch(()=>{if(youtubeApi===promise)youtubeApi=null;});return promise;
}
const nativePlugin=name=>{const capacitor=globalThis.window?.Capacitor;return capacitor?.isNativePlatform?.()?(capacitor.Plugins?.[name]||capacitor.registerPlugin?.(name)):null;};
const fullscreenIcon=<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>;

export default function Player({videoId,episode,startAt=0,onProgress,onEnded,autoplay=true}){
  const {t,lang}=useLang(),container=useRef(null),stage=useRef(null),video=useRef(null),youtubeHost=useRef(null);
  const callbacks=useRef({onProgress,onEnded,videoId});callbacks.current={onProgress,onEnded,videoId};
  const position=useRef(startAt),attempts=useRef(new Set()),automaticFailures=useRef(0),native=useRef(null),closing=useRef(Promise.resolve()),sessionCounter=useRef(0),history=useRef(null),evidence=useRef(null);
  if(!history.current)history.current=createPlaybackHistory();
  const [servers,setServers]=useState([]),[active,setActive]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState(''),[closed,setClosed]=useState(false),[retry,setRetry]=useState(0),[fullscreen,setFullscreen]=useState(false),[resolvedKey,setResolvedKey]=useState(null);
  const provider=/^(mf|fm|hd):/.test(videoId||'')||episode?.offerings?.some(offering=>offering.provider!=='youtube');
  const source=episode?.offerings?.find(offering=>['fmovies','hdtoday'].includes(offering.provider))?.sourceUrl||episode?.sourceUrl;
  const sources=episode?.offerings?.map(offering=>offering.sourceUrl).filter(Boolean)||[];
  const resolutionKey=JSON.stringify([videoId,episode?.showId,source,sources]);
  const current=provider?(resolvedKey===resolutionKey?servers[active]:null):{id:videoId,type:'youtube',videoId,name:'YouTube'};
  const plugin=current?.type==='embed'?nativePlugin('PlayerView'):current?.streamUrl?nativePlugin('DirectVideo'):null;
  const nativeExpected=!!globalThis.window?.Capacitor?.isNativePlatform?.()&&(current?.type==='embed'||!!current?.streamUrl),useNative=!!plugin;
  const expectedDurationSec=Number(episode?.durationSec)||0;
  const handlers=useRef({});
  const report=(pos,duration,{playing=false}={})=>{if(validProgress(pos,duration)&&pos>0){
    position.current=Math.min(pos,duration);callbacks.current.onProgress?.(position.current,duration);
    const key=`${resolutionKey}:${current?.id}:${retry}`;
    if(evidence.current?.key!==key)evidence.current={key,tracker:createPlaybackEvidence({expectedDurationSec})};
    if(current&&evidence.current.tracker.observe({position:pos,duration,playing}))history.current.success(videoId,current);
  }};
  const fail=detail=>{
    attempts.current.add(active);
    if(current)history.current.failure(videoId,current);
    automaticFailures.current++;
    const next=nextServer(servers,active,attempts.current,{videoId,history:history.current});
    if(next>=0&&automaticFailures.current<MAX_AUTOMATIC_SOURCES){setActive(next);setError('');setClosed(false);}
    else setError(`${current?.name?current.name+': ':''}${playbackFailureText(detail,lang)} ${lang==='ar'?'اختر المصدر التالي أو جرّب خادماً آخر.':'Choose Next source or another server.'}`);
  };
  const choose=(index,{keepAttempts=false}={})=>{if(!keepAttempts)attempts.current.clear();automaticFailures.current=0;setActive(index);setError('');setClosed(false);setRetry(value=>value+1);};
  const advance=()=>{
    attempts.current.add(active);
    const next=nextServer(servers,active,attempts.current,{videoId,history:history.current});
    if(next>=0)choose(next,{keepAttempts:true});
    else setError(lang==='ar'?'تمت تجربة جميع المصادر. اختر خادماً لإعادة المحاولة.':'All sources have been tried. Select a server to retry.');
  };
  handlers.current={fail,report,next:advance,ended:()=>callbacks.current.onEnded?.()};
  const bounds=()=>{const rect=stage.current?.getBoundingClientRect();return rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height,viewportWidth:window.innerWidth}:null;};

  useEffect(()=>{
    let cancelled=false;position.current=Math.max(0,startAt||0);attempts.current.clear();automaticFailures.current=0;evidence.current=null;setServers([]);setActive(0);setError('');setClosed(false);setLoading(provider);
    if(provider)api.stream(videoId,{showId:episode?.showId,source,sources}).then(data=>{
      if(cancelled)return;const choices=playbackServers(data,API_BASE||window.location.origin);setServers(choices);setResolvedKey(resolutionKey);setActive(preferredServer(choices,videoId,history.current));setLoading(false);if(!choices.length)setError(lang==='ar'?'لا توجد روابط تشغيل متاحة لهذا المصدر الآن.':'No playable links are currently available from this source.');
    }).catch(()=>{if(!cancelled){setLoading(false);setError(lang==='ar'?'تعذر تحميل الخوادم. أعد المحاولة.':'Could not load servers. Please try again.');}});
    return()=>{cancelled=true;};
    // Identity/source changes resolve once; progress renders must not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[resolutionKey]);

  useEffect(()=>{
    const selected=container.current?.querySelector('.player__server-btn[aria-pressed="true"]'),list=selected?.closest('.player__servers');
    if(!selected||!list)return;const button=selected.getBoundingClientRect(),strip=list.getBoundingClientRect();
    const left=button.left<strip.left?button.left-strip.left:button.right>strip.right?button.right-strip.right:0;
    if(left)list.scrollBy({left,behavior:'smooth'});
  },[active,servers,fullscreen]);

  useEffect(()=>{
    const change=()=>setFullscreen(!!(document.fullscreenElement||document.webkitFullscreenElement));document.addEventListener('fullscreenchange',change);document.addEventListener('webkitfullscreenchange',change);
    return()=>{document.removeEventListener('fullscreenchange',change);document.removeEventListener('webkitfullscreenchange',change);};
  },[]);
  const toggleFullscreen=()=>{
    if(native.current){native.current.plugin.setFullscreen({fullscreen:!fullscreen}).catch(()=>{});return;}
    if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});else container.current?.requestFullscreen?.().catch(()=>{});
  };

  useEffect(()=>{
    if(!nativeExpected||!current||error||closed)return;
    if(!plugin){handlers.current.fail({sourceError:'UNSUPPORTED_NATIVE'});return;}
    let cancelled=false,progressListener,fullscreenListener,opened=false;
    const session=`${videoId}:${++sessionCounter.current}`;
    const sync=()=>{if(!cancelled&&opened)plugin.updateBounds({bounds:bounds()}).catch(()=>{});};
    const resize=new ResizeObserver(sync);if(stage.current)resize.observe(stage.current);window.addEventListener('resize',sync);window.addEventListener('scroll',sync,true);
    (async()=>{
      await closing.current;if(cancelled)return;
      progressListener=await plugin.addListener('progress',value=>{if(!cancelled&&callbacks.current.videoId===videoId&&value.session===session)handlers.current.report(value.position,value.duration,{playing:value.playing===true});});
      fullscreenListener=await plugin.addListener('fullscreen',value=>{if(!cancelled&&value.session===session)setFullscreen(value.fullscreen===true);});
      if(cancelled)return;
      native.current={plugin,session};opened=true;
      const result=await plugin.open({url:current.streamUrl||current.embedUrl,type:current.type,session,startAt:position.current,expectedDurationSec,title:episode?.title||current.name,headers:current.headers||{},bounds:bounds(),captureMedia:false});
      if(cancelled)return;
      if(callbacks.current.videoId===videoId)handlers.current.report(result.position,result.duration);
      native.current=null;setFullscreen(false);
      if(result.reason==='ended')handlers.current.ended();
      else if(result.reason==='next')handlers.current.next();
      else if(result.reason==='failed')handlers.current.fail(result);
      else setClosed(true);
    })().catch(detail=>{if(cancelled)return;native.current=null;handlers.current.fail(detail);}).finally(()=>{if(cancelled){progressListener?.remove();fullscreenListener?.remove();}});
    return()=>{cancelled=true;resize.disconnect();window.removeEventListener('resize',sync);window.removeEventListener('scroll',sync,true);progressListener?.remove();fullscreenListener?.remove();if(opened){if(native.current?.session===session)native.current=null;closing.current=plugin.close().catch(()=>{});}};
    // Native plugin instances can be recreated by Capacitor; source identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[videoId,current?.id,current?.streamUrl,current?.embedUrl,nativeExpected,error,closed,retry]);

  useEffect(()=>{
    if(!current?.streamUrl||nativeExpected||error||closed)return;
    const element=video.current;if(!element)return;let stopped=false,hls,failed=false;
    const failure=()=>{if(!stopped&&!failed){failed=true;handlers.current.fail();}};
    const seek=()=>{if(position.current>0&&position.current<element.duration-2)element.currentTime=position.current;if(autoplay)element.play().catch(()=>{});};
    const timer=setTimeout(failure,45000),playing=()=>clearTimeout(timer);
    element.addEventListener('loadedmetadata',seek);element.addEventListener('error',failure);element.addEventListener('playing',playing);
    (async()=>{
      if(current.type==='dash'){failure();return;}
      if(current.type==='hls'&&!element.canPlayType('application/vnd.apple.mpegurl')){
        const Hls=(await import('hls.js')).default;if(stopped)return;if(!Hls.isSupported()){failure();return;}
        hls=new Hls({enableWorker:true,backBufferLength:30});hls.on(Hls.Events.ERROR,(_,event)=>{if(event.fatal)failure();});hls.loadSource(current.streamUrl);hls.attachMedia(element);
      }else element.src=current.streamUrl;
    })().catch(failure);
    return()=>{stopped=true;clearTimeout(timer);element.removeEventListener('loadedmetadata',seek);element.removeEventListener('error',failure);element.removeEventListener('playing',playing);hls?.destroy();element.pause();element.removeAttribute('src');element.load();};
  },[current?.streamUrl,current?.type,nativeExpected,error,closed,retry,autoplay]);

  useEffect(()=>{
    if(current?.type!=='youtube'||error||closed)return;
    let cancelled=false,player,timer;const mount=document.createElement('div');youtubeHost.current?.replaceChildren(mount);
    const progress=()=>{if(!cancelled&&callbacks.current.videoId===videoId&&player?.getCurrentTime)handlers.current.report(player.getCurrentTime(),player.getDuration(),{playing:player.getPlayerState?.()===1});};
    loadYoutube().then(YT=>{if(cancelled)return;player=new YT.Player(mount,{videoId:current.videoId,host:'https://www.youtube-nocookie.com',playerVars:{autoplay:autoplay?1:0,rel:0,playsinline:1,hl:lang,cc_lang_pref:lang,start:Math.floor(position.current)||0,origin:window.location.origin},events:{onStateChange:event=>{clearInterval(timer);if(event.data===YT.PlayerState.PLAYING)timer=setInterval(progress,5000);else if(event.data===YT.PlayerState.PAUSED)progress();else if(event.data===YT.PlayerState.ENDED){progress();handlers.current.ended();}},onError:()=>{if(!cancelled){if(provider)handlers.current.fail();else setError(lang==='ar'?'الفيديو غير متاح من يوتيوب الآن.':'This YouTube video is currently unavailable.');}}}});}).catch(()=>{if(!cancelled)setError(lang==='ar'?'تعذر تحميل مشغل يوتيوب. أعد المحاولة.':'YouTube player could not load. Please retry.');});
    return()=>{progress();cancelled=true;clearInterval(timer);try{player?.destroy();}catch{}};
  },[current?.videoId,current?.type,error,closed,retry,autoplay]);

  const reset=()=>{if(!servers.length&&provider){setLoading(true);setError('');api.stream(videoId,{showId:episode?.showId,source,sources}).then(data=>{if(callbacks.current.videoId!==videoId)return;const choices=playbackServers(data,API_BASE||window.location.origin);setServers(choices);setResolvedKey(resolutionKey);setActive(preferredServer(choices,videoId,history.current));if(!choices.length)setError(lang==='ar'?'لا توجد روابط متاحة حالياً.':'No playable links are available.');}).catch(()=>{if(callbacks.current.videoId===videoId)setError(lang==='ar'?'تعذر تحميل الخوادم.':'Could not load servers.');}).finally(()=>{if(callbacks.current.videoId===videoId)setLoading(false);});}else choose(active);};
  const label=lang==='ar';
  return <div ref={container} className="player player--wrap" style={{background:'#000'}}>
    <div className="player__overlay-bar" style={{position:'absolute',inset:'0 0 auto',height:46,padding:'5px 7px',background:provider&&!fullscreen?'#07130f':'transparent',zIndex:30}}>
      {provider&&!fullscreen&&servers.length>0&&<div className="player__servers" style={{minWidth:0,flex:1}}><div className="player__servers-list">{servers.map((server,index)=><button key={server.id} type="button" className={`player__server-btn ${index===active?'is-active':''}`} aria-pressed={index===active} onClick={()=>choose(index)}>{server.name}</button>)}</div></div>}
      {provider&&!fullscreen&&servers.length>1&&<button type="button" className="player__fs-btn" aria-label={label?'المصدر التالي':'Next source'} title={label?'المصدر التالي':'Next source'} onClick={advance}>›</button>}
      {provider&&useNative&&!closed&&<button type="button" className="player__fs-btn" aria-label={label?'إغلاق المشغل':'Close player'} onClick={()=>{native.current?.plugin.close().catch(()=>{});setClosed(true);}}>×</button>}
      <button type="button" className="player__fs-btn" onClick={toggleFullscreen} aria-label={fullscreen?(label?'إنهاء ملء الشاشة':'Exit fullscreen'):(label?'ملء الشاشة':'Fullscreen')}>{fullscreenIcon}</button>
    </div>
    <div ref={stage} style={{position:'absolute',inset:provider&&!fullscreen?'46px 0 0':'0',overflow:'hidden'}}>
      {!loading&&!error&&!closed&&current?.type==='youtube'&&<div ref={youtubeHost} style={{width:'100%',height:'100%'}}/>}
      {!loading&&!error&&!closed&&!nativeExpected&&current?.streamUrl&&<video ref={video} controls playsInline poster={episode?.thumbs?.custom} onTimeUpdate={event=>report(event.currentTarget.currentTime,event.currentTarget.duration,{playing:!event.currentTarget.paused})} onEnded={()=>callbacks.current.onEnded?.()} style={{objectFit:'contain',background:'#000'}}/>}
      {!loading&&!error&&!closed&&!nativeExpected&&current?.type==='embed'&&<iframe key={`${current.id}:${retry}`} src={current.embedUrl} title={episode?.title||current.name} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen sandbox={current.sandbox===null?undefined:'allow-scripts allow-same-origin allow-forms allow-presentation'} referrerPolicy="strict-origin-when-cross-origin" style={{border:0}}/>}
      {(loading||nativeExpected&&!closed&&!error)&&<div className="player__error" style={{pointerEvents:'none'}}><span className="spinner"/><p>{t('loading')}</p></div>}
      {(error||closed)&&<div className="player__error"><p role="status">{closed?(label?'تم إيقاف التشغيل':'Playback paused'):error}</p><div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center'}}><button type="button" className="btn btn--ghost" onClick={reset}>{closed?(label?'متابعة':'Resume'):(label?'إعادة المحاولة':'Retry')}</button>{provider&&servers.length>1&&<button type="button" className="btn btn--ghost" onClick={advance}>{label?'المصدر التالي':'Next source'}</button>}</div></div>}
    </div>
  </div>;
}
