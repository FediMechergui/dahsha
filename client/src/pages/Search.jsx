import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ShowCard from '../components/ShowCard.jsx';
import EpisodeCard from '../components/EpisodeCard.jsx';
import { EmptyState, Spinner } from '../components/Bits.jsx';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useLang } from '../lib/i18n.jsx';
import { api } from '../lib/api.js';

function norm(s = '') {
  return String(s).toLowerCase().trim();
}

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { catalog, registerShows } = useCatalog();
  const { t } = useLang();
  const [liveResults, setLiveResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // 1. Live search directly from Myflixer API
  useEffect(() => {
    if (!q.trim()) {
      setLiveResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    api.search(q)
      .then((data) => {
        if (!cancelled && Array.isArray(data?.items)) {
          setLiveResults(data.items);
          registerShows(data.items);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => { cancelled = true; };
  }, [q]);

  // 2. Local search within loaded catalog
  const { localShows, episodes } = useMemo(() => {
    if (!catalog || !q.trim()) return { localShows: [], episodes: [] };
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const hit = (text) => { const n = norm(text); return terms.every((x) => n.includes(x)); };
    const found = catalog.shows.filter((s) => hit(s.title) || (s.altTitles && s.altTitles.some(hit)) || hit(s.synopsis || ''));
    const eps = [];
    for (const s of catalog.shows) {
      if (Array.isArray(s.episodes)) {
        for (const e of s.episodes) {
          if (hit(e.title) || hit(e.synopsis || '')) eps.push({ show: s, episode: e });
        }
      }
    }
    return { localShows: found, episodes: eps.slice(0, 40) };
  }, [catalog, q]);

  // Merge local shows and live API results (deduplicating by slug/id)
  const allShows = useMemo(() => {
    const map = new Map();
    for (const s of liveResults) map.set(s.id || s.slug, s);
    for (const s of localShows) if (!map.has(s.id || s.slug)) map.set(s.id || s.slug, s);
    return Array.from(map.values());
  }, [liveResults, localShows]);

  const none = !searching && !allShows.length && !episodes.length;

  return (
    <div className="page container">
      <header className="page__head">
        <h1 className="page__title">
          {t('search_results')} «{q}»
          {searching && <span style={{ marginInlineStart: 12, display: 'inline-flex' }}><Spinner size={18} /></span>}
        </h1>
        <p className="page__sub">{allShows.length} {t('shows_label')} • {episodes.length} {t('episodes_label')}</p>
      </header>
      {none && <EmptyState title={t('no_results')} body={t('no_results_body')} />}
      {allShows.length > 0 && (
        <section className="search__section">
          <h2 className="row__title">{t('shows_label')}</h2>
          <div className="grid">{allShows.map((s, i) => <ShowCard key={s.id || s.slug} show={s} index={i} />)}</div>
        </section>
      )}
      {episodes.length > 0 && (
        <section className="search__section">
          <h2 className="row__title">{t('episodes_label')}</h2>
          <div className="grid grid--episodes">{episodes.map(({ show, episode }) => <EpisodeCard key={episode.id} show={show} episode={episode} showShowTitle />)}</div>
        </section>
      )}
    </div>
  );
}
