import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useT } from '../i18n';
import ResendConfirmation from '../components/ResendConfirmation';

export default function LoginPage() {
  const t = useT();
  const { teacher, setTeacher } = useAuth();
  const navigate = useNavigate();
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
      const status = (err as { response?: { status: number } }).response?.status;
      if (status === 401) {
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
    <div className="auth-page">
      <div className="auth-card">
        <div className="nav-logo" style={{ marginBottom: 24 }}>
          <span className="nav-logo-icon material-symbols-outlined">groups_3</span>
          kid splitter
        </div>
        <h1 className="auth-title">{t('Welcome back')}</h1>
        <p className="auth-subtitle">{t('Sign in to your account')}</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">{t('Email')}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder={t('you@school.edu')}
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('Password')}</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder="••••••••"
            />
            {error && <span className="form-error">{error}</span>}
          </div>
          {unconfirmed && <ResendConfirmation email={email} />}
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: 4 }}>
            {loading ? t('Signing in…') : t('Sign in')}
          </button>
        </form>
        <p className="auth-link">
          {t('Don\'t have an account?')} <Link to="/register">{t('Sign up')}</Link>
        </p>
      </div>
    </div>
  );
}
