import { Link } from 'react-router-dom';
import Thumb from './Thumb.jsx';
import { Badge, PlayIcon, ProgressBar } from './Bits.jsx';
import { useProgress } from '../hooks/useProgress.js';
import { useLang } from '../lib/i18n.jsx';
import { fmtClock, fmtDate, fmtCompact, isNew } from '../lib/format.js';
import { cleanTitle, decodeEntities, episodeHeadline, isNumberedEpisodeTitle } from '../lib/text.js';
import { thumbnailCandidates } from '../lib/thumbnails.js';
import { episodeRecency } from '../lib/catalog-helpers.js';

const int = (n) => (Number.isInteger(n) && n >= 0 ? n : null);

/**
 * layout: "list" (show page, watch sidebar) | "grid" (rows, search)
 * showShowTitle: the card stands alone (rows, search, My List). A generic episode title
 * ('الحلقة الكاملة', 'Episode 3') never headlines it: the show title does, the label goes below.
 * Empty and 'Episode #24.1' titles read 'Episode N' / 'الحلقة N' in the show's own language.
 * In lists, an episode whose only art is the show poster (most provider series) gets a numbered
 * tile over a blurred copy of that poster instead of the same poster on every row.
 */
export default function EpisodeCard({ show, episode, layout = 'grid', index, active = false, showShowTitle = false }) {
  const progress = useProgress()[episode.id];
  const { t, lang } = useLang();
  const cl = show.lang || lang;
  const ratio = progress && progress.duration ? progress.position / progress.duration : 0;
  // Myflixer episodes added to a listed series rank (and badge) by their discovery date (addedAt).
  const fresh = isNew(episodeRecency(episode));
  const film = show.kind === 'film';
  const position = index != null ? index + 1 : null;
  const head = episodeHeadline(show, episode, { lang: cl, withShow: showShowTitle, number: position });
  const tileNumber = int(episode.number) ?? position;
  const own = thumbnailCandidates(episode.thumbs, episode.id, 'hq');
  const tile = layout === 'list' && !film && tileNumber != null && (!own.length || own[0] === show.poster?.custom);
  const num = film || tile || (layout === 'list' && isNumberedEpisodeTitle(head.title)) ? null : (episode.number ?? position);
  const sub = (episode.classification || show.classification)?.status === 'uncertain' ? (lang === 'en' ? 'Not yet classified' : 'لم يُصنّف بعد') : showShowTitle ? (film ? t('kind_film_label') : head.sub) : null;
  const season = int(episode.season);
  return (
    <Link to={`/watch/${show.id}/${episode.id}`} className={`ep ep--${layout} ${active ? 'ep--active' : ''} ${head.generic && showShowTitle ? 'ep--generic' : ''} ${tile ? 'ep--tiled' : ''}`}>
      <div className={`ep__media ${tile ? 'ep__media--tile' : ''}`}>
        <Thumb videoId={episode.id} fallbackThumbs={show.poster} thumbs={episode.thumbs} alt="" className={`ep__img ${tile ? 'ep__img--ambient' : ''}`} start={layout === 'grid' ? 'sd' : 'hq'} fitPortrait={!tile} label={tile ? '' : cleanTitle(show.title)} />
        {tile && <span className="ep__tile" aria-hidden>
          <small>{season != null ? (cl === 'en' ? `Season ${season}` : `الموسم ${season}`) : (cl === 'en' ? 'Episode' : 'الحلقة')}</small>
          <b>{tileNumber}</b>
        </span>}
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
