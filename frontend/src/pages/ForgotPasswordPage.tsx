import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { useT } from '../i18n';
import AuthShell from '../components/AuthShell';
import { httpStatus, isNetworkError } from '../lib/errors';

export default function ForgotPasswordPage() {
  const t = useT();
  const id = useId();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError(t('Enter a valid email.')); return; }
    setError('');
    setState('sending');
    try {
      await api.post('/auth/forgot-password', { email });
      setState('sent');
    } catch (err) {
      setState('idle');
      if (httpStatus(err) === 429) setError(t('Too many emails requested. Wait a minute and try again.'));
      else if (isNetworkError(err)) setError(t('We can’t reach the server. Check your connection.'));
      else setError(t('Could not send the email. Try again.'));
    }
  }

  if (state === 'sent') {
    return (
      <AuthShell center>
        <h1 className="auth-title">{t('Check your email')}</h1>
        <p style={{ color: 'var(--text2)', marginTop: 8 }} role="status">
          {t('If {email} has an account, we’ve sent a link to choose a new password. It can take a few minutes — check your spam folder too.', { email })}
        </p>
        <p className="auth-link" style={{ marginTop: 20 }}>
          <button type="button" className="link-button" onClick={() => setState('idle')}>{t('Use a different email')}</button>
          {' · '}
          <Link to="/login">{t('Back to sign in')}</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="auth-title">{t('Forgot your password?')}</h1>
      <p className="auth-subtitle">{t('Enter your email and we’ll send you a link to choose a new one.')}</p>
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="form-field">
          <label className="form-label" htmlFor={`${id}-email`}>{t('Email')}</label>
          <input
            id={`${id}-email`} type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} disabled={state === 'sending'}
            placeholder={t('you@school.edu')} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
          />
          {error && <span id={`${id}-err`} className="form-error" role="alert">{error}</span>}
        </div>
        <button className="btn btn-primary" type="submit" disabled={state === 'sending'} style={{ width: '100%' }}>
          {state === 'sending' ? t('Sending…') : t('Send reset link')}
        </button>
      </form>
      <p className="auth-link"><Link to="/login">{t('Back to sign in')}</Link></p>
    </AuthShell>
  );
}
