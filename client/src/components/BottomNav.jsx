// Phone-only bottom tab bar (Home, Browse, Movies, TV Shows, My List).
import { NavLink, useSearchParams } from 'react-router-dom';
import { useLang } from '../lib/i18n.jsx';

const Icon = ({ d }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  browse: 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z',
  films: 'M4 5h16v14H4zM4 9h16M4 15h16M8 5v14M16 5v14',
  series: 'M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7zm15 14l-5-4-5 4',
  my: 'M12 21s-7.5-4.6-9.5-9.2C1.2 8.5 3.3 5 6.8 5c2 0 3.4 1.1 4.2 2.3C11.8 6.1 13.2 5 15.2 5c3.5 0 5.6 3.5 4.3 6.8C19.5 16.4 12 21 12 21z',
};

export default function BottomNav() {
  const { t } = useLang();
  const [params] = useSearchParams();
  const kind = params.get('kind');
  return (
    <nav className="bnav" aria-label="main">
      <NavLink to="/" end><Icon d={ICONS.home} /><span>{t('nav_home')}</span></NavLink>
      <NavLink to="/browse" className={({ isActive }) => (isActive && !kind ? 'active' : '')}><Icon d={ICONS.browse} /><span>{t('nav_browse')}</span></NavLink>
      <NavLink to="/browse?kind=film" className={({ isActive }) => (isActive && kind === 'film' ? 'active' : '')}><Icon d={ICONS.films} /><span>{t('nav_movies')}</span></NavLink>
      <NavLink to="/browse?kind=series" className={({ isActive }) => (isActive && kind === 'series' ? 'active' : '')}><Icon d={ICONS.series} /><span>{t('nav_series')}</span></NavLink>
      <NavLink to="/my"><Icon d={ICONS.my} /><span>{t('nav_my')}</span></NavLink>
    </nav>
  );
}
