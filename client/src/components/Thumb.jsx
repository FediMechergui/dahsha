import { useEffect, useState } from 'react';
import { thumbnailCandidates } from '../lib/thumbnails.js';

export default function Thumb({ thumbs, videoId, fallbackThumbs, alt='', className='', start='max', eager=false }) {
  const candidates=thumbnailCandidates(thumbs,videoId,start,fallbackThumbs);
  const key=candidates.join('|');
  const [failed,setFailed]=useState([]);
  const [loaded,setLoaded]=useState(null);
  useEffect(()=>{setFailed([]);setLoaded(null);},[key]);
  const src=candidates.find(url=>!failed.includes(url));
  if(!src)return <div className={`thumb thumb--empty ${className}`} role={alt?'img':undefined} aria-label={alt || undefined} />;
  const next=()=>setFailed(previous=>previous.includes(src)?previous:[...previous,src]);
  return <img className={`thumb ${loaded===src?'is-loaded':''} ${className}`} src={src} alt={alt}
    loading={eager?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer"
    onLoad={event=>{if(/i\.ytimg\.com/.test(src)&&event.currentTarget.naturalWidth<=120&&candidates.some(url=>url!==src&&!failed.includes(url)))next();else setLoaded(src);}}
    onError={next} />;
}
