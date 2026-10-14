// Hybrid Player: YouTube IFrame Player for YouTube videos, and native HTML5/Hls.js Video Player
// for direct documentary streams (e.g. Myflixer HLS .m3u8), with fallback to clean player embed.
import { useEffect, useRef, useState } from 'react';
import { useLang } from '../lib/i18n.jsx';
import { api, API_BASE } from '../lib/api.js';

let apiPromise = null;
function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

export default function Player({ videoId, episode, startAt = 0, onProgress, onEnded, autoplay = true }) {
  const host = useRef(null);
  const player = useRef(null);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const timer = useRef(null);
  const cbs = useRef({ onProgress, onEnded });
  cbs.current = { onProgress, onEnded };

  const [errorCode, setErrorCode] = useState(null);
  const [streamUrl, setStreamUrl] = useState(null);
  const [embedSrc, setEmbedSrc] = useState(null);
  const [servers, setServers] = useState([]);
  const [activeServerIdx, setActiveServerIdx] = useState(0);
  const [serverNotice, setServerNotice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [streamFailed, setStreamFailed] = useState(false);
  const { t, lang } = useLang();

  const isMyflixer = /^(mf|fm|hd):/.test(videoId || '') || episode?.offerings?.some(o => o.provider !== 'youtube');
  const youtubeServer = servers[activeServerIdx]?.type === 'youtube' ? servers[activeServerIdx] : null;
  const youtubeId = youtubeServer?.videoId || videoId;
  const playYoutube = !isMyflixer || !!youtubeServer;
  const mfSlug = isMyflixer ? videoId.replace(/^mf:[me]:/, '') : '';

  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  const toggleFullscreen = () => {
    const el = containerRef.current || document.querySelector('.watch__player') || document.querySelector('.player');
    if (!el) return;
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!isFs) {
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  };

  // 1. Fetch resolved video streams for Myflixer
  useEffect(() => {
    if (!isMyflixer) {
      setStreamUrl(null);
      setEmbedSrc(null);
      setServers([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setStreamFailed(false);
    setServerNotice(null);

    api.stream(videoId, { sources: episode?.offerings?.map(o=>o.sourceUrl).filter(Boolean) || [], showId: episode?.showId, source: episode?.offerings?.find(o => ['fmovies', 'hdtoday'].includes(o.provider))?.sourceUrl || episode?.sourceUrl })
      .then((data) => {
        if (cancelled) return;
        setLoading(false);
        const toAbsolute = (url) => {
          if (!url) return null;
          if (url.startsWith('http://') || url.startsWith('https://')) return url;
          return `${API_BASE}${url}`;
        };

        const resolvedServers = [];
        if (Array.isArray(data?.servers) && data.servers.length) {
          data.servers.forEach((s, idx) => {
            const streamUrl = s.streamUrl ? toAbsolute(s.streamUrl) : (s.rawStreamUrl ? toAbsolute(s.rawStreamUrl) : null);
            const embedUrl = s.embedUrl ? toAbsolute(s.embedUrl) : (s.rawEmbedUrl ? toAbsolute(s.rawEmbedUrl) : null);
            if (streamUrl || embedUrl || s.type === 'youtube') {
              resolvedServers.push({
                id: s.id ?? idx,
                name: s.name || `Player ${idx + 1}`,
                type: s.type || (streamUrl ? 'hls' : 'embed'),
                streamUrl,
                embedUrl,
                videoId: s.videoId, sandbox: s.sandbox, provider: s.provider,
              });
            }
          });
        }

        if (!resolvedServers.length && Array.isArray(data?.streams) && data.streams.length) {
          data.streams.forEach((s, idx) => {
            const url = toAbsolute(s.proxyUri || s.uri);
            if (url) {
              resolvedServers.push({
                id: idx,
                name: s.quality || s.name || `Server ${idx + 1}`,
                type: 'hls',
                streamUrl: url,
              });
            }
          });
        }

        if (!resolvedServers.length && data?.streamUrl) {
          resolvedServers.push({
            id: 0,
            name: 'Player 1 (HLS)',
            type: 'hls',
            streamUrl: toAbsolute(data.streamUrl),
          });
        }

        if (!resolvedServers.length && data?.embedUrl) {
          resolvedServers.push({
            id: 0,
            name: 'Player 1',
            type: 'embed',
            embedUrl: toAbsolute(data.embedUrl),
          });
        }

        setServers(resolvedServers);

        // Prioritize Player 2 (Medmedia) as initial active server: it provides multi-CDN sources,
        // full video controls, subtitles, and is completely free of Soap2Day token/CSP blocks.
        const p2Idx = resolvedServers.findIndex((s) => s.name?.toLowerCase().includes('player 2'));
        const ytIdx = resolvedServers.findIndex(s => s.type === 'youtube');
        const initialIdx = /^[\w-]{11}$/.test(videoId) && ytIdx !== -1 ? ytIdx : p2Idx !== -1 ? p2Idx : 0;
        setActiveServerIdx(initialIdx);

        const initialSrv = resolvedServers[initialIdx];
        if (initialSrv?.type === 'hls' && initialSrv?.streamUrl) {
          setStreamUrl(initialSrv.streamUrl);
        } else {
          setStreamUrl(null);
        }
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('[player] provider resolution failed:', err.message);
        setLoading(false); setStreamFailed(true);
      });

    return () => { cancelled = true; };
  }, [videoId, isMyflixer, mfSlug, episode]);

  // Switch to specific server
  const switchServer = (idx) => {
    if (!servers[idx]) return;
    setActiveServerIdx(idx);
    const target = servers[idx];
    setStreamFailed(false);
    if (target.type === 'hls' && target.streamUrl) {
      setStreamUrl(target.streamUrl);
    } else {
      setStreamUrl(null);
    }
  };

  // Automatic failover to next server when a stream fails
  const failoverToNext = () => {
    // If an HLS stream fails, jump directly to the next embed server (e.g. Player 2)
    let nextIdx = activeServerIdx + 1;
    if (servers[activeServerIdx]?.type === 'hls') {
      const nextEmbedIdx = servers.findIndex((s, i) => i > activeServerIdx && s.type === 'embed');
      if (nextEmbedIdx !== -1) {
        nextIdx = nextEmbedIdx;
      }
    }

    if (nextIdx < servers.length) {
      const nextSrv = servers[nextIdx];
      const curName = servers[activeServerIdx]?.name || `Server ${activeServerIdx + 1}`;
      const nextName = nextSrv?.name || `Server ${nextIdx + 1}`;
      console.warn(`[player] server ${curName} unavailable, failing over to ${nextName}`);
      setServerNotice(
        lang === 'ar'
          ? `السيرفر ${curName} غير متاح. جاري التبديل إلى ${nextName}...`
          : `Server ${curName} unavailable. Switching to ${nextName}...`
      );
      setTimeout(() => {
        switchServer(nextIdx);
        setServerNotice(null);
      }, 600);
    } else {
      console.warn('[player] all servers exhausted');
      setStreamFailed(true);
    }
  };

  const retryPlayback = () => {
    setStreamFailed(false);
    const p2Idx = servers.findIndex((s) => s.name?.toLowerCase().includes('player 2'));
    const targetIdx = p2Idx !== -1 ? p2Idx : 0;
    switchServer(targetIdx);
  };

  // 2. Attach Hls.js or native HLS to HTML5 <video>
  useEffect(() => {
    if (!isMyflixer || !streamUrl || streamFailed) return;
    const video = videoRef.current;
    if (!video) return;

    if (startAt > 0) {
      video.currentTime = startAt;
    }

    const onNativeError = () => {
      console.warn('[player] native video tag error, attempting failover');
      failoverToNext();
    };
    video.addEventListener('error', onNativeError);
    let cancelled = false;
    const attach = async () => {
    const Hls = video.canPlayType('application/vnd.apple.mpegurl') ? null : (await import('hls.js')).default;
    if (cancelled) return;

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari / iOS)
      video.src = streamUrl;
      if (autoplay) video.play().catch(() => {});
    } else if (Hls?.isSupported()) {
      // Hls.js (Chrome, Firefox, Edge, Android)
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoplay) video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.warn('[player] HLS fatal error:', data.type, data.details);
          failoverToNext();
        }
      });
    } else {
      video.src = streamUrl;
      if (autoplay) video.play().catch(() => {});
    }

    };
    attach().catch(() => { if (!cancelled) failoverToNext(); });
    return () => {
      cancelled = true;
      video.removeEventListener('error', onNativeError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [isMyflixer, streamUrl, autoplay, startAt, streamFailed, activeServerIdx, servers]);

  // 3. YouTube player initialization
  useEffect(() => {
    if (!playYoutube) return;
    let cancelled = false;
    setErrorCode(null);
    const mount = document.createElement('div');
    host.current?.replaceChildren(mount);

    const report = () => {
      const p = player.current;
      if (!p?.getCurrentTime) return;
      const pos = p.getCurrentTime(), dur = p.getDuration();
      if (dur > 0) cbs.current.onProgress?.(pos, dur);
    };
    const stopTimer = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };

    loadApi().then((YT) => {
      if (cancelled) return;
      player.current = new YT.Player(mount, {
        videoId: youtubeId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: autoplay ? 1 : 0, rel: 0, modestbranding: 1, playsinline: 1, hl: lang, cc_lang_pref: lang, start: Math.floor(startAt) || 0, origin: window.location.origin },
        events: {
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) { stopTimer(); timer.current = setInterval(report, 5000); }
            else if (e.data === YT.PlayerState.PAUSED) { stopTimer(); report(); }
            else if (e.data === YT.PlayerState.ENDED) { stopTimer(); report(); cbs.current.onEnded?.(); }
          },
          onError: (e) => setErrorCode(e.data),
        },
      });
    });

    return () => {
      cancelled = true;
      stopTimer();
      try { report(); } catch { /* player gone */ }
      try { player.current?.destroy(); } catch { /* ignore */ }
      player.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeId, playYoutube]);

  // Handle native <video> timeupdate & ended
  const handleTimeUpdate = (e) => {
    const v = e.currentTarget;
    if (v && v.duration > 0) {
      cbs.current.onProgress?.(v.currentTime, v.duration);
    }
  };

  const handleEnded = () => {
    cbs.current.onEnded?.();
  };

    const renderServerBar = () => (
      <div className="player__overlay-bar">
        {servers.length > 1 && (
          <div className="player__servers">
            <span className="player__servers-title">
              <i className="dot" />
              {lang === 'ar' ? 'السيرفر' : 'Server'}:
            </span>
            <div className="player__servers-list">
              {servers.map((s, idx) => (
                <button
                  key={s.id ?? idx}
                  type="button"
                  className={`player__server-btn ${idx === activeServerIdx ? 'is-active' : ''}`}
                  onClick={() => switchServer(idx)}
                  title={`Switch to ${s.name}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <button
          type="button"
          className={`player__fs-btn ${isFullscreen ? 'is-active' : ''}`}
          onClick={toggleFullscreen}
          title={isFullscreen ? (lang === 'ar' ? 'خروج من وضع ملء الشاشة' : 'Exit Fullscreen') : (lang === 'ar' ? 'ملء الشاشة' : 'Fullscreen')}
        >
          {isFullscreen ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-14v3h3v2h-5V5h2z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            </svg>
          )}
        </button>
      </div>
    );

  if (isMyflixer && !playYoutube) {
    const poster = episode?.thumbs?.custom || (episode?.thumbs?.default?.startsWith('http') ? episode.thumbs.default : null);
    const curServer = servers[activeServerIdx] || null;
    const isHls = curServer?.type === 'hls' && streamUrl && !streamFailed;
    const currentEmbed = curServer?.embedUrl || (!isHls && curServer?.rawEmbedUrl ? curServer.rawEmbedUrl : embedSrc);

    // Shared server switcher button bar


    // 1. Primary: Native HTML5 video with Hls.js stream
    if (isHls) {
      return (
        <div ref={containerRef} className="player player--video">
          {renderServerBar()}
          {serverNotice && (
            <div className="player__notice">
              <span className="spinner" style={{ width: 14, height: 14 }} />
              <span>{serverNotice}</span>
            </div>
          )}
          <video
            ref={videoRef}
            controls
            playsInline
            crossOrigin="anonymous"
            poster={poster}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
            style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }}
          />
        </div>
      );
    }

    // 2. Embed Player iframe (Player 2, Player 3, Player 4, Player 5, Player 6, Player 7)
    if (currentEmbed && !streamFailed) {
      return (
        <div ref={containerRef} className="player player--myflixer" style={{ position: 'relative', width: '100%', height: '100%' }}>
          {renderServerBar()}
          {serverNotice && (
            <div className="player__notice">
              <span className="spinner" style={{ width: 14, height: 14 }} />
              <span>{serverNotice}</span>
            </div>
          )}
          <iframe
            key={currentEmbed}
            src={currentEmbed}
            title={episode?.title || 'Player'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
            allowFullScreen
            sandbox={curServer?.sandbox === null ? undefined : "allow-scripts allow-same-origin allow-forms allow-presentation"}
            frameBorder="0"
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          />
        </div>
      );
    }

    // 3. While loading stream files
    if (loading) {
      return (
        <div className="player player--loading" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#0a0b0d', color: '#fff', gap: 14 }}>
          <span className="spinner" style={{ width: 36, height: 36 }} />
          <p style={{ opacity: 0.8, fontSize: 14 }}>{t('loading') || 'Loading stream...'}</p>
        </div>
      );
    }

    // 4. Final fallback if all servers fail
    return (
      <div className="player player--error" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#0a0b0d', color: '#fff', gap: 14, padding: 20, textAlign: 'center' }}>
        <p>{lang === 'ar' ? 'تعذر تشغيل البث المباشر لجميع السيرفرات حالياً.' : (t('stream_error') || 'Unable to play this stream directly across all servers.')}</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          {servers.length > 0 && (
            <button type="button" className="btn btn--ghost" onClick={retryPlayback}>
              {lang === 'ar' ? 'إعادة المحاولة' : 'Retry Servers'}
            </button>
          )}
          <a className="btn btn--primary" href={episode?.sourceUrl || `https://myflixerz.day/${mfSlug}/`} target="_blank" rel="noreferrer">
            {t('open_myflixer')} ↗
          </a>
        </div>
      </div>
    );
  }

  const message = errorCode == null ? null : ({ 2: 'player_err_2', 5: 'player_err_5', 100: 'player_err_100', 101: 'player_err_101', 150: 'player_err_101', 153: 'player_err_153' }[errorCode] ? t({ 2: 'player_err_2', 5: 'player_err_5', 100: 'player_err_100', 101: 'player_err_101', 150: 'player_err_101', 153: 'player_err_153' }[errorCode]) : t('player_err_other', { code: errorCode }));

  return (
    <div ref={containerRef} className="player player--wrap" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <button
        type="button"
        className={`player__fs-btn ${isFullscreen ? 'is-active' : ''}`}
        onClick={toggleFullscreen}
        title={isFullscreen ? (lang === 'ar' ? 'خروج من وضع ملء الشاشة' : 'Exit Fullscreen') : (lang === 'ar' ? 'ملء الشاشة' : 'Fullscreen')}
        style={{ position: 'absolute', top: 12, right: 12, zIndex: 30 }}
      >
        {isFullscreen ? (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-14v3h3v2h-5V5h2z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
          </svg>
        )}
      </button>
      <div className="player__mount" ref={host} style={{ width: '100%', height: '100%' }} />
      {isMyflixer && renderServerBar()}
      {message && (
        <div className="player__error">
          <p>{message}</p>
          <a className="btn btn--primary" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer">{t('watch_on_youtube')} ↗</a>
        </div>
      )}
    </div>
  );
}
