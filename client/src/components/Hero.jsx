import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Thumb from './Thumb.jsx';
import { ChannelPill, PlayIcon, TagPill } from './Bits.jsx';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useLang } from '../lib/i18n.jsx';
import { episodesLabel, fmtDuration, fmtRelative } from '../lib/format.js';

export default function Hero({ shows }) {
  const { tagMap } = useCatalog();
  const { t, lang } = useLang();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || shows.length < 2) return;
    const id = setInterval(() => setI((x) => (x + 1) % shows.length), 8000);
    return () => clearInterval(id);
  }, [paused, shows.length]);
  if (!shows.length) return null;
  const show = shows[i % shows.length];
  const first = show.episodes[0];
  const tag = tagMap.get(show.primaryTag);
  return (
    <section className="hero" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {shows.map((s, k) => (
        <div key={s.id} className={`hero__bg ${k === i % shows.length ? 'is-active' : ''}`}>
          <Thumb thumbs={s.poster} alt="" eager={k === 0} />
        </div>
      ))}
      <div className="hero__shade" />
      <div className="container hero__body" key={show.id}>
        <p className="hero__kicker">
          <ChannelPill channel={show.channel} small />
          {tag && <TagPill tag={tag} small />}
        </p>
        <h1 className="hero__title">{show.title}</h1>
        <p className="hero__meta">
          <span>{episodesLabel(show.episodeCount, lang)}</span>
          <span>{fmtDuration(show.totalDurationSec, lang)}</span>
          {show.latestAt && <span>{t('hero_last_episode')} {fmtRelative(show.latestAt, lang)}</span>}
        </p>
        <p className="hero__synopsis">{show.synopsis}</p>
        <div className="hero__actions">
          <Link to={`/watch/${show.id}/${first.id}`} className="btn btn--primary"><PlayIcon /> {t('hero_watch')}</Link>
          <Link to={`/show/${show.id}`} className="btn btn--ghost">{t('hero_details')}</Link>
        </div>
      </div>
      {shows.length > 1 && (
        <div className="hero__dots container">
          {shows.map((s, k) => (
            <button key={s.id} className={`hero__dot ${k === i % shows.length ? 'is-active' : ''}`} onClick={() => setI(k)} aria-label={s.title} />
          ))}
        </div>
      )}
    </section>
  );
}
