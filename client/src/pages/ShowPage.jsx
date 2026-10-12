import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import Thumb from '../components/Thumb.jsx';
import EpisodeCard from '../components/EpisodeCard.jsx';
import Row from '../components/Row.jsx';
import ShowCard from '../components/ShowCard.jsx';
import { ChannelPill, EmptyState, HeartIcon, PlayIcon, TagPill } from '../components/Bits.jsx';
import { useCatalog, useFullShow } from '../hooks/useCatalog.jsx';
import { useFavorites, favoritesStore, useProgress } from '../hooks/useProgress.js';
import { useLang } from '../lib/i18n.jsx';
import { episodesLabel, fmtDuration, fmtDate, fmtCompact, yearOf } from '../lib/format.js';
import { contentLangBadge } from '../lib/channels.js';

export default function ShowPage() {
  const { id } = useParams();
  const { catalog, all } = useCatalog();
  const { t, lang } = useLang();
  const favs = useFavorites();
  const progress = useProgress();
  const show = useFullShow(id);

  // Tag labels for the show's own language (a shared link may open a show from the other section).
  const tagMap = useMemo(() => {
    const l = show?.lang || lang;
    return new Map((all?.tags || []).map((x) => [x.id, { ...x, label: l === 'en' ? (x.labelEn || x.label) : x.label }]));
  }, [all, show?.lang, lang]);

  const related = useMemo(() => {
    if (!catalog || !show) return [];
    const sameTag = catalog.shows.filter((s) => s.id !== show.id && s.tags.some((x) => show.tags.includes(x)));
    return [...sameTag.filter((s) => s.channel?.id === show.channel?.id), ...sameTag.filter((s) => s.channel?.id !== show.channel?.id)].slice(0, 14);
  }, [catalog, show]);

  if (!catalog) return null;
  if (!show) return <div className="page container"><EmptyState title={t('show_missing')} body={t('show_missing_body')} action={<Link className="btn btn--ghost" to="/browse">{t('back_to_browse')}</Link>} /></div>;

  const film = show.kind === 'film';
  const inProgress = show.episodes.map((e) => ({ e, p: progress[e.id] })).filter((x) => x.p && !x.p.finished && x.p.position > 30).sort((a, b) => b.p.at - a.p.at)[0];
  const next = inProgress?.e || show.episodes.find((e) => !progress[e.id]?.finished) || show.episodes[0];
  const isFav = favs.includes(show.id);
  const years = [yearOf(show.firstAt), yearOf(show.latestAt)].filter(Boolean);
  const yearLabel = years.length ? (years[0] === years[1] ? `${years[0]}` : `${years[0]}–${years[1]}`) : null;
  const seasons = show.seasons || [];
  const sl = show.lang || lang; // formatting language for this show's content

  return (
    <div className="page page--show" dir={sl === 'en' ? 'ltr' : 'rtl'}>
      <div className="show__backdrop">
        <Thumb thumbs={show.poster} alt="" eager />
        <div className="show__shade" />
      </div>
      <div className="container show__head">
        <div className={`show__poster ${show.portrait ? 'show__poster--portrait' : ''}`}>
          {show.portrait ? <img src={show.portrait} alt={show.title} loading="eager" /> : <Thumb thumbs={show.poster} alt={show.title} start="sd" eager />}
        </div>
        <div className="show__info">
          <p className="show__kicker">
            <ChannelPill channel={show.channel} small />
            <span className="show__kind">{film ? t('kind_film_label') : t('kind_series_label')}</span>
            {contentLangBadge(show, lang) && <span className="badge badge--lang">{contentLangBadge(show, lang).label}</span>}
          </p>
          <h1 className="show__title">{show.title}</h1>
          <p className="show__meta">
            {film ? <span>{fmtDuration(show.totalDurationSec, lang)}</span> : <span>{episodesLabel(show.episodeCount, lang)}{seasons.length > 1 ? ` • ${seasons.length} ${t('seasons')}` : ''}</span>}
            {!film && <span>{fmtDuration(show.totalDurationSec, lang)}</span>}
            {yearLabel && <span>{yearLabel}</span>}
            {show.totalViews ? <span>{fmtCompact(show.totalViews, lang)} {t('views')}</span> : null}
          </p>
          <div className="show__tags">{show.tags.map((x) => <TagPill key={x} tag={tagMap.get(x)} />)}</div>
          <p className={`show__synopsis ${show.synopsisGenerated ? 'is-generated' : ''}`}>{show.synopsis}</p>
          <div className="show__actions">
            <Link to={`/watch/${show.id}/${next.id}`} className="btn btn--primary">
              <PlayIcon /> {inProgress ? t('continue_watching') : film ? t('watch_film') : t('watch_now')}
            </Link>
            <button className={`btn btn--ghost fav-btn ${isFav ? 'is-active' : ''}`} onClick={() => favoritesStore.toggle(show.id)}>
              <HeartIcon filled={isFav} /> {isFav ? t('in_my_list') : t('add_to_list')}
            </button>
          </div>
          {show.altTitles.length > 0 && <p className="show__alt">{t('also_known')} {show.altTitles.join(' • ')}</p>}
        </div>
      </div>

      <div className="container show__episodes">
        <div className="row__head">
          <div>
            <h2 className="row__title">{film ? t('the_film') : t('episodes')}</h2>
            <p className="row__sub">{film ? '' : episodesLabel(show.episodeCount, lang)}{show.latestAt ? `${film ? '' : ' — '}${film ? t('published') : t('last_added')} ${fmtDate(show.latestAt, lang)}` : ''}</p>
          </div>
        </div>
        {seasons.length > 1 ? seasons.map((season) => (
          <section key={season} className="season">
            <h3 className="season__title">{t('season')} {season}</h3>
            <div className="ep-list">
              {show.episodes.filter((e) => e.season === season).map((e, i) => <EpisodeCard key={e.id} show={show} episode={e} index={i} layout="list" />)}
            </div>
          </section>
        )) : (
          <div className="ep-list">
            {show.episodes.map((e, i) => <EpisodeCard key={e.id} show={show} episode={e} index={i} layout="list" />)}
          </div>
        )}
        {seasons.length > 1 && show.episodes.some((e) => e.season == null) && (
          <section className="season">
            <h3 className="season__title">{t('other_episodes')}</h3>
            <div className="ep-list">
              {show.episodes.filter((e) => e.season == null).map((e, i) => <EpisodeCard key={e.id} show={show} episode={e} index={i} layout="list" />)}
            </div>
          </section>
        )}
      </div>

      {related.length > 0 && (
        <div className="container" dir={lang === 'en' ? 'ltr' : 'rtl'}>
          <Row title={t('related')} sub={t('related_sub')}>
            {related.map((s, i) => <ShowCard key={s.id} show={s} index={i} />)}
          </Row>
        </div>
      )}
    </div>
  );
}
