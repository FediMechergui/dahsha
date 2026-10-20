import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useLang } from '../lib/i18n.jsx';
import { fmtRelative } from '../lib/format.js';
import { Logo } from './Bits.jsx';
import { api } from '../lib/api.js';

// CI rebuilds and deploys every 6 hours; data older than two missed runs means the updates stopped
// (a failing or auto-disabled workflow cannot report that itself), so the pill says so.
const STALE_AFTER_MS = 12 * 3600e3;

function StatusPill() {
  const { status, connected, refresh, checking } = useCatalog();
  const { t, lang } = useLang();
  const busy = status?.refreshing || checking;
  const last = status?.lastRefreshAt || status?.generatedAt;
  const age = last ? Date.now() - Date.parse(last) : NaN;
  const stale = connected && !busy && age > STALE_AFTER_MS;
  const label = checking ? t('status_checking')
    : !connected ? t('status_offline')
    : stale ? (lang === 'en' ? 'Not updated recently' : 'لم يُحدَّث مؤخراً')
    : api.static ? t('status_static')
    : busy ? ({ details: t('status_details'), playlists: t('status_playlists'), building: t('status_building') }[status.stage] || t('status_listing'))
    : t('status_live');
  const pct = status?.refreshing && status.progress ? Math.round((status.progress.done / Math.max(1, status.progress.total)) * 100) : null;
  const when = last ? `${t('status_last')} ${fmtRelative(last, lang)}` : t('status_never');
  // The label is hidden on narrower headers (dot only), so the tooltip leads with it.
  const title = `${label} · ${when}`;
  return (
    // Static web/APK builds: the pill is the manual "check for updates" control.
    <button className={`pill ${!connected && !checking ? 'pill--off' : busy ? 'pill--busy' : stale ? 'pill--stale' : 'pill--live'}`} onClick={() => !busy && refresh()} title={busy ? title : `${title} — ${api.static ? t('status_check') : t('status_click')}`}>
      <i className="dot" />
      <span>{label}{pct != null ? ` ${pct}%` : ''}</span>
    </button>
  );
}

export default function Header() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { t, lang, setLang, appName, tagline } = useLang();
  const [q, setQ] = useState(params.get('q') || '');
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on(); window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => { setQ(params.get('q') || ''); }, [params]);

  const submit = (e) => {
    e.preventDefault();
    const v = q.trim();
    if (v) nav(`/search?q=${encodeURIComponent(v)}`);
    setOpen(false);
  };
  const switchLang = () => { setLang(lang === 'ar' ? 'en' : 'ar'); nav('/'); };

  return (
    <header className={`hdr ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="container hdr__inner">
        <Link to="/" className="hdr__logo" aria-label={appName}>
          <Logo size={32} />
          <span className="hdr__brand"><b>{appName}</b><small>{tagline}</small></span>
        </Link>
        <nav className={`hdr__nav ${open ? 'is-open' : ''}`} onClick={() => setOpen(false)}>
          <NavLink to="/" end>{t('nav_home')}</NavLink>
          <NavLink to="/browse" className={({ isActive }) => (isActive && !params.get('kind') ? 'active' : '')}>{t('nav_browse')}</NavLink>
          <NavLink to="/browse?kind=film" className={({ isActive }) => (isActive && params.get('kind') === 'film' ? 'active' : '')}>{t('nav_movies')}</NavLink>
          <NavLink to="/browse?kind=series" className={({ isActive }) => (isActive && params.get('kind') === 'series' ? 'active' : '')}>{t('nav_series')}</NavLink>
          <NavLink to="/my">{t('nav_my')}</NavLink>
          <button className="hdr__lang hdr__lang--mobile" onClick={switchLang}><span className="hdr__lang-full">{t('lang_switch')}</span></button>
        </nav>
        <form className="hdr__search" onSubmit={submit} role="search">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search_placeholder')} aria-label={t('search')} />
          <button type="submit" aria-label={t('search')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </button>
        </form>
        <button className="hdr__lang" onClick={switchLang} title={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}>
          <span className="hdr__lang-globe" aria-hidden>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg>
          </span>
          <span className="hdr__lang-full">{t('lang_switch')}</span>
          <span className="hdr__lang-short">{lang === 'ar' ? 'EN' : 'ع'}</span>
        </button>
        <StatusPill />
        <button className="hdr__burger" onClick={() => setOpen((o) => !o)} aria-label={t('menu')} aria-expanded={open}>
          <span /><span /><span />
        </button>
      </div>
    </header>
  );
}
