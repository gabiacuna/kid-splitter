import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useT } from '../i18n';
import ErrorState from './ErrorState';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { teacher, status, retry } = useAuth();
  const t = useT();

  if (status === 'loading') {
    return (
      <div className="full-page-spinner">
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  // The backend is down or unreachable: that doesn't mean the teacher is signed out.
  if (status === 'unreachable') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-title">{t('We can’t connect')}</h1>
          <p style={{ color: 'var(--text2)', margin: '8px 0 12px' }}>
            {t('The server isn’t answering right now. Check your connection and try again in a moment.')}
          </p>
          <ErrorState message={t('We can’t reach the server. Check your connection.')} onRetry={retry} />
        </div>
      </div>
    );
  }

  if (!teacher) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
