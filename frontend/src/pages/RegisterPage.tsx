import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useT } from '../i18n';

interface FieldErrors {
  school_name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

export default function RegisterPage() {
  const t = useT();
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
      const { status, data } = (err as { response?: { status: number; data?: { detail?: unknown } } }).response ?? {};
      if (status === 409) {
        setFieldErrors((prev) => ({ ...prev, email: t('An account with this email already exists. Sign in instead.') }));
      } else if (status === 422 && typeof data?.detail === 'string') {
        setFieldErrors((prev) => ({ ...prev, password: t('Choose a stronger password.') }));
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
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>✉️</div>
          <h2 className="auth-title">{t('Check your email')}</h2>
          <p style={{ color: 'var(--text2)', marginTop: 8 }}>
            {t('We sent a confirmation link to')} <strong>{email}</strong>.{' '}
            {t('Click it to activate your account.')}
          </p>
          <p className="auth-link" style={{ marginTop: 20 }}>
            <Link to="/login">{t('Back to sign in')}</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="nav-logo" style={{ marginBottom: 24 }}>
          <span className="nav-logo-icon material-symbols-outlined">groups_3</span>
          kid splitter
        </div>
        <h1 className="auth-title">{t('Create account')}</h1>
        <p className="auth-subtitle">{t('Get started in seconds')}</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">{t('School name')}</label>
            <input
              type="text"
              required
              maxLength={100}
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              onBlur={(e) => handleBlur('school_name', e.target.value)}
              disabled={loading}
              placeholder={t('Sunnybrook Primary')}
            />
            {fieldErrors.school_name && <span className="form-error">{fieldErrors.school_name}</span>}
          </div>
          <div className="form-field">
            <label className="form-label">{t('Email')}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={(e) => handleBlur('email', e.target.value)}
              disabled={loading}
              placeholder={t('you@school.edu')}
            />
            {fieldErrors.email && <span className="form-error">{fieldErrors.email}</span>}
          </div>
          <div className="form-field">
            <label className="form-label">{t('Password')}</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={(e) => handleBlur('password', e.target.value)}
              disabled={loading}
              placeholder={t('min 8 characters')}
            />
            {fieldErrors.password && <span className="form-error">{fieldErrors.password}</span>}
          </div>
          <div className="form-field">
            <label className="form-label">{t('Confirm password')}</label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onBlur={(e) => handleBlur('confirm', e.target.value)}
              disabled={loading}
              placeholder={t('repeat password')}
            />
            {fieldErrors.confirm && <span className="form-error">{fieldErrors.confirm}</span>}
          </div>
          {serverError && <span className="form-error">{serverError}</span>}
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: 4 }}>
            {loading ? t('Creating account…') : t('Create account')}
          </button>
        </form>
        <p className="auth-link">
          {t('Already have an account?')} <Link to="/login">{t('Sign in')}</Link>
        </p>
      </div>
    </div>
  );
}
