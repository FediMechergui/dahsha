import { useEffect, useState } from 'react';
import { thumbnailCandidates } from '../lib/thumbnails.js';
import { isPortraitUrl } from '../lib/text.js';

/**
 * fitPortrait: a 2:3 provider poster in a landscape box is shown whole (contain) over a blurred,
 * darkened copy of itself instead of being centre-cropped. Detected from the URL up front and from
 * the decoded image size for posters the URL does not reveal.
 * label: text for the placeholder drawn when no image exists (a few provider titles have no art);
 * the placeholder takes the tag/channel colour of the card around it (--tag / --ch).
 */
export default function Thumb({ thumbs, videoId, fallbackThumbs, alt='', className='', start='max', eager=false, fitPortrait=true, label='' }) {
  const candidates=thumbnailCandidates(thumbs,videoId,start,fallbackThumbs);
  const key=candidates.join('|');
  const [failed,setFailed]=useState([]);
  const [loaded,setLoaded]=useState(null);
  const [tall,setTall]=useState(null);
  useEffect(()=>{setFailed([]);setLoaded(null);setTall(null);},[key]);
  const src=candidates.find(url=>!failed.includes(url));
  if(!src)return <div className={`thumb thumb--empty ${className}`} role={alt?'img':undefined} aria-label={alt || undefined}>
    <i className="thumb__mark" aria-hidden />
    {label && <span className="thumb__label" dir="auto" aria-hidden>{label}</span>}
  </div>;
  const next=()=>setFailed(previous=>previous.includes(src)?previous:[...previous,src]);
  const portrait=fitPortrait && (isPortraitUrl(src) || tall===src);
  return <>
    <img className={`thumb ${loaded===src?'is-loaded':''} ${portrait?'thumb--contain':''} ${className}`} src={src} alt={alt}
      loading={eager?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer"
      onLoad={event=>{
        const {naturalWidth:w,naturalHeight:h}=event.currentTarget;
        if(/i\.ytimg\.com/.test(src)&&w<=120&&candidates.some(url=>url!==src&&!failed.includes(url)))return next();
        if(fitPortrait&&h>w*1.15)setTall(src);
        setLoaded(src);
      }}
      onError={next} />
    {portrait && <img className="thumb__blur" src={src} alt="" aria-hidden loading={eager?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer" />}
  </>;
}
