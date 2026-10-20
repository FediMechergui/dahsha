import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ShowCard from './ShowCard.jsx';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useLang } from '../lib/i18n.jsx';
import { fmtRelative, titlesLabel } from '../lib/format.js';
import { byRecency, hasRecency, PROVIDER_NAMES, resourceOf, WEB_PROVIDERS } from '../lib/catalog-helpers.js';

const WINDOW = 16;

/**
 * Newest titles of the active language section only (the result no longer depends on which
 * sections were loaded earlier). Sources: YouTube channels vs web providers (Myflixer, FMovies,
 * HDToday). Titles are ordered by recency (catalog-helpers): latestAt, or for FMovies/HDToday cards
 * the build's updatedAt (a new listing or a new episode there). Undated titles are never "new" (C3).
 */
export default function NewReleasesWindow() {
  const { catalog, status } = useCatalog();
  const { t, lang } = useLang();
  const [sourceFilter, setSourceFilter] = useState('all'); // 'all' | 'channels' | 'web'
  const [kindFilter, setKindFilter] = useState('all'); // 'all' | 'film' | 'series'

  const dated = useMemo(() => (catalog?.shows || []).filter(hasRecency).sort(byRecency), [catalog]);
  const counts = useMemo(() => {
    const c = { all: dated.length, channels: 0, web: 0 };
    for (const s of dated) c[resourceOf(s)] += 1;
    return c;
  }, [dated]);
  const providers = useMemo(() => {
    const ids = new Set((catalog?.shows || []).map((s) => s.channelId || s.channel?.id).filter((id) => WEB_PROVIDERS.includes(id)));
    return WEB_PROVIDERS.filter((id) => ids.has(id)).map((id) => PROVIDER_NAMES[id]);
  }, [catalog]);

  const source = counts[sourceFilter] ? sourceFilter : 'all';
  const filtered = useMemo(() => {
    const out = [];
    for (const s of dated) {
      if (source !== 'all' && resourceOf(s) !== source) continue;
      if (kindFilter !== 'all' && s.kind !== kindFilter) continue;
      out.push(s);
      if (out.length >= WINDOW) break;
    }
    return out;
  }, [dated, source, kindFilter]);

  if (!catalog || !dated.length) return null;
  const updated = status?.generatedAt || catalog.generatedAt;
  const sources = [
    { id: 'all', label: t('src_all') },
    { id: 'channels', label: t('src_channels') },
    { id: 'web', label: t('src_web') },
  ].filter((x) => x.id === 'all' || counts[x.id] > 0);
  const browseTo = `/browse?sort=latest${source === 'all' ? '' : `&source=${source}`}${kindFilter === 'all' ? '' : `&kind=${kindFilter}`}`;

  return (
    <section className="releases-window container">
      <div className="releases-window__head">
        <div>
          {updated && (
            <div className="releases-window__tag">
              <span className="releases-window__pulse" />
              <span>{t('updated_ago', { when: fmtRelative(updated, lang) })}</span>
            </div>
          )}
          <h2 className="releases-window__title">{t('releases_title')}</h2>
          <p className="releases-window__sub">
            {providers.length ? t('releases_sub_web', { providers: providers.join(lang === 'ar' ? '، ' : ', ') }) : t('releases_sub_channels')}
          </p>
        </div>
        <Link className="row__link" to={browseTo}>
          {t('see_all')} <span className="chev" aria-hidden />
        </Link>
      </div>

      <div className="releases-window__filters">
        {sources.length > 1 && (
          <div className="segmented" role="tablist" aria-label={t('sources')}>
            {sources.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={source === x.id} className={source === x.id ? 'is-active' : ''} onClick={() => setSourceFilter(x.id)}>
                {x.label}
              </button>
            ))}
          </div>
        )}
        <div className="releases-window__kinds">
          {[['all', t('all')], ['film', t('kind_films')], ['series', t('kind_series')]].map(([id, label]) => (
            <button key={id} type="button" className={`pill ${kindFilter === id ? 'pill--live' : 'pill--ghost'}`} onClick={() => setKindFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="releases-window__grid">
        {filtered.map((s, idx) => (
          <ShowCard key={s.id} show={s} index={idx} size="md" />
        ))}
      </div>

      <div className="releases-window__footer">
        <span>{titlesLabel(filtered.length, lang)}</span>
        <Link className="btn btn--ghost btn--sm" to={browseTo}>
          {t('browse_all')} <span className="chev" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
