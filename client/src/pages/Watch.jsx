import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Player from '../components/Player.jsx';
import EpisodeCard from '../components/EpisodeCard.jsx';
import { Badge, ChannelPill, EmptyState, TagPill } from '../components/Bits.jsx';
import { useCatalog, useFullShow } from '../hooks/useCatalog.jsx';
import { progressStore, useProgress } from '../hooks/useProgress.js';
import { useLang } from '../lib/i18n.jsx';
import { fmtClock, fmtDate, fmtCompact, isNew } from '../lib/format.js';

export default function Watch() {
  const { showId, epId } = useParams();
  const nav = useNavigate();
  const { catalog, all } = useCatalog();
  const { t, lang, appName } = useLang();
  const progress = useProgress();
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem('dh.autonext') !== '0');
  const [countdown, setCountdown] = useState(null);

  const show = useFullShow(showId);
  const idx = show ? show.episodes.findIndex((e) => e.id === epId) : -1;
  const episode = idx >= 0 ? show.episodes[idx] : null;
  const next = idx >= 0 ? show.episodes[idx + 1] : null;
  const prev = idx > 0 ? show.episodes[idx - 1] : null;
  const film = show?.kind === 'film';
  const sl = show?.lang || lang;
  const tagMap = useMemo(() => new Map((all?.tags || []).map((x) => [x.id, { ...x, label: sl === 'en' ? (x.labelEn || x.label) : x.label }])), [all, sl]);

  const saved = progress[epId];
  const startAt = useMemo(() => (saved && !saved.finished && saved.position > 15 && saved.duration - saved.position > 30 ? saved.position : 0), [epId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { document.title = episode ? `${film ? show.title : `${episode.title} — ${show.title}`} — ${appName}` : appName; return () => { document.title = appName; }; }, [episode, show, film, appName]);
  useEffect(() => { window.scrollTo({ top: 0 }); setCountdown(null); }, [epId]);

  const onProgress = useCallback((position, duration) => {
    progressStore.set(epId, { showId, position, duration });
  }, [epId, showId]);

  const onEnded = useCallback(() => {
    if (!next || !autoNext) return;
    setCountdown(6);
  }, [next, autoNext]);

  useEffect(() => {
    if (countdown == null) return;
    if (countdown === 0) { nav(`/watch/${showId}/${next.id}`); return; }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown, nav, showId, next]);

  if (!catalog) return null;
  if (!show || !episode) return <div className="page container"><EmptyState title={t('episode_missing')} action={<Link className="btn btn--ghost" to="/browse">{t('back_to_browse')}</Link>} /></div>;

  return (
    <div className="page page--watch container" dir={sl === 'en' ? 'ltr' : 'rtl'}>
      <div className="watch">
        <div className="watch__main">
          <div className="watch__player">
            <Player key={episode.id} videoId={episode.id} episode={episode} startAt={startAt} onProgress={onProgress} onEnded={onEnded} />
            {countdown != null && next && (
              <div className="watch__next">
                <p>{t('next_in')} <b>{countdown}</b> {t('seconds')}</p>
                <strong>{next.title}</strong>
                <div className="watch__next-actions">
                  <Link className="btn btn--primary" to={`/watch/${showId}/${next.id}`}>{t('play_now')}</Link>
                  <button className="btn btn--ghost" onClick={() => setCountdown(null)}>{t('cancel')}</button>
                </div>
              </div>
            )}
          </div>

          <div className="watch__info">
            <p className="watch__crumbs">
              <ChannelPill channel={show.channel} small />
              <Link to={`/show/${show.id}`}>{show.title}</Link>
              {!film && <><span className="chev" aria-hidden /><span>{episode.season != null ? `${t('season')} ${episode.season} • ` : ''}{t('episode')} {episode.number ?? idx + 1} {t('of')} {show.episodeCount}</span></>}
            </p>
            <h1 className="watch__title">{film ? show.title : episode.title} {isNew(episode.publishedAt) && <Badge tone="new">{t('badge_new')}</Badge>}</h1>
            <p className="watch__meta">
              <span>{fmtClock(episode.durationSec)}</span>
              {episode.publishedAt && <span>{fmtDate(episode.publishedAt, sl)}</span>}
              {episode.views ? <span>{fmtCompact(episode.views, sl)} {t('views')}</span> : null}
              {show.tags.map((x) => <TagPill key={x} tag={tagMap.get(x)} small />)}
            </p>
            {episode.synopsis && <p className="watch__synopsis">{episode.synopsis}</p>}
            {!episode.synopsis && <p className="watch__synopsis is-muted">{show.synopsis}</p>}
            <div className="watch__controls">
              {prev && <Link className="btn btn--ghost" to={`/watch/${showId}/${prev.id}`}><span className="chev chev--back" aria-hidden /> {t('prev_episode')}</Link>}
              {next && <Link className="btn btn--ghost" to={`/watch/${showId}/${next.id}`}>{t('next_episode')} <span className="chev" aria-hidden /></Link>}
              {!film && (
                <label className="switch">
                  <input type="checkbox" checked={autoNext} onChange={(e) => { setAutoNext(e.target.checked); localStorage.setItem('dh.autonext', e.target.checked ? '1' : '0'); }} />
                  <span>{t('autoplay_next')}</span>
                </label>
              )}
              {episode.id?.startsWith('mf:') ? (
                <a className="btn btn--text" href={episode.sourceUrl || `https://myflixerz.day/${episode.id.replace(/^mf:[me]:/, '')}/`} target="_blank" rel="noreferrer">{t('open_myflixer')} ↗</a>
              ) : (
                <a className="btn btn--text" href={`https://www.youtube.com/watch?v=${episode.id}`} target="_blank" rel="noreferrer">{t('open_youtube')} ↗</a>
              )}
            </div>
          </div>
        </div>

        <aside className="watch__side">
          <div className="row__head">
            <div><h2 className="row__title">{film ? t('the_film') : `${t('episodes_of')} ${show.title}`}</h2><p className="row__sub">{film ? (show.channel?.name || show.channel?.short) : `${show.episodeCount}`}</p></div>
            <Link className="row__link" to={`/show/${show.id}`}>{t('show_page')} <span className="chev" aria-hidden /></Link>
          </div>
          <div className="watch__list">
            {show.episodes.map((e, i) => <EpisodeCard key={e.id} show={show} episode={e} index={i} layout="list" active={e.id === episode.id} />)}
          </div>
        </aside>
      </div>
    </div>
  );
}
