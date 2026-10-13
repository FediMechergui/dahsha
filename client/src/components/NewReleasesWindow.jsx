import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ShowCard from './ShowCard.jsx';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useLang } from '../lib/i18n.jsx';
import { titlesLabel } from '../lib/format.js';

export default function NewReleasesWindow() {
  const { catalog, all } = useCatalog();
  const { t, lang } = useLang();
  const [sourceFilter, setSourceFilter] = useState('all'); // 'all' | 'myflixer' | 'arabic' | 'english'
  const [kindFilter, setKindFilter] = useState('all'); // 'all' | 'film' | 'series'

  const allShows = useMemo(() => {
    if (!catalog) return [];
    // If all is available, merge all shows across sections to truly represent all resources
    const list = all?.shows?.length ? all.shows : catalog.shows;
    return list;
  }, [catalog, all]);

  const filtered = useMemo(() => {
    let list = allShows;

    // Filter by source
    if (sourceFilter === 'myflixer') {
      list = list.filter((s) => s.channelId === 'myflixer' || s.id.startsWith('mf:'));
    } else if (sourceFilter === 'arabic') {
      list = list.filter((s) => (s.lang === 'ar' || s.contentLang === 'ar') && s.channelId !== 'myflixer');
    } else if (sourceFilter === 'english') {
      list = list.filter((s) => (s.lang === 'en' || s.contentLang === 'en') && s.channelId !== 'myflixer');
    }

    // Filter by format
    if (kindFilter === 'film') {
      list = list.filter((s) => s.kind === 'film');
    } else if (kindFilter === 'series') {
      list = list.filter((s) => s.kind === 'series');
    }

    // Sort by latest addition / release date
    return [...list]
      .sort((a, b) => (b.latestAt || '').localeCompare(a.latestAt || ''))
      .slice(0, 16);
  }, [allShows, sourceFilter, kindFilter]);

  if (!catalog || !allShows.length) return null;

  return (
    <section className="releases-window container">
      <div className="releases-window__head">
        <div>
          <div className="releases-window__tag">
            <span className="releases-window__pulse" />
            <span>{lang === 'ar' ? 'تحديثات مباشرة عبر كل المصادر' : 'Live updates across all resources'}</span>
          </div>
          <h2 className="releases-window__title">
            {lang === 'ar' ? 'نافذة أحدث الوثائقيات' : 'New Documentary Releases Window'}
          </h2>
          <p className="releases-window__sub">
            {lang === 'ar'
              ? 'أحدث الإضافات والإصدارات الوثائقية المجمعة من يوتيوب ومايفليكسر'
              : 'Latest documentary releases and updates aggregated from YouTube and Myflixer'}
          </p>
        </div>
        <Link className="row__link" to="/browse?sort=latest">
          {t('see_all')} <span className="chev" aria-hidden />
        </Link>
      </div>

      {/* Interactive Resource & Format Filter Bars */}
      <div className="releases-window__filters">
        <div className="segmented" role="tablist" aria-label="Filter by resource">
          <button
            type="button"
            className={sourceFilter === 'all' ? 'is-active' : ''}
            onClick={() => setSourceFilter('all')}
          >
            {lang === 'ar' ? '🌟 جميع المصادر' : '🌟 All Resources'}
          </button>
          <button
            type="button"
            className={sourceFilter === 'myflixer' ? 'is-active' : ''}
            onClick={() => setSourceFilter('myflixer')}
          >
            {lang === 'ar' ? '🎬 مايفليكسر (Myflixer)' : '🎬 Myflixer Docs'}
          </button>
          <button
            type="button"
            className={sourceFilter === 'arabic' ? 'is-active' : ''}
            onClick={() => setSourceFilter('arabic')}
          >
            {lang === 'ar' ? '🟢 القنوات العربية' : '🟢 Arabic Channels'}
          </button>
          <button
            type="button"
            className={sourceFilter === 'english' ? 'is-active' : ''}
            onClick={() => setSourceFilter('english')}
          >
            {lang === 'ar' ? '🔵 القنوات الإنجليزية' : '🔵 English Channels'}
          </button>
        </div>

        <div className="releases-window__kinds">
          <button
            type="button"
            className={`pill ${kindFilter === 'all' ? 'pill--live' : 'pill--ghost'}`}
            onClick={() => setKindFilter('all')}
          >
            {t('all')}
          </button>
          <button
            type="button"
            className={`pill ${kindFilter === 'film' ? 'pill--live' : 'pill--ghost'}`}
            onClick={() => setKindFilter('film')}
          >
            {t('kind_films')}
          </button>
          <button
            type="button"
            className={`pill ${kindFilter === 'series' ? 'pill--live' : 'pill--ghost'}`}
            onClick={() => setKindFilter('series')}
          >
            {t('kind_series')}
          </button>
        </div>
      </div>

      {/* Grid of latest documentary releases */}
      <div className="releases-window__grid">
        {filtered.map((s, idx) => (
          <ShowCard key={s.id} show={s} index={idx} size="md" />
        ))}
      </div>

      <div className="releases-window__footer">
        <span>{titlesLabel(filtered.length, lang)}</span>
        <Link className="btn btn--ghost btn--sm" to="/browse?sort=latest">
          {t('browse_all')} →
        </Link>
      </div>
    </section>
  );
}
