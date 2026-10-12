import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import Hero from '../components/Hero.jsx';
import Row from '../components/Row.jsx';
import ShowCard from '../components/ShowCard.jsx';
import EpisodeCard from '../components/EpisodeCard.jsx';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useProgress, continueWatching } from '../hooks/useProgress.js';
import { useLang } from '../lib/i18n.jsx';
import { fmtNumber, titlesLabel, episodesLabel } from '../lib/format.js';
import { channelColor } from '../lib/channels.js';

const byLatest = (a, b) => (b.latestAt || '').localeCompare(a.latestAt || '');
const ROW = 12;

export default function Home() {
  const { catalog, recentEpisodes } = useCatalog();
  const { t, lang } = useLang();
  const progress = useProgress();
  const cont = useMemo(() => continueWatching(progress, catalog), [progress, catalog]);

  const { featured, newest, films, popular, byChannel, byTag } = useMemo(() => {
    if (!catalog) return { featured: [], newest: [], films: [], popular: [], byChannel: [], byTag: [] };
    const shows = catalog.shows;
    const perChannel = new Map();
    for (const s of [...shows].filter((x) => x.kind === 'series' && x.episodeCount >= 2 && !x.synopsisGenerated).sort(byLatest)) {
      if (s.channel?.id && !perChannel.has(s.channel.id)) perChannel.set(s.channel.id, s);
    }
    let featured = [...perChannel.values()].slice(0, 6);
    if (featured.length < 3) featured = [...featured, ...shows.filter((x) => !featured.includes(x) && !x.synopsisGenerated).sort(byLatest).slice(0, 6 - featured.length)];
    const newest = [...shows].filter((s) => s.kind === 'series').sort(byLatest).slice(0, ROW);
    const filmsList = [...shows].filter((s) => s.kind === 'film').sort(byLatest).slice(0, ROW);
    const popular = [...shows].sort((a, b) => (b.totalViews || 0) - (a.totalViews || 0)).slice(0, ROW);
    const byChannel = (catalog.channels || [])
      .map((c) => ({ channel: c, shows: shows.filter((s) => s.channel?.id === c.id).sort(byLatest).slice(0, ROW) }))
      .filter((x) => x.shows.length >= 2);
    const byTag = catalog.tags
      .map((x) => ({ tag: x, shows: shows.filter((s) => s.tags.includes(x.id)).sort(byLatest).slice(0, ROW) }))
      .filter((x) => x.shows.length >= 2)
      .sort((a, b) => b.tag.count - a.tag.count);
    return { featured, newest, films: filmsList, popular, byChannel, byTag };
  }, [catalog]);

  if (!catalog) return null;
  if (!catalog.shows.length) {
    return (
      <div className="page container">
        <div className="empty" style={{ paddingTop: 120 }}>
          <div className="empty__icon" aria-hidden>◌</div>
          <h3 className="empty__title">{lang === 'en' ? 'The English section is still being built' : 'القسم العربي قيد البناء'}</h3>
          <p className="empty__body">{lang === 'en' ? 'Come back in a little while, or switch the language from the top bar.' : 'عد بعد قليل، أو بدّل اللغة من الشريط العلوي.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page page--home">
      <Hero shows={featured} />

      <div className="container stats-strip">
        <div><b>{fmtNumber(catalog.stats.series, lang)}</b><span>{t('stat_series')}</span></div>
        <div><b>{fmtNumber(catalog.stats.films, lang)}</b><span>{t('stat_films')}</span></div>
        <div><b>{fmtNumber(catalog.stats.episodes, lang)}</b><span>{t('stat_episodes')}</span></div>
        <div><b>{fmtNumber(catalog.stats.totalHours, lang)}</b><span>{t('stat_hours')}</span></div>
        <div><b>{fmtNumber(catalog.stats.channels, lang)}</b><span>{t('stat_channels')}</span></div>
      </div>

      <div className="container">
        {cont.length > 0 && (
          <Row title={t('row_continue')} to="/my" className="row--episodes">
            {cont.map(({ show, episode }) => <EpisodeCard key={episode.id} show={show} episode={episode} showShowTitle />)}
          </Row>
        )}

        <Row title={t('row_latest_eps')} sub={t('row_latest_eps_sub')} to="/browse?sort=latest" className="row--episodes">
          {recentEpisodes.slice(0, ROW).map(({ show, episode }) => <EpisodeCard key={episode.id} show={show} episode={episode} showShowTitle />)}
        </Row>

        {newest.length > 0 && (
          <Row title={t('row_new_series')} to="/browse?kind=series&sort=latest">
            {newest.map((s, i) => <ShowCard key={s.id} show={s} index={i} />)}
          </Row>
        )}

        {films.length > 0 && (
          <Row title={t('row_films')} sub={t('row_films_sub')} to="/browse?kind=film&sort=latest">
            {films.map((s, i) => <ShowCard key={s.id} show={s} index={i} />)}
          </Row>
        )}

        {byChannel.map(({ channel, shows }) => (
          <Row key={channel.id} title={<span className="row__chtitle" style={{ '--ch': channelColor(channel) }}><i />{channel.name}</span>} sub={`${titlesLabel(channel.shows, lang)} • ${episodesLabel(channel.episodes, lang)}`} to={`/browse?channel=${encodeURIComponent(channel.id)}`}>
            {shows.map((s, i) => <ShowCard key={s.id} show={s} index={i} hideChannel />)}
          </Row>
        ))}

        <Row title={t('row_popular')} to="/browse?sort=views">
          {popular.map((s, i) => <ShowCard key={s.id} show={s} index={i} />)}
        </Row>

        {byTag.map(({ tag, shows }) => (
          <Row key={tag.id} title={tag.label} sub={titlesLabel(tag.count, lang)} to={`/browse?tag=${tag.id}`}>
            {shows.map((s, i) => <ShowCard key={s.id} show={s} index={i} />)}
          </Row>
        ))}

        <div className="home__all">
          <Link to="/browse" className="btn btn--ghost btn--lg">{t('browse_all')} — {titlesLabel(catalog.stats.shows, lang)}</Link>
        </div>
      </div>
    </div>
  );
}
