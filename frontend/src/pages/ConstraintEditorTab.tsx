import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { BinaryConstraint, UnaryConstraint, Student, ConflictGroup, ValidationResult } from '../lib/types';
import { useToast } from '../components/Toast';
import { TrashIcon } from '../components/Icons';
import { validationKey } from '../lib/queryKeys';
import { shortNames } from '../lib/roster';
import { useT } from '../i18n';
import HelpTip from '../components/HelpTip';
import TypeChip from '../components/TypeChip';
import ErrorState from '../components/ErrorState';
import { loadErrorMessage } from '../lib/errors';

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
  const t = useT();
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
        onError(typeof detail === 'string' ? detail : t('Couldn’t save this rule. Check it and try again.'));
        tracker.end(false);
      }
    });
  }, [isComplete, onError, tracker, t]);

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
  const t = useT();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{t('Select student…')}</option>
      {students.filter((s) => s.id !== exclude).map((s) => (
        <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
      ))}
    </select>
  );
}

function WeightSlider({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const t = useT();
  const v = Math.round(Math.min(10, Math.max(1, value)));
  return (
    <div className={`weight-slider-wrap${disabled ? ' is-disabled' : ''}`} title={disabled ? t('Hard rules always apply — weight is ignored') : undefined}>
      <input
        type="range" min={1} max={10} step={1} value={v} disabled={disabled}
        aria-label={t('Weight (1–10)')}
        onChange={(e) => onChange(parseInt(e.target.value))}
      />
      <span className="weight-value" aria-hidden>{v}</span>
    </div>
  );
}

function HardCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const t = useT();
  return (
    <label className="hard-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={t('Hard rule (must always hold)')} />
      <span className="mobile-only">{t('Hard')}</span>
    </label>
  );
}

function DeleteControl({ onDelete, busy }: { onDelete: () => void; busy: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const t = useT();
  if (confirm) {
    return (
      <div className="delete-confirm">
        <span>{t('Remove?')}</span>
        <button type="button" className="btn btn-danger btn-sm" onClick={onDelete} disabled={busy}>{t('Yes')}</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm(false)}>{t('No')}</button>
      </div>
    );
  }
  return (
    <button type="button" className="icon-button danger" aria-label={t('Delete rule')} title={t('Delete rule')} onClick={() => setConfirm(true)}>
      <TrashIcon />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type Kind = 'binary' | 'unary';
type ConstraintCache = { binary: BinaryConstraint[]; unary: UnaryConstraint[] };

const needsTagParam = (type: UnaryConstraint['type']) => type === 'max_flagged_peers' || type === 'max_conflict_peers';

const isBinaryComplete = (v: BinaryDraft) => !!v.student_a_id && !!v.student_b_id && v.student_a_id !== v.student_b_id;
const binaryBody = (v: BinaryDraft) => ({
  student_a_id: v.student_a_id, student_b_id: v.student_b_id, type: v.type, is_hard: v.is_hard, weight: v.weight,
});
const isUnaryComplete = (v: UnaryDraft) =>
  !!v.student_id && (!needsTagParam(v.type) || (!!v.tag && /^[a-zA-Z0-9_-]+$/.test(v.tag) && v.parameter != null && v.parameter >= 0));
const unaryBody = (v: UnaryDraft) => ({
  student_id: v.student_id, type: v.type, is_hard: v.is_hard, weight: v.weight,
  tag: needsTagParam(v.type) ? v.tag : null, parameter: needsTagParam(v.type) ? v.parameter : null,
});

/** State, autosave and delete for one editable rule row; only the JSX differs per kind. */
function useConstraintRow<T extends { id?: string }>(
  kind: Kind, draft: T, cohortId: string,
  isComplete: (v: T) => boolean, toBody: (v: T) => object, onRemoved: () => void,
  onCreated?: (id: string) => void,
) {
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const [c, setC] = useState(draft);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();
  const { showToast } = useToast();
  const tracker = useContext(SaveTrackerContext);
  const t = useT();

  const persist = useCallback(async (v: T, id?: string) => {
    const res = id
      ? await api.put<{ id: string }>(`/constraints/${kind}/${id}`, toBody(v))
      : await api.post<{ id: string }>(`/cohorts/${cohortId}/constraints/${kind}`, toBody(v));
    // Write the saved rule into the cache right away. Rows are snapshotted from this cache when
    // the tab mounts, so a stale copy (before the post-save refetch lands) would bring back old
    // values on remount, and the next edit to that row would save them over the teacher's change.
    const saved = res.data as { id: string };
    qc.setQueryData<ConstraintCache>(['constraints', cohortId], (old) => {
      if (!old) return old;
      const list = old[kind] as { id: string }[];
      const next = list.some((x) => x.id === saved.id)
        ? list.map((x) => (x.id === saved.id ? saved : x))
        : [...list, saved];
      return { ...old, [kind]: next };
    });
    // A new rule's id only exists here; the editor needs it to badge and group the row.
    if (!id) onCreatedRef.current?.(saved.id);
    return saved.id;
  }, [kind, cohortId, toBody, qc]);
  const { schedule, idRef, settle } = useRowAutosave(draft.id, isComplete, persist, setError);

  function update(patch: Partial<T>) {
    setC((prev) => { const next = { ...prev, ...patch }; schedule(next); return next; });
  }

  async function handleDelete() {
    await settle();
    const id = idRef.current;
    if (!id) { onRemoved(); return; }
    setDeleting(true);
    tracker.begin();
    try {
      await api.delete(`/constraints/${kind}/${id}`);
      qc.setQueryData<ConstraintCache>(['constraints', cohortId],
        (old) => old && { ...old, [kind]: (old[kind] as { id: string }[]).filter((x) => x.id !== id) });
      onRemoved();
      tracker.end(true);
    } catch {
      showToast(t('Failed to delete. Try again.'), 'error');
      setDeleting(false);
      tracker.end(false);
    }
  }

  return { c, update, error, deleting, handleDelete, incomplete: !idRef.current && !isComplete(c) };
}

interface RowProps<T> {
  rowKey: string; draft: T; students: Student[]; cohortId: string; onRemoved: (key: string) => void;
  onCreated?: (key: string, id: string) => void;
}

// Memoised: a CSV import can create hundreds of rows, each with a full student list.
const BinaryRow = memo(function BinaryRow({ rowKey, draft, students, cohortId, badgeId, badgeSeverity, onRemoved, onCreated }:
  RowProps<BinaryDraft> & { badgeId?: number; badgeSeverity?: 'hard' | 'soft' }) {
  const { c, update, error, deleting, handleDelete, incomplete } =
    useConstraintRow('binary', draft, cohortId, isBinaryComplete, binaryBody, () => onRemoved(rowKey), (id) => onCreated?.(rowKey, id));
  const t = useT();
  return (
    <div className={`constraint-row binary${badgeId ? ` conflict conflict-${badgeSeverity}` : ''}${incomplete ? ' incomplete' : ''}`}>
      {badgeId && <span className="conflict-badge" aria-label={t('Conflict {n}', { n: badgeId })}>{badgeId}</span>}
      <StudentSelect label={t('Student A')} value={c.student_a_id} onChange={(v) => update({ student_a_id: v })} students={students} exclude={c.student_b_id} />
      <StudentSelect label={t('Student B')} value={c.student_b_id} onChange={(v) => update({ student_b_id: v })} students={students} exclude={c.student_a_id} />
      <TypeChip<BinaryConstraint['type']>
        value={c.type} label={t('Type')}
        options={[{ value: 'together', label: t('Together') }, { value: 'separate', label: t('Separate') }]}
        onChange={(v) => update({ type: v })}
      />
      <HardCheckbox checked={c.is_hard} onChange={(v) => update({ is_hard: v })} />
      <WeightSlider value={c.weight} onChange={(v) => update({ weight: v })} disabled={c.is_hard} />
      <DeleteControl onDelete={handleDelete} busy={deleting} />
      {incomplete && <span className="row-hint">{t('Choose both students — the rule saves once it’s complete.')}</span>}
      {error && <span className="form-error row-hint">{error}</span>}
    </div>
  );
});

const UnaryRow = memo(function UnaryRow({ rowKey, draft, students, cohortId, onRemoved }: RowProps<UnaryDraft>) {
  const { c, update, error, deleting, handleDelete, incomplete } =
    useConstraintRow('unary', draft, cohortId, isUnaryComplete, unaryBody, () => onRemoved(rowKey));
  const needsParam = needsTagParam(c.type);
  const t = useT();
  const UNARY_LABELS: Record<UnaryConstraint['type'], string> = {
    small_class: t('Prefers a smaller class'),
    large_class: t('Prefers a larger class'),
    max_flagged_peers: t('Limit classmates with tag'),
    max_conflict_peers: t('Limit conflict-tagged classmates'),
  };
  return (
    <div className={`constraint-row unary${incomplete ? ' incomplete' : ''}`}>
      <StudentSelect label={t('Student')} value={c.student_id} onChange={(v) => update({ student_id: v })} students={students} />
      <select value={c.type} aria-label={t('Rule')} onChange={(e) => update({ type: e.target.value as UnaryConstraint['type'] })}>
        {Object.entries(UNARY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {needsParam ? (
        <div className="unary-params">
          <input
            type="text" placeholder={t('tag')} aria-label={t('Tag')} value={c.tag ?? ''} maxLength={30}
            onChange={(e) => update({ tag: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
          />
          <span>{t('max')}</span>
          <input
            type="number" min={0} aria-label={t('Maximum in class')} value={c.parameter ?? ''}
            onChange={(e) => update({ parameter: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value) || 0) })}
          />
        </div>
      ) : <div />}
      <HardCheckbox checked={c.is_hard} onChange={(v) => update({ is_hard: v })} />
      <WeightSlider value={c.weight} onChange={(v) => update({ weight: v })} disabled={c.is_hard} />
      <DeleteControl onDelete={handleDelete} busy={deleting} />
      {incomplete && <span className="row-hint">{needsParam ? t('Choose a student, a tag and a maximum — it saves once complete.') : t('Choose a student — it saves once complete.')}</span>}
      {error && <span className="form-error row-hint">{error}</span>}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Conflict banner
// ---------------------------------------------------------------------------

function ConflictBanner({ groups, binary, students }: { groups: ConflictGroup[]; binary: BinaryConstraint[]; students: Student[] }) {
  const [open, setOpen] = useState(false);
  const hard = groups.filter((g) => g.severity === 'hard');
  const soft = groups.filter((g) => g.severity === 'soft');
  const byId = new Map(binary.map((b) => [b.id, b]));
  const short = useMemo(() => shortNames(students), [students]);
  const name = (id: string) => short.get(id) ?? '?';
  const t = useT();
  const tip = hard.length > 0
    ? t('Two required rules can’t both be met. Fix it before generating the lists.')
    : t('The lists will have to leave out some preference.');
  const title = hard.length > 0
    ? (hard.length === 1
      ? t('{n} contradiction found — resolve before solving.', { n: hard.length })
      : t('{n} contradictions found — resolve before solving.', { n: hard.length }))
    : (soft.length === 1
      ? t('{n} preference conflict — the solver will have to break some preferences.', { n: soft.length })
      : t('{n} preference conflicts — the solver will have to break some preferences.', { n: soft.length }));

  return (
    <div className={`conflict-banner${hard.length ? '' : ' soft'}`} role="status">
      <div className="conflict-banner-head">
        <span aria-hidden>⚠</span>
        <span className="conflict-banner-title">{title}<HelpTip text={tip} /></span>
        <button type="button" className="conflict-why" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? t('Hide') : t('Why?')}
        </button>
      </div>
      {open && (
        <div className="conflict-banner-body">
          {groups.map((g) => {
            const rules = g.constraint_ids.map((id) => byId.get(id)).filter(Boolean) as BinaryConstraint[];
            return (
              <div key={g.id} className="conflict-group">
                <p><span className={`conflict-num ${g.severity}`}>{g.id}</span> {explainConflict(g, name, t)}</p>
                <div className="conflict-chips">
                  {rules.slice(0, MAX_CHIPS).map((r) => (
                    <span key={r.id} className="conflict-chip">
                      <span className={`conflict-num ${g.severity}`}>{g.id}</span>
                      {name(r.student_a_id)} + {name(r.student_b_id)} — {r.type === 'together' ? t('Together') : t('Separate')}
                      {r.is_hard ? ` ${t('(hard)')}` : ''}
                    </span>
                  ))}
                  {rules.length > MAX_CHIPS && <span className="conflict-chip more">{t('+{n} more', { n: rules.length - MAX_CHIPS })}</span>}
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

export default function ConstraintEditorTab({ cohortId, onGoToSolutions }: { cohortId: string; onGoToSolutions?: () => void }) {
  const qc = useQueryClient();
  const t = useT();

  const { data: constraintData, isLoading, isError, error, refetch, isRefetching } = useQuery<{ binary: BinaryConstraint[]; unary: UnaryConstraint[] }>({
    queryKey: ['constraints', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/constraints`).then((r) => r.data),
  });
  const { data: students = [], isError: studentsFailed, error: studentsError, refetch: refetchStudents, isRefetching: refetchingStudents } = useQuery<Student[]>({
    queryKey: ['students', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/students`).then((r) => r.data),
  });
  const { data: validation, isError: validationFailed, refetch: refetchValidation, isRefetching: refetchingValidation } = useQuery<ValidationResult>({
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

  const removeBinary = useCallback((key: string) => setBinaryRows((rows) => rows!.filter((x) => x.key !== key)), []);
  const binaryCreated = useCallback((key: string, id: string) => setBinaryRows((rows) => rows!.map((x) => (
    x.key === key && x.value.id !== id ? { ...x, value: { ...x.value, id } } : x
  ))), []);
  const removeUnary = useCallback((key: string) => setUnaryRows((rows) => rows!.filter((x) => x.key !== key)), []);

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

  // A load error used to leave the spinner going forever.
  if (isError && !constraintData) {
    return <ErrorState message={loadErrorMessage(error, 'We couldn’t load the preferences.')} onRetry={() => refetch()} retrying={isRefetching} />;
  }
  if (studentsFailed) {
    return <ErrorState message={loadErrorMessage(studentsError, 'We couldn’t load the students.')} onRetry={() => refetchStudents()} retrying={refetchingStudents} />;
  }
  if (isLoading || binaryRows === null || unaryRows === null) return <div><div className="spinner" /></div>;

  const noStudentsReasonId = `no-students-${cohortId}`;

  return (
    <SaveTrackerContext.Provider value={tracker}>
      <div className="constraint-editor">
        {noStudents && <div className="warn-banner" style={{ marginBottom: 20 }}>{t('Add students before creating constraints.')}</div>}
        {validationFailed && (
          <ErrorState compact message={t('We couldn’t check your rules for contradictions.')} onRetry={() => refetchValidation()} retrying={refetchingValidation} />
        )}

        <div className="constraint-toolbar">
          <span className="constraint-count">
            {binaryRows.length === 1 ? t('{n} rule', { n: binaryRows.length }) : t('{n} rules', { n: binaryRows.length })}
          </span>
          <span className={`save-status ${saveState}`} aria-live="polite">
            {saveState === 'saving' && t('Saving…')}
            {saveState === 'saved' && t('All changes saved')}
            {saveState === 'error' && t('Some changes couldn’t be saved')}
          </span>
        </div>

        {groups.length > 0 && <ConflictBanner groups={groups} binary={constraintData?.binary ?? []} students={students} />}

        {binaryRows.length === 0 && !noStudents && (
          <div className="empty-state constraints-empty">
            <h3>{t('No preferences yet')}</h3>
            <p>{t('They’re optional: you can generate class lists without them.')}</p>
            <p>{t('Add one when two students should share a class, or be kept apart.')}</p>
            {onGoToSolutions && (
              <button type="button" className="btn btn-secondary" onClick={onGoToSolutions}>{t('Go to class lists →')}</button>
            )}
          </div>
        )}
        {binaryRows.length > 0 && (
          <div className="constraint-header">
            <span>{t('Student A')}</span><span>{t('Student B')}</span>
            <span>{t('Type')}<HelpTip text={t('Together: same class. Separate: different classes.')} /></span>
            <span>{t('Hard')}<HelpTip text={t('Always met; if that’s impossible, no lists are generated.')} /></span>
            <span>{t('Weight')}<HelpTip text={t('How much it matters compared with the others (1 a little, 10 a lot).')} /></span>
            <span />
          </div>
        )}
        {/* One flat keyed list (section heads + rows as siblings), so a row that moves between
            sections is re-ordered, not re-mounted, and keeps its unsaved state. */}
        {groupedRows(binaryRows, groups, badgeFor).map((item) => {
          if (item.kind === 'head') {
            return (
              <div key={item.key} className={`rules-section-head${item.severity ? ` conflict-${item.severity}` : ''}`} role="heading" aria-level={3}>
                <span>{item.label === 'rest' ? t('Other rules ({n})', { n: item.n }) : t('Conflict {n}', { n: item.n })}</span>
              </div>
            );
          }
          const r = item.row;
          const badge = r.value.id ? badgeFor.get(r.value.id) : undefined;
          return (
            <BinaryRow
              key={r.key}
              rowKey={r.key}
              draft={r.value}
              students={students}
              cohortId={cohortId}
              badgeId={badge?.id}
              badgeSeverity={badge?.severity}
              onRemoved={removeBinary}
              onCreated={binaryCreated}
            />
          );
        })}
        <button type="button" className="add-constraint" onClick={addBinary} disabled={noStudents} aria-describedby={noStudents ? noStudentsReasonId : undefined}>
          {t('+ Add constraint')}
        </button>
        {noStudents && <p id={noStudentsReasonId} className="disabled-reason">{t('Add students before creating constraints.')}</p>}

        <details className="advanced-constraints" open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
          <summary>
            {unaryCount > 0
              ? t('Advanced: class-size and tag limits ({n})', { n: unaryCount })
              : t('Advanced: class-size and tag limits')}
          </summary>
          <p className="advanced-hint">{t('Rules about a single student — e.g. a smaller class, or at most N classmates with a given tag.')}</p>
          {unaryRows.map((r) => (
            <UnaryRow
              key={r.key}
              rowKey={r.key}
              draft={r.value}
              students={students}
              cohortId={cohortId}
              onRemoved={removeUnary}
            />
          ))}
          <button type="button" className="add-constraint" onClick={addUnary} disabled={noStudents} aria-describedby={noStudents ? noStudentsReasonId : undefined}>
            {t('+ Add advanced rule')}
          </button>
        </details>
      </div>
    </SaveTrackerContext.Provider>
  );
}

const MAX_NAMES_IN_TEXT = 5;

/** "Ana, Beto y Cris" / "Ana, Beto, … y 3 más", in the current language. */
function nameList(ids: string[], name: (id: string) => string, t: ReturnType<typeof useT>): string {
  const labels = ids.map(name).sort((x, y) => x.localeCompare(y));
  if (labels.length > MAX_NAMES_IN_TEXT) {
    return t('{names} and {n} more', { names: labels.slice(0, MAX_NAMES_IN_TEXT).join(', '), n: labels.length - MAX_NAMES_IN_TEXT });
  }
  if (labels.length <= 1) return labels.join('');
  return t('{names} and {last}', { names: labels.slice(0, -1).join(', '), last: labels[labels.length - 1] });
}

/** Builds the "Why?" sentence from the conflict's type and params, so it follows the UI language.
 *  Falls back to the backend's English text if params are missing (older API). */
function explainConflict(g: ConflictGroup, name: (id: string) => string, t: ReturnType<typeof useT>): string {
  const p = g.params ?? {};
  switch (g.type) {
    case 'direct_conflict':
      if (p.a && p.b) return t('{a} and {b} must be together, but must also be apart. Remove one of these two rules.', { a: name(p.a), b: name(p.b) });
      break;
    case 'chain_conflict':
      if (p.a && p.b && p.path) return t('{a} and {b} must be apart, but “must be together” rules link them ({path}), so they would land in the same class. Remove one of these rules.', { a: name(p.a), b: name(p.b), path: p.path.map(name).join(' → ') });
      break;
    case 'cluster_overflow':
      if (p.students && p.max_size) return t('{n} students are linked by “must be together” rules ({names}), but a class holds at most {max}. Remove one of these rules or add a class.', { n: p.students.length, names: nameList(p.students, name, t), max: p.max_size });
      break;
    case 'coloring_impossible':
      if (p.students && p.rules && p.classes) return t('These {n} “must be apart” rules (between {names}) need more than {k} classes, and you have {k}. No single rule is to blame: add a class, or remove one of these rules.', { n: p.rules, names: nameList(p.students, name, t), k: p.classes });
      break;
    case 'soft_warning':
      if (p.a && p.mid && p.c) return t('{a} and {b} prefer to be together, and so do {b} and {c}, but {a} and {c} prefer to be apart. The lists will have to leave out one of these preferences.', { a: name(p.a), b: name(p.mid), c: name(p.c) });
      break;
  }
  return g.explanation;
}

type RowItem =
  | { kind: 'head'; key: string; label: 'conflict' | 'rest'; n: number; severity?: 'hard' | 'soft' }
  | { kind: 'row'; key: string; row: Draft<BinaryDraft> };

/**
 * Rules in a conflict go first, under one heading per conflict (hard ones first, as the
 * validator numbers them), then the rest in their usual order. A rule in several conflicts
 * sits in the lowest-numbered one, matching its badge. Without conflicts: no headings at all.
 */
function groupedRows(
  rows: Draft<BinaryDraft>[],
  groups: ConflictGroup[],
  badgeFor: Map<string, { id: number; severity: 'hard' | 'soft' }>,
): RowItem[] {
  const byGroup = new Map<number, Draft<BinaryDraft>[]>();
  const rest: Draft<BinaryDraft>[] = [];
  for (const r of rows) {
    const badge = r.value.id ? badgeFor.get(r.value.id) : undefined;
    if (!badge) { rest.push(r); continue; }
    const list = byGroup.get(badge.id) ?? [];
    list.push(r);
    byGroup.set(badge.id, list);
  }
  if (byGroup.size === 0) return rows.map((row) => ({ kind: 'row', key: row.key, row }));

  const items: RowItem[] = [];
  for (const g of groups) {
    const list = byGroup.get(g.id);
    if (!list) continue;
    items.push({ kind: 'head', key: `head-conflict-${g.id}`, label: 'conflict', n: g.id, severity: g.severity });
    for (const row of list) items.push({ kind: 'row', key: row.key, row });
  }
  if (rest.length) {
    items.push({ kind: 'head', key: 'head-rest', label: 'rest', n: rest.length });
    for (const row of rest) items.push({ kind: 'row', key: row.key, row });
  }
  return items;
}
