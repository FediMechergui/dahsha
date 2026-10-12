import { Link } from 'react-router-dom';
import { useCatalog } from '../hooks/useCatalog.jsx';
import { useLang } from '../lib/i18n.jsx';

export default function Toasts() {
  const { toasts, dismissToast } = useCatalog();
  const { t } = useLang();
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast toast--${x.kind || 'info'}`}>
          <div className="toast__text">
            <b className="toast__title">{x.title}</b>
            {x.body && <span className="toast__body">{x.body}</span>}
            {x.to && <Link className="toast__link" to={x.to} onClick={() => dismissToast(x.id)}>{t('toast_open')}</Link>}
          </div>
          <button className="toast__close" onClick={() => dismissToast(x.id)} aria-label="×">×</button>
        </div>
      ))}
    </div>
  );
}
