import { Link } from 'react-router-dom';
import Thumb from './Thumb.jsx';
import { Badge, PlayIcon } from './Bits.jsx';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useLang, channelName } from '../lib/i18n.jsx';
import { episodesLabel, isNew, fmtDuration } from '../lib/format.js';
import { channelColor, contentLangBadge } from '../lib/channels.js';

export default function ShowCard({ show, size = 'md', index, hideChannel = false }) {
  const { tagMap } = useCatalog();
  const { t, lang } = useLang();
  const tag = tagMap.get(show.primaryTag);
  const cl = contentLangBadge(show, lang);
  const fresh = isNew(show.latestAt);
  const film = show.kind === 'film';
  return (
    <Link to={`/show/${show.id}${/^(fm|hd):/.test(show.id) && show.sourceUrl ? `?source=${encodeURIComponent(show.sourceUrl)}` : ''}`} className={`card card--${size}`} style={{ '--tag': tag?.color || '#999', '--ch': channelColor(show.channel) }} data-index={index}>
      <div className="card__media">
        <Thumb thumbs={show.poster} alt="" className="card__img" start={size === 'lg' ? 'max' : 'sd'} />
        <i className="card__frame" aria-hidden />
        <div className="card__badges">
          {fresh && <Badge tone="new">{t('badge_new')}</Badge>}
          {film ? <Badge tone="film">{t('badge_film')}{show.totalDurationSec > 0 ? ` • ${fmtDuration(show.totalDurationSec, lang)}` : ''}</Badge> : <Badge>{episodesLabel(show.episodeCount, lang)}</Badge>}
          {cl && <Badge tone="lang" title={cl.label}>{cl.short}</Badge>}
        </div>
        {!hideChannel && show.channel && <span className="card__channel"><i />{channelName(show.channel, lang)}</span>}
        <span className="card__play" aria-hidden><PlayIcon size={26} /></span>
      </div>
      <div className="card__body">
        <h3 className="card__title">{show.title}</h3>
        <p className="card__meta">
          {tag && <span className="card__tag"><i />{tag.label}</span>}
        </p>
      </div>
    </Link>
  );
}
