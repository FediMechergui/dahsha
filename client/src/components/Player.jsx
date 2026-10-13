// Hybrid Player: YouTube IFrame Player for YouTube videos, and native HTML5/Hls.js Video Player
// for direct documentary streams (e.g. Myflixer HLS .m3u8), with fallback to clean player embed.
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
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

  const isMyflixer = videoId?.startsWith('mf:');
  const mfSlug = isMyflixer ? videoId.replace(/^mf:[me]:/, '') : '';

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

    api.stream(videoId)
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
            const url = toAbsolute(s.streamUrl || s.rawStreamUrl);
            if (url) {
              resolvedServers.push({
                id: s.id ?? idx,
                name: s.name || `Server ${idx + 1}`,
                streamUrl: url,
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
                streamUrl: url,
              });
            }
          });
        }

        if (!resolvedServers.length && data?.streamUrl) {
          resolvedServers.push({
            id: 0,
            name: 'Soap2Cloud',
            streamUrl: toAbsolute(data.streamUrl),
          });
        }

        setServers(resolvedServers);
        setActiveServerIdx(0);

        const primaryStream = resolvedServers[0]?.streamUrl || null;
        const embed = toAbsolute(data?.embedUrl);

        if (primaryStream) {
          setStreamUrl(primaryStream);
          if (embed) setEmbedSrc(embed);
        } else if (embed) {
          setEmbedSrc(embed);
        } else {
          setStreamFailed(true);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[player] stream resolution notice:', err.message);
        setLoading(false);
        setStreamFailed(true);
      });

    return () => { cancelled = true; };
  }, [videoId, isMyflixer]);

  // Switch to specific server
  const switchServer = (idx) => {
    if (!servers[idx]) return;
    setActiveServerIdx(idx);
    setStreamUrl(servers[idx].streamUrl);
    setStreamFailed(false);
  };

  // Automatic failover to next server when an HLS stream fails
  const failoverToNext = () => {
    if (activeServerIdx + 1 < servers.length) {
      const nextIdx = activeServerIdx + 1;
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
      }, 700);
    } else {
      console.warn('[player] all HLS servers exhausted');
      setStreamFailed(true);
    }
  };

  const retryPlayback = () => {
    setStreamFailed(false);
    setActiveServerIdx(0);
    if (servers[0]?.streamUrl) {
      setStreamUrl(servers[0].streamUrl);
    }
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

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari / iOS)
      video.src = streamUrl;
      if (autoplay) video.play().catch(() => {});
    } else if (Hls.isSupported()) {
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

    return () => {
      video.removeEventListener('error', onNativeError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [isMyflixer, streamUrl, autoplay, startAt, streamFailed, activeServerIdx, servers]);

  // 3. YouTube player initialization
  useEffect(() => {
    if (isMyflixer) return; // YouTube only
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
        videoId,
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
  }, [videoId, isMyflixer]);

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

  if (isMyflixer) {
    const poster = episode?.thumbs?.custom || (episode?.thumbs?.default?.startsWith('http') ? episode.thumbs.default : null);

    // Primary: Native HTML5 video with Hls.js stream
    if (streamUrl && !streamFailed) {
      return (
        <div className="player player--video">
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

    // While loading stream files
    if (loading) {
      return (
        <div className="player player--loading" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#0a0b0d', color: '#fff', gap: 14 }}>
          <span className="spinner" style={{ width: 36, height: 36 }} />
          <p style={{ opacity: 0.8, fontSize: 14 }}>{t('loading') || 'Loading stream...'}</p>
        </div>
      );
    }

    // Secondary fallback: Direct nontongo player iframe
    if (embedSrc) {
      return (
        <div className="player player--myflixer">
          <iframe
            src={embedSrc}
            title={episode?.title || 'Documentary Player'}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            frameBorder="0"
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        </div>
      );
    }

    // Final fallback if all servers fail
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
    <>
      <div className="player" ref={host} />
      {message && (
        <div className="player__error">
          <p>{message}</p>
          <a className="btn btn--primary" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer">{t('watch_on_youtube')} ↗</a>
        </div>
      )}
    </>
  );
}
