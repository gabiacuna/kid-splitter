import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useT } from '../i18n';
import LangToggle from './LangToggle';

export function Logo({ style }: { style?: React.CSSProperties }) {
  return (
    <span className="nav-logo" style={style}>
      <span className="nav-logo-icon material-symbols-outlined" aria-hidden>groups_3</span>
      kid splitter
    </span>
  );
}

export default function Nav() {
  const { teacher, logout } = useAuth();
  const t = useT();

  return (
    <nav className="nav" aria-label={t('Main')}>
      <div className="nav-inner">
        <Link to="/cohorts" className="nav-logo">
          <span className="nav-logo-icon material-symbols-outlined" aria-hidden>groups_3</span>
          kid splitter
        </Link>
        {teacher && (
          <div className="nav-right">
            <span className="nav-school">{teacher.school_name}</span>
            <LangToggle />
            <Link
              to="/profile"
              className="nav-icon-btn"
              title={t('Your profile')}
              aria-label={t('Your profile')}
            >
              <span className="material-symbols-outlined" aria-hidden>settings</span>
            </Link>
            <button className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: 13 }} onClick={logout}>
              {t('Log out')}
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
