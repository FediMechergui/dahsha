import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Thumb from './Thumb.jsx';
import { ChannelPill, PlayIcon, TagPill } from './Bits.jsx';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useLang } from '../lib/i18n.jsx';
import { episodesLabel, fmtDuration, fmtRelative } from '../lib/format.js';
import { cleanTitle, decodeEntities, isPortraitUrl } from '../lib/text.js';
import { landscapeArt, portraitArt } from '../lib/catalog-helpers.js';

// Slide art usually has a title printed on it, so the text never sits on the sharp image: the
// slide is shown framed beside the text block, over a blurred, darkened copy of itself.
function artOf(show) {
  const thumbs = landscapeArt(show.poster);
  const videoId = show.posterId || show.posterVideoId || show.episodes?.[0]?.id;
  const landscape = /^[\w-]{11}$/.test(videoId || '') || Object.values(thumbs || {}).some((v) => typeof v === 'string' && v && !isPortraitUrl(v));
  const portrait = landscape ? null : portraitArt(show);
  return { thumbs: portrait ? { custom: portrait } : thumbs, videoId, portrait: !!portrait };
}

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
  const art = artOf(show);
  const title = cleanTitle(show.title);
  const count = Number.isFinite(show.episodeCount) && show.episodeCount > 0 ? show.episodeCount : 0;
  return (
    <section className="hero" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {shows.map((s, k) => {
        const a = artOf(s);
        return (
          <div key={s.id} className={`hero__bg ${k === i % shows.length ? 'is-active' : ''}`}>
            <Thumb videoId={a.videoId} thumbs={a.thumbs} alt="" start="hq" eager={k === 0} fitPortrait={false} />
          </div>
        );
      })}
      <div className="hero__shade" />
      <div className="container hero__body" key={show.id}>
        <div className="hero__text">
          <p className="hero__kicker">
            <ChannelPill channel={show.channel} small />
            {tag && <TagPill tag={tag} small />}
          </p>
          <h1 className="hero__title" dir="auto">{title}</h1>
          <p className="hero__meta">
            {count > 0 && <span>{episodesLabel(count, lang)}</span>}
            {show.totalDurationSec > 0 && <span>{fmtDuration(show.totalDurationSec, lang)}</span>}
            {show.latestAt && <span>{t('hero_last_episode')} {fmtRelative(show.latestAt, lang)}</span>}
          </p>
          <p className="hero__synopsis" dir="auto">{decodeEntities(show.synopsis)}</p>
          <div className="hero__actions">
            <Link to={first ? `/watch/${show.id}/${first.id}` : `/show/${show.id}`} className="btn btn--primary"><PlayIcon /> {t('hero_watch')}</Link>
            <Link to={`/show/${show.id}`} className="btn btn--ghost">{t('hero_details')}</Link>
          </div>
        </div>
        <Link to={`/show/${show.id}`} className={`hero__frame ${art.portrait ? 'hero__frame--portrait' : ''}`} aria-label={title} tabIndex={-1}>
          <Thumb videoId={art.videoId} thumbs={art.thumbs} alt="" start="max" eager />
        </Link>
      </div>
      {shows.length > 1 && (
        <div className="hero__dots container">
          {shows.map((s, k) => (
            <button key={s.id} className={`hero__dot ${k === i % shows.length ? 'is-active' : ''}`} onClick={() => setI(k)} aria-label={cleanTitle(s.title)} />
          ))}
        </div>
      )}
    </section>
  );
}
