import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useLang } from '../lib/i18n.jsx';
import { Spinner } from '../components/Bits.jsx';
import { fmtDate, fmtRelative, fmtNumber } from '../lib/format.js';
import { channelColor } from '../lib/channels.js';

const PROFILE_LABEL = {
  ar: { natgeo: 'ناشونال جيوغرافيك', asharq: 'الشرق ديسكفري', dw: 'دي دبليو', aljazeera: 'الجزيرة الوثائقية', generic: 'عام', 'natgeo-en': 'Nat Geo', 'dw-en': 'DW', frontline: 'Frontline', history: 'History', freedoc: 'Free Documentary', creator: 'صانع محتوى', 'generic-en': 'عام' },
  en: { natgeo: 'Nat Geo AD', asharq: 'Asharq Discovery', dw: 'DW Arabic', aljazeera: 'Al Jazeera', generic: 'generic', 'natgeo-en': 'Nat Geo', 'dw-en': 'DW', frontline: 'Frontline', history: 'History', freedoc: 'Free Documentary', creator: 'creator', 'generic-en': 'generic' },
};
const LANG_LABEL = { ar: { ar: 'العربية', en: 'الإنجليزية' }, en: { ar: 'Arabic', en: 'English' } };

export default function Sources() {
  const { catalog, all, status, connected, refresh, pushToast } = useCatalog();
  const { t, lang } = useLang();
  const [sources, setSources] = useState(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.sources().then((r) => setSources(r.sources)).catch(() => setSources([]));
  useEffect(() => { load(); }, []);

  const add = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    try {
      const src = await api.addSource(url.trim());
      pushToast({ kind: 'info', title: t('source_added'), body: `${src.title} — ${t('will_scan')}` });
      setUrl('');
      await load();
    } catch (err) { pushToast({ kind: 'error', title: t('add_failed'), body: err.message }); }
    finally { setBusy(false); }
  };

  const remove = async (s) => {
    if (!window.confirm(t('remove_confirm', { title: s.title }))) return;
    try { await api.removeSource(s.id); await load(); }
    catch (err) { pushToast({ kind: 'error', title: t('remove_failed'), body: err.message }); }
  };

  const stageLabel = { idle: t('idle'), listing: t('status_listing'), playlists: t('status_playlists'), details: t('status_details'), building: t('status_building') };
  const channelStats = new Map((all?.channels || []).map((c) => [c.id, c]));
  const generated = status?.generatedAt || all?.generatedAt;

  return (
    <div className="page container page--sources">
      <header className="page__head">
        <h1 className="page__title">{t('sources_title')}</h1>
        <p className="page__sub">{api.static ? t('sources_static_sub', { date: generated ? fmtDate(generated, lang) : '—' }) : t('sources_sub', { refresh: status?.refreshMinutes ?? 15, feed: status?.feedMinutes ?? 3 })}</p>
      </header>

      <section className="panel">
        <div className="panel__head">
          <h2>{t('refresh_status')}</h2>
          {!api.static && (
            <div className="panel__actions">
              <button className="btn btn--primary" disabled={status?.refreshing} onClick={() => refresh(false)}>{t('refresh_now')}</button>
              <button className="btn btn--ghost" disabled={status?.refreshing} onClick={() => { if (window.confirm(t('full_rebuild_confirm'))) refresh(true); }}>{t('full_rebuild')}</button>
            </div>
          )}
        </div>
        <div className="stat-grid">
          <div className="stat"><span>{t('connection')}</span><b className={connected ? 'ok' : 'bad'}>{connected ? (api.static ? t('status_static') : t('connected')) : t('disconnected')}</b></div>
          {!api.static && <div className="stat"><span>{t('state')}</span><b>{status?.refreshing ? <><Spinner size={14} /> {stageLabel[status.stage] || status.stage}</> : t('idle')}</b></div>}
          {!api.static && <div className="stat"><span>{t('progress')}</span><b>{status?.progress ? `${status.progress.done} / ${status.progress.total}` : '—'}</b></div>}
          <div className="stat"><span>{t('last_update')}</span><b title={fmtDate(status?.lastRefreshAt || generated, lang)}>{(status?.lastRefreshAt || generated) ? fmtRelative(status?.lastRefreshAt || generated, lang) : '—'}</b></div>
          {!api.static && <div className="stat"><span>{t('next_update')}</span><b>{status?.nextRefreshAt ? fmtRelative(status.nextRefreshAt, lang) : '—'}</b></div>}
          {!api.static && <div className="stat"><span>{t('last_error')}</span><b className={status?.lastError ? 'bad' : ''}>{status?.lastError || t('none')}</b></div>}
        </div>
        {all && (
          <div className="stat-grid stat-grid--catalog">
            <div className="stat"><span>{t('series_')}</span><b>{fmtNumber(all.stats.series, lang)}</b></div>
            <div className="stat"><span>{t('films_')}</span><b>{fmtNumber(all.stats.films, lang)}</b></div>
            <div className="stat"><span>{t('full_episodes')}</span><b>{fmtNumber(all.stats.episodes, lang)}</b></div>
            <div className="stat"><span>{t('playlists_scanned')}</span><b>{fmtNumber(all.stats.playlists, lang)}</b></div>
            <div className="stat"><span>{t('videos_scanned')}</span><b>{fmtNumber(all.stats.videosScanned, lang)}</b></div>
            <div className="stat"><span>{t('built_at')}</span><b>{fmtDate(all.generatedAt, lang)}</b></div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel__head"><h2>{t('sources')}</h2></div>
        {api.static ? <p className="hint">{t('static_readonly')}</p> : (
          <form className="form-row" onSubmit={add}>
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('add_placeholder')} dir="ltr" />
            <button className="btn btn--primary" disabled={busy || !url.trim()}>{busy ? <Spinner size={16} /> : t('add')}</button>
          </form>
        )}
        <p className="hint">{t('sources_hint', { min: Math.round((catalog?.minEpisodeSeconds ?? 420) / 60) })}</p>
        {!sources ? <Spinner /> : sources.length === 0 ? <p className="hint">{t('no_sources')}</p> : (
          <ul className="sources">
            {sources.map((s) => {
              const c = channelStats.get(s.id);
              return (
                <li key={s.id} className="source" style={{ '--ch': channelColor(s) }}>
                  <div className="source__main">
                    <b><i className="source__dot" />{lang === 'en' && s.lang !== 'en' ? s.title : (s.short || s.title)}</b>
                    <a href={s.url} target="_blank" rel="noreferrer" dir="ltr">{s.url}</a>
                    <small>
                      {s.type === 'channel' ? t('channel') : t('playlist')} • {t('profile')} {PROFILE_LABEL[lang][s.profile] || s.profile} • {LANG_LABEL[lang][s.lang] || s.lang}
                      {s.scanUploads ? ` • ${t('scans_uploads', { n: s.maxUploads })}` : ''}
                      {c ? ` • ${c.series} ${t('series_').toLowerCase()}, ${c.films} ${t('films_').toLowerCase()}, ${c.episodes} ${t('episodes_count')}` : ` • ${t('not_indexed')}`}
                    </small>
                  </div>
                  {!api.static && <button className="btn btn--text danger" onClick={() => remove(s)}>{t('remove')}</button>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!api.static && (
        <section className="panel panel--muted">
          <div className="panel__head"><h2>{t('curation')}</h2></div>
          <p className="hint">{t('curation_hint')}</p>
        </section>
      )}
    </div>
  );
}
