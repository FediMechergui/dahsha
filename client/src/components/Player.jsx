// YouTube IFrame Player with progress reporting, auto-advance and an error fallback.
import { useEffect, useRef, useState } from 'react';
import { useLang } from '../lib/i18n.jsx';

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
  const timer = useRef(null);
  const cbs = useRef({ onProgress, onEnded });
  cbs.current = { onProgress, onEnded };
  const [errorCode, setErrorCode] = useState(null);
  const [embedSrc, setEmbedSrc] = useState(null);
  const { t, lang } = useLang();

  const isMyflixer = videoId?.startsWith('mf:');
  const mfSlug = isMyflixer ? videoId.replace(/^mf:[me]:/, '') : '';
  const fallbackUrl = episode?.sourceUrl || (isMyflixer ? `https://myflixerz.day/${mfSlug}/` : `https://www.youtube.com/watch?v=${videoId}`);

  // Fetch resolved Myflixer player embed if on server
  useEffect(() => {
    if (!isMyflixer) { setEmbedSrc(null); return; }
    let cancelled = false;
    const initialEmbed = episode?.embedUrl || `https://myflixerz.day/${mfSlug}/`;
    setEmbedSrc(initialEmbed);

    fetch(`/api/stream/${encodeURIComponent(videoId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.embedUrl) {
          setEmbedSrc(data.embedUrl);
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [videoId, isMyflixer, mfSlug, episode?.embedUrl]);

  useEffect(() => {
    if (isMyflixer) return; // YouTube only
    let cancelled = false;
    setErrorCode(null);
    const mount = document.createElement('div');
    host.current.replaceChildren(mount);

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

  if (isMyflixer) {
    return (
      <div className="player player--myflixer">
        <iframe
          src={embedSrc || fallbackUrl}
          title={episode?.title || 'Documentary Player'}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          frameBorder="0"
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
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
