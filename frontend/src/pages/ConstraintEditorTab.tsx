import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { BinaryConstraint, UnaryConstraint, Student, ConflictGroup, ValidationResult } from '../lib/types';
import { useToast } from '../components/Toast';
import { TrashIcon } from '../components/Icons';
import { validationKey } from '../lib/queryKeys';

/*
 * Constraint editor (design features 04 + 05).
 *
 * Autosave: every field change is debounced (~500ms) and saved; writes for one row are
 * serialised so they land in order. New rows live only in the client until complete
 * (both students chosen), then POST once and PUT afterwards. Validation re-runs only
 * after all pending saves settle, so the contradiction banner doesn't strobe mid-drag.
 */

const SAVE_DEBOUNCE_MS = 500;
const MAX_CHIPS = 5;

type BinaryDraft = Omit<BinaryConstraint, 'id'> & { id?: string };
type UnaryDraft = Omit<UnaryConstraint, 'id'> & { id?: string };
interface Draft<T> { key: string; value: T }


// ---------------------------------------------------------------------------
// Save tracking: page-level "Saving… / Saved" + revalidate when everything settles
// ---------------------------------------------------------------------------

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
interface SaveTracker { begin: () => void; end: (ok: boolean) => void }
const SaveTrackerContext = createContext<SaveTracker>({ begin: () => {}, end: () => {} });

function useSaveTracker(onSettled: () => void): [SaveState, SaveTracker] {
  const pending = useRef(0);
  const failed = useRef(false);
  const [state, setState] = useState<SaveState>('idle');
  const tracker = useMemo<SaveTracker>(() => ({
    begin: () => { pending.current += 1; setState('saving'); },
    end: (ok) => {
      pending.current -= 1;
      if (!ok) failed.current = true;
      if (pending.current === 0) {
        setState(failed.current ? 'error' : 'saved');
        failed.current = false;
        onSettled();
      }
    },
  }), [onSettled]);
  return [state, tracker];
}

/**
 * Debounced, ordered autosave for one row. `persist(value, id)` returns the saved id.
 * Returns `schedule(value)`; flushes a pending save on unmount so nothing is lost.
 */
function useRowAutosave<T>(
  initialId: string | undefined,
  isComplete: (v: T) => boolean,
  persist: (v: T, id: string | undefined) => Promise<string>,
  onError: (msg: string) => void,
) {
  const tracker = useContext(SaveTrackerContext);
  const idRef = useRef(initialId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<T | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const persistRef = useRef(persist);
  persistRef.current = persist;

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const value = latest.current;
    latest.current = null;
    if (value === null || !isComplete(value)) return;
    tracker.begin();
    chain.current = chain.current.then(async () => {
      try {
        idRef.current = await persistRef.current(value, idRef.current);
        onError('');
        tracker.end(true);
      } catch (e) {
        const detail = (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
        onError(typeof detail === 'string' ? detail : 'Couldn’t save this rule. Check it and try again.');
        tracker.end(false);
      }
    });
  }, [isComplete, onError, tracker]);

  const schedule = useCallback((value: T) => {
    latest.current = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  useEffect(() => () => { if (timer.current) flush(); }, [flush]);

  /** Drop any unsent change and wait for in-flight writes (used before deleting). */
  const settle = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    latest.current = null;
    await chain.current;
  }, []);

  return { schedule, idRef, settle };
}

// ---------------------------------------------------------------------------
// Shared controls
// ---------------------------------------------------------------------------

function StudentSelect({ value, onChange, students, exclude, label }: {
  value: string; onChange: (v: string) => void; students: Student[]; exclude?: string; label: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">Select student…</option>
      {students.filter((s) => s.id !== exclude).map((s) => (
        <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
      ))}
    </select>
  );
}

function WeightSlider({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const v = Math.round(Math.min(10, Math.max(1, value)));
  return (
    <div className={`weight-slider-wrap${disabled ? ' is-disabled' : ''}`} title={disabled ? 'Hard rules always apply — weight is ignored' : undefined}>
      <input
        type="range" min={1} max={10} step={1} value={v} disabled={disabled}
        aria-label="Weight (1–10)"
        onChange={(e) => onChange(parseInt(e.target.value))}
      />
      <span className="weight-value" aria-hidden>{v}</span>
    </div>
  );
}

function HardCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="hard-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label="Hard rule (must always hold)" />
      <span className="mobile-only">Hard</span>
    </label>
  );
}

function DeleteControl({ onDelete, busy }: { onDelete: () => void; busy: boolean }) {
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <div className="delete-confirm">
        <span>Remove?</span>
        <button type="button" className="btn btn-danger btn-sm" onClick={onDelete} disabled={busy}>Yes</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm(false)}>No</button>
      </div>
    );
  }
  return (
    <button type="button" className="icon-button danger" aria-label="Delete rule" title="Delete rule" onClick={() => setConfirm(true)}>
      <TrashIcon />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function BinaryRow({ draft, students, cohortId, badge, onRemoved }: {
  draft: BinaryDraft; students: Student[]; cohortId: string;
  badge?: { id: number; severity: 'hard' | 'soft' };
  onRemoved: (id?: string) => void;
}) {
  const [c, setC] = useState(draft);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();
  const { showToast } = useToast();
  const tracker = useContext(SaveTrackerContext);

  const isComplete = useCallback((v: BinaryDraft) => !!v.student_a_id && !!v.student_b_id && v.student_a_id !== v.student_b_id, []);
  const persist = useCallback(async (v: BinaryDraft, id?: string) => {
    const body = { student_a_id: v.student_a_id, student_b_id: v.student_b_id, type: v.type, is_hard: v.is_hard, weight: v.weight };
    const res = id
      ? await api.put<BinaryConstraint>(`/constraints/binary/${id}`, body)
      : await api.post<BinaryConstraint>(`/cohorts/${cohortId}/constraints/binary`, body);
    return res.data.id;
  }, [cohortId]);
  const { schedule, idRef, settle } = useRowAutosave(draft.id, isComplete, persist, setError);

  function update(patch: Partial<BinaryDraft>) {
    setC((prev) => { const next = { ...prev, ...patch }; schedule(next); return next; });
  }

  async function handleDelete() {
    await settle();
    const id = idRef.current;
    if (!id) { onRemoved(); return; }
    setDeleting(true);
    tracker.begin();
    try {
      await api.delete(`/constraints/binary/${id}`);
      qc.setQueryData<{ binary: BinaryConstraint[]; unary: UnaryConstraint[] }>(['constraints', cohortId],
        (old) => old && { ...old, binary: old.binary.filter((x) => x.id !== id) });
      onRemoved(id);
      tracker.end(true);
    } catch {
      showToast('Failed to delete. Try again.', 'error');
      setDeleting(false);
      tracker.end(false);
    }
  }

  const incomplete = !idRef.current && !isComplete(c);
  return (
    <div className={`constraint-row binary${badge ? ` conflict conflict-${badge.severity}` : ''}${incomplete ? ' incomplete' : ''}`}>
      {badge && <span className="conflict-badge" aria-label={`Conflict ${badge.id}`}>{badge.id}</span>}
      <StudentSelect label="Student A" value={c.student_a_id} onChange={(v) => update({ student_a_id: v })} students={students} exclude={c.student_b_id} />
      <StudentSelect label="Student B" value={c.student_b_id} onChange={(v) => update({ student_b_id: v })} students={students} exclude={c.student_a_id} />
      <select
        className={`type-select ${c.type}`} value={c.type} aria-label="Type"
        onChange={(e) => update({ type: e.target.value as BinaryConstraint['type'] })}
      >
        <option value="together">Together</option>
        <option value="separate">Separate</option>
      </select>
      <HardCheckbox checked={c.is_hard} onChange={(v) => update({ is_hard: v })} />
      <WeightSlider value={c.weight} onChange={(v) => update({ weight: v })} disabled={c.is_hard} />
      <DeleteControl onDelete={handleDelete} busy={deleting} />
      {incomplete && <span className="row-hint">Choose both students — the rule saves once it’s complete.</span>}
      {error && <span className="form-error row-hint">{error}</span>}
    </div>
  );
}

const UNARY_LABELS: Record<UnaryConstraint['type'], string> = {
  small_class: 'Prefers a smaller class',
  large_class: 'Prefers a larger class',
  max_flagged_peers: 'Limit classmates with tag',
  max_conflict_peers: 'Limit conflict-tagged classmates',
};

function UnaryRow({ draft, students, cohortId, onRemoved }: {
  draft: UnaryDraft; students: Student[]; cohortId: string; onRemoved: (id?: string) => void;
}) {
  const [c, setC] = useState(draft);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();
  const { showToast } = useToast();
  const tracker = useContext(SaveTrackerContext);
  const needsParam = c.type === 'max_flagged_peers' || c.type === 'max_conflict_peers';

  const isComplete = useCallback((v: UnaryDraft) => {
    if (!v.student_id) return false;
    if (v.type === 'max_flagged_peers' || v.type === 'max_conflict_peers') {
      return !!v.tag && /^[a-zA-Z0-9_-]+$/.test(v.tag) && v.parameter != null && v.parameter >= 0;
    }
    return true;
  }, []);
  const persist = useCallback(async (v: UnaryDraft, id?: string) => {
    const max = v.type === 'max_flagged_peers' || v.type === 'max_conflict_peers';
    const body = {
      student_id: v.student_id, type: v.type, is_hard: v.is_hard, weight: v.weight,
      tag: max ? v.tag : null, parameter: max ? v.parameter : null,
    };
    const res = id
      ? await api.put<UnaryConstraint>(`/constraints/unary/${id}`, body)
      : await api.post<UnaryConstraint>(`/cohorts/${cohortId}/constraints/unary`, body);
    return res.data.id;
  }, [cohortId]);
  const { schedule, idRef, settle } = useRowAutosave(draft.id, isComplete, persist, setError);

  function update(patch: Partial<UnaryDraft>) {
    setC((prev) => { const next = { ...prev, ...patch }; schedule(next); return next; });
  }

  async function handleDelete() {
    await settle();
    const id = idRef.current;
    if (!id) { onRemoved(); return; }
    setDeleting(true);
    tracker.begin();
    try {
      await api.delete(`/constraints/unary/${id}`);
      qc.setQueryData<{ binary: BinaryConstraint[]; unary: UnaryConstraint[] }>(['constraints', cohortId],
        (old) => old && { ...old, unary: old.unary.filter((x) => x.id !== id) });
      onRemoved(id);
      tracker.end(true);
    } catch {
      showToast('Failed to delete. Try again.', 'error');
      setDeleting(false);
      tracker.end(false);
    }
  }

  const incomplete = !idRef.current && !isComplete(c);
  return (
    <div className={`constraint-row unary${incomplete ? ' incomplete' : ''}`}>
      <StudentSelect label="Student" value={c.student_id} onChange={(v) => update({ student_id: v })} students={students} />
      <select value={c.type} aria-label="Rule" onChange={(e) => update({ type: e.target.value as UnaryConstraint['type'] })}>
        {Object.entries(UNARY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {needsParam ? (
        <div className="unary-params">
          <input
            type="text" placeholder="tag" aria-label="Tag" value={c.tag ?? ''} maxLength={30}
            onChange={(e) => update({ tag: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
          />
          <span>max</span>
          <input
            type="number" min={0} aria-label="Maximum in class" value={c.parameter ?? ''}
            onChange={(e) => update({ parameter: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value) || 0) })}
          />
        </div>
      ) : <div />}
      <HardCheckbox checked={c.is_hard} onChange={(v) => update({ is_hard: v })} />
      <WeightSlider value={c.weight} onChange={(v) => update({ weight: v })} disabled={c.is_hard} />
      <DeleteControl onDelete={handleDelete} busy={deleting} />
      {incomplete && <span className="row-hint">{needsParam ? 'Choose a student, a tag and a maximum — it saves once complete.' : 'Choose a student — it saves once complete.'}</span>}
      {error && <span className="form-error row-hint">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflict banner
// ---------------------------------------------------------------------------

function ConflictBanner({ groups, binary, students }: { groups: ConflictGroup[]; binary: BinaryConstraint[]; students: Student[] }) {
  const [open, setOpen] = useState(false);
  const hard = groups.filter((g) => g.severity === 'hard');
  const soft = groups.filter((g) => g.severity === 'soft');
  const byId = new Map(binary.map((b) => [b.id, b]));
  const name = (id: string) => {
    const s = students.find((x) => x.id === id);
    return s ? `${s.first_name} ${s.last_name.charAt(0)}.` : '?';
  };
  const title = hard.length > 0
    ? `${hard.length} contradiction${hard.length > 1 ? 's' : ''} found — resolve before solving.`
    : `${soft.length} preference conflict${soft.length > 1 ? 's' : ''} — the solver will have to break some preferences.`;

  return (
    <div className={`conflict-banner${hard.length ? '' : ' soft'}`} role="status">
      <div className="conflict-banner-head">
        <span aria-hidden>⚠</span>
        <span className="conflict-banner-title">{title}</span>
        <button type="button" className="conflict-why" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Why?'}
        </button>
      </div>
      {open && (
        <div className="conflict-banner-body">
          {groups.map((g) => {
            const rules = g.constraint_ids.map((id) => byId.get(id)).filter(Boolean) as BinaryConstraint[];
            return (
              <div key={g.id} className="conflict-group">
                <p><span className={`conflict-num ${g.severity}`}>{g.id}</span> {g.explanation}</p>
                <div className="conflict-chips">
                  {rules.slice(0, MAX_CHIPS).map((r) => (
                    <span key={r.id} className="conflict-chip">
                      <span className={`conflict-num ${g.severity}`}>{g.id}</span>
                      {name(r.student_a_id)} + {name(r.student_b_id)} — {r.type === 'together' ? 'Together' : 'Separate'}
                      {r.is_hard ? ' (hard)' : ''}
                    </span>
                  ))}
                  {rules.length > MAX_CHIPS && <span className="conflict-chip more">+{rules.length - MAX_CHIPS} more</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

let _tempKey = 0;
const newKey = () => `new-${++_tempKey}`;

export default function ConstraintEditorTab({ cohortId }: { cohortId: string }) {
  const qc = useQueryClient();

  const { data: constraintData, isLoading } = useQuery<{ binary: BinaryConstraint[]; unary: UnaryConstraint[] }>({
    queryKey: ['constraints', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/constraints`).then((r) => r.data),
  });
  const { data: students = [] } = useQuery<Student[]>({
    queryKey: ['students', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/students`).then((r) => r.data),
  });
  const { data: validation } = useQuery<ValidationResult>({
    queryKey: validationKey(cohortId),
    queryFn: () => api.get(`/cohorts/${cohortId}/constraints/validate`).then((r) => r.data),
  });

  // Rows are snapshotted into drafts once, so refetches never clobber what's being edited.
  const [binaryRows, setBinaryRows] = useState<Draft<BinaryDraft>[] | null>(null);
  const [unaryRows, setUnaryRows] = useState<Draft<UnaryDraft>[] | null>(null);
  useEffect(() => {
    if (constraintData && binaryRows === null) {
      setBinaryRows(constraintData.binary.map((b) => ({ key: b.id, value: b })));
      setUnaryRows(constraintData.unary.map((u) => ({ key: u.id, value: u })));
    }
  }, [constraintData, binaryRows]);

  const onSettled = useCallback(() => {
    qc.invalidateQueries({ queryKey: validationKey(cohortId) });
    // Drafts are snapshotted, so a refetch only refreshes banner labels and the Solutions tab.
    qc.invalidateQueries({ queryKey: ['constraints', cohortId] });
  }, [qc, cohortId]);
  const [saveState, tracker] = useSaveTracker(onSettled);

  const groups = validation?.conflict_groups ?? [];
  // A rule can sit in several groups; show the lowest number.
  const badgeFor = new Map<string, { id: number; severity: 'hard' | 'soft' }>();
  for (const g of groups) for (const id of g.constraint_ids) if (!badgeFor.has(id)) badgeFor.set(id, { id: g.id, severity: g.severity });

  const noStudents = students.length === 0;
  const unaryCount = unaryRows?.length ?? 0;
  // Collapsed by default; opens on its own only if the cohort already uses advanced rules.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpened.current && constraintData) {
      autoOpened.current = true;
      if (constraintData.unary.length > 0) setAdvancedOpen(true);
    }
  }, [constraintData]);

  function addBinary() {
    setBinaryRows((rows) => [...(rows ?? []), {
      key: newKey(),
      value: { student_a_id: '', student_b_id: '', type: 'together', is_hard: false, weight: 5 },
    }]);
  }
  function addUnary() {
    setUnaryRows((rows) => [...(rows ?? []), {
      key: newKey(),
      value: { student_id: '', type: 'small_class', is_hard: false, weight: 5 },
    }]);
  }

  if (isLoading || binaryRows === null || unaryRows === null) return <div><div className="spinner" /></div>;

  return (
    <SaveTrackerContext.Provider value={tracker}>
      <div className="constraint-editor">
        {noStudents && <div className="warn-banner" style={{ marginBottom: 20 }}>Add students before creating constraints.</div>}

        <div className="constraint-toolbar">
          <span className="constraint-count">{binaryRows.length} {binaryRows.length === 1 ? 'rule' : 'rules'}</span>
          <span className={`save-status ${saveState}`} aria-live="polite">
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && 'All changes saved'}
            {saveState === 'error' && 'Some changes couldn’t be saved'}
          </span>
        </div>

        {groups.length > 0 && <ConflictBanner groups={groups} binary={constraintData?.binary ?? []} students={students} />}

        {binaryRows.length > 0 && (
          <div className="constraint-header" aria-hidden>
            <span>Student A</span><span>Student B</span><span>Type</span><span>Hard</span><span>Weight</span><span />
          </div>
        )}
        {binaryRows.map((r) => (
          <BinaryRow
            key={r.key}
            draft={r.value}
            students={students}
            cohortId={cohortId}
            badge={r.value.id ? badgeFor.get(r.value.id) : undefined}
            onRemoved={() => setBinaryRows((rows) => rows!.filter((x) => x.key !== r.key))}
          />
        ))}
        <button type="button" className="add-constraint" onClick={addBinary} disabled={noStudents}>
          + Add constraint
        </button>

        <details className="advanced-constraints" open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
          <summary>Advanced: class-size and tag limits{unaryCount > 0 ? ` (${unaryCount})` : ''}</summary>
          <p className="advanced-hint">Rules about a single student — e.g. a smaller class, or at most N classmates with a given tag.</p>
          {unaryRows.map((r) => (
            <UnaryRow
              key={r.key}
              draft={r.value}
              students={students}
              cohortId={cohortId}
              onRemoved={() => setUnaryRows((rows) => rows!.filter((x) => x.key !== r.key))}
            />
          ))}
          <button type="button" className="add-constraint" onClick={addUnary} disabled={noStudents}>
            + Add advanced rule
          </button>
        </details>
      </div>
    </SaveTrackerContext.Provider>
  );
}
