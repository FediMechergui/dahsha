import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import ShowCard from '../components/ShowCard.jsx';
import TagChips from '../components/TagChips.jsx';
import { EmptyState } from '../components/Bits.jsx';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useLang } from '../lib/i18n.jsx';
import { titlesLabel } from '../lib/format.js';
import { channelColor } from '../lib/channels.js';

export default function Browse() {
  const { catalog, tagMap, channelMap } = useCatalog();
  const { t, lang } = useLang();
  const [params, setParams] = useSearchParams();
  const tag = params.get('tag');
  const channel = params.get('channel');
  const kind = params.get('kind') || '';
  const sort = params.get('sort') || 'latest';
  const q = params.get('q') || '';

  const SORTS = [
    { id: 'latest', label: t('sort_latest') }, { id: 'title', label: t('sort_title') }, { id: 'episodes', label: t('sort_episodes') },
    { id: 'views', label: t('sort_views') }, { id: 'duration', label: t('sort_duration') },
  ];
  const KINDS = [{ id: '', label: t('all') }, { id: 'series', label: t('kind_series') }, { id: 'film', label: t('kind_films') }];

  const update = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
  };

  const base = useMemo(() => {
    if (!catalog) return [];
    let list = catalog.shows;
    if (channel) list = list.filter((s) => s.channel?.id === channel);
    if (kind) list = list.filter((s) => s.kind === kind);
    return list;
  }, [catalog, channel, kind]);

  const shows = useMemo(() => {
    let list = base;
    if (tag) list = list.filter((s) => s.tags.includes(tag));
    if (q) { const n = q.trim().toLowerCase(); list = list.filter((s) => s.title.toLowerCase().includes(n) || s.altTitles.some((x) => x.toLowerCase().includes(n))); }
    const by = {
      latest: (a, b) => (b.latestAt || '').localeCompare(a.latestAt || ''),
      title: (a, b) => a.title.localeCompare(b.title, lang),
      episodes: (a, b) => b.episodeCount - a.episodeCount,
      views: (a, b) => (b.totalViews || 0) - (a.totalViews || 0),
      duration: (a, b) => b.totalDurationSec - a.totalDurationSec,
    }[sort] || (() => 0);
    return [...list].sort(by);
  }, [base, tag, sort, q, lang]);

  const tagsForChips = useMemo(() => {
    if (!catalog) return [];
    const counts = new Map();
    for (const s of base) for (const x of s.tags) counts.set(x, (counts.get(x) || 0) + 1);
    return catalog.tags.map((x) => ({ ...x, count: counts.get(x.id) || 0 })).filter((x) => x.count > 0);
  }, [catalog, base]);

  if (!catalog) return null;
  const activeTag = tag ? tagMap.get(tag) : null;
  const activeChannel = channel ? channelMap.get(channel) : null;
  const title = activeChannel ? activeChannel.name : activeTag ? activeTag.label : kind === 'film' ? t('browse_films') : kind === 'series' ? t('browse_series') : t('browse_title');

  return (
    <div className="page container">
      <header className="page__head">
        <h1 className="page__title">{title}</h1>
        <p className="page__sub">
          {titlesLabel(shows.length, lang)}{activeTag && activeChannel ? ` ${t('browse_within')} ${activeTag.label}` : ''} — {t('browse_sub', { min: Math.round(catalog.minEpisodeSeconds / 60) })}
        </p>
      </header>

      <div className="filterbar">
        <div className="chips chips--inline" role="tablist">
          <button role="tab" aria-selected={!channel} className={`chip ${!channel ? 'is-active' : ''}`} onClick={() => update({ channel: null })}>{t('all_channels')}<span className="chip__count">{catalog.stats.shows}</span></button>
          {(catalog.channels || []).map((c) => (
            <button key={c.id} role="tab" aria-selected={channel === c.id} className={`chip ${channel === c.id ? 'is-active' : ''}`} style={{ '--tag': channelColor(c) }} onClick={() => update({ channel: channel === c.id ? null : c.id })}>
              <i className="chip__dot" />{c.name}<span className="chip__count">{c.shows}</span>
            </button>
          ))}
        </div>
        <div className="segmented" role="tablist">
          {KINDS.map((k) => <button key={k.id} role="tab" aria-selected={kind === k.id} className={kind === k.id ? 'is-active' : ''} onClick={() => update({ kind: k.id || null })}>{k.label}</button>)}
        </div>
      </div>

      <TagChips tags={tagsForChips} active={tag} onChange={(x) => update({ tag: x })} total={base.length} />

      <div className="toolbar">
        <input className="input input--inline" value={q} onChange={(e) => update({ q: e.target.value })} placeholder={t('filter_name')} aria-label={t('filter_name')} />
        <label className="select">
          <span>{t('sort')}</span>
          <select value={sort} onChange={(e) => update({ sort: e.target.value })}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {shows.length ? (
        <div className="grid">
          {shows.map((s, i) => <ShowCard key={s.id} show={s} index={i} hideChannel={!!activeChannel} />)}
        </div>
      ) : (
        <EmptyState title={t('empty_results')} body={t('empty_results_body')} />
      )}
    </div>
  );
}
