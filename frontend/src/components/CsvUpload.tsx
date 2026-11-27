import { useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { ColumnNote, ImportConfirmResponse, ImportPreviewResponse, NameSplit, PreferenceMatch, Student } from '../lib/types';
import { useToast } from './Toast';
import { genderLabel } from '../lib/gender';
import { useT, getLang, translate } from '../i18n';
import Modal from './Modal';
import HelpTip from './HelpTip';
import { errorCode, errorDetail, httpStatus, isNetworkError } from '../lib/errors';
import {
  type PendingGroup, type PrefState, type RowState,
  display, initialRows, isPending, newRowFromName, normName, pendingGroups, prefsApply,
  revalidateRow, rowKey, splitPreferenceName, statusText,
} from '../lib/importPreview';

// ---------------------------------------------------------------------------
// Status + preference chips
// ---------------------------------------------------------------------------

function StatusBadge({ row }: { row: RowState }) {
  const t = useT();
  const s = row.status;
  const [cls, label] =
    s === 'ok' ? ['badge-sage', t('OK')]
    : s === 'duplicate_exact' ? ['badge-warn', t('Exact copy')]
    : s === 'duplicate_similar' ? ['badge-warn', t('Possible duplicate')]
    : s === 'invalid_tag' ? ['badge-red', t('Invalid tag')]
    : s === 'invalid_gender' ? ['badge-warn', t('Gender unclear')]
    : ['badge-red', t('Missing name')];
  const msg = statusText(row);
  return (
    <div className="import-status">
      <span className={`badge ${cls}`}>{label}</span>
      {msg && <span className="import-status-msg">{msg}</span>}
    </div>
  );
}

/** Matched/chosen vs unmatched must not be told apart by colour alone: ✓ / ? and the label say it too. */
function PreferenceChips({ pref, names, onRemove, onRename }: {
  pref: PrefState;
  names: Map<string, string>;
  onRemove: () => void;
  onRename: (name: string) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(pref.name);

  if (pref.skipped) {
    return <span className="pref-chip skipped">{t('{name} (skipped)', { name: pref.name })}</span>;
  }

  if (pref.chosen.length > 0) {
    return (
      <>
        {pref.chosen.map((k) => (
          <span key={k} className="badge badge-sage pref-chip" title={t('Matched → {name}', { name: names.get(k) ?? k })}>
            <span aria-hidden>✓</span>
            <span className="sr-only">{t('Matched:')}</span> {names.get(k) ?? pref.matched_display ?? pref.name}
            <button type="button" className="pref-chip-remove" aria-label={t('Remove {name}', { name: names.get(k) ?? pref.name })} onClick={onRemove}>
              <span aria-hidden>×</span>
            </button>
          </span>
        ))}
      </>
    );
  }

  if (editing) {
    const commit = () => {
      setEditing(false);
      const name = value.trim();
      if (name && name !== pref.name) onRename(name);
      else setValue(pref.name);
    };
    return (
      <span className="badge badge-warn pref-chip">
        <input
          className="pref-chip-input"
          value={value}
          autoFocus
          aria-label={t('Classmate name')}
          size={Math.max(value.length, 4)}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
            if (e.key === 'Escape') { e.stopPropagation(); setValue(pref.name); setEditing(false); }
          }}
        />
      </span>
    );
  }

  return (
    <span className="badge badge-warn pref-chip">
      <button
        type="button"
        className="pref-chip-text"
        title={t('Could not match "{name}" — click to edit', { name: pref.name })}
        aria-label={t('Not matched yet: {name}. Edit the name', { name: pref.name })}
        onClick={() => { setValue(pref.name); setEditing(true); }}
      >
        <span aria-hidden>?</span> {pref.name}
      </button>
      <button type="button" className="pref-chip-remove" aria-label={t('Remove {name}', { name: pref.name })} onClick={onRemove}>
        <span aria-hidden>×</span>
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Decisions for names that matched nobody or more than one student
// ---------------------------------------------------------------------------

interface GroupActions {
  toggle: (rowIndex: number, prefIndex: number, key: string, on: boolean) => void;
  skip: (rowIndex: number, prefIndex: number) => void;
  applyAll: (g: PendingGroup, key: string, on: boolean) => void;
  skipAll: (g: PendingGroup) => void;
  addNew: (g: PendingGroup, rowIndex?: number, prefIndex?: number) => void;
}

function candidateLabel(c: { display: string; source: string; row_index?: number | null }, dupNames: Set<string>) {
  // Two candidates with the same name: say which is which.
  if (!dupNames.has(normName(c.display))) return c.display;
  return c.source === 'existing'
    ? translate('{name} (already in the cohort)', { name: c.display })
    : translate('{name} (line {line})', { name: c.display, line: (c.row_index ?? 0) + 2 });
}

function DecisionGroup({ g, actions }: { g: PendingGroup; actions: GroupActions }) {
  const t = useT();
  const id = useId();
  const n = g.owners.length;
  const canAdd = !!splitPreferenceName(g.name);
  const alreadyAdded = g.candidates.some((c) => c.source === 'upload' && normName(c.display) === normName(g.name) && g.owners.every((o) => o.ownerKey !== c.key));
  const counts = new Map<string, number>();
  for (const c of g.candidates) counts.set(normName(c.display), (counts.get(normName(c.display)) ?? 0) + 1);
  const dupNames = new Set([...counts].filter(([, v]) => v > 1).map(([k]) => k));
  const decided = g.pending === 0;

  return (
    <div className={`decision-item${decided ? ' decided' : ''}`} role="group" aria-labelledby={`${id}-h`}>
      <p id={`${id}-h`} className="decision-head">
        <strong>“{g.name}”</strong>{' '}
        <span className="decision-meta">
          {n === 1 ? t('{n} student lists it', { n }) : t('{n} students list it', { n })}
          {' · '}
          {g.candidates.length === 0
            ? t('no student has that name')
            : g.status === 'ambiguous'
              ? t('matches: {names}', { names: g.candidates.map((c) => c.display).join(', ') })
              : t('did you mean: {names}', { names: g.candidates.map((c) => c.display).join(', ') })}
        </span>
        {decided && <span className="decision-done">✓ {t('Decided')}</span>}
      </p>

      {n > 1 && (
        <div className="decision-row apply-all">
          <span className="decision-owner">{t('Apply to all:')}</span>
          {g.candidates.map((c) => {
            const eligible = g.owners.filter((o) => o.ownerKey !== c.key);
            const on = eligible.filter((o) => o.pref.chosen.includes(c.key)).length;
            return (
              <label key={c.key} className="decision-check">
                <input
                  type="checkbox"
                  checked={eligible.length > 0 && on === eligible.length}
                  ref={(el) => { if (el) el.indeterminate = on > 0 && on < eligible.length; }}
                  onChange={(e) => actions.applyAll(g, c.key, e.target.checked)}
                />
                {candidateLabel(c, dupNames)}
              </label>
            );
          })}
          {canAdd && !alreadyAdded && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => actions.addNew(g)}>
              {t('+ Add “{name}” as a new student', { name: g.name })}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.skipAll(g)}>{t('Skip all')}</button>
        </div>
      )}

      <ul className="decision-owners">
        {g.owners.map((o) => (
          <li key={`${o.rowIndex}-${o.prefIndex}`} className="decision-row">
            <span className="decision-owner">{n > 1 ? o.ownerName : t('{name} wants to be with:', { name: o.ownerName })}</span>
            {g.candidates.filter((c) => c.key !== o.ownerKey).map((c) => (
              <label key={c.key} className="decision-check">
                <input
                  type="checkbox"
                  checked={o.pref.chosen.includes(c.key)}
                  onChange={(e) => actions.toggle(o.rowIndex, o.prefIndex, c.key, e.target.checked)}
                />
                {candidateLabel(c, dupNames)}
              </label>
            ))}
            <button
              type="button"
              className={`btn btn-ghost btn-sm${o.pref.skipped ? ' active' : ''}`}
              aria-pressed={o.pref.skipped}
              onClick={() => actions.skip(o.rowIndex, o.prefIndex)}
            >
              {o.pref.skipped ? t('Skipped') : t('Skip')}
            </button>
            {n === 1 && !alreadyAdded && (canAdd ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => actions.addNew(g, o.rowIndex, o.prefIndex)}>
                {t('+ Add “{name}” as a new student', { name: g.name })}
              </button>
            ) : (
              <span className="disabled-reason inline">{t('Can’t add as a new student: it needs a first and last name. Edit the name in the table.')}</span>
            ))}
          </li>
        ))}
      </ul>
      {n > 1 && !canAdd && (
        <p className="disabled-reason">{t('Can’t add as a new student: it needs a first and last name. Edit the name in the table.')}</p>
      )}
    </div>
  );
}

function PendingNamesPanel({ groups, pendingCount, actions, onSkipEverything }: {
  groups: PendingGroup[];
  pendingCount: number;
  actions: GroupActions;
  onSkipEverything: () => void;
}) {
  const t = useT();
  return (
    <section className="decision-panel" aria-label={t('Pairing names that need a decision')}>
      <div className="decision-panel-head">
        <strong>
          {pendingCount === 0
            ? t('All classmate names are decided')
            : pendingCount === 1
              ? t('{n} pairing name needs your decision', { n: pendingCount })
              : t('{n} pairing names need your decision', { n: pendingCount })}
          <HelpTip text={t('Tick everyone the student meant (you can tick several: each becomes a “together” preference), skip the name, or add it as a new student.')} />
        </strong>
        {pendingCount > 0 && <button type="button" className="link-button" onClick={onSkipEverything}>{t('Skip all')}</button>}
      </div>
      <div className="decision-list">
        {groups.map((g) => <DecisionGroup key={g.key} g={g} actions={actions} />)}
      </div>
    </section>
  );
}

function ColumnNotes({ notes }: { notes: ColumnNote[] }) {
  const t = useT();
  if (notes.length === 0) return null;
  const text = (n: ColumnNote) => {
    const p = n.params ?? {};
    switch (n.code) {
      case 'tags': return t('added as tags: {examples}', { examples: p.examples ?? '' });
      case 'empty': return t('ignored — {detail}', { detail: t('the column is empty') });
      case 'numbers_only': return t('ignored — {detail}', { detail: t('numbers only (looks like a list number)') });
      case 'unique_values': return t('ignored — {detail}', { detail: t('every row has a different value (looks like an ID)') });
      case 'too_many_values': return t('ignored — {detail}', { detail: t('too many different values ({n}) to use as tags', { n: p.count ?? '' }) });
      default: return n.action === 'tags' ? n.detail : t('ignored — {detail}', { detail: n.detail });
    }
  };
  return (
    <ul className="column-notes">
      {notes.map((n) => (
        <li key={n.column}>{t('Column')} <strong>{n.column}</strong>: {text(n)}</li>
      ))}
    </ul>
  );
}

function NameSplitNote({ split, onFlip, edited, busy }: { split: NameSplit; onFlip: () => void; edited: boolean; busy: boolean }) {
  const t = useT();
  return (
    <div className="name-split-note">
      <p>
        {t('Names come from one column, “{column}”. We read “{full}” as first name “{first}” and last name “{last}”.', {
          column: split.column, full: split.example_full, first: split.example_first, last: split.example_last,
        })}
      </p>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onFlip} disabled={busy}>
        {split.order === 'surname_first' ? t('Names are written first name first') : t('Names are written surname first')}
      </button>
      {edited && <span className="form-hint">{t('Re-reading the file discards the edits you made in this preview.')}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview modal
// ---------------------------------------------------------------------------

interface ImportSummary {
  students: number;
  constraints: number;
  notImported: string[];
  existingUpdated: { display: string; constraints_created: number }[];
  skipped: { owner: string; target: string; reason: string }[];
}

function PreviewModal({
  cohortId, preview, onClose, onDone, onReupload, reuploading,
}: {
  cohortId: string;
  preview: ImportPreviewResponse;
  onClose: () => void;
  onDone: (s: ImportSummary) => void;
  onReupload: (order: NameSplit['order']) => void;
  reuploading: boolean;
}) {
  const t = useT();
  const descId = useId();
  const [rows, setRows] = useState<RowState[]>(() => initialRows(preview.rows));
  const [edited, setEdited] = useState(false);
  const qc = useQueryClient();
  const { showToast } = useToast();
  // The cohort's students when the preview opened: used to re-check edited names for duplicates.
  const [existing] = useState<Student[]>(() => qc.getQueryData<Student[]>(['students', cohortId]) ?? []);

  /** Key → name, for chips and the summary. */
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of existing) m.set(s.id, display(s));
    for (const r of rows) m.set(rowKey(r.row_index), display(r));
    for (const r of rows) for (const p of r.prefs) for (const c of p.suggestions ?? []) if (!m.has(c.key)) m.set(c.key, c.display);
    return m;
  }, [rows, existing]);

  const groups = pendingGroups(rows);
  const pendingCount = groups.reduce((n, g) => n + (g.pending > 0 ? 1 : 0), 0);
  const included = rows.filter((r) => r.include);
  const validCount = included.length;
  const hasPreferences = rows.some((r) => r.prefs.length > 0);
  const hasGender = rows.some((r) => r.gender || r.genderUnclear);
  const unclearGenderCount = rows.filter((r) => r.include && r.genderUnclear).length;
  const skippedErrors = rows.filter((r) => r.status === 'missing_name' || r.status === 'invalid_tag').length;
  const exactCount = rows.filter((r) => r.status === 'duplicate_exact').length;
  const similarCount = rows.filter((r) => r.status === 'duplicate_similar').length;

  function patchPref(rowIndex: number, prefIndex: number, f: (p: PrefState) => PrefState) {
    setRows((prev) => prev.map((r, i) => i !== rowIndex ? r : { ...r, prefs: r.prefs.map((p, j) => j === prefIndex ? f(p) : p) }));
  }

  const actions: GroupActions = {
    toggle: (ri, pi, key, on) => patchPref(ri, pi, (p) => ({
      ...p, skipped: false, chosen: on ? [...new Set([...p.chosen, key])] : p.chosen.filter((k) => k !== key),
    })),
    skip: (ri, pi) => patchPref(ri, pi, (p) => (p.skipped ? { ...p, skipped: false } : { ...p, skipped: true, chosen: [] })),
    applyAll: (g, key, on) => {
      for (const o of g.owners) {
        if (o.ownerKey === key) continue;
        actions.toggle(o.rowIndex, o.prefIndex, key, on);
      }
    },
    skipAll: (g) => {
      for (const o of g.owners) patchPref(o.rowIndex, o.prefIndex, (p) => ({ ...p, skipped: true, chosen: [] }));
    },
    addNew: (g, ri, pi) => {
      setRows((prev) => {
        const row = newRowFromName(g.name, prev, g.key);
        if (!row) return prev;
        const key = rowKey(row.row_index);
        const targets = ri === undefined ? g.owners : g.owners.filter((o) => o.rowIndex === ri && o.prefIndex === pi);
        const next = prev.map((r, i) => {
          const mine = targets.filter((o) => o.rowIndex === i);
          if (mine.length === 0) return r;
          return { ...r, prefs: r.prefs.map((p, j) => mine.some((o) => o.prefIndex === j) ? { ...p, skipped: false, chosen: [...new Set([...p.chosen, key])] } : p) };
        });
        return [...next, row];
      });
    },
  };

  function skipEverything() {
    setRows((prev) => prev.map((r) => ({ ...r, prefs: r.prefs.map((p) => (isPending(p) ? { ...p, skipped: true } : p)) })));
  }

  function updateName(index: number, field: 'first_name' | 'last_name', value: string) {
    setEdited(true);
    setRows((prev) => {
      const next = prev.map((r, i) => (i === index ? { ...r, [field]: value } : r));
      next[index] = revalidateRow(next[index], next, existing);
      return next;
    });
  }

  function setInclude(index: number, include: boolean) {
    setEdited(true);
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, include } : r)));
  }

  function removePreference(rowIndex: number, prefIndex: number) {
    setEdited(true);
    patchPref(rowIndex, prefIndex, (p) => ({ ...p, skipped: true, chosen: [] }));
  }

  async function rematchPreference(rowIndex: number, prefIndex: number, name: string) {
    setEdited(true);
    const rosterRows = rows.map((r) => ({ row_index: r.row_index, first_name: r.first_name, last_name: r.last_name, importable: r.include }));
    const apply = (m: PreferenceMatch) => patchPref(rowIndex, prefIndex, () => ({
      ...m, chosen: m.status === 'matched' && m.matched_key ? [m.matched_key] : [], skipped: false,
    }));
    try {
      const { data } = await api.post<PreferenceMatch>(
        `/cohorts/${cohortId}/students/import/rematch`,
        { name, self_row_index: rows[rowIndex].row_index, rows: rosterRows },
      );
      apply(data);
    } catch {
      apply({ name, status: 'unresolved', matched_display: null, suggestions: [] });
    }
  }

  const confirmMutation = useMutation({
    mutationFn: () => {
      const keysOf = (r: RowState) => [...new Set(r.prefs.filter((p) => !p.skipped).flatMap((p) => p.chosen))];
      const students = included.map((r) => ({
        row_index: r.row_index,
        first_name: r.first_name.trim(),
        last_name: r.last_name.trim(),
        tags: r.tags,
        gender: r.gender ?? null,
        preference_keys: keysOf(r),
      }));
      // An exact copy of a cohort student that lists new classmates: add them to that student.
      const existing_preferences = rows
        .filter((r) => !r.include && r.status === 'duplicate_exact' && r.existing_student_id && keysOf(r).length > 0)
        .map((r) => ({ student_id: r.existing_student_id!, preference_keys: keysOf(r) }));
      return api
        .post<ImportConfirmResponse>(`/cohorts/${cohortId}/students/import/confirm`, { students, existing_preferences })
        .then((r) => r.data);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['students', cohortId] });
      qc.invalidateQueries({ queryKey: ['cohorts'] });
      qc.invalidateQueries({ queryKey: ['constraints', cohortId] });
      qc.invalidateQueries({ queryKey: ['validation', cohortId] });
      onDone({
        students: data.students.length,
        constraints: data.constraints_created,
        notImported: rows.filter((r) => !r.include && r.status !== 'duplicate_exact').map((r) => display(r) || t('(no name)')),
        existingUpdated: data.existing_updated ?? [],
        skipped: (data.skipped_preferences ?? []).map((s) => ({
          owner: s.owner, target: names.get(s.target_key) ?? s.target_key, reason: s.reason,
        })),
      });
    },
    onError: (err) => showToast(
      isNetworkError(err) ? t('We can’t reach the server. Check your connection.')
        : httpStatus(err) === 422 ? t('Some rows aren’t valid (e.g. a name over 100 characters). Check them and try again.')
        : t('Import failed. Try again.'),
      'error',
    ),
  });

  const confirmReason = confirmMutation.isPending ? ''
    : validCount === 0 ? t('No valid students to import.')
    : pendingCount > 0 ? t('Decide what to do with the unmatched pairing names first')
    : '';

  return (
    <Modal title={t('Preview import')} onClose={onClose} dirty busy={confirmMutation.isPending} className="import-modal" describedBy={descId}>
      <p id={descId} style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 12 }}>
        {t('Review the students below before confirming. You can edit names and tags inline.')}
        {hasPreferences && ` ${t('Pairing preferences become soft "keep together" constraints.')}`}
      </p>
      {(skippedErrors > 0 || exactCount > 0 || similarCount > 0) && (
        <div className="warn-banner" style={{ marginBottom: 12 }}>
          {skippedErrors > 0 && <p>{t('Rows marked "Missing name" or "Invalid tag" will be skipped.')}</p>}
          {exactCount > 0 && <p>{exactCount === 1
            ? t('{n} row is an exact copy and is unticked.', { n: exactCount })
            : t('{n} rows are exact copies and are unticked.', { n: exactCount })}</p>}
          {similarCount > 0 && <p>{similarCount === 1
            ? t('{n} row may be a duplicate; it’s ticked — untick it if it’s the same student.', { n: similarCount })
            : t('{n} rows may be duplicates; they’re ticked — untick any that are the same student.', { n: similarCount })}</p>}
        </div>
      )}
      {unclearGenderCount > 0 && (
        <div className="warn-banner" style={{ marginBottom: 12 }}>
          {unclearGenderCount === 1
            ? t('{n} row has a gender value we didn’t recognise.', { n: unclearGenderCount })
            : t('{n} rows have a gender value we didn’t recognise.', { n: unclearGenderCount })}
          {' '}{unclearGenderCount === 1
            ? t('It will be imported with gender unknown — set it in the student table afterwards.')
            : t('They will be imported with gender unknown — set it in the student table afterwards.')}
        </div>
      )}
      {preview.name_split && (
        <NameSplitNote
          split={preview.name_split}
          edited={edited}
          busy={reuploading}
          onFlip={() => onReupload(preview.name_split!.order === 'surname_first' ? 'given_first' : 'surname_first')}
        />
      )}
      <ColumnNotes notes={preview.column_notes ?? []} />
      {groups.length > 0 && (
        <PendingNamesPanel groups={groups} pendingCount={pendingCount} actions={actions} onSkipEverything={skipEverything} />
      )}
      <div className="import-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('Import')}</th>
              <th scope="col">{t('First name')}</th>
              <th scope="col">{t('Last name')}</th>
              {hasGender && <th scope="col">{t('Gender')}</th>}
              <th scope="col">{t('Tags')}</th>
              {hasPreferences && <th scope="col">{t('Pair with')}</th>}
              <th scope="col">{t('Status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const line = row.addedFor ? t('new') : String(row.row_index + 2);
              const blocked = row.status === 'missing_name' || row.status === 'invalid_tag';
              return (
                <tr key={row.row_index} className={row.include ? '' : 'excluded'}>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.include}
                      disabled={blocked}
                      aria-label={t('Import line {line} ({name})', { line, name: display(row) || t('(no name)') })}
                      onChange={(e) => setInclude(i, e.target.checked)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={row.first_name}
                      aria-label={t('First name, line {line}', { line })}
                      onChange={(e) => updateName(i, 'first_name', e.target.value)}
                      style={{ width: '100%', padding: '4px 8px' }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={row.last_name}
                      aria-label={t('Last name, line {line}', { line })}
                      onChange={(e) => updateName(i, 'last_name', e.target.value)}
                      style={{ width: '100%', padding: '4px 8px' }}
                    />
                  </td>
                  {hasGender && (
                    <td style={{ fontSize: 12.5, color: row.gender ? undefined : 'var(--text3)' }}>
                      {genderLabel(row.gender)}
                    </td>
                  )}
                  <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{row.tags.join(', ')}</td>
                  {hasPreferences && (
                    <td style={{ fontSize: 12.5 }}>
                      {row.prefs.length === 0 ? <span style={{ color: 'var(--text3)' }}>—</span> : (
                        <div className="pref-cell">
                          {row.prefs.map((p, j) => (
                            <PreferenceChips
                              key={j}
                              pref={p}
                              names={names}
                              onRemove={() => removePreference(i, j)}
                              onRename={(name) => rematchPreference(i, j, name)}
                            />
                          ))}
                        </div>
                      )}
                      {!row.include && prefsApply(row) && row.prefs.some((p) => p.chosen.length) && (
                        <span className="form-hint">{t('Added to the student already in the cohort.')}</span>
                      )}
                    </td>
                  )}
                  <td><StatusBadge row={row} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="modal-footer import-footer">
        {confirmReason && <p id={`${descId}-reason`} className="disabled-reason">{confirmReason}</p>}
        <button className="btn btn-secondary" onClick={onClose} disabled={confirmMutation.isPending}>
          {t('Cancel')}
        </button>
        <button
          className="btn btn-primary"
          onClick={() => confirmMutation.mutate()}
          disabled={!!confirmReason || confirmMutation.isPending}
          aria-describedby={confirmReason ? `${descId}-reason` : undefined}
        >
          {confirmMutation.isPending
            ? t('Importing…')
            : pendingCount > 0
              ? (pendingCount === 1 ? t('Decide {n} name first', { n: pendingCount }) : t('Decide {n} names first', { n: pendingCount }))
              : (validCount === 1 ? t('Confirm import ({n} student)', { n: validCount }) : t('Confirm import ({n} students)', { n: validCount }))}
        </button>
      </div>
    </Modal>
  );
}

/** Summary toast after a successful import; each count needs its own sentence for Spanish plurals. */
function importSummary(students: number, constraints: number): string {
  if (constraints === 0) {
    return students === 1 ? translate('{n} student added.', { n: students }) : translate('{n} students added.', { n: students });
  }
  if (students === 1) {
    return constraints === 1
      ? translate('{s} student added, {c} "keep together" preference created.', { s: students, c: constraints })
      : translate('{s} student added, {c} "keep together" preferences created.', { s: students, c: constraints });
  }
  return constraints === 1
    ? translate('{s} students added, {c} "keep together" preference created.', { s: students, c: constraints })
    : translate('{s} students added, {c} "keep together" preferences created.', { s: students, c: constraints });
}

function SummaryModal({ summary, onClose }: { summary: ImportSummary; onClose: () => void }) {
  const t = useT();
  return (
    <Modal title={t('Import finished')} onClose={onClose}>
      <p className="modal-text" role="status">{importSummary(summary.students, summary.constraints)}</p>
      {summary.existingUpdated.length > 0 && (
        <section className="import-summary-block">
          <h3>{t('Preferences added to students already in the cohort')}</h3>
          <ul>{summary.existingUpdated.map((e) => <li key={e.display}>{t('{name}: {n} new', { name: e.display, n: e.constraints_created })}</li>)}</ul>
        </section>
      )}
      {summary.notImported.length > 0 && (
        <section className="import-summary-block">
          <h3>{t('Not imported ({n})', { n: summary.notImported.length })}</h3>
          <ul>{summary.notImported.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </section>
      )}
      {summary.skipped.length > 0 && (
        <section className="import-summary-block">
          <h3>{t('Preferences not created ({n})', { n: summary.skipped.length })}</h3>
          <ul>
            {summary.skipped.map((s, i) => (
              <li key={i}>
                {s.owner} → {s.target}{' '}
                <span className="form-hint">
                  ({s.reason === 'target_not_imported' ? t('that student wasn’t imported') : t('that student isn’t in this cohort')})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="modal-footer">
        <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>{t('Close')}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Upload button + help + template
// ---------------------------------------------------------------------------

function downloadTemplate() {
  const es = getLang() === 'es';
  const csv = es
    ? 'nombres,apellidos,genero,etiquetas,preferencias\nLucía,García Pérez,niña,"apoyo,lectura",Mateo Soto|Ana Ruiz\nMateo,Soto Díaz,niño,,Lucía García\n'
    : 'first_name,last_name,gender,tags,preferences\nAlice,Smith,girl,"support,reading",Ben Jones|Carol Lee\nBen,Jones,boy,,Alice Smith\n';
  // BOM so Excel opens the accents correctly.
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = es ? 'plantilla-alumnos.csv' : 'students-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function uploadErrorMessage(err: unknown): string {
  if (isNetworkError(err)) return translate('We can’t reach the server. Check your connection.');
  const status = httpStatus(err);
  const code = errorCode(err);
  if (status === 415) return translate('This isn’t a CSV file. In Excel, use File → Save as → CSV.');
  if (status === 413) return translate('File too large. Maximum 5 MB.');
  if (status === 422) {
    if (code === 'too_many_rows') return translate('Too many rows. Maximum 500 students per import.');
    if (code === 'no_name_column') {
      const headers = (errorDetail(err) as { headers?: string } | undefined)?.headers;
      return headers
        ? translate('We couldn’t find a name column. The first row must have column names, e.g. “nombres, apellidos” or “nombre”. We found: {headers}.', { headers })
        : translate('We couldn’t find a name column. The first row must have column names, e.g. “nombres, apellidos” or “nombre”.');
    }
    if (code === 'empty_file') return translate('The file is empty.');
  }
  return translate('Import failed. Check your file format and try again.');
}

export default function CsvUploadButton({ cohortId }: { cohortId: string }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFile = useRef<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [uploadError, setUploadError] = useState('');
  const { showToast } = useToast();
  const errId = useId();

  async function upload(file: File, nameOrder: NameSplit['order'] = 'surname_first') {
    if (file.size > 5 * 1024 * 1024) {
      setUploadError(t('File too large. Maximum 5 MB.'));
      return;
    }
    lastFile.current = file;
    setUploadError('');
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name_order', nameOrder);
    try {
      const res = await api.post<ImportPreviewResponse>(`/cohorts/${cohortId}/students/import`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(res.data);
      setPreviewVersion((v) => v + 1);
    } catch (err: unknown) {
      const msg = uploadErrorMessage(err);
      if (preview) showToast(msg, 'error');
      else setUploadError(msg);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <>
      <div className="csv-upload">
        <div className="csv-upload-row">
          <button
            className="btn btn-secondary"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            aria-describedby={uploadError ? errId : undefined}
          >
            {uploading ? t('Uploading…') : t('Import CSV')}
          </button>
          <HelpTip
            label={t('CSV format')}
            text={t('First row: column names. Columns: nombres, apellidos (or a single “nombre” column), genero (niño/niña), etiquetas (separated by commas), preferencias (classmates separated by |). Commas or semicolons both work.')}
          />
          <button type="button" className="link-button" onClick={downloadTemplate}>{t('Download template')}</button>
        </div>
        {uploadError && <span id={errId} className="form-error" role="alert" style={{ fontSize: 12 }}>{uploadError}</span>}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,application/vnd.ms-excel"
          style={{ display: 'none' }}
          aria-hidden
          tabIndex={-1}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
        />
      </div>

      {preview && (
        <PreviewModal
          key={previewVersion}
          cohortId={cohortId}
          preview={preview}
          reuploading={uploading}
          onReupload={(order) => { if (lastFile.current) upload(lastFile.current, order); }}
          onClose={() => setPreview(null)}
          onDone={(s) => {
            setPreview(null);
            // Anything the teacher should know about → a summary dialog; otherwise just a toast.
            if (s.notImported.length || s.skipped.length || s.existingUpdated.length) setSummary(s);
            else showToast(importSummary(s.students, s.constraints), 'success');
          }}
        />
      )}
      {summary && <SummaryModal summary={summary} onClose={() => setSummary(null)} />}
    </>
  );
}
