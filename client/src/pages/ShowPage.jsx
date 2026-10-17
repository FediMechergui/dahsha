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
import { cleanTitle, decodeEntities } from '../lib/text.js';
import { landscapeArt, portraitArt } from '../lib/catalog-helpers.js';

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
  if (show?.detailsLoading && !show.title) return <div className="page container" role="status">{t('loading')}</div>;
  if (!show) return <div className="page container"><EmptyState title={t('show_missing')} body={t('show_missing_body')} action={<Link className="btn btn--ghost" to="/browse">{t('back_to_browse')}</Link>} /></div>;

  const film = show.kind === 'film';
  const inProgress = show.episodes.map((e) => ({ e, p: progress[e.id] })).filter((x) => x.p && !x.p.finished && x.p.position > 30).sort((a, b) => b.p.at - a.p.at)[0];
  const next = inProgress?.e || show.episodes.find((e) => !progress[e.id]?.finished) || show.episodes[0];
  const isFav = favs.includes(show.id);
  const years = [yearOf(show.firstAt), yearOf(show.latestAt)].filter(Boolean);
  const yearLabel = show.year ? String(show.year) : years.length ? (years[0] === years[1] ? `${years[0]}` : `${years[0]}–${years[1]}`) : null;
  const seasons = show.seasons || [];
  const sl = show.lang || lang; // formatting language for this show's content
  const title = cleanTitle(show.title);
  const count = Math.max(Number.isFinite(show.episodeCount) ? show.episodeCount : 0, show.episodes.length);
  const portrait = portraitArt(show);
  const videoId = show.posterId || show.posterVideoId || show.episodes?.[0]?.id;
  const langBadge = contentLangBadge(show, lang);

  return (
    <div className="page page--show" dir={sl === 'en' ? 'ltr' : 'rtl'}>
      {/* Ambient, blurred backdrop: the sharp artwork (often with a printed title) appears once, in the poster frame. */}
      <div className="show__backdrop">
        <Thumb videoId={videoId} thumbs={landscapeArt(show.poster)} alt="" start="hq" eager fitPortrait={false} />
        <div className="show__shade" />
      </div>
      <div className="container show__head">
        <div className={`show__poster ${portrait ? 'show__poster--portrait' : ''}`}>
          {portrait ? <Thumb thumbs={{...show.poster,custom:portrait}} videoId={show.posterId || show.posterVideoId} alt={title} eager /> : <Thumb videoId={videoId} thumbs={show.poster} alt={title} start="sd" eager />}
        </div>
        <div className="show__info">
          <p className="show__kicker">
            <ChannelPill channel={show.channel} small />
            <span className="show__kind">{show.classification?.status === 'uncertain' ? (lang === 'en' ? 'Not yet classified' : 'لم يُصنّف بعد') : film ? t('kind_film_label') : t('kind_series_label')}</span>
            {langBadge && <span className="badge badge--lang">{langBadge.label}</span>}
          </p>
          <h1 className="show__title" dir="auto">{title}</h1>
          <p className="show__meta">
            {film ? (show.totalDurationSec > 0 ? <span>{fmtDuration(show.totalDurationSec, lang)}</span> : null) : count > 0 ? <span>{episodesLabel(count, lang)}{seasons.length > 1 ? ` • ${seasons.length} ${t('seasons')}` : ''}</span> : null}
            {!film && show.totalDurationSec > 0 && <span>{fmtDuration(show.totalDurationSec, lang)}</span>}
            {yearLabel && <span>{yearLabel}</span>}
            {show.totalViews > 0 ? <span>{fmtCompact(show.totalViews, lang)} {t('views')}</span> : null}
          </p>
          <div className="show__tags">{show.tags.map((x) => <TagPill key={x} tag={tagMap.get(x)} />)}</div>
          <p className={`show__synopsis ${show.synopsisGenerated ? 'is-generated' : ''}`} dir="auto">{decodeEntities(show.synopsis)}</p>
          {show.versions?.length > 0 && <section aria-label="Available versions">
            <h2>{lang === 'ar' ? 'نسخ أخرى بنفس العنوان' : 'Other versions with this title'}</h2>
            <p>{lang === 'ar' ? 'قد تكون هذه نسخاً مختلفة. اختر النسخة التي تريد مشاهدتها.' : 'These may be different editions. Choose which one to open.'}</p>
            <div className="show__actions">{show.versions.map(version => <Link className="btn btn--ghost" key={version.id} to={`/show/${version.id}${version.sourceUrl ? `?source=${encodeURIComponent(version.sourceUrl)}` : ''}`}>
              <bdi>{cleanTitle(version.title)}</bdi> {version.year || ''} · {version.offerings?.[0]?.provider || version.channelId || 'Source'}
            </Link>)}</div>
          </section>}
          <div className="show__actions">
            {next && <Link to={`/watch/${show.id}/${next.id}${/^(fm|hd):/.test(show.id) && show.sourceUrl ? `?source=${encodeURIComponent(show.sourceUrl)}` : ''}`} className="btn btn--primary">
              <PlayIcon /> {inProgress ? t('continue_watching') : film ? t('watch_film') : t('watch_now')}
            </Link>}
            {!next && <p role="status">{show.detailsLoading ? t('loading') : show.detailsError || t('episode_missing')}</p>}
            <button className={`btn btn--ghost fav-btn ${isFav ? 'is-active' : ''}`} onClick={() => favoritesStore.toggle(show.id)}>
              <HeartIcon filled={isFav} /> {isFav ? t('in_my_list') : t('add_to_list')}
            </button>
          </div>
          {show.altTitles.length > 0 && <p className="show__alt">{t('also_known')} {show.altTitles.map((x, i) => <span key={i}>{i > 0 && ' • '}<bdi>{cleanTitle(x)}</bdi></span>)}</p>}
        </div>
      </div>

      <div className="container show__episodes">
        <div className="row__head">
          <div>
            <h2 className="row__title">{film ? t('the_film') : t('episodes')}</h2>
            <p className="row__sub">{film || !count ? '' : episodesLabel(count, lang)}{show.latestAt ? `${film || !count ? '' : ' — '}${film ? t('published') : t('last_added')} ${fmtDate(show.latestAt, lang)}` : ''}</p>
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
