import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import AuthShell from '../components/AuthShell';

/** Public: shown right after deletion, when there is no session any more. */
export default function AccountDeletedPage() {
  const t = useT();
  return (
    <AuthShell center>
      <h1 className="auth-title">{t('Your account was deleted')}</h1>
      <p style={{ color: 'var(--text2)', marginTop: 8 }}>
        {t('Your login and all your data have been permanently removed.')}
      </p>
      <p className="auth-link" style={{ marginTop: 20 }}>
        <Link to="/register">{t('Create a new account')}</Link>
      </p>
    </AuthShell>
  );
}
