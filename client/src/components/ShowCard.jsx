import { Link } from 'react-router-dom';
import Thumb from './Thumb.jsx';
import { Badge, PlayIcon } from './Bits.jsx';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useLang, channelName } from '../lib/i18n.jsx';
import { episodesLabel, isNew, fmtDuration } from '../lib/format.js';
import { channelColor, contentLangBadge } from '../lib/channels.js';
import { cleanTitle } from '../lib/text.js';
import { discoveredOn, PROVIDER_NAMES, recencyOf } from '../lib/catalog-helpers.js';

// Most thumbnails already carry a printed title or logo, so the card keeps text and badges off the
// image: title, channel and badges sit below it.
export default function ShowCard({ show, size = 'md', index, hideChannel = false }) {
  const { tagMap } = useCatalog();
  const { t, lang } = useLang();
  const tag = tagMap.get(show.primaryTag);
  const cl = contentLangBadge(show, lang);
  // "New" follows the card's recency (latestAt, or a provider discovery / new provider episode).
  const fresh = isNew(recencyOf(show));
  const discovered = fresh ? discoveredOn(show) : null;
  const newTitle = discovered ? (lang === 'en' ? `New on ${PROVIDER_NAMES[discovered]}` : `جديد على ${PROVIDER_NAMES[discovered]}`) : undefined;
  const film = show.kind === 'film';
  const count = Number.isFinite(show.episodeCount) && show.episodeCount > 0 ? show.episodeCount : 0;
  const pending = show.classification?.status === 'uncertain';
  const kindText = pending ? (lang === 'en' ? 'Not yet classified' : 'لم يُصنّف بعد') : film
    ? `${t('badge_film')}${show.totalDurationSec > 0 ? ` • ${fmtDuration(show.totalDurationSec, lang)}` : ''}`
    : count ? episodesLabel(count, lang) : t('kind_series_label');
  const channel = !hideChannel && show.channel ? channelName(show.channel, lang) || show.channel.name || show.channel.title : null;
  const title = cleanTitle(show.title);
  return (
    <Link to={`/show/${show.id}${/^(fm|hd):/.test(show.id) && show.sourceUrl ? `?source=${encodeURIComponent(show.sourceUrl)}` : ''}`} className={`card card--${size}`} style={{ '--tag': tag?.color || '#999', '--ch': channelColor(show.channel) }} data-index={index} aria-label={title || undefined}>
      <div className="card__media">
        <Thumb videoId={show.posterId || show.posterVideoId || show.episodes?.[0]?.id} thumbs={show.poster} alt="" className="card__img" start={size === 'lg' ? 'max' : 'sd'} />
        <i className="card__frame" aria-hidden />
        <span className="card__play" aria-hidden><PlayIcon size={26} /></span>
      </div>
      <div className="card__body">
        <h3 className="card__title" dir="auto">{title}</h3>
        <p className="card__meta">
          {channel ? <span className="card__channel"><i />{channel}</span> : tag && <span className="card__tag"><i />{tag.label}</span>}
          <span className="card__kind">{kindText}</span>
          {fresh && <Badge tone="new" title={newTitle}>{t('badge_new')}</Badge>}
          {cl && <Badge tone="lang" title={cl.label}>{cl.short}</Badge>}
        </p>
      </div>
    </Link>
  );
}
