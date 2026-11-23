import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLang, type Lang } from '../i18n';

const LANGS: { code: Lang; label: string }[] = [
  { code: 'es', label: 'ES' },
  { code: 'en', label: 'EN' },
];

export default function Nav() {
  const { teacher, logout } = useAuth();
  const { lang, setLang, t } = useLang();

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link to="/cohorts" className="nav-logo">
          <span className="nav-logo-icon material-symbols-outlined">groups_3</span>
          kid splitter
        </Link>
        {teacher && (
          <div className="nav-right">
            <span className="nav-school">{teacher.school_name}</span>
            <div className="lang-toggle" role="group" aria-label={t('Language')}>
              {LANGS.map(({ code, label }) => (
                <button
                  key={code}
                  type="button"
                  className={`lang-toggle-btn${lang === code ? ' active' : ''}`}
                  aria-pressed={lang === code}
                  onClick={() => setLang(code)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: 13 }} onClick={logout}>
              {t('Log out')}
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
