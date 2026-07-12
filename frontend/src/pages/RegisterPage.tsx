import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';

interface FieldErrors {
  school_name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

export default function RegisterPage() {
  const { teacher } = useAuth();
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
    if (name === 'school_name' && !value.trim()) return 'School name is required.';
    if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email.';
    if (name === 'password' && value.length < 8) return 'Password must be at least 8 characters.';
    if (name === 'confirm' && value !== password) return 'Passwords do not match.';
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
      await api.post('/auth/register', { email, password, school_name: schoolName });
      setDone(true);
    } catch (err: unknown) {
      const status = (err as { response?: { status: number } }).response?.status;
      if (status === 409) {
        setFieldErrors((prev) => ({ ...prev, email: 'An account with this email already exists.' }));
      } else {
        setServerError('Something went wrong. Try again.');
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
          <h2 className="auth-title">Check your email</h2>
          <p style={{ color: 'var(--text2)', marginTop: 8 }}>
            We sent a confirmation link to <strong>{email}</strong>.
            Click it to activate your account.
          </p>
          <p className="auth-link" style={{ marginTop: 20 }}>
            <Link to="/login">Back to sign in</Link>
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
        <h1 className="auth-title">Create account</h1>
        <p className="auth-subtitle">Get started in seconds</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">School name</label>
            <input
              type="text"
              required
              maxLength={100}
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              onBlur={(e) => handleBlur('school_name', e.target.value)}
              disabled={loading}
              placeholder="Sunnybrook Primary"
            />
            {fieldErrors.school_name && <span className="form-error">{fieldErrors.school_name}</span>}
          </div>
          <div className="form-field">
            <label className="form-label">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={(e) => handleBlur('email', e.target.value)}
              disabled={loading}
              placeholder="you@school.edu"
            />
            {fieldErrors.email && <span className="form-error">{fieldErrors.email}</span>}
          </div>
          <div className="form-field">
            <label className="form-label">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={(e) => handleBlur('password', e.target.value)}
              disabled={loading}
              placeholder="min 8 characters"
            />
            {fieldErrors.password && <span className="form-error">{fieldErrors.password}</span>}
          </div>
          <div className="form-field">
            <label className="form-label">Confirm password</label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onBlur={(e) => handleBlur('confirm', e.target.value)}
              disabled={loading}
              placeholder="repeat password"
            />
            {fieldErrors.confirm && <span className="form-error">{fieldErrors.confirm}</span>}
          </div>
          {serverError && <span className="form-error">{serverError}</span>}
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: 4 }}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="auth-link">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
