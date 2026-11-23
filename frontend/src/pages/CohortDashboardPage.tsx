import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { Cohort } from '../lib/types';
import Nav from '../components/Nav';
import { MIN_CLASSES, MAX_CLASSES } from '../lib/classes';
import { timeAgo } from '../lib/timeAgo';
import { cohortTint } from '../lib/cohortTint';
import { PersonIcon, PlusIcon } from '../components/Icons';
import { useT, getLocale } from '../i18n';

function SkeletonCard() {
  return (
    <div className="cohort-card">
      <div className="skeleton" style={{ height: 20, width: '60%', marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 14, width: '40%', marginBottom: 6 }} />
      <div className="skeleton" style={{ height: 14, width: '50%' }} />
      <div className="skeleton" style={{ height: 36, marginTop: 16 }} />
    </div>
  );
}

function CreateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (c: Cohort) => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [year, setYear] = useState('');
  const [numClasses, setNumClasses] = useState('3');
  const [balanceGender, setBalanceGender] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (body: object) => api.post('/cohorts', body).then((r) => r.data),
    onSuccess: (data: Cohort) => {
      qc.invalidateQueries({ queryKey: ['cohorts'] });
      onCreate(data);
    },
    onError: () => setServerError(t('Something went wrong. Try again.')),
  });

  function validate() {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t('Name is required.');
    const n = parseInt(numClasses);
    if (!numClasses || n < MIN_CLASSES || n > MAX_CLASSES) errs.numClasses = t('Between {min} and {max} classes.', { min: MIN_CLASSES, max: MAX_CLASSES });
    return errs;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setServerError('');
    mutation.mutate({ name: name.trim(), year: year ? parseInt(year) : undefined, num_classes: parseInt(numClasses), balance_gender: balanceGender });
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 className="modal-title">{t('New cohort')}</h2>
        <p style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 20 }}>
          {t('Create a new class group to start adding students.')}
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-field">
            <label className="form-label">{t('Cohort name *')}</label>
            <input
              type="text"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Year 3 — 2026')}
              disabled={mutation.isPending}
            />
            {errors.name && <span className="form-error">{errors.name}</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-field">
              <label className="form-label">{t('Year (optional)')}</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2026"
                min={2000}
                max={2100}
                disabled={mutation.isPending}
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('Number of classes *')}</label>
              <input
                type="number"
                value={numClasses}
                onChange={(e) => setNumClasses(e.target.value)}
                min={MIN_CLASSES}
                max={MAX_CLASSES}
                disabled={mutation.isPending}
              />
              {errors.numClasses && <span className="form-error">{errors.numClasses}</span>}
            </div>
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={balanceGender}
              onChange={(e) => setBalanceGender(e.target.checked)}
              disabled={mutation.isPending}
            />
            <span>
              {t('Prioritize a balanced mix of boys and girls per class')}
              <span className="checkbox-caption">{t('Added as a soft constraint the solver weighs alongside your other preferences.')}</span>
            </span>
          </label>
          {serverError && <span className="form-error">{serverError}</span>}
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>
              {t('Cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? t('Creating…') : t('Create cohort')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditModal({ cohort, onClose }: { cohort: Cohort; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(cohort.name);
  const [balanceGender, setBalanceGender] = useState(cohort.balance_gender);
  const [error, setError] = useState('');
  const [serverError, setServerError] = useState('');
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (body: object) => api.put(`/cohorts/${cohort.id}`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cohorts'] });
      qc.invalidateQueries({ queryKey: ['cohort', cohort.id] });
      onClose();
    },
    onError: () => setServerError(t('Something went wrong. Try again.')),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError(t('Name is required.')); return; }
    setServerError('');
    mutation.mutate({ name: name.trim(), balance_gender: balanceGender });
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 className="modal-title">{t('Edit cohort')}</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-field">
            <label className="form-label">{t('Cohort name *')}</label>
            <input
              type="text"
              maxLength={100}
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              disabled={mutation.isPending}
            />
            {error && <span className="form-error">{error}</span>}
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={balanceGender}
              onChange={(e) => setBalanceGender(e.target.checked)}
              disabled={mutation.isPending}
            />
            <span>
              {t('Prioritize a balanced mix of boys and girls per class')}
              <span className="checkbox-caption">{t('Added as a soft constraint the solver weighs alongside your other preferences.')}</span>
            </span>
          </label>
          {serverError && <span className="form-error">{serverError}</span>}
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>
              {t('Cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? t('Saving…') : t('Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteModal({ cohort, onClose }: { cohort: Cohort; onClose: () => void }) {
  const t = useT();
  // Split the translated sentence around {name} so the name can stay bold ("¿Eliminar <b>X</b>?").
  const [deletePrefix, deleteSuffix = ''] = t('Delete {name}?').split('{name}');
  const [serverError, setServerError] = useState('');
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.delete(`/cohorts/${cohort.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cohorts'] });
      onClose();
    },
    onError: () => setServerError(t('Something went wrong. Try again.')),
  });

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 className="modal-title">{t('Delete cohort')}</h2>
        <p style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 20 }}>
          {deletePrefix}<strong>{cohort.name}</strong>{deleteSuffix} {t('This permanently removes its students, constraints, and solutions. This can’t be undone.')}
        </p>
        {serverError && <span className="form-error">{serverError}</span>}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn-danger" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? t('Deleting…') : t('Delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

function CardMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div className="card-menu" ref={ref}>
      <button
        type="button"
        className="card-menu-btn"
        aria-label={t('Cohort options')}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="card-menu-dropdown">
          <button type="button" className="card-menu-item" onClick={() => { setOpen(false); onEdit(); }}>
            {t('Edit')}
          </button>
          <button type="button" className="card-menu-item danger" onClick={() => { setOpen(false); onDelete(); }}>
            {t('Delete')}
          </button>
        </div>
      )}
    </div>
  );
}

export default function CohortDashboardPage() {
  const t = useT();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Cohort | null>(null);
  const [deleting, setDeleting] = useState<Cohort | null>(null);

  const { data: cohorts, isLoading, isError } = useQuery<Cohort[]>({
    queryKey: ['cohorts'],
    queryFn: () => api.get('/cohorts').then((r) => r.data.cohorts),
  });

  return (
    <>
      <Nav />
      <div className="page-wrap">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('Your cohorts')}</h1>
            <p className="page-subtitle">{t('Pick a cohort to manage students and class placements.')}</p>
          </div>
          <button className="btn btn-primary btn-icon" onClick={() => setShowCreate(true)}>
            <PlusIcon /> {t('New cohort')}
          </button>
        </div>

        {isLoading && (
          <div className="cohort-grid">
            {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {isError && (
          <div className="warn-banner">{t('Failed to load cohorts. Refresh to try again.')}</div>
        )}

        {cohorts && cohorts.length === 0 && (
          <div className="empty-state">
            <h3>{t('No cohorts yet')}</h3>
            <p>{t('Create your first cohort to start building class lists.')}</p>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>{t('New cohort')}</button>
          </div>
        )}

        {cohorts && cohorts.length > 0 && (
          <div className="cohort-grid">
            {cohorts.map((c) => {
              // Status is inferred from solve history: never solved = Draft.
              const solved = !!c.last_solve_at;
              const tint = cohortTint(c.id);
              const studentCount = c.student_count ?? 0;
              return (
                <article key={c.id} className={`cohort-card${solved ? '' : ' empty'}`}>
                  <div className="cohort-card-top">
                    <div className="cohort-icon" style={{ background: tint.bg, color: tint.fg }}><PersonIcon size={22} /></div>
                    <span className={`status-pill ${solved ? 'active' : 'draft'}`}>{solved ? t('Active') : t('Draft')}</span>
                    <CardMenu onEdit={() => setEditing(c)} onDelete={() => setDeleting(c)} />
                  </div>
                  <div>
                    <h2 className="cohort-name">{c.name}</h2>
                    <div className="cohort-sub">
                      {studentCount === 1 ? t('{n} student', { n: studentCount }) : t('{n} students', { n: studentCount })} · {c.num_classes === 1 ? t('{n} class', { n: c.num_classes }) : t('{n} classes', { n: c.num_classes })}
                      {c.year ? ` · ${c.year}` : ''}
                    </div>
                  </div>
                  {solved ? (
                    <div className="cohort-solved">
                      {t('Last solved')} <strong title={new Date(c.last_solve_at!).toLocaleString(getLocale())}>{timeAgo(c.last_solve_at!)}</strong>
                    </div>
                  ) : (
                    <div className="cohort-empty-note">
                      <strong>{t('No solves yet')}</strong>
                      <span>{t('Add constraints and run your first solve.')}</span>
                    </div>
                  )}
                  <Link to={`/cohorts/${c.id}`} className={`btn ${solved ? 'btn-primary' : 'btn-secondary'} cohort-open`}>
                    {t('Open')} →
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreate={(c) => { setShowCreate(false); navigate(`/cohorts/${c.id}`); }}
        />
      )}

      {editing && <EditModal cohort={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteModal cohort={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}
