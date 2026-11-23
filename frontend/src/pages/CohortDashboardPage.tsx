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
    onError: () => setServerError('Something went wrong. Try again.'),
  });

  function validate() {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required.';
    const n = parseInt(numClasses);
    if (!numClasses || n < MIN_CLASSES || n > MAX_CLASSES) errs.numClasses = `Between ${MIN_CLASSES} and ${MAX_CLASSES} classes.`;
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
        <h2 className="modal-title">New cohort</h2>
        <p style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 20 }}>
          Create a new class group to start adding students.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-field">
            <label className="form-label">Cohort name *</label>
            <input
              type="text"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Year 3 — 2026"
              disabled={mutation.isPending}
            />
            {errors.name && <span className="form-error">{errors.name}</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-field">
              <label className="form-label">Year (optional)</label>
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
              <label className="form-label">Number of classes *</label>
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
              Prioritize a balanced mix of boys and girls per class
              <span className="checkbox-caption">Added as a soft constraint the solver weighs alongside your other preferences.</span>
            </span>
          </label>
          {serverError && <span className="form-error">{serverError}</span>}
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create cohort'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditModal({ cohort, onClose }: { cohort: Cohort; onClose: () => void }) {
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
    onError: () => setServerError('Something went wrong. Try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    setServerError('');
    mutation.mutate({ name: name.trim(), balance_gender: balanceGender });
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 className="modal-title">Edit cohort</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-field">
            <label className="form-label">Cohort name *</label>
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
              Prioritize a balanced mix of boys and girls per class
              <span className="checkbox-caption">Added as a soft constraint the solver weighs alongside your other preferences.</span>
            </span>
          </label>
          {serverError && <span className="form-error">{serverError}</span>}
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteModal({ cohort, onClose }: { cohort: Cohort; onClose: () => void }) {
  const [serverError, setServerError] = useState('');
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.delete(`/cohorts/${cohort.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cohorts'] });
      onClose();
    },
    onError: () => setServerError('Something went wrong. Try again.'),
  });

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 className="modal-title">Delete cohort</h2>
        <p style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 20 }}>
          Delete <strong>{cohort.name}</strong>? This permanently removes its students,
          constraints, and solutions. This can’t be undone.
        </p>
        {serverError && <span className="form-error">{serverError}</span>}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CardMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
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
        aria-label="Cohort options"
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="card-menu-dropdown">
          <button type="button" className="card-menu-item" onClick={() => { setOpen(false); onEdit(); }}>
            Edit
          </button>
          <button type="button" className="card-menu-item danger" onClick={() => { setOpen(false); onDelete(); }}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export default function CohortDashboardPage() {
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
            <h1 className="page-title">Your cohorts</h1>
            <p className="page-subtitle">Pick a cohort to manage students and class placements.</p>
          </div>
          <button className="btn btn-primary btn-icon" onClick={() => setShowCreate(true)}>
            <PlusIcon /> New cohort
          </button>
        </div>

        {isLoading && (
          <div className="cohort-grid">
            {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {isError && (
          <div className="warn-banner">Failed to load cohorts. Refresh to try again.</div>
        )}

        {cohorts && cohorts.length === 0 && (
          <div className="empty-state">
            <h3>No cohorts yet</h3>
            <p>Create your first cohort to start building class lists.</p>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>New cohort</button>
          </div>
        )}

        {cohorts && cohorts.length > 0 && (
          <div className="cohort-grid">
            {cohorts.map((c) => {
              // Status is inferred from solve history: never solved = Draft.
              const solved = !!c.last_solve_at;
              const tint = cohortTint(c.id);
              return (
                <article key={c.id} className={`cohort-card${solved ? '' : ' empty'}`}>
                  <div className="cohort-card-top">
                    <div className="cohort-icon" style={{ background: tint.bg, color: tint.fg }}><PersonIcon size={22} /></div>
                    <span className={`status-pill ${solved ? 'active' : 'draft'}`}>{solved ? 'Active' : 'Draft'}</span>
                    <CardMenu onEdit={() => setEditing(c)} onDelete={() => setDeleting(c)} />
                  </div>
                  <div>
                    <h2 className="cohort-name">{c.name}</h2>
                    <div className="cohort-sub">
                      {c.student_count ?? 0} {c.student_count === 1 ? 'student' : 'students'} · {c.num_classes} classes
                      {c.year ? ` · ${c.year}` : ''}
                    </div>
                  </div>
                  {solved ? (
                    <div className="cohort-solved">
                      Last solved <strong title={new Date(c.last_solve_at!).toLocaleString()}>{timeAgo(c.last_solve_at!)}</strong>
                    </div>
                  ) : (
                    <div className="cohort-empty-note">
                      <strong>No solves yet</strong>
                      <span>Add constraints and run your first solve.</span>
                    </div>
                  )}
                  <Link to={`/cohorts/${c.id}`} className={`btn ${solved ? 'btn-primary' : 'btn-secondary'} cohort-open`}>
                    Open →
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
