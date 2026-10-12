// Image with a graceful fallback chain: custom artwork → maxres → sd → hq → mq YouTube thumbnails.
import { useEffect, useState } from 'react';

const CHAIN = ['custom', 'max', 'sd', 'hq', 'mq'];

export default function Thumb({ thumbs, videoId, alt = '', className = '', start = 'max', eager = false }) {
  const urls = thumbs || (videoId && !videoId.startsWith('mf:') ? {
    max: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    sd: `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    hq: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    mq: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
  } : null);
  const firstIdx = (u, s) => {
    if (!u) return 0;
    if (u.custom) return 0;
    const i = CHAIN.indexOf(s);
    return Math.max(1, i);
  };
  const [idx, setIdx] = useState(() => firstIdx(urls, start));
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setIdx(firstIdx(urls, start)); setLoaded(false); }, [urls?.hq, urls?.custom, start]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!urls) return <div className={`thumb thumb--empty ${className}`} />;
  const next = () => { let i = idx + 1; while (i < CHAIN.length && !urls[CHAIN[i]]) i++; if (i < CHAIN.length) setIdx(i); };
  const src = urls[CHAIN[idx]] || urls.hq;
  return (
    <img
      className={`thumb ${loaded ? 'is-loaded' : ''} ${className}`}
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onLoad={(e) => {
        // YouTube serves a 120x90 placeholder (with 404) when maxres is missing; some CDNs return it with 200.
        if (e.currentTarget.naturalWidth <= 120 && idx < CHAIN.length - 1) next();
        else setLoaded(true);
      }}
      onError={next}
    />
  );
}
