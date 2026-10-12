import { useRef } from 'react';
import { SectionTitle } from './Bits.jsx';
import { useLang } from '../lib/i18n.jsx';

/** Horizontal scroller with arrows. Children are the cards. Direction-aware (RTL / LTR). */
export default function Row({ title, sub, to, children, className = '' }) {
  const track = useRef(null);
  const { dir } = useLang();
  const scroll = (step) => {
    const el = track.current;
    if (!el) return;
    const amount = Math.max(240, el.clientWidth * 0.85);
    // "next" moves forward in reading direction: left in RTL, right in LTR.
    const sign = dir === 'rtl' ? -1 : 1;
    el.scrollBy({ left: sign * step * amount, behavior: 'smooth' });
  };
  return (
    <section className={`row ${className}`}>
      <SectionTitle sub={sub} to={to}>{title}</SectionTitle>
      <div className="row__scroller">
        <button className="row__arrow row__arrow--prev" onClick={() => scroll(-1)} aria-label="previous"><span className="chev chev--back" /></button>
        <div className="row__track" ref={track}>{children}</div>
        <button className="row__arrow row__arrow--next" onClick={() => scroll(1)} aria-label="next"><span className="chev" /></button>
      </div>
    </section>
  );
}
