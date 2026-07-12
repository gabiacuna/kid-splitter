import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { BinaryConstraint, UnaryConstraint, Student, Contradiction } from '../lib/types';
import { useToast } from '../components/Toast';

type NewBinary = Omit<BinaryConstraint, 'id'> & { id?: string };
type NewUnary = Omit<UnaryConstraint, 'id'> & { id?: string };

function StudentSelect({ value, onChange, students, exclude }: { value: string; onChange: (v: string) => void; students: Student[]; exclude?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }}>
      <option value="">Select student…</option>
      {students.filter((s) => s.id !== exclude).map((s) => (
        <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
      ))}
    </select>
  );
}

function WeightSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="weight-slider-wrap">
      <span className="weight-label">Low</span>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="weight-label">High</span>
    </div>
  );
}

function BinaryRow({
  constraint,
  students,
  isNew,
  contradictionIds,
  onSaved,
  onDeleted,
  cohortId,
}: {
  constraint: NewBinary;
  students: Student[];
  isNew: boolean;
  contradictionIds: Set<string>;
  onSaved: () => void;
  onDeleted: () => void;
  cohortId: string;
}) {
  const [c, setC] = useState(constraint);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const qc = useQueryClient();
  const { showToast } = useToast();

  const isContradiction = c.id && contradictionIds.has(c.id);
  const isDirty = JSON.stringify(c) !== JSON.stringify(constraint);

  async function handleSave() {
    if (!c.student_a_id || !c.student_b_id) { setError('Select both students.'); return; }
    if (c.student_a_id === c.student_b_id) { setError('Select two different students.'); return; }
    setError('');
    setSaving(true);
    try {
      if (isNew || !c.id) {
        await api.post(`/cohorts/${cohortId}/constraints/binary`, c);
      } else {
        await api.put(`/constraints/binary/${c.id}`, c);
      }
      qc.invalidateQueries({ queryKey: ['constraints', cohortId] });
      onSaved();
    } catch {
      setError('Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!c.id) { onDeleted(); return; }
    setSaving(true);
    try {
      await api.delete(`/constraints/binary/${c.id}`);
      qc.invalidateQueries({ queryKey: ['constraints', cohortId] });
      onDeleted();
    } catch {
      showToast('Failed to delete. Try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`constraint-row binary${isContradiction ? ' contradiction' : ''}`}>
      <StudentSelect value={c.student_a_id} onChange={(v) => setC((p) => ({ ...p, student_a_id: v }))} students={students} exclude={c.student_b_id} />
      <select value={c.type} onChange={(e) => setC((p) => ({ ...p, type: e.target.value as BinaryConstraint['type'] }))}>
        <option value="together">Together</option>
        <option value="separate">Separate</option>
      </select>
      <StudentSelect value={c.student_b_id} onChange={(v) => setC((p) => ({ ...p, student_b_id: v }))} students={students} exclude={c.student_a_id} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={c.is_hard} onChange={(e) => setC((p) => ({ ...p, is_hard: e.target.checked }))} />
        Hard
      </label>
      {!c.is_hard && <WeightSlider value={c.weight} onChange={(v) => setC((p) => ({ ...p, weight: v }))} />}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {(isNew || !c.id) ? (
          <>
            <button className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 12.5 }} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={onDeleted}>×</button>
          </>
        ) : confirmDel ? (
          <>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>Remove?</span>
            <button className="btn btn-danger" style={{ padding: '4px 8px', fontSize: 12 }} onClick={handleDelete} disabled={saving}>Yes</button>
            <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setConfirmDel(false)}>No</button>
          </>
        ) : (
          <>
            {isDirty && (
              <button className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 12.5 }} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            <button
              style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 18, cursor: 'pointer', padding: '4px' }}
              title="Delete"
              onClick={() => setConfirmDel(true)}
            >🗑</button>
          </>
        )}
      </div>
      {error && <span className="form-error" style={{ gridColumn: '1 / -1' }}>{error}</span>}
    </div>
  );
}

function UnaryRow({
  constraint,
  students,
  isNew,
  contradictionIds,
  onSaved,
  onDeleted,
  cohortId,
}: {
  constraint: NewUnary;
  students: Student[];
  isNew: boolean;
  contradictionIds: Set<string>;
  onSaved: () => void;
  onDeleted: () => void;
  cohortId: string;
}) {
  const [c, setC] = useState(constraint);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const qc = useQueryClient();
  const { showToast } = useToast();

  const isContradiction = c.id && contradictionIds.has(c.id);
  const needsParam = c.type === 'max_flagged_peers' || c.type === 'max_conflict_peers';
  const isDirty = JSON.stringify(c) !== JSON.stringify(constraint);

  async function handleSave() {
    if (!c.student_id) { setError('Select a student.'); return; }
    setError('');
    setSaving(true);
    try {
      if (isNew || !c.id) {
        await api.post(`/cohorts/${cohortId}/constraints/unary`, c);
      } else {
        await api.put(`/constraints/unary/${c.id}`, c);
      }
      qc.invalidateQueries({ queryKey: ['constraints', cohortId] });
      onSaved();
    } catch {
      setError('Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!c.id) { onDeleted(); return; }
    setSaving(true);
    try {
      await api.delete(`/constraints/unary/${c.id}`);
      qc.invalidateQueries({ queryKey: ['constraints', cohortId] });
      onDeleted();
    } catch {
      showToast('Failed to delete. Try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`constraint-row unary${isContradiction ? ' contradiction' : ''}`}>
      <StudentSelect value={c.student_id} onChange={(v) => setC((p) => ({ ...p, student_id: v }))} students={students} />
      <select value={c.type} onChange={(e) => setC((p) => ({ ...p, type: e.target.value as UnaryConstraint['type'] }))}>
        <option value="small_class">Small class</option>
        <option value="large_class">Large class</option>
        <option value="max_flagged_peers">Max flagged peers</option>
        <option value="max_conflict_peers">Max conflict peers</option>
      </select>
      {needsParam ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>Max</span>
          <input
            type="number"
            min={0}
            value={c.parameter ?? ''}
            onChange={(e) => setC((p) => ({ ...p, parameter: parseInt(e.target.value) || 0 }))}
            style={{ width: 60 }}
          />
          <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>in class</span>
        </div>
      ) : <div />}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={c.is_hard} onChange={(e) => setC((p) => ({ ...p, is_hard: e.target.checked }))} />
        Hard
      </label>
      {!c.is_hard && <WeightSlider value={c.weight} onChange={(v) => setC((p) => ({ ...p, weight: v }))} />}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {(isNew || !c.id) ? (
          <>
            <button className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 12.5 }} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={onDeleted}>×</button>
          </>
        ) : confirmDel ? (
          <>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>Remove?</span>
            <button className="btn btn-danger" style={{ padding: '4px 8px', fontSize: 12 }} onClick={handleDelete} disabled={saving}>Yes</button>
            <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setConfirmDel(false)}>No</button>
          </>
        ) : (
          <>
            {isDirty && (
              <button className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 12.5 }} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            <button
              style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 18, cursor: 'pointer', padding: '4px' }}
              title="Delete"
              onClick={() => setConfirmDel(true)}
            >🗑</button>
          </>
        )}
      </div>
      {error && <span className="form-error" style={{ gridColumn: '1 / -1' }}>{error}</span>}
    </div>
  );
}

let _tempId = 0;

export default function ConstraintEditorTab({ cohortId }: { cohortId: string }) {
  const qc = useQueryClient();

  const { data: constraintData, isLoading: cLoading } = useQuery<{ binary: BinaryConstraint[]; unary: UnaryConstraint[] }>({
    queryKey: ['constraints', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/constraints`).then((r) => r.data),
  });

  const { data: students = [] } = useQuery<Student[]>({
    queryKey: ['students', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/students`).then((r) => r.data),
  });

  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [newBinary, setNewBinary] = useState<NewBinary[]>([]);
  const [newUnary, setNewUnary] = useState<NewUnary[]>([]);

  async function validate() {
    try {
      const res = await api.get(`/cohorts/${cohortId}/constraints/validate`);
      setContradictions(res.data?.contradictions ?? []);
    } catch {
      // stale — keep previous
    }
  }

  useEffect(() => {
    if (constraintData) validate();
  }, [constraintData]);

  function addBinary() {
    setNewBinary((prev) => [...prev, { student_a_id: '', student_b_id: '', type: 'together', is_hard: false, weight: 1.0, _tempId: --_tempId } as NewBinary & { _tempId: number }]);
  }

  function addUnary() {
    setNewUnary((prev) => [...prev, { student_id: '', type: 'small_class', is_hard: false, weight: 1.0, _tempId: --_tempId } as NewUnary & { _tempId: number }]);
  }

  const contradictionIds = new Set(contradictions.flatMap((c) => c.student_ids));

  const binary = constraintData?.binary ?? [];
  const unary = constraintData?.unary ?? [];
  const noStudents = students.length === 0;

  if (cLoading) return <div><div className="spinner" /></div>;

  return (
    <div>
      {noStudents && (
        <div className="warn-banner" style={{ marginBottom: 20 }}>
          Add students before creating constraints.
        </div>
      )}

      {contradictions.length > 0 && (
        <div className="contradiction-panel">
          <h4>Solve disabled — {contradictions.length} contradiction{contradictions.length > 1 ? 's' : ''} found</h4>
          <ul>
            {contradictions.map((c, i) => <li key={i}>{c.message}</li>)}
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>Binary constraints</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" style={{ fontSize: 12.5, padding: '6px 14px' }} onClick={validate}>
            Validate now
          </button>
          <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '6px 14px' }} onClick={addBinary} disabled={noStudents}>
            + Add binary
          </button>
        </div>
      </div>

      {binary.length === 0 && newBinary.length === 0 && (
        <p style={{ color: 'var(--text3)', fontSize: 13.5, marginBottom: 20 }}>No binary constraints yet.</p>
      )}
      {binary.map((c) => (
        <BinaryRow
          key={c.id}
          constraint={c}
          students={students}
          isNew={false}
          contradictionIds={contradictionIds}
          cohortId={cohortId}
          onSaved={validate}
          onDeleted={() => { qc.invalidateQueries({ queryKey: ['constraints', cohortId] }); validate(); }}
        />
      ))}
      {newBinary.map((c, i) => (
        <BinaryRow
          key={(c as { _tempId?: number })._tempId ?? i}
          constraint={c}
          students={students}
          isNew={true}
          contradictionIds={contradictionIds}
          cohortId={cohortId}
          onSaved={() => { setNewBinary((prev) => prev.filter((_, idx) => idx !== i)); qc.invalidateQueries({ queryKey: ['constraints', cohortId] }); validate(); }}
          onDeleted={() => setNewBinary((prev) => prev.filter((_, idx) => idx !== i))}
        />
      ))}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, marginTop: 32 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>Unary constraints</h3>
        <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '6px 14px' }} onClick={addUnary} disabled={noStudents}>
          + Add unary
        </button>
      </div>

      {unary.length === 0 && newUnary.length === 0 && (
        <p style={{ color: 'var(--text3)', fontSize: 13.5 }}>No unary constraints yet.</p>
      )}
      {unary.map((c) => (
        <UnaryRow
          key={c.id}
          constraint={c}
          students={students}
          isNew={false}
          contradictionIds={contradictionIds}
          cohortId={cohortId}
          onSaved={validate}
          onDeleted={() => { qc.invalidateQueries({ queryKey: ['constraints', cohortId] }); validate(); }}
        />
      ))}
      {newUnary.map((c, i) => (
        <UnaryRow
          key={(c as { _tempId?: number })._tempId ?? i}
          constraint={c}
          students={students}
          isNew={true}
          contradictionIds={contradictionIds}
          cohortId={cohortId}
          onSaved={() => { setNewUnary((prev) => prev.filter((_, idx) => idx !== i)); qc.invalidateQueries({ queryKey: ['constraints', cohortId] }); validate(); }}
          onDeleted={() => setNewUnary((prev) => prev.filter((_, idx) => idx !== i))}
        />
      ))}
    </div>
  );
}
