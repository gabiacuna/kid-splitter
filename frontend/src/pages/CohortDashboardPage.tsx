import { useState, useEffect, useRef, useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { Cohort } from '../lib/types';
import Nav from '../components/Nav';
import { MIN_CLASSES, MAX_CLASSES } from '../lib/classes';
import { timeAgo } from '../lib/timeAgo';
import { cohortTint } from '../lib/cohortTint';
import { PersonIcon, PlusIcon } from '../components/Icons';
import { useT, getLocale, translate } from '../i18n';
import Modal from '../components/Modal';
import ErrorState from '../components/ErrorState';
import HelpTip from '../components/HelpTip';
import { httpStatus, isNetworkError, loadErrorMessage } from '../lib/errors';

const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

/** Server error → one specific sentence where the status code allows it. */
function saveErrorMessage(err: unknown): string {
  if (isNetworkError(err)) return translate('We can’t reach the server. Check your connection.');
  const status = httpStatus(err);
  if (status === 422) return translate('Some fields aren’t valid. Check them and try again.');
  if (status === 403 || status === 404) return translate('This cohort no longer exists. Reload the page.');
  return translate('Something went wrong. Try again.');
}

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
  const id = useId();
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
    onError: (err) => setServerError(saveErrorMessage(err)),
  });

  function validate() {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t('Name is required.');
    const n = parseInt(numClasses);
    if (!numClasses || n < MIN_CLASSES || n > MAX_CLASSES) errs.numClasses = t('Between {min} and {max} classes.', { min: MIN_CLASSES, max: MAX_CLASSES });
    if (year) {
      const y = Number(year);
      if (!Number.isInteger(y) || y < YEAR_MIN || y > YEAR_MAX) errs.year = t('Enter a year between {min} and {max}.', { min: YEAR_MIN, max: YEAR_MAX });
    }
    return errs;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setServerError('');
    mutation.mutate({ name: name.trim(), year: year ? parseInt(year) : undefined, num_classes: parseInt(numClasses), balance_gender: balanceGender });
  }

  const dirty = !!name || !!year || numClasses !== '3' || balanceGender;

  return (
    <Modal title={t('New cohort')} onClose={onClose} dirty={dirty} busy={mutation.isPending} describedBy={`${id}-desc`}>
      <p id={`${id}-desc`} style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 20 }}>
        {t('Create a new class group to start adding students.')}
      </p>
      <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-field">
          <label className="form-label" htmlFor={`${id}-name`}>{t('Cohort name *')}</label>
          <input
            id={`${id}-name`}
            type="text"
            maxLength={100}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder={t('Year 3 — 2026')}
            disabled={mutation.isPending}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? `${id}-name-err` : undefined}
          />
          {errors.name && <span id={`${id}-name-err`} className="form-error">{errors.name}</span>}
        </div>
        <div className="form-grid-2">
          <div className="form-field">
            <label className="form-label" htmlFor={`${id}-year`}>{t('Year (optional)')}</label>
            <input
              id={`${id}-year`}
              type="number"
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2026"
              min={YEAR_MIN}
              max={YEAR_MAX}
              disabled={mutation.isPending}
              aria-invalid={!!errors.year}
              aria-describedby={errors.year ? `${id}-year-err` : undefined}
            />
            {errors.year && <span id={`${id}-year-err`} className="form-error">{errors.year}</span>}
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor={`${id}-classes`}>
              {t('Number of classes *')}
              <HelpTip text={t('Between 2 and 4 classes. You can change it when you generate the lists.')} />
            </label>
            <input
              id={`${id}-classes`}
              type="number"
              value={numClasses}
              onChange={(e) => setNumClasses(e.target.value)}
              min={MIN_CLASSES}
              max={MAX_CLASSES}
              disabled={mutation.isPending}
              aria-invalid={!!errors.numClasses}
              aria-describedby={errors.numClasses ? `${id}-classes-err` : undefined}
            />
            {errors.numClasses && <span id={`${id}-classes-err`} className="form-error">{errors.numClasses}</span>}
          </div>
        </div>
        <GenderBalanceField id={`${id}-gender`} checked={balanceGender} onChange={setBalanceGender} disabled={mutation.isPending} />
        {serverError && <span className="form-error" role="alert">{serverError}</span>}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? t('Creating…') : t('Create cohort')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function GenderBalanceField({ id, checked, onChange, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  const t = useT();
  return (
    <div className="checkbox-field">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} aria-describedby={`${id}-cap`} />
      <span>
        <label htmlFor={id}>{t('Prioritize a balanced mix of boys and girls per class')}</label>
        <HelpTip text={t('Only a tie-breaker: it never breaks a preference. Students without a gender are placed freely.')} />
        <span id={`${id}-cap`} className="checkbox-caption">{t('Added as a soft constraint the solver weighs alongside your other preferences.')}</span>
      </span>
    </div>
  );
}

function EditModal({ cohort, onClose }: { cohort: Cohort; onClose: () => void }) {
  const t = useT();
  const id = useId();
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
    onError: (err) => setServerError(saveErrorMessage(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError(t('Name is required.')); return; }
    setServerError('');
    mutation.mutate({ name: name.trim(), balance_gender: balanceGender });
  }

  const dirty = name !== cohort.name || balanceGender !== cohort.balance_gender;

  return (
    <Modal title={t('Edit cohort')} onClose={onClose} dirty={dirty} busy={mutation.isPending}>
      <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-field">
          <label className="form-label" htmlFor={`${id}-name`}>{t('Cohort name *')}</label>
          <input
            id={`${id}-name`}
            type="text"
            maxLength={100}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            disabled={mutation.isPending}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-name-err` : undefined}
          />
          {error && <span id={`${id}-name-err`} className="form-error">{error}</span>}
        </div>
        <GenderBalanceField id={`${id}-gender`} checked={balanceGender} onChange={setBalanceGender} disabled={mutation.isPending} />
        {serverError && <span className="form-error" role="alert">{serverError}</span>}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? t('Saving…') : t('Save')}
          </button>
        </div>
      </form>
    </Modal>
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
    onError: (err) => setServerError(saveErrorMessage(err)),
  });

  return (
    <Modal title={t('Delete cohort')} onClose={onClose} busy={mutation.isPending}>
      <p style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 20 }}>
        {deletePrefix}<strong>{cohort.name}</strong>{deleteSuffix} {t('This permanently removes its students, constraints, and solutions. This can’t be undone.')}
      </p>
      {serverError && <span className="form-error" role="alert">{serverError}</span>}
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>
          {t('Cancel')}
        </button>
        <button type="button" className="btn btn-danger" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? t('Deleting…') : t('Delete')}
        </button>
      </div>
    </Modal>
  );
}

function CardMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const t = useT();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) btnRef.current?.focus();
  }

  function onMenuKey(e: React.KeyboardEvent) {
    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === 'Tab') close(false);
  }

  return (
    <div className="card-menu" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className="card-menu-btn"
        aria-label={t('Cohort options')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
      >
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <div className="card-menu-dropdown" role="menu" id={menuId} aria-label={t('Cohort options')} onKeyDown={onMenuKey}>
          <button ref={(el) => { itemRefs.current[0] = el; }} type="button" role="menuitem" className="card-menu-item" onClick={() => { close(false); onEdit(); }}>
            {t('Edit')}
          </button>
          <button ref={(el) => { itemRefs.current[1] = el; }} type="button" role="menuitem" className="card-menu-item danger" onClick={() => { close(false); onDelete(); }}>
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

  const { data: cohorts, isLoading, isError, error, refetch, isRefetching } = useQuery<Cohort[]>({
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
          <ErrorState message={loadErrorMessage(error, 'We couldn’t load your cohorts.')} onRetry={() => refetch()} retrying={isRefetching} />
        )}

        {cohorts && cohorts.length === 0 && (
          <div className="empty-state">
            <h3>{t('No cohorts yet')}</h3>
            <p>{t('A cohort is one grade or year group you want to split into classes, e.g. “Year 3 — 2026”.')}</p>
            <p>{t('Create one, then add its students. Preferences are optional.')}</p>
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
                    <span className="status-wrap">
                      <span className={`status-pill ${solved ? 'active' : 'draft'}`}>{solved ? t('Active') : t('Draft')}</span>
                      <HelpTip text={t('Active: it already has class lists. Draft: no class lists yet.')} />
                    </span>
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
