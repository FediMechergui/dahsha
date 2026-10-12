import { Link } from 'react-router-dom';
import { channelColor } from '../lib/channels.js';
import { useLang } from '../lib/i18n.jsx';

/** The Dahsha mark: an eye with a golden iris. */
export function Logo({ size = 28 }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="#ffcc00" />
      <path d="M8 32c6.5-9.5 15-14.5 24-14.5S49.5 22.5 56 32c-6.5 9.5-15 14.5-24 14.5S14.5 41.5 8 32z" fill="#0a0b0d" />
      <circle cx="32" cy="32" r="8.5" fill="#ffcc00" />
      <circle cx="35" cy="29" r="2.6" fill="#0a0b0d" />
    </svg>
  );
}

export function Spinner({ size = 28 }) {
  const { t } = useLang();
  return <span className="spinner" style={{ width: size, height: size }} aria-label={t('loading')} />;
}

export function EmptyState({ icon = '◌', title, body, action }) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden>{icon}</div>
      <h3 className="empty__title">{title}</h3>
      {body && <p className="empty__body">{body}</p>}
      {action}
    </div>
  );
}

export function Badge({ children, tone = 'default', title }) {
  return <span className={`badge badge--${tone}`} title={title}>{children}</span>;
}

export function SectionTitle({ children, sub, to, linkLabel }) {
  const { t } = useLang();
  return (
    <div className="row__head">
      <div>
        <h2 className="row__title">{children}</h2>
        {sub && <p className="row__sub">{sub}</p>}
      </div>
      {to && <Link className="row__link" to={to}>{linkLabel || t('see_all')} <span className="chev" aria-hidden /></Link>}
    </div>
  );
}

export function TagPill({ tag, small = false, asLink = true }) {
  if (!tag) return null;
  const style = { '--tag': tag.color };
  const cls = `tagpill ${small ? 'tagpill--sm' : ''}`;
  return asLink
    ? <Link to={`/browse?tag=${tag.id}`} className={cls} style={style}><i className="tagpill__dot" />{tag.label}</Link>
    : <span className={cls} style={style}><i className="tagpill__dot" />{tag.label}</span>;
}

export function ChannelPill({ channel, small = false, asLink = true }) {
  const { lang } = useLang();
  if (!channel) return null;
  const style = { '--ch': channelColor(channel) };
  const cls = `chpill ${small ? 'chpill--sm' : ''}`;
  const name = channel.name || (lang === 'en' && channel.lang !== 'en' ? channel.title : channel.short) || channel.title;
  const inner = <><i className="chpill__dot" />{name}</>;
  return asLink
    ? <Link to={`/browse?channel=${encodeURIComponent(channel.id)}`} className={cls} style={style}>{inner}</Link>
    : <span className={cls} style={style}>{inner}</span>;
}

export function PlayIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

export function HeartIcon({ filled, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.5 3.3 5 6.8 5c2 0 3.4 1.1 4.2 2.3C11.8 6.1 13.2 5 15.2 5c3.5 0 5.6 3.5 4.3 6.8C19.5 16.4 12 21 12 21z" />
    </svg>
  );
}

export function ProgressBar({ value = 0 }) {
  return <div className="progressbar"><i style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div>;
}
