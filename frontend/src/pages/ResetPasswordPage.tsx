import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { useT } from '../i18n';
import AuthShell from '../components/AuthShell';
import { errorDetail, httpStatus, isNetworkError } from '../lib/errors';

/** Supabase's recovery link lands here with `#access_token=…&type=recovery` (or `#error=…`). */
function readRecoveryHash(): { token: string | null; linkError: boolean } {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = params.get('access_token');
  const linkError = !!params.get('error') || !!params.get('error_code');
  return { token: linkError ? null : token, linkError };
}

export default function ResetPasswordPage() {
  const t = useT();
  const id = useId();
  // Read once, then drop the token from the address bar (and from history).
  const [{ token, linkError }] = useState(() => {
    const r = readRecoveryHash();
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    return r;
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; server?: string }>({});
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'expired'>(token ? 'idle' : 'expired');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (password.length < 8) errs.password = t('Password must be at least 8 characters.');
    if (confirm !== password) errs.confirm = t('Passwords do not match.');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setState('saving');
    try {
      await api.post('/auth/reset-password', { access_token: token, new_password: password });
      setState('done');
    } catch (err) {
      const status = httpStatus(err);
      const detail = errorDetail(err);
      if (status === 400 && detail === 'link_expired') { setState('expired'); return; }
      setState('idle');
      if (status === 422 && typeof detail === 'string' && detail.toLowerCase().includes('different')) setErrors({ password: t('New password must be different from your current password.') });
      else if (status === 422) setErrors({ password: t('Choose a stronger password.') });
      else if (status === 429) setErrors({ server: t('Too many attempts. Wait a few minutes and try again.') });
      else if (isNetworkError(err)) setErrors({ server: t('We can’t reach the server. Check your connection.') });
      else setErrors({ server: t('Could not update password. Try again.') });
    }
  }

  if (state === 'done') {
    return (
      <AuthShell center>
        <h1 className="auth-title">{t('Password updated')}</h1>
        <p style={{ color: 'var(--text2)', marginTop: 8 }} role="status">{t('Sign in with your new password.')}</p>
        <p className="auth-link" style={{ marginTop: 20 }}><Link to="/login">{t('Sign in')}</Link></p>
      </AuthShell>
    );
  }

  if (state === 'expired') {
    return (
      <AuthShell center>
        <h1 className="auth-title">{t('This link has expired')}</h1>
        <p style={{ color: 'var(--text2)', marginTop: 8 }} role="alert">
          {linkError || token
            ? t('Reset links work once and only for a short time. Ask for a new one.')
            : t('Open this page from the link in the reset email. If it doesn’t work, ask for a new one.')}
        </p>
        <p className="auth-link" style={{ marginTop: 20 }}><Link to="/forgot-password">{t('Send me a new link')}</Link></p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="auth-title">{t('Choose a new password')}</h1>
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="form-field">
          <label className="form-label" htmlFor={`${id}-pw`}>{t('New password')}</label>
          <input id={`${id}-pw`} type="password" autoComplete="new-password" value={password}
            onChange={(e) => setPassword(e.target.value)} disabled={state === 'saving'}
            aria-describedby={`${id}-pw-hint${errors.password ? ` ${id}-pw-err` : ''}`} aria-invalid={!!errors.password} />
          <span id={`${id}-pw-hint`} className="form-hint">{t('At least 8 characters.')}</span>
          {errors.password && <span id={`${id}-pw-err`} className="form-error" role="alert">{errors.password}</span>}
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor={`${id}-confirm`}>{t('Confirm new password')}</label>
          <input id={`${id}-confirm`} type="password" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} disabled={state === 'saving'}
            aria-invalid={!!errors.confirm} aria-describedby={errors.confirm ? `${id}-confirm-err` : undefined} />
          {errors.confirm && <span id={`${id}-confirm-err`} className="form-error" role="alert">{errors.confirm}</span>}
        </div>
        {errors.server && <span className="form-error" role="alert">{errors.server}</span>}
        <button className="btn btn-primary" type="submit" disabled={state === 'saving'} style={{ width: '100%' }}>
          {state === 'saving' ? t('Updating…') : t('Update password')}
        </button>
      </form>
    </AuthShell>
  );
}
