import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { BinaryConstraint, Cohort, Solution, Student, UnaryConstraint } from '../lib/types';
import Nav from '../components/Nav';
import StudentListTab from './StudentListTab';
import ConstraintEditorTab from './ConstraintEditorTab';
import SolutionsTab from './SolutionsTab';
import { useToast } from '../components/Toast';
import { useT } from '../i18n';
import Modal from '../components/Modal';
import ErrorState from '../components/ErrorState';
import { httpStatus, loadErrorMessage } from '../lib/errors';

type Tab = 'students' | 'constraints' | 'solutions';

function InlineEdit({ value, onSave, type = 'text', placeholder, label }: { value: string; onSave: (v: string) => Promise<void>; type?: string; placeholder?: string; label?: string }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const [saving, setSaving] = useState(false);

  async function commit() {
    if (!val.trim() && type === 'text') { setVal(value); setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(val);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="inline-edit-display"
        onClick={() => { setVal(value); setEditing(true); }}
        title={t('Click to edit')}
        aria-label={label ? `${label}: ${value || placeholder || ''}. ${t('Click to edit')}` : undefined}
      >
        {value || <span style={{ color: 'var(--text3)' }}>{placeholder ?? t('Click to edit')}</span>}
        {saving && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2, marginLeft: 6 }} />}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type={type}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setVal(value); setEditing(false); }
      }}
      onBlur={commit}
      aria-label={label}
      style={{ fontSize: 'inherit', fontWeight: 'inherit', letterSpacing: 'inherit', padding: '2px 8px', minWidth: 160 }}
    />
  );
}

function DeleteModal({ cohort, onClose }: { cohort: Cohort; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.delete(`/cohorts/${cohort.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cohorts'] });
      navigate('/cohorts');
    },
    onError: () => setError(t('Failed to delete cohort. Try again.')),
  });

  return (
    <Modal title={t('Delete {name}?', { name: cohort.name })} onClose={onClose} busy={mutation.isPending}>
      <p style={{ fontSize: 13.5, color: 'var(--text2)', marginTop: 8 }}>
        {t('This will permanently remove all students, constraints, and solutions. This cannot be undone.')}
      </p>
      {error && <p className="form-error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>{t('Cancel')}</button>
        <button className="btn btn-danger" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? t('Deleting…') : t('Delete cohort')}
        </button>
      </div>
    </Modal>
  );
}

type StepState = 'done' | 'todo' | 'optional';

/** Alumnos → Preferencias (opcional) → Listas, ticked from the cohort's data; each step opens its tab. */
function CohortSteps({ tab, setTab, students, rules, lists }: {
  tab: Tab; setTab: (t: Tab) => void; students: number; rules: number; lists: number;
}) {
  const t = useT();
  const steps: { key: Tab; label: string; hint: string; state: StepState }[] = [
    { key: 'students', label: t('Students'), hint: t('Add or import your students'), state: students > 0 ? 'done' : 'todo' },
    { key: 'constraints', label: t('Preferences'), hint: t('Optional'), state: rules > 0 ? 'done' : 'optional' },
    { key: 'solutions', label: t('Class lists'), hint: t('Generate and choose'), state: lists > 0 ? 'done' : 'todo' },
  ];
  return (
    <nav className="cohort-steps" aria-label={t('Steps')}>
      <ol>
        {steps.map((s, i) => (
          <li key={s.key} className={`cohort-step ${s.state}${tab === s.key ? ' current' : ''}`}>
            <button type="button" onClick={() => setTab(s.key)} aria-current={tab === s.key ? 'step' : undefined}>
              <span className="cohort-step-num" aria-hidden>{s.state === 'done' ? '✓' : i + 1}</span>
              <span className="cohort-step-text">
                <span className="cohort-step-label">{s.label}</span>
                <span className="cohort-step-hint">
                  {s.state === 'done' ? t('Done') : s.hint}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default function CohortDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showDelete, setShowDelete] = useState(false);

  const rawTab = searchParams.get('tab');
  const tab: Tab = rawTab === 'constraints' || rawTab === 'solutions' ? rawTab : 'students';
  function setTab(t: Tab) { setSearchParams({ tab: t }); }

  const { data: cohort, isLoading, isError, error, refetch, isRefetching } = useQuery<Cohort>({
    queryKey: ['cohort', id],
    queryFn: () => api.get(`/cohorts/${id}`).then((r) => r.data),
    retry: false,
  });

  const { data: students = [] } = useQuery<Student[]>({
    queryKey: ['students', id],
    queryFn: () => api.get(`/cohorts/${id}/students`).then((r) => r.data),
    enabled: !!id && !!cohort,
  });
  // Same keys as the tabs, so the step indicator costs no extra requests once a tab has loaded.
  const { data: rules } = useQuery<{ binary: BinaryConstraint[]; unary: UnaryConstraint[] }>({
    queryKey: ['constraints', id],
    queryFn: () => api.get(`/cohorts/${id}/constraints`).then((r) => r.data),
    enabled: !!id && !!cohort,
  });
  const { data: solutions } = useQuery<Solution[]>({
    queryKey: ['solutions', id],
    queryFn: () => api.get(`/cohorts/${id}/solutions`).then((r) => r.data),
    enabled: !!id && !!cohort,
  });

  // Only "it's gone / not yours" sends the teacher back; anything else gets a retry.
  const status = httpStatus(error);
  const gone = isError && (status === 403 || status === 404);
  useEffect(() => {
    if (!gone) return;
    showToast(t('That cohort doesn’t exist or was deleted.'), 'error');
    navigate('/cohorts', { replace: true });
  }, [gone, navigate, showToast, t]);

  if (isLoading || gone) {
    return (
      <>
        <Nav />
        <div className="full-page-spinner"><div className="spinner spinner-lg" /></div>
      </>
    );
  }

  if (isError || !cohort) {
    return (
      <>
        <Nav />
        <div className="page-wrap" style={{ paddingTop: 28 }}>
          <ErrorState message={loadErrorMessage(error, 'We couldn’t load this cohort.')} onRetry={() => refetch()} retrying={isRefetching} />
        </div>
      </>
    );
  }

  async function saveName(name: string) {
    if (!name.trim()) return;
    try {
      const updated = await api.put(`/cohorts/${id}`, { name: name.trim() }).then((r) => r.data);
      qc.setQueryData(['cohort', id], updated);
      qc.invalidateQueries({ queryKey: ['cohorts'] });
    } catch {
      showToast(t('Failed to save. Try again.'), 'error');
    }
  }

  async function saveYear(yearStr: string) {
    const year = yearStr ? Number(yearStr) : null;
    if (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) {
      showToast(t('Enter a year between {min} and {max}.', { min: 2000, max: 2100 }), 'error');
      return;
    }
    try {
      const updated = await api.put(`/cohorts/${id}`, { year }).then((r) => r.data);
      qc.setQueryData(['cohort', id], updated);
    } catch {
      showToast(t('Failed to save. Try again.'), 'error');
    }
  }

  const n = students.length;
  const numClasses = cohort.num_classes;

  return (
    <>
      <Nav />
      <div className="page-wrap">
        <div className="page-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <InlineEdit value={cohort.name} onSave={saveName} label={t('Cohort name')} />
            </h1>
            <div style={{ fontSize: 13, color: 'var(--text3)', display: 'flex', gap: 16 }}>
              <span>{t('Year:')} <InlineEdit value={cohort.year?.toString() ?? ''} onSave={saveYear} type="number" placeholder={t('add year')} label={t('Year')} /></span>
              <span>
                {n === 1 ? t('{n} student', { n }) : t('{n} students', { n })} · {numClasses === 1 ? t('{n} class', { n: numClasses }) : t('{n} classes', { n: numClasses })}
              </span>
            </div>
          </div>
          <button className="btn btn-danger" style={{ fontSize: 13 }} onClick={() => setShowDelete(true)}>
            {t('Delete cohort')}
          </button>
        </div>

        <CohortSteps
          tab={tab}
          setTab={setTab}
          students={n}
          rules={(rules?.binary.length ?? 0) + (rules?.unary.length ?? 0)}
          lists={solutions?.length ?? 0}
        />

        {tab === 'students' && <StudentListTab cohortId={id!} balanceGender={cohort.balance_gender} />}
        {tab === 'constraints' && <ConstraintEditorTab cohortId={id!} onGoToSolutions={() => setTab('solutions')} />}
        {tab === 'solutions' && <SolutionsTab cohortId={id!} numStudents={students.length} numClasses={cohort.num_classes} />}
      </div>

      {showDelete && cohort && (
        <DeleteModal cohort={cohort} onClose={() => setShowDelete(false)} />
      )}
    </>
  );
}
