import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { Student } from '../lib/types';
import { useToast } from './Toast';

const TAG_REGEX = /^[a-z0-9-]+$/;

function TagPill({ tag, onRemove }: { tag: string; onRemove: () => void }) {
  return (
    <span className="tag-pill">
      {tag}
      <button type="button" onClick={onRemove} title="Remove tag">×</button>
    </span>
  );
}

function TagInput({ onAdd }: { onAdd: (tag: string) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');

  function commit() {
    const t = val.toLowerCase().trim();
    if (t && TAG_REGEX.test(t) && t.length <= 30) {
      onAdd(t);
    }
    setVal('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ fontSize: 12, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
      >
        + tag
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="text"
      value={val}
      onChange={(e) => {
        const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
        setVal(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { setVal(''); setOpen(false); }
      }}
      onBlur={commit}
      maxLength={30}
      style={{ width: 80, padding: '2px 6px', fontSize: 12 }}
      placeholder="tag-name"
    />
  );
}

interface StudentTableProps {
  cohortId: string;
  students: Student[];
}

export default function StudentTable({ cohortId, students }: StudentTableProps) {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const [savingTags, setSavingTags] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/students/${id}`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['students', cohortId] });
      qc.invalidateQueries({ queryKey: ['cohorts'] });
      const s = students.find((x) => x.id === id);
      if (s) showToast(`Student removed. Any constraints involving ${s.first_name} were also removed.`, 'success');
      setConfirmDelete(null);
    },
    onError: () => showToast('Failed to remove student.', 'error'),
  });

  async function updateTags(student: Student, tags: string[]) {
    setSavingTags((prev) => new Set(prev).add(student.id));
    try {
      await api.put(`/students/${student.id}`, { tags });
      qc.invalidateQueries({ queryKey: ['students', cohortId] });
    } catch {
      showToast('Failed to update tags.', 'error');
    } finally {
      setSavingTags((prev) => { const s = new Set(prev); s.delete(student.id); return s; });
    }
  }

  function handleAddTag(student: Student, tag: string) {
    if (student.tags.includes(tag) || student.tags.length >= 10) return;
    updateTags(student, [...student.tags, tag]);
  }

  function handleRemoveTag(student: Student, tag: string) {
    updateTags(student, student.tags.filter((t) => t !== tag));
  }

  if (students.length === 0) return null;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>First name</th>
            <th>Last name</th>
            <th>Tags</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => {
            const saving = savingTags.has(s.id);
            const deleting = confirmDelete === s.id;
            return (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{s.first_name}</td>
                <td>{s.last_name}</td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', opacity: saving ? 0.5 : 1, pointerEvents: saving ? 'none' : undefined }}>
                    {s.tags.map((t) => (
                      <TagPill key={t} tag={t} onRemove={() => handleRemoveTag(s, t)} />
                    ))}
                    {s.tags.length < 10 && <TagInput onAdd={(t) => handleAddTag(s, t)} />}
                    {saving && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
                  </div>
                </td>
                <td>
                  {deleting ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>
                        Remove {s.first_name} {s.last_name}?
                      </span>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => deleteMutation.mutate(s.id)}
                        disabled={deleteMutation.isPending}
                      >
                        {deleteMutation.isPending ? '…' : 'Remove'}
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => setConfirmDelete(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 10px', fontSize: 12, color: 'var(--coral)' }}
                      onClick={() => setConfirmDelete(s.id)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
