import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { ImportConfirmResponse, ImportPreviewResponse, PreferenceMatch, PreviewRow } from '../lib/types';
import { useToast } from './Toast';

function StatusBadge({ status }: { status: PreviewRow['status'] }) {
  if (status === 'ok') return <span className="badge badge-sage">OK</span>;
  if (status === 'duplicate') return <span className="badge badge-warn">Duplicate</span>;
  if (status === 'invalid_tag') return <span className="badge badge-red">Invalid tag</span>;
  return <span className="badge badge-red">Missing name</span>;
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
  const matched = pref.status === 'matched';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(pref.name);

  useEffect(() => { if (!editing) setValue(pref.name); }, [pref.name, editing]);

  if (matched) {
    return (
      <span className="badge badge-sage" title={`Matched → ${pref.matched_display}`}>
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
        title={`Could not match "${pref.name}" — click to edit`}
        onClick={() => setEditing(true)}
      >
        {pref.name} ?
      </button>
      <button
        type="button"
        className="pref-chip-remove"
        aria-label={`Remove ${pref.name}`}
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

const isErrorRow = (r: PreviewRow) => r.status === 'missing_name' || r.status === 'invalid_tag';

function PreviewModal({
  cohortId,
  initialRows,
  onClose,
  onSuccess,
}: {
  cohortId: string;
  initialRows: PreviewRow[];
  onClose: () => void;
  onSuccess: (students: number, constraints: number) => void;
}) {
  const [rows, setRows] = useState<PreviewRow[]>(initialRows);
  const qc = useQueryClient();
  const { showToast } = useToast();

  const confirmMutation = useMutation({
    mutationFn: () => {
      const students = rows
        .filter((r) => !isErrorRow(r))
        .map(({ first_name, last_name, tags, preferences }) => ({
          first_name,
          last_name,
          tags,
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
    onError: () => showToast('Import failed. Try again.', 'error'),
  });

  const hasErrors = rows.some(isErrorRow);
  const validCount = rows.filter((r) => !isErrorRow(r)).length;
  const hasPreferences = rows.some((r) => r.preferences.length > 0);
  const unresolvedCount = rows.reduce(
    (n, r) => n + r.preferences.filter((p) => p.status !== 'matched').length,
    0,
  );

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
      importable: r.status === 'ok',
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
      <div className="modal" style={{ maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <h2 className="modal-title">Preview import</h2>
        <p style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 16 }}>
          Review the students below before confirming. You can edit names and tags inline.
          {hasPreferences && ' Pairing preferences become soft "keep together" constraints.'}
        </p>
        {hasErrors && (
          <div className="warn-banner" style={{ marginBottom: 12 }}>
            Rows marked "Missing name" or "Invalid tag" will be skipped.
          </div>
        )}
        {unresolvedCount > 0 && (
          <div className="warn-banner" style={{ marginBottom: 12 }}>
            {unresolvedCount} pairing {unresolvedCount === 1 ? 'name' : 'names'} could not be matched to a
            student (shown with a “?”) and will be skipped.
          </div>
        )}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <table>
            <thead>
              <tr>
                <th>First name</th>
                <th>Last name</th>
                <th>Tags</th>
                {hasPreferences && <th>Pair with</th>}
                <th>Status</th>
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
                  <td style={{ fontSize: 12.5 }}>{row.tags.join(', ')}</td>
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
          <div style={{ color: 'var(--text3)', fontSize: 13, marginTop: 10 }}>No valid students to import.</div>
        )}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={confirmMutation.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => confirmMutation.mutate()}
            disabled={validCount === 0 || confirmMutation.isPending}
          >
            {confirmMutation.isPending ? 'Importing…' : `Confirm import (${validCount} students)`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CsvUploadButton({ cohortId }: { cohortId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewRow[] | null>(null);
  const [uploadError, setUploadError] = useState('');
  const { showToast } = useToast();

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('File too large. Maximum 5 MB.');
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
      setPreviewRows(res.data.rows);
    } catch (err: unknown) {
      const status = (err as { response?: { status: number } }).response?.status;
      if (status === 422) {
        setUploadError('Too many rows. Maximum 500 students per import.');
      } else {
        setUploadError('Import failed. Check your file format and try again.');
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
          {uploading ? 'Uploading…' : 'Import CSV'}
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

      {previewRows && (
        <PreviewModal
          cohortId={cohortId}
          initialRows={previewRows}
          onClose={() => setPreviewRows(null)}
          onSuccess={(students, constraints) => {
            setPreviewRows(null);
            const msg = constraints > 0
              ? `${students} students added, ${constraints} "keep together" preferences created.`
              : `${students} students added.`;
            showToast(msg, 'success');
          }}
        />
      )}
    </>
  );
}
