import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { downloadFile } from '../lib/download';
import type { AccountSummary, Teacher } from '../lib/types';
import { useAuth } from '../hooks/useAuth';
import { useT } from '../i18n';
import Nav from '../components/Nav';
import { useToast } from '../components/Toast';
import { SheetIcon } from '../components/Icons';

function SchoolSection() {
  const t = useT();
  const { teacher, setTeacher } = useAuth();
  const { showToast } = useToast();
  const [name, setName] = useState(teacher?.school_name ?? '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: (school_name: string) => api.put<Teacher>('/account', { school_name }).then((r) => r.data),
    onSuccess: (updated) => {
      setTeacher(updated); // the nav shows the new name straight away
      setName(updated.school_name);
      showToast(t('Saved'), 'success');
    },
    onError: () => setError(t('Could not save. Try again.')),
  });

  const trimmed = name.trim();
  const unchanged = trimmed === teacher?.school_name;

  return (
    <section className="card profile-section">
      <h2 className="profile-heading">{t('School')}</h2>
      <form
        className="profile-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmed) { setError(t('School name is required.')); return; }
          setError('');
          save.mutate(trimmed);
        }}
      >
        <div className="form-field">
          <label className="form-label" htmlFor="profile-school">{t('School name')}</label>
          <input
            id="profile-school" type="text" value={name} maxLength={200}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            disabled={save.isPending}
          />
          {error && <span className="form-error">{error}</span>}
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="profile-email">{t('Email')}</label>
          <input id="profile-email" type="email" value={teacher?.email ?? ''} readOnly disabled />
        </div>
        <div>
          <button type="submit" className="btn btn-primary" disabled={unchanged || save.isPending}>
            {save.isPending ? t('Saving…') : t('Save')}
          </button>
        </div>
      </form>
    </section>
  );
}

function PasswordSection() {
  const t = useT();
  const { showToast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentError, setCurrentError] = useState('');
  const [newError, setNewError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [serverError, setServerError] = useState('');

  const change = useMutation({
    mutationFn: () =>
      api.post('/account/password', {
        current_password: currentPassword,
        new_password: newPassword,
      }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      showToast(t('Password updated'), 'success');
    },
    onError: (err: unknown) => {
      const { status, data } = (err as { response?: { status: number; data?: { detail?: unknown } } }).response ?? {};
      if (status === 403) {
        setCurrentError(t('Incorrect password.'));
      } else if (status === 422) {
        const detail = typeof data?.detail === 'string' ? data.detail.toLowerCase() : '';
        if (detail.includes('different')) {
          setNewError(t('New password must be different from your current password.'));
        } else {
          setNewError(t('Choose a stronger password.'));
        }
      } else if (status === 429) {
        setServerError(t('Too many attempts. Wait a few minutes and try again.'));
      } else {
        setServerError(t('Could not update password. Try again.'));
      }
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCurrentError('');
    setNewError('');
    setConfirmError('');
    setServerError('');

    let hasError = false;
    if (newPassword.length < 8) {
      setNewError(t('Password must be at least 8 characters.'));
      hasError = true;
    } else if (newPassword === currentPassword) {
      setNewError(t('New password must be different from your current password.'));
      hasError = true;
    }
    if (confirmPassword !== newPassword) {
      setConfirmError(t('Passwords do not match.'));
      hasError = true;
    }
    if (hasError) return;

    change.mutate();
  }

  return (
    <section className="card profile-section">
      <h2 className="profile-heading">{t('Change password')}</h2>
      <form className="profile-form" onSubmit={handleSubmit}>
        <div className="form-field">
          <label className="form-label" htmlFor="profile-current-password">{t('Current password')}</label>
          <input
            id="profile-current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => { setCurrentPassword(e.target.value); setCurrentError(''); setServerError(''); }}
            disabled={change.isPending}
          />
          {currentError && <span className="form-error" role="alert">{currentError}</span>}
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="profile-new-password">{t('New password')}</label>
          <input
            id="profile-new-password"
            type="password"
            autoComplete="new-password"
            placeholder={t('min 8 characters')}
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setNewError(''); setServerError(''); }}
            disabled={change.isPending}
          />
          {newError && <span className="form-error" role="alert">{newError}</span>}
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="profile-confirm-password">{t('Confirm new password')}</label>
          <input
            id="profile-confirm-password"
            type="password"
            autoComplete="new-password"
            placeholder={t('repeat password')}
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); setConfirmError(''); setServerError(''); }}
            disabled={change.isPending}
          />
          {confirmError && <span className="form-error" role="alert">{confirmError}</span>}
        </div>
        {serverError && <span className="form-error" role="alert">{serverError}</span>}
        <div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!currentPassword || !newPassword || !confirmPassword || change.isPending}
          >
            {change.isPending ? t('Updating…') : t('Update password')}
          </button>
        </div>
      </form>
    </section>
  );
}

function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { setTeacher } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  const { data: summary } = useQuery<AccountSummary>({
    queryKey: ['account-summary'],
    queryFn: () => api.get('/account/summary').then((r) => r.data),
    staleTime: 0,
  });

  const remove = useMutation({
    mutationFn: () => api.post('/account/delete', { password }),
    onSuccess: () => {
      setTeacher(null);
      qc.clear();
      navigate('/account-deleted', { replace: true });
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status: number } }).response?.status;
      if (status === 403) setError(t('Incorrect password.'));
      else if (status === 429) setError(t('Too many attempts. Wait a few minutes and try again.'));
      else if (status === 503) setError(t("Account deletion isn't set up on this server yet."));
      else setError(t('Something went wrong. Try again.'));
    },
  });

  async function download() {
    setDownloading(true); setDownloadFailed(false);
    try {
      await downloadFile('/account/export.xlsx', t('kid-splitter-data.xlsx'));
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  }

  const count = (n: number, one: string, many: string) => t(n === 1 ? one : many, { n });

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !remove.isPending && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-account-title"
        onKeyDown={(e) => e.key === 'Escape' && !remove.isPending && onClose()}>
        <h2 className="modal-title" id="delete-account-title">{t('Delete your account?')}</h2>
        <p className="modal-text">{t('This permanently deletes your login and all your data. It cannot be undone:')}</p>
        {summary ? (
          <ul className="deletion-list">
            <li>{count(summary.cohorts, '{n} cohort', '{n} cohorts')}</li>
            <li>{count(summary.students, '{n} student', '{n} students')}</li>
            <li>{count(summary.solutions, '{n} saved solution option', '{n} saved solution options')}</li>
            <li>{count(summary.share_links, '{n} active share link', '{n} active share links')}</li>
          </ul>
        ) : <div className="spinner" />}

        <div className="deletion-download">
          <p>{t('Want to keep your class lists? Download everything first.')}</p>
          <button type="button" className="export-btn" onClick={download} disabled={downloading}>
            <SheetIcon />{downloading ? t('Preparing…') : t('Download my data (.xlsx)')}
          </button>
          {downloadFailed && <span className="export-error" role="alert">{t('Download failed — try again')}</span>}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); if (password) { setError(''); remove.mutate(); } }}>
          <div className="form-field">
            <label className="form-label" htmlFor="delete-password">{t('Enter your password to confirm')}</label>
            <input
              id="delete-password" type="password" autoComplete="current-password" autoFocus
              value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }}
              disabled={remove.isPending}
            />
            {error && <span className="form-error" role="alert">{error}</span>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={remove.isPending}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-danger" disabled={!password || remove.isPending}>
              {remove.isPending ? t('Deleting…') : t('Delete everything')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const t = useT();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Nav />
      <div className="page-wrap profile-page">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('Your profile')}</h1>
            <p className="page-subtitle">{t('Manage your school details and your data.')}</p>
          </div>
        </div>

        <SchoolSection />

        <PasswordSection />

        <section className="card profile-section danger-zone">
          <h2 className="profile-heading">{t('Delete account')}</h2>
          <p>{t('Permanently delete your login and every cohort, student, preference, solution and share link. This cannot be undone.')}</p>
          <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>{t('Delete my account')}</button>
        </section>
      </div>
      {confirming && <DeleteAccountModal onClose={() => setConfirming(false)} />}
    </>
  );
}
