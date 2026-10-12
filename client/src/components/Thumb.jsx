// YouTube thumbnail with a graceful fallback chain (maxres → sd → hq → mq).
import { useEffect, useState } from 'react';

const CHAIN = ['max', 'sd', 'hq', 'mq'];

export default function Thumb({ thumbs, videoId, alt = '', className = '', start = 'max', eager = false }) {
  const urls = thumbs || (videoId ? {
    max: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    sd: `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    hq: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    mq: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
  } : null);
  const [idx, setIdx] = useState(Math.max(0, CHAIN.indexOf(start)));
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setIdx(Math.max(0, CHAIN.indexOf(start))); setLoaded(false); }, [urls?.hq, start]);
  if (!urls) return <div className={`thumb thumb--empty ${className}`} />;
  const src = urls.custom || urls[CHAIN[idx]] || urls.hq;
  return (
    <img
      className={`thumb ${loaded ? 'is-loaded' : ''} ${className}`}
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onLoad={(e) => {
        // YouTube serves a 120x90 placeholder (with 404) when maxres is missing; some CDNs return it with 200.
        if (e.currentTarget.naturalWidth <= 120 && idx < CHAIN.length - 1) setIdx(idx + 1);
        else setLoaded(true);
      }}
      onError={() => { if (idx < CHAIN.length - 1) setIdx(idx + 1); }}
    />
  );
}
