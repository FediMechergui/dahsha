import { DOCUMENTARIES } from '../lib/product.js';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useLang } from '../lib/i18n.jsx';
import { Spinner } from '../components/Bits.jsx';
import { fmtDate, fmtRelative, fmtNumber } from '../lib/format.js';
import { channelColor } from '../lib/channels.js';
import { providerFreshness, WEB_PROVIDERS, withChannelStats } from '../lib/catalog-helpers.js';

const isProviderSource = (s) => s.type === 'provider' || s.type === 'myflixer' || WEB_PROVIDERS.includes(s.id);
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

const PROFILE_LABEL = {
  ar: { natgeo: 'ناشونال جيوغرافيك', asharq: 'الشرق ديسكفري', dw: 'دي دبليو', aljazeera: 'الجزيرة الوثائقية', generic: 'عام', 'natgeo-en': 'Nat Geo', 'dw-en': 'DW', frontline: 'Frontline', history: 'History', freedoc: 'Free Documentary', creator: 'صانع محتوى', 'generic-en': 'عام', 'ar-show': 'برامج', 'ar-films': 'أفلام وثائقية' },
  en: { natgeo: 'Nat Geo AD', asharq: 'Asharq Discovery', dw: 'DW Arabic', aljazeera: 'Al Jazeera', generic: 'generic', 'natgeo-en': 'Nat Geo', 'dw-en': 'DW', frontline: 'Frontline', history: 'History', freedoc: 'Free Documentary', creator: 'creator', 'generic-en': 'generic', 'ar-show': 'shows', 'ar-films': 'films' },
};
const LANG_LABEL = { ar: { ar: 'العربية', en: 'الإنجليزية' }, en: { ar: 'Arabic', en: 'English' } };
// Per-provider freshness (catalog.providerSync.providers): last success, last new title, failures.
const SYNC_LABEL = {
  ar: { updated: 'آخر استجابة ناجحة', newest: 'آخر عنوان جديد', never: 'لا استجابة ناجحة بعد', since: 'متعطّل منذ', fails: (n) => (n === 2 ? 'محاولتان فاشلتان متتاليتان' : n <= 10 ? `${n} محاولات فاشلة متتالية` : `${n} محاولة فاشلة متتالية`) },
  en: { updated: 'updated', newest: 'last new title', never: 'no successful scan yet', since: 'failing since', fails: (n) => `${n} failed scans in a row` },
};

/**
 * Freshness lines of one crawled provider (FMovies/HDToday): its own last success, last new title
 * and current error, never the shared providerSync.lastRefreshAt (which a failed provider used to
 * advance). Catalogues without providerSync.providers keep the old "last sync" line and error.
 */
export function ProviderSyncInfo({ providerSync, id }) {
  const { t, lang } = useLang();
  const fresh = providerFreshness(providerSync, id);
  if (!fresh) return null;
  const S = SYNC_LABEL[lang] || SYNC_LABEL.en;
  const lines = (fresh.legacy
    ? [fresh.lastSyncAt && { at: fresh.lastSyncAt, text: `${t('provider_sync')} ${fmtRelative(fresh.lastSyncAt, lang)}` }]
    : [
      fresh.lastSuccessAt ? { at: fresh.lastSuccessAt, text: `${S.updated} ${fmtRelative(fresh.lastSuccessAt, lang)}` } : { text: S.never },
      fresh.lastNewRecordAt && { at: fresh.lastNewRecordAt, text: `${S.newest} ${fmtRelative(fresh.lastNewRecordAt, lang)}` },
    ]).filter(Boolean);
  const failing = fresh.lastError && !fresh.legacy
    ? [fresh.lastSuccessAt ? `${S.since} ${fmtDate(fresh.lastSuccessAt, lang, { short: true })}` : null, fresh.consecutiveFailures > 1 ? S.fails(fresh.consecutiveFailures) : null].filter(Boolean).join(' • ')
    : '';
  return (
    <>
      {lines.length > 0 && (
        <small className="source__sync">
          {lines.map((x, i) => <span key={i} title={x.at ? fmtDate(x.at, lang) : undefined}>{i ? ' • ' : ''}{x.text}</span>)}
        </small>
      )}
      {fresh.lastError && (
        <small className={`source__error${fresh.stale ? ' is-stale' : ''}`} style={fresh.stale ? { color: 'var(--danger)' } : undefined}>
          {t('provider_error')}: <bdi>{fresh.lastError}</bdi>{failing ? ` — ${failing}` : ''}
        </small>
      )}
    </>
  );
}

export default function Sources() {
  const { catalog, all, status, connected, refresh, pushToast, checking } = useCatalog();
  const { t, lang } = useLang();
  const [sources, setSources] = useState(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  // Static builds already carry the source list in the loaded catalogue; re-downloading a section
  // just to read it is wasteful (and printed nothing useful for the web providers).
  const load = () => Promise.resolve().then(() => !DOCUMENTARIES ? { sources: [] } : api.static ? { sources: all?.sources || [] } : api.sources()).then((r) => setSources(r.sources || [])).catch(() => setSources([]));
  useEffect(() => { load(); }, [api.static ? all?.sources : null]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const channelStats = new Map(withChannelStats(all?.channels || [], all?.shows || [], null).map((c) => [c.id, c]));
  // status.json carries the same providerSync and may be newer than the loaded catalogue.
  const providerSync = status?.providerSync || all?.providerSync || catalog?.providerSync || null;
  const generated = status?.generatedAt || all?.generatedAt;

  return (
    <div className="page container page--sources">
      <header className="page__head">
        <h1 className="page__title">{t('sources_title')}</h1>
        <p className="page__sub">{(api.static || !DOCUMENTARIES) ? t('sources_static_sub', { date: generated ? fmtDate(generated, lang) : '—' }) : t('sources_sub', { refresh: status?.refreshMinutes ?? 15, feed: status?.feedMinutes ?? 3 })}</p>
      </header>

      <section className="panel">
        <div className="panel__head">
          <h2>{t('refresh_status')}</h2>
          {!api.static && DOCUMENTARIES && (
            <div className="panel__actions">
              <button className="btn btn--primary" disabled={status?.refreshing} onClick={() => refresh(false)}>{t('refresh_now')}</button>
              <button className="btn btn--ghost" disabled={status?.refreshing} onClick={() => { if (window.confirm(t('full_rebuild_confirm'))) refresh(true); }}>{t('full_rebuild')}</button>
            </div>
          )}
          {api.static && (
            <div className="panel__actions">
              <button className="btn btn--ghost" disabled={checking} onClick={() => refresh(false)}>{checking ? <Spinner size={16} /> : null} {t('check_updates')}</button>
            </div>
          )}
        </div>
        <div className="stat-grid">
          <div className="stat"><span>{t('connection')}</span><b className={connected ? 'ok' : 'bad'}>{connected ? ((api.static || !DOCUMENTARIES) ? t('status_static') : t('connected')) : t('disconnected')}</b></div>
          {!api.static && DOCUMENTARIES && <div className="stat"><span>{t('state')}</span><b>{status?.refreshing ? <><Spinner size={14} /> {stageLabel[status.stage] || status.stage}</> : t('idle')}</b></div>}
          {!api.static && DOCUMENTARIES && <div className="stat"><span>{t('progress')}</span><b>{status?.progress ? `${status.progress.done} / ${status.progress.total}` : '—'}</b></div>}
          <div className="stat"><span>{t('last_update')}</span><b title={fmtDate(status?.lastRefreshAt || generated, lang)}>{(status?.lastRefreshAt || generated) ? fmtRelative(status?.lastRefreshAt || generated, lang) : '—'}</b></div>
          {!api.static && DOCUMENTARIES && <div className="stat"><span>{t('next_update')}</span><b>{status?.nextRefreshAt ? fmtRelative(status.nextRefreshAt, lang) : '—'}</b></div>}
          {!api.static && DOCUMENTARIES && <div className="stat"><span>{t('last_error')}</span><b className={status?.lastError ? 'bad' : ''}>{status?.lastError || t('none')}</b></div>}
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
        {(api.static || !DOCUMENTARIES) ? <p className="hint">{t('static_readonly')}</p> : (
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
              const provider = isProviderSource(s);
              const counts = c ? [
                num(c.series) != null ? `${fmtNumber(c.series, lang)} ${t('series_').toLowerCase()}` : null,
                num(c.films) != null ? `${fmtNumber(c.films, lang)} ${t('films_').toLowerCase()}` : null,
                num(c.episodes) > 0 ? `${fmtNumber(c.episodes, lang)} ${t('episodes_count')}` : null,
              ].filter(Boolean).join(', ') : '';
              const parts = [
                provider ? t('web_provider') : s.type === 'channel' ? t('channel') : t('playlist'),
                !provider && s.profile ? `${t('profile')} ${PROFILE_LABEL[lang][s.profile] || s.profile}` : null,
                LANG_LABEL[lang][s.lang || c?.lang] || null,
                s.scanUploads ? t('scans_uploads', { n: s.maxUploads }) : null,
                counts || t('not_indexed'),
              ].filter(Boolean);
              return (
                <li key={s.id} className="source" style={{ '--ch': channelColor(s) }}>
                  <div className="source__main">
                    <b><i className="source__dot" /><bdi>{lang === 'en' && s.lang !== 'en' ? s.title : (s.short || s.title)}</bdi></b>
                    {s.url && <a href={s.url} target="_blank" rel="noreferrer" dir="ltr">{s.url}</a>}
                    <small>{parts.join(' • ')}</small>
                    {provider && <ProviderSyncInfo providerSync={providerSync} id={s.id} />}
                  </div>
                  {!api.static && DOCUMENTARIES && <button className="btn btn--text danger" disabled={s.managed} onClick={() => remove(s)}>{t('remove')}</button>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!api.static && DOCUMENTARIES && (
        <section className="panel panel--muted">
          <div className="panel__head"><h2>{t('curation')}</h2></div>
          <p className="hint">{t('curation_hint')}</p>
        </section>
      )}
    </div>
  );
}
