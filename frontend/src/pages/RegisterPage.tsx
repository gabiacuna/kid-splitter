import { useId, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useT } from '../i18n';
import ResendConfirmation from '../components/ResendConfirmation';
import AuthShell from '../components/AuthShell';
import { errorDetail, httpStatus, isNetworkError } from '../lib/errors';

interface FieldErrors {
  school_name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

export default function RegisterPage() {
  const t = useT();
  const id = useId();
  const { teacher, setTeacher } = useAuth();
  const navigate = useNavigate();
  const [schoolName, setSchoolName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (teacher) return <Navigate to="/cohorts" replace />;

  function validateField(name: string, value: string): string {
    if (name === 'school_name' && !value.trim()) return t('School name is required.');
    if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return t('Enter a valid email.');
    if (name === 'password' && value.length < 8) return t('Password must be at least 8 characters.');
    if (name === 'confirm' && value !== password) return t('Passwords do not match.');
    return '';
  }

  function handleBlur(name: string, value: string) {
    const msg = validateField(name, value);
    setFieldErrors((prev) => ({ ...prev, [name]: msg || undefined }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: FieldErrors = {};
    const fields = [
      { name: 'school_name', value: schoolName },
      { name: 'email', value: email },
      { name: 'password', value: password },
      { name: 'confirm', value: confirm },
    ];
    for (const f of fields) {
      const msg = validateField(f.name, f.value);
      if (msg) errs[f.name as keyof FieldErrors] = msg;
    }
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }

    setServerError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/register', { email, password, school_name: schoolName });
      if (res.data.needs_confirmation) {
        setDone(true);
      } else {
        // No email confirmation required: the session cookies are already set.
        setTeacher(res.data.teacher);
        navigate('/cohorts');
      }
    } catch (err: unknown) {
      const status = httpStatus(err);
      const detail = errorDetail(err);
      if (isNetworkError(err)) {
        setServerError(t('We can’t reach the server. Check your connection.'));
      } else if (status === 409) {
        setFieldErrors((prev) => ({ ...prev, email: t('An account with this email already exists. Sign in instead.') }));
      } else if (status === 422 && typeof detail === 'string') {
        // Supabase's own reason (e.g. which characters it wants) — shown as it comes.
        setFieldErrors((prev) => ({ ...prev, password: `${t('Choose a stronger password.')} (${detail})` }));
      } else if (status === 422 && Array.isArray(detail)) {
        // FastAPI validation: map each failing field to its own message.
        const errs: FieldErrors = {};
        for (const d of detail as { loc?: unknown[] }[]) {
          const field = d.loc?.[d.loc.length - 1];
          if (field === 'email') errs.email = t('Enter a valid email.');
          else if (field === 'password') errs.password = t('Password must be at least 8 characters.');
          else if (field === 'school_name') errs.school_name = t('School name is required.');
        }
        if (Object.keys(errs).length) setFieldErrors((prev) => ({ ...prev, ...errs }));
        else setServerError(t('Something went wrong. Try again.'));
      } else if (status === 429) {
        setServerError(t('Too many sign-up attempts. Wait a few minutes and try again.'));
      } else {
        setServerError(t('Something went wrong. Try again.'));
      }
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthShell center>
        <div style={{ fontSize: 40, marginBottom: 16 }} aria-hidden>✉️</div>
        <h1 className="auth-title">{t('Check your email')}</h1>
        <p style={{ color: 'var(--text2)', marginTop: 8 }}>
          {t('We sent a confirmation link to')} <strong>{email}</strong>.{' '}
          {t('Click it to activate your account.')}
        </p>
        <p style={{ color: 'var(--text3)', fontSize: 13, marginTop: 18 }}>{t("Didn't get it?")}</p>
        <ResendConfirmation email={email} />
        <p className="auth-link" style={{ marginTop: 20 }}>
          <button type="button" className="link-button" onClick={() => setDone(false)}>{t('Wrong email? Change it')}</button>
          {' · '}
          <Link to="/login">{t('Back to sign in')}</Link>
        </p>
      </AuthShell>
    );
  }

  const field = (name: keyof FieldErrors) => ({
    'aria-invalid': !!fieldErrors[name],
    'aria-describedby': fieldErrors[name] ? `${id}-${name}-err` : undefined,
  });
  const err = (name: keyof FieldErrors) =>
    fieldErrors[name] && <span id={`${id}-${name}-err`} className="form-error" role="alert">{fieldErrors[name]}</span>;

  return (
    <AuthShell>
      <h1 className="auth-title">{t('Create account')}</h1>
      <p className="auth-subtitle">{t('Get started in seconds')}</p>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label className="form-label" htmlFor={`${id}-school`}>{t('School name')}</label>
          <input
            id={`${id}-school`}
            type="text"
            required
            maxLength={100}
            autoComplete="organization"
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            onBlur={(e) => handleBlur('school_name', e.target.value)}
            disabled={loading}
            placeholder={t('Sunnybrook Primary')}
            {...field('school_name')}
          />
          {err('school_name')}
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor={`${id}-email`}>{t('Email')}</label>
          <input
            id={`${id}-email`}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={(e) => handleBlur('email', e.target.value)}
            disabled={loading}
            placeholder={t('you@school.edu')}
            {...field('email')}
          />
          {err('email')}
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor={`${id}-password`}>{t('Password')}</label>
          <input
            id={`${id}-password`}
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={(e) => handleBlur('password', e.target.value)}
            disabled={loading}
            placeholder={t('min 8 characters')}
            aria-invalid={!!fieldErrors.password}
            aria-describedby={`${id}-password-hint${fieldErrors.password ? ` ${id}-password-err` : ''}`}
          />
          <span id={`${id}-password-hint`} className="form-hint">{t('At least 8 characters.')}</span>
          {err('password')}
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor={`${id}-confirm`}>{t('Confirm password')}</label>
          <input
            id={`${id}-confirm`}
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={(e) => handleBlur('confirm', e.target.value)}
            disabled={loading}
            placeholder={t('repeat password')}
            {...field('confirm')}
          />
          {err('confirm')}
        </div>
        {serverError && <span className="form-error" role="alert">{serverError}</span>}
        <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: 4 }}>
          {loading ? t('Creating account…') : t('Create account')}
        </button>
      </form>
      <p className="auth-link">
        {t('Already have an account?')} <Link to="/login">{t('Sign in')}</Link>
      </p>
    </AuthShell>
  );
}
