import { useEffect } from 'react';
import { Routes, Route, useLocation, Link } from 'react-router-dom';
import Header from './components/Header.jsx';
import Toasts from './components/Toasts.jsx';
import { Logo, Spinner } from './components/Bits.jsx';
import { useCatalog } from './hooks/useCatalog.jsx';
import { useLang } from './lib/i18n.jsx';
import Home from './pages/Home.jsx';
import Browse from './pages/Browse.jsx';
import ShowPage from './pages/ShowPage.jsx';
import Watch from './pages/Watch.jsx';
import Search from './pages/Search.jsx';
import MyList from './pages/MyList.jsx';
import Sources from './pages/Sources.jsx';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
  return null;
}

function Building() {
  const { status, error, reload, loading, building } = useCatalog();
  const { t, appName } = useLang();
  const stage = { listing: t('building_listing'), playlists: t('building_playlists'), details: t('building_details'), building: t('building_building') }[status?.stage] || t('building_first');
  const pct = status?.progress ? Math.round((status.progress.done / Math.max(1, status.progress.total)) * 100) : null;
  if (!error && !building && loading) {
    return <div className="building"><Logo size={64} /><p className="building__stage"><Spinner size={18} /> {t('loading')}</p></div>;
  }
  return (
    <div className="building">
      <Logo size={72} />
      <h1>{appName}</h1>
      {error ? (
        <>
          <p className="building__err">{t('server_error')} {error}</p>
          <button className="btn btn--primary" onClick={reload}>{t('retry')}</button>
        </>
      ) : (
        <>
          <p className="building__stage"><Spinner size={18} /> {stage}{pct != null ? ` ${pct}%` : ''}</p>
          {pct != null && <div className="progressbar progressbar--lg"><i style={{ width: `${pct}%` }} /></div>}
          <p className="hint">{t('building_hint')}</p>
        </>
      )}
    </div>
  );
}

export default function App() {
  const { catalog } = useCatalog();
  const { t } = useLang();
  return (
    <>
      <ScrollToTop />
      <Header />
      <main>
        {!catalog ? <Building /> : (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/show/:id" element={<ShowPage />} />
            <Route path="/watch/:showId/:epId" element={<Watch />} />
            <Route path="/search" element={<Search />} />
            <Route path="/my" element={<MyList />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="*" element={<div className="page container"><h1 className="page__title">{t('not_found')}</h1><Link className="btn btn--ghost" to="/">{t('nav_home')}</Link></div>} />
          </Routes>
        )}
      </main>
      <footer className="footer container">
        <Logo size={20} />
        <span>{t('footer')}</span>
      </footer>
      <Toasts />
    </>
  );
}
