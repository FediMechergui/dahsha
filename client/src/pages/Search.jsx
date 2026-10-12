import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import ShowCard from '../components/ShowCard.jsx';
import EpisodeCard from '../components/EpisodeCard.jsx';
import { EmptyState } from '../components/Bits.jsx';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useLang } from '../lib/i18n.jsx';

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
function norm(s = '') {
  return s.replace(TASHKEEL, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/[’']/g, "'").toLowerCase();
}

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { catalog } = useCatalog();
  const { t } = useLang();

  const { shows, episodes } = useMemo(() => {
    if (!catalog || !q.trim()) return { shows: [], episodes: [] };
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const hit = (text) => { const n = norm(text); return terms.every((x) => n.includes(x)); };
    const found = catalog.shows.filter((s) => hit(s.title) || s.altTitles.some(hit) || hit(s.synopsis || '') || hit(s.channel?.name || s.channel?.short || ''));
    const eps = [];
    for (const s of catalog.shows) for (const e of s.episodes) if (s.kind !== 'film' && (hit(e.title) || hit(e.synopsis || '') || (hit(s.title) && !found.includes(s)))) eps.push({ show: s, episode: e });
    return { shows: found.slice(0, 60), episodes: eps.slice(0, 80) };
  }, [catalog, q]);

  if (!catalog) return null;
  const none = !shows.length && !episodes.length;

  return (
    <div className="page container">
      <header className="page__head">
        <h1 className="page__title">{t('search_results')} «{q}»</h1>
        <p className="page__sub">{shows.length} {t('shows_label')} • {episodes.length} {t('episodes_label')}</p>
      </header>
      {none && <EmptyState title={t('no_results')} body={t('no_results_body')} />}
      {shows.length > 0 && (
        <section className="search__section">
          <h2 className="row__title">{t('shows_label')}</h2>
          <div className="grid">{shows.map((s, i) => <ShowCard key={s.id} show={s} index={i} />)}</div>
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
