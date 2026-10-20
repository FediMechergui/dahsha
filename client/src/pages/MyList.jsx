import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import ShowCard from '../components/ShowCard.jsx';
import EpisodeCard from '../components/EpisodeCard.jsx';
import { EmptyState } from '../components/Bits.jsx';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useFavorites, useProgress, continueWatching, progressStore } from '../hooks/useProgress.js';
import { useLang } from '../lib/i18n.jsx';
import { titlesLabel, episodesLabel } from '../lib/format.js';
import { favoriteCardIndex } from '../lib/catalog-helpers.js';

export default function MyList() {
  const { catalog, episodeIndex } = useCatalog();
  const { t, lang } = useLang();
  const favs = useFavorites();
  const progress = useProgress();

  // A favourite saved under a provider card that is now an uncertain version (show.versions) or an
  // offering of another card lists that card, once. ShowPage resolves the same index (favoriteIdsOf),
  // so that card's heart reads "In My List" and removing it drops every id it is stored under.
  const index = useMemo(() => favoriteCardIndex(catalog?.shows), [catalog]);
  const favShows = useMemo(() => [...new Map(favs.map((id) => index.get(id)).filter(Boolean).map((s) => [s.id, s])).values()], [favs, index]);
  const cont = useMemo(() => continueWatching(progress, catalog, 40), [progress, catalog]);
  const finished = useMemo(() => Object.entries(progress)
    .filter(([id, p]) => p.finished && episodeIndex.has(id))
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 40)
    .map(([id]) => episodeIndex.get(id)), [progress, episodeIndex]);

  if (!catalog) return null;
  const empty = !favShows.length && !cont.length && !finished.length;

  return (
    <div className="page container">
      <header className="page__head">
        <h1 className="page__title">{t('my_title')}</h1>
        <p className="page__sub">{t('my_sub')}</p>
      </header>

      {empty && <EmptyState icon="♡" title={t('my_empty')} body={t('my_empty_body')} action={<Link className="btn btn--primary" to="/browse">{t('browse_all')}</Link>} />}

      {cont.length > 0 && (
        <section className="search__section">
          <div className="row__head"><div><h2 className="row__title">{t('row_continue')}</h2><p className="row__sub">{episodesLabel(cont.length, lang)}</p></div></div>
          <div className="grid grid--episodes">{cont.map(({ show, episode }) => <EpisodeCard key={episode.id} show={show} episode={episode} showShowTitle />)}</div>
        </section>
      )}

      {favShows.length > 0 && (
        <section className="search__section">
          <div className="row__head"><div><h2 className="row__title">{t('favorites')}</h2><p className="row__sub">{titlesLabel(favShows.length, lang)}</p></div></div>
          <div className="grid">{favShows.map((s, i) => <ShowCard key={s.id} show={s} index={i} />)}</div>
        </section>
      )}

      {finished.length > 0 && (
        <section className="search__section">
          <div className="row__head">
            <div><h2 className="row__title">{t('watched_list')}</h2><p className="row__sub">{episodesLabel(finished.length, lang)}</p></div>
            <button className="row__link" onClick={() => { for (const { episode } of finished) progressStore.clear(episode.id); }}>{t('clear_history')}</button>
          </div>
          <div className="grid grid--episodes">{finished.map(({ show, episode }) => <EpisodeCard key={episode.id} show={show} episode={episode} showShowTitle />)}</div>
        </section>
      )}
    </div>
  );
}
