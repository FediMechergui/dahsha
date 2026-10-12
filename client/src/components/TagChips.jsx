import { useLang } from '../lib/i18n.jsx';

export default function TagChips({ tags, active, onChange, total }) {
  const { t } = useLang();
  return (
    <div className="chips" role="tablist">
      <button role="tab" aria-selected={!active} className={`chip ${!active ? 'is-active' : ''}`} onClick={() => onChange(null)}>
        {t('all')}{total != null && <span className="chip__count">{total}</span>}
      </button>
      {tags.map((x) => (
        <button key={x.id} role="tab" aria-selected={active === x.id} className={`chip ${active === x.id ? 'is-active' : ''}`} style={{ '--tag': x.color }} onClick={() => onChange(active === x.id ? null : x.id)}>
          <i className="chip__dot" />{x.label}<span className="chip__count">{x.count}</span>
        </button>
      ))}
    </div>
  );
}
