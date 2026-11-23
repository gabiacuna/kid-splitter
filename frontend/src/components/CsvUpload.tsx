import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { ColumnNote, ImportConfirmResponse, ImportPreviewResponse, PreferenceMatch, PreviewRow } from '../lib/types';
import { useToast } from './Toast';
import { genderLabel } from '../lib/gender';
import { useT } from '../i18n';

function StatusBadge({ status }: { status: PreviewRow['status'] }) {
  const t = useT();
  if (status === 'ok') return <span className="badge badge-sage">{t('OK')}</span>;
  if (status === 'duplicate') return <span className="badge badge-warn">{t('Duplicate')}</span>;
  if (status === 'invalid_tag') return <span className="badge badge-red">{t('Invalid tag')}</span>;
  if (status === 'invalid_gender') return <span className="badge badge-warn">{t('Gender unclear')}</span>;
  return <span className="badge badge-red">{t('Missing name')}</span>;
}

function PreferenceChip({
  pref,
  onRemove,
  onRename,
}: {
  pref: PreferenceMatch;
  onRemove: () => void;
  onRename: (name: string) => void;
}) {
  const t = useT();
  const matched = pref.status === 'matched';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(pref.name);

  useEffect(() => { if (!editing) setValue(pref.name); }, [pref.name, editing]);

  if (matched) {
    return (
      <span className="badge badge-sage" title={t('Matched → {name}', { name: pref.matched_display ?? pref.name })}>
        {pref.matched_display ?? pref.name}
      </span>
    );
  }

  if (editing) {
    function commit() {
      setEditing(false);
      const name = value.trim();
      if (name && name !== pref.name) onRename(name);
      else setValue(pref.name);
    }
    return (
      <span className="badge badge-warn pref-chip">
        <input
          className="pref-chip-input"
          value={value}
          autoFocus
          size={Math.max(value.length, 4)}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
            if (e.key === 'Escape') { setValue(pref.name); setEditing(false); }
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
        onClick={() => setEditing(true)}
      >
        {pref.name} ?
      </button>
      <button
        type="button"
        className="pref-chip-remove"
        aria-label={t('Remove {name}', { name: pref.name })}
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  );
}

function PreferenceCell({
  preferences,
  onRemove,
  onRename,
}: {
  preferences: PreferenceMatch[];
  onRemove: (prefIndex: number) => void;
  onRename: (prefIndex: number, name: string) => void;
}) {
  if (preferences.length === 0) return <span style={{ color: 'var(--text3)' }}>—</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {preferences.map((p, i) => (
        <PreferenceChip
          key={i}
          pref={p}
          onRemove={() => onRemove(i)}
          onRename={(name) => onRename(i, name)}
        />
      ))}
    </div>
  );
}

const isErrorRow = (r: PreviewRow) => !r.importable;

const normName = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');

/** One decision per distinct unmatched name, however many students listed it. */
interface PendingName {
  key: string;
  name: string;
  status: PreferenceMatch['status'];
  owners: string[];
  suggestions: string[];
}

function PendingNamesPanel({
  pending,
  onPick,
  onAddNew,
  onSkip,
  onSkipAll,
}: {
  pending: PendingName[];
  onPick: (key: string, display: string) => void;
  onAddNew: (key: string) => void;
  onSkip: (key: string) => void;
  onSkipAll: () => void;
}) {
  const t = useT();
  return (
    <section className="decision-panel" aria-label={t('Pairing names that need a decision')}>
      <div className="decision-panel-head">
        <strong>
          {pending.length === 1
            ? t('{n} pairing name needs your decision', { n: pending.length })
            : t('{n} pairing names need your decision', { n: pending.length })}
        </strong>
        <button type="button" className="link-button" onClick={onSkipAll}>{t('Skip all')}</button>
      </div>
      <div className="decision-list">
        {pending.map((p) => {
          const canAdd = p.name.trim().split(/\s+/).length >= 2;
          return (
            <div key={p.key} className="decision-item">
              <p>
                <strong>{p.owners.join(', ')}</strong> {p.owners.length === 1 ? t('wants to be with') : t('want to be with')}{' '}
                <strong>“{p.name}”</strong>
                {p.status === 'ambiguous'
                  ? t(', which matches more than one student.')
                  : t(', but no student has that name.')}
              </p>
              <div className="decision-actions">
                {p.suggestions.length > 0 && <span className="decision-label">{t('Did you mean')}</span>}
                {p.suggestions.map((sug) => (
                  <button key={sug} type="button" className="btn btn-secondary btn-sm" onClick={() => onPick(p.key, sug)}>
                    {sug}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onAddNew(p.key)}
                  disabled={!canAdd}
                  title={canAdd ? undefined : t('Needs a first and last name — edit the name in the table first')}
                >
                  {t('+ Add “{name}” as a new student', { name: p.name })}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSkip(p.key)}>
                  {t('Skip')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ColumnNotes({ notes }: { notes: ColumnNote[] }) {
  const t = useT();
  if (notes.length === 0) return null;
  return (
    <ul className="column-notes">
      {notes.map((n) => (
        <li key={n.column}>
          {t('Column')} <strong>{n.column}</strong>: {n.action === 'tags' ? n.detail : t('ignored — {detail}', { detail: n.detail })}
        </li>
      ))}
    </ul>
  );
}

function PreviewModal({
  cohortId,
  initialRows,
  columnNotes,
  onClose,
  onSuccess,
}: {
  cohortId: string;
  initialRows: PreviewRow[];
  columnNotes: ColumnNote[];
  onClose: () => void;
  onSuccess: (students: number, constraints: number) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<PreviewRow[]>(initialRows);
  const qc = useQueryClient();
  const { showToast } = useToast();

  const confirmMutation = useMutation({
    mutationFn: () => {
      const students = rows
        .filter((r) => !isErrorRow(r))
        .map(({ first_name, last_name, tags, gender, preferences }) => ({
          first_name,
          last_name,
          tags,
          gender: gender ?? null,
          preferences: preferences.map((p) => p.name),
        }));
      return api
        .post<ImportConfirmResponse>(`/cohorts/${cohortId}/students/import/confirm`, { students })
        .then((r) => r.data);
    },
    onSuccess: (data: ImportConfirmResponse) => {
      qc.invalidateQueries({ queryKey: ['students', cohortId] });
      qc.invalidateQueries({ queryKey: ['cohorts'] });
      qc.invalidateQueries({ queryKey: ['constraints', cohortId] });
      onSuccess(data.students.length, data.constraints_created);
    },
    onError: () => showToast(t('Import failed. Try again.'), 'error'),
  });

  const hasErrors = rows.some(isErrorRow);
  const validCount = rows.filter((r) => !isErrorRow(r)).length;
  const hasPreferences = rows.some((r) => r.preferences.length > 0);
  const hasGender = rows.some((r) => r.gender || r.status === 'invalid_gender');
  const unclearGenderCount = rows.filter((r) => r.status === 'invalid_gender').length;
  const pending: PendingName[] = [];
  for (const r of rows) {
    if (isErrorRow(r)) continue;
    for (const p of r.preferences) {
      if (p.status === 'matched') continue;
      const key = normName(p.name);
      let entry = pending.find((e) => e.key === key);
      if (!entry) {
        entry = { key, name: p.name, status: p.status, owners: [], suggestions: p.suggestions ?? [] };
        pending.push(entry);
      }
      entry.owners.push(r.first_name);
    }
  }
  const unresolvedCount = pending.length;

  /** Apply `update` to every unmatched preference whose name normalises to `key`. */
  function resolveName(key: string, update: (p: PreferenceMatch) => PreferenceMatch | null) {
    setRows((prev) => prev.map((r) => ({
      ...r,
      preferences: r.preferences.flatMap((p) => {
        if (p.status === 'matched' || normName(p.name) !== key) return [p];
        const next = update(p);
        return next ? [next] : [];
      }),
    })));
  }

  function pickSuggestion(key: string, display: string) {
    resolveName(key, () => ({ name: display, status: 'matched', matched_display: display }));
  }

  function addAsNewStudent(key: string) {
    const entry = pending.find((e) => e.key === key);
    if (!entry) return;
    // Preference lists write "Given Surname", so the last word is the surname.
    const words = entry.name.trim().split(/\s+/);
    const first = words.slice(0, -1).join(' ');
    const last = words[words.length - 1];
    const display = `${first} ${last}`;
    setRows((prev) => [
      ...prev,
      {
        row_index: Math.max(-1, ...prev.map((r) => r.row_index)) + 1,
        first_name: first,
        last_name: last,
        tags: [],
        gender: null,
        status: 'ok',
        importable: true,
        status_message: 'Added from a pairing preference',
        preferences: [],
      },
    ]);
    resolveName(key, () => ({ name: display, status: 'matched', matched_display: display }));
  }

  function updateRow(index: number, field: keyof PreviewRow, value: string) {
    setRows((prev) => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }

  function removePreference(rowIndex: number, prefIndex: number) {
    setRows((prev) => prev.map((r, i) =>
      i === rowIndex
        ? { ...r, preferences: r.preferences.filter((_, j) => j !== prefIndex) }
        : r,
    ));
  }

  async function rematchPreference(rowIndex: number, prefIndex: number, name: string) {
    const rosterRows = rows.map((r) => ({
      row_index: r.row_index,
      first_name: r.first_name,
      last_name: r.last_name,
      importable: r.importable,
    }));
    const applyMatch = (match: PreferenceMatch) => setRows((prev) => prev.map((r, i) =>
      i === rowIndex
        ? { ...r, preferences: r.preferences.map((p, j) => j === prefIndex ? match : p) }
        : r,
    ));
    try {
      const { data } = await api.post<PreferenceMatch>(
        `/cohorts/${cohortId}/students/import/rematch`,
        { name, self_row_index: rows[rowIndex].row_index, rows: rosterRows },
      );
      applyMatch(data);
    } catch {
      applyMatch({ name, status: 'unresolved', matched_display: null });
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 920, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <h2 className="modal-title">{t('Preview import')}</h2>
        <p style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 16 }}>
          {t('Review the students below before confirming. You can edit names and tags inline.')}
          {hasPreferences && ` ${t('Pairing preferences become soft "keep together" constraints.')}`}
        </p>
        {hasErrors && (
          <div className="warn-banner" style={{ marginBottom: 12 }}>
            {t('Rows marked "Missing name" or "Invalid tag" will be skipped.')}
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
        <ColumnNotes notes={columnNotes} />
        {unresolvedCount > 0 && (
          <PendingNamesPanel
            pending={pending}
            onPick={pickSuggestion}
            onAddNew={addAsNewStudent}
            onSkip={(key) => resolveName(key, () => null)}
            onSkipAll={() => pending.forEach((p) => resolveName(p.key, () => null))}
          />
        )}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <table>
            <thead>
              <tr>
                <th>{t('First name')}</th>
                <th>{t('Last name')}</th>
                {hasGender && <th>{t('Gender')}</th>}
                <th>{t('Tags')}</th>
                {hasPreferences && <th>{t('Pair with')}</th>}
                <th>{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="text"
                      value={row.first_name}
                      onChange={(e) => updateRow(i, 'first_name', e.target.value)}
                      style={{ width: '100%', padding: '4px 8px' }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={row.last_name}
                      onChange={(e) => updateRow(i, 'last_name', e.target.value)}
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
                      <PreferenceCell
                        preferences={row.preferences}
                        onRemove={(prefIndex) => removePreference(i, prefIndex)}
                        onRename={(prefIndex, name) => rematchPreference(i, prefIndex, name)}
                      />
                    </td>
                  )}
                  <td><StatusBadge status={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {validCount === 0 && (
          <div style={{ color: 'var(--text3)', fontSize: 13, marginTop: 10 }}>{t('No valid students to import.')}</div>
        )}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={confirmMutation.isPending}>
            {t('Cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => confirmMutation.mutate()}
            disabled={validCount === 0 || unresolvedCount > 0 || confirmMutation.isPending}
            title={unresolvedCount > 0 ? t('Decide what to do with the unmatched pairing names first') : undefined}
          >
            {confirmMutation.isPending
              ? t('Importing…')
              : unresolvedCount > 0
                ? (unresolvedCount === 1
                    ? t('Decide {n} name first', { n: unresolvedCount })
                    : t('Decide {n} names first', { n: unresolvedCount }))
                : (validCount === 1
                    ? t('Confirm import ({n} student)', { n: validCount })
                    : t('Confirm import ({n} students)', { n: validCount }))}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CsvUploadButton({ cohortId }: { cohortId: string }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [uploadError, setUploadError] = useState('');
  const { showToast } = useToast();

  /** Summary toast after a successful import; each count needs its own sentence for Spanish plurals. */
  function importSummary(students: number, constraints: number): string {
    if (constraints === 0) {
      return students === 1
        ? t('{n} student added.', { n: students })
        : t('{n} students added.', { n: students });
    }
    if (students === 1) {
      return constraints === 1
        ? t('{s} student added, {c} "keep together" preference created.', { s: students, c: constraints })
        : t('{s} student added, {c} "keep together" preferences created.', { s: students, c: constraints });
    }
    return constraints === 1
      ? t('{s} students added, {c} "keep together" preference created.', { s: students, c: constraints })
      : t('{s} students added, {c} "keep together" preferences created.', { s: students, c: constraints });
  }

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setUploadError(t('File too large. Maximum 5 MB.'));
      return;
    }
    setUploadError('');
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api.post<ImportPreviewResponse>(`/cohorts/${cohortId}/students/import`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(res.data);
    } catch (err: unknown) {
      const status = (err as { response?: { status: number } }).response?.status;
      if (status === 422) {
        setUploadError(t('Too many rows. Maximum 500 students per import.'));
      } else {
        setUploadError(t('Import failed. Check your file format and try again.'));
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button
          className="btn btn-secondary"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? t('Uploading…') : t('Import CSV')}
        </button>
        {uploadError && <span className="form-error" style={{ fontSize: 12 }}>{uploadError}</span>}
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      {preview && (
        <PreviewModal
          cohortId={cohortId}
          initialRows={preview.rows}
          columnNotes={preview.column_notes ?? []}
          onClose={() => setPreview(null)}
          onSuccess={(students, constraints) => {
            setPreview(null);
            showToast(importSummary(students, constraints), 'success');
          }}
        />
      )}
    </>
  );
}
