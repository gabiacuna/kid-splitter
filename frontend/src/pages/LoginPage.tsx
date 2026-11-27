import { useId, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useT } from '../i18n';
import ResendConfirmation from '../components/ResendConfirmation';
import AuthShell from '../components/AuthShell';
import { httpStatus, isNetworkError } from '../lib/errors';

export default function LoginPage() {
  const t = useT();
  const id = useId();
  const { teacher, setTeacher } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const sessionExpired = !!(location.state as { sessionExpired?: boolean } | null)?.sessionExpired;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [loading, setLoading] = useState(false);

  if (teacher) return <Navigate to="/cohorts" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setUnconfirmed(false);
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      setTeacher(res.data.teacher); // response is { teacher }
      navigate('/cohorts');
    } catch (err: unknown) {
      const status = httpStatus(err);
      if (isNetworkError(err)) {
        setError(t('We can’t reach the server. Check your connection.'));
      } else if (status === 401) {
        setError(t('Incorrect email or password.'));
      } else if (status === 403) {
        setError(t('Confirm your email first — check your inbox (and spam) for the link we sent.'));
        setUnconfirmed(true);
      } else if (status === 429) {
        setError(t('Too many attempts. Wait a few minutes and try again.'));
      } else {
        setError(t('Something went wrong. Try again.'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="auth-title">{t('Welcome back')}</h1>
      <p className="auth-subtitle">{t('Sign in to your account')}</p>
      {sessionExpired && !error && (
        <div className="warn-banner" role="status" style={{ marginBottom: 16 }}>{t('Your session expired. Please sign in again.')}</div>
      )}
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="form-field">
          <label className="form-label" htmlFor={`${id}-email`}>{t('Email')}</label>
          <input
            id={`${id}-email`}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            placeholder={t('you@school.edu')}
          />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor={`${id}-password`}>{t('Password')}</label>
          <input
            id={`${id}-password`}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            placeholder="••••••••"
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-err` : undefined}
          />
          {error && <span id={`${id}-err`} className="form-error" role="alert">{error}</span>}
          <Link to="/forgot-password" className="auth-forgot">{t('Forgot your password?')}</Link>
        </div>
        {unconfirmed && <ResendConfirmation email={email} />}
        <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: 4 }}>
          {loading ? t('Signing in…') : t('Sign in')}
        </button>
      </form>
      <p className="auth-link">
        {t('Don\'t have an account?')} <Link to="/register">{t('Sign up')}</Link>
      </p>
    </AuthShell>
  );
}
