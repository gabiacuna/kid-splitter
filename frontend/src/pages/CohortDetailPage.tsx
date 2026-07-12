import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { Cohort, Student } from '../lib/types';
import Nav from '../components/Nav';
import StudentListTab from './StudentListTab';
import ConstraintEditorTab from './ConstraintEditorTab';
import SolutionsTab from './SolutionsTab';
import { useToast } from '../components/Toast';

type Tab = 'students' | 'constraints' | 'solutions';

function InlineEdit({ value, onSave, type = 'text', placeholder }: { value: string; onSave: (v: string) => Promise<void>; type?: string; placeholder?: string }) {
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
      <span
        className="inline-edit-display"
        onClick={() => { setVal(value); setEditing(true); }}
        title="Click to edit"
      >
        {value || <span style={{ color: 'var(--text3)' }}>{placeholder ?? 'Click to edit'}</span>}
        {saving && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2, marginLeft: 6 }} />}
      </span>
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
      style={{ fontSize: 'inherit', fontWeight: 'inherit', letterSpacing: 'inherit', padding: '2px 8px', minWidth: 160 }}
    />
  );
}

function DeleteModal({ cohort, onClose }: { cohort: Cohort; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.delete(`/cohorts/${cohort.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cohorts'] });
      navigate('/cohorts');
    },
    onError: () => setError('Failed to delete cohort. Try again.'),
  });

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 className="modal-title">Delete {cohort.name}?</h2>
        <p style={{ fontSize: 13.5, color: 'var(--text2)', marginTop: 8 }}>
          This will permanently remove all students, constraints, and solutions. This cannot be undone.
        </p>
        {error && <p className="form-error" style={{ marginTop: 12 }}>{error}</p>}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</button>
          <button className="btn btn-danger" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Deleting…' : 'Delete cohort'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CohortDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showDelete, setShowDelete] = useState(false);

  const tab = (searchParams.get('tab') as Tab) || 'students';
  function setTab(t: Tab) { setSearchParams({ tab: t }); }

  const { data: cohort, isLoading, isError } = useQuery<Cohort>({
    queryKey: ['cohort', id],
    queryFn: () => api.get(`/cohorts/${id}`).then((r) => r.data),
    retry: false,
  });

  const { data: students = [] } = useQuery<Student[]>({
    queryKey: ['students', id],
    queryFn: () => api.get(`/cohorts/${id}/students`).then((r) => r.data),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <>
        <Nav />
        <div className="full-page-spinner"><div className="spinner spinner-lg" /></div>
      </>
    );
  }

  if (isError || !cohort) {
    navigate('/cohorts');
    return null;
  }

  async function saveName(name: string) {
    if (!name.trim()) return;
    try {
      const updated = await api.put(`/cohorts/${id}`, { name: name.trim() }).then((r) => r.data);
      qc.setQueryData(['cohort', id], updated);
      qc.invalidateQueries({ queryKey: ['cohorts'] });
    } catch {
      showToast('Failed to save. Try again.', 'error');
    }
  }

  async function saveYear(yearStr: string) {
    try {
      const year = yearStr ? parseInt(yearStr) : null;
      const updated = await api.put(`/cohorts/${id}`, { year }).then((r) => r.data);
      qc.setQueryData(['cohort', id], updated);
    } catch {
      showToast('Failed to save. Try again.', 'error');
    }
  }

  return (
    <>
      <Nav />
      <div className="page-wrap">
        <div className="page-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <InlineEdit value={cohort.name} onSave={saveName} />
            </h1>
            <div style={{ fontSize: 13, color: 'var(--text3)', display: 'flex', gap: 16 }}>
              <span>Year: <InlineEdit value={cohort.year?.toString() ?? ''} onSave={saveYear} type="number" placeholder="add year" /></span>
              <span>{students.length} students · {cohort.num_classes} classes</span>
            </div>
          </div>
          <button className="btn btn-danger" style={{ fontSize: 13 }} onClick={() => setShowDelete(true)}>
            Delete cohort
          </button>
        </div>

        <div className="tabs">
          {(['students', 'constraints', 'solutions'] as Tab[]).map((t) => (
            <button key={t} className={`tab-btn${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'students' && <StudentListTab cohortId={id!} />}
        {tab === 'constraints' && <ConstraintEditorTab cohortId={id!} />}
        {tab === 'solutions' && <SolutionsTab cohortId={id!} numStudents={students.length} />}
      </div>

      {showDelete && cohort && (
        <DeleteModal cohort={cohort} onClose={() => setShowDelete(false)} />
      )}
    </>
  );
}
