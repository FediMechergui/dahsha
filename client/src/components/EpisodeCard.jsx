import { Link } from 'react-router-dom';
import Thumb from './Thumb.jsx';
import { Badge, PlayIcon, ProgressBar } from './Bits.jsx';
import { useProgress } from '../hooks/useProgress.js';
import { useLang } from '../lib/i18n.jsx';
import { fmtClock, fmtDate, fmtCompact, isNew } from '../lib/format.js';

/**
 * layout: "list" (show page, watch sidebar) | "grid" (rows, search)
 */
export default function EpisodeCard({ show, episode, layout = 'grid', index, active = false, showShowTitle = false }) {
  const progress = useProgress()[episode.id];
  const { t, lang } = useLang();
  const ratio = progress && progress.duration ? progress.position / progress.duration : 0;
  const fresh = isNew(episode.publishedAt);
  const film = show.kind === 'film';
  const num = film ? null : (episode.number ?? (index != null ? index + 1 : null));
  return (
    <Link to={`/watch/${show.id}/${episode.id}`} className={`ep ep--${layout} ${active ? 'ep--active' : ''}`}>
      <div className="ep__media">
        <Thumb videoId={episode.id} fallbackThumbs={show.poster} thumbs={episode.thumbs} alt="" className="ep__img" start={layout === 'grid' ? 'sd' : 'hq'} />
        {episode.durationSec > 0 && <span className="ep__dur">{fmtClock(episode.durationSec)}</span>}
        {progress?.finished && <span className="ep__done" title={t('watched')}>✓</span>}
        {ratio > 0.01 && !progress?.finished && <div className="ep__progress"><ProgressBar value={ratio} /></div>}
        <span className="ep__play" aria-hidden><PlayIcon size={22} /></span>
        {active && <span className="ep__now">{t('now_playing')}</span>}
      </div>
      <div className="ep__body">
        <div className="ep__top">
          {num != null && <span className="ep__num">{num}</span>}
          <h4 className="ep__title">{film ? show.title : episode.title}</h4>
          {fresh && <Badge tone="new">{t('badge_new')}</Badge>}
        </div>
        {showShowTitle && !film && <p className="ep__show">{show.title}</p>}
        {showShowTitle && film && <p className="ep__show">{t('kind_film_label')}</p>}
        <p className="ep__meta">
          {episode.publishedAt && <span>{fmtDate(episode.publishedAt, lang)}</span>}
          {episode.views ? <span>{fmtCompact(episode.views, lang)} {t('views')}</span> : null}
        </p>
        {layout === 'list' && episode.synopsis && <p className="ep__synopsis">{episode.synopsis}</p>}
      </div>
    </Link>
  );
}
