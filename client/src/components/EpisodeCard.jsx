import { Link } from 'react-router-dom';
import Thumb from './Thumb.jsx';
import { Badge, PlayIcon, ProgressBar } from './Bits.jsx';
import { useProgress } from '../hooks/useProgress.js';
import { useLang } from '../lib/i18n.jsx';
import { fmtClock, fmtDate, fmtCompact, isNew } from '../lib/format.js';
import { decodeEntities, episodeHeadline, isNumberedEpisodeTitle } from '../lib/text.js';

/**
 * layout: "list" (show page, watch sidebar) | "grid" (rows, search)
 * showShowTitle: the card stands alone (rows, search, My List). A generic episode title
 * ('الحلقة الكاملة', 'Episode 3') never headlines it: the show title does, the label goes below.
 */
export default function EpisodeCard({ show, episode, layout = 'grid', index, active = false, showShowTitle = false }) {
  const progress = useProgress()[episode.id];
  const { t, lang } = useLang();
  const ratio = progress && progress.duration ? progress.position / progress.duration : 0;
  const fresh = isNew(episode.publishedAt);
  const film = show.kind === 'film';
  const head = episodeHeadline(show, episode, { lang, withShow: showShowTitle });
  const num = film || (layout === 'list' && isNumberedEpisodeTitle(head.title)) ? null : (episode.number ?? (index != null ? index + 1 : null));
  const sub = (episode.classification || show.classification)?.status === 'uncertain' ? (lang === 'en' ? 'Not yet classified' : 'لم يُصنّف بعد') : showShowTitle ? (film ? t('kind_film_label') : head.sub) : null;
  return (
    <Link to={`/watch/${show.id}/${episode.id}`} className={`ep ep--${layout} ${active ? 'ep--active' : ''} ${head.generic && showShowTitle ? 'ep--generic' : ''}`}>
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
          {num != null && !(showShowTitle && head.generic) && <span className="ep__num">{num}</span>}
          <h4 className="ep__title" dir="auto">{head.title}</h4>
        </div>
        {sub && <p className={`ep__show ${head.generic ? 'ep__show--label' : ''}`} dir="auto">{sub}</p>}
        <p className="ep__meta">
          {fresh && <Badge tone="new">{t('badge_new')}</Badge>}
          {episode.publishedAt && <span>{fmtDate(episode.publishedAt, lang)}</span>}
          {episode.views > 0 ? <span>{fmtCompact(episode.views, lang)} {t('views')}</span> : null}
        </p>
        {layout === 'list' && episode.synopsis && <p className="ep__synopsis" dir="auto">{decodeEntities(episode.synopsis)}</p>}
      </div>
    </Link>
  );
}
