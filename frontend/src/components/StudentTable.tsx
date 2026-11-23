import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { Student } from '../lib/types';
import { genderLabel, nextGender } from '../lib/gender';
import { useToast } from './Toast';
import { useT } from '../i18n';

const TAG_REGEX = /^[a-z0-9-]+$/;

function TagPill({ tag, onRemove }: { tag: string; onRemove: () => void }) {
  const t = useT();
  return (
    <span className="tag-pill">
      {tag}
      <button type="button" onClick={onRemove} title={t('Remove tag')}>×</button>
    </span>
  );
}

function TagInput({ onAdd }: { onAdd: (tag: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');

  function commit() {
    const tag = val.toLowerCase().trim();
    if (tag && TAG_REGEX.test(tag) && tag.length <= 30) {
      onAdd(tag);
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
        {t('+ tag')}
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
      placeholder={t('tag-name')}
    />
  );
}


function GenderCell({ student, onCycle }: { student: Student; onCycle: () => void }) {
  const t = useT();
  const g = student.gender;
  return (
    <button
      type="button"
      className="gender-cycle"
      data-gender={g ?? 'none'}
      onClick={onCycle}
      title={t('Click to change (Boy → Girl → unknown)')}
      aria-label={t('Gender for {name}: {label}. Activate to change.', {
        name: `${student.first_name} ${student.last_name}`,
        label: genderLabel(g, t('unknown')),
      })}
    >
      {genderLabel(g)}
    </button>
  );
}

interface StudentTableProps {
  cohortId: string;
  students: Student[];
}

export default function StudentTable({ cohortId, students }: StudentTableProps) {
  const t = useT();
  const qc = useQueryClient();
  const { showToast } = useToast();
  const [savingTags, setSavingTags] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Per-student write queue: tag and gender edits reach the server in click order.
  const writes = useRef(new Map<string, Promise<unknown>>());
  function enqueueWrite(studentId: string, body: object) {
    const write = (writes.current.get(studentId) ?? Promise.resolve()).catch(() => {})
      .then(() => api.put(`/students/${studentId}`, body));
    writes.current.set(studentId, write);
    return write;
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/students/${id}`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['students', cohortId] });
      qc.invalidateQueries({ queryKey: ['cohorts'] });
      const s = students.find((x) => x.id === id);
      if (s) showToast(t('Student removed. Any constraints involving {name} were also removed.', { name: s.first_name }), 'success');
      setConfirmDelete(null);
    },
    onError: () => showToast(t('Failed to remove student.'), 'error'),
  });

  async function updateTags(student: Student, tags: string[]) {
    setSavingTags((prev) => new Set(prev).add(student.id));
    try {
      await enqueueWrite(student.id, { tags });
      qc.invalidateQueries({ queryKey: ['students', cohortId] });
    } catch {
      showToast(t('Failed to update tags.'), 'error');
    } finally {
      setSavingTags((prev) => { const s = new Set(prev); s.delete(student.id); return s; });
    }
  }

  async function cycleGender(studentId: string) {
    const key = ['students', cohortId];
    // An in-flight refetch (e.g. after an import) would overwrite the optimistic value.
    await qc.cancelQueries({ queryKey: key });
    // Read from the cache, not the render closure: rapid clicks can land before a re-render.
    const current = qc.getQueryData<Student[]>(key)?.find((s) => s.id === studentId);
    if (!current) return;
    const next = nextGender(current.gender);
    // Optimistic: flip immediately so a teacher can click straight down the column.
    qc.setQueryData<Student[]>(key, (old) => old?.map((s) => (s.id === studentId ? { ...s, gender: next } : s)));

    try {
      await enqueueWrite(studentId, { gender: next });
    } catch {
      showToast(t('Failed to update gender.'), 'error');
      qc.invalidateQueries({ queryKey: key }); // resync with the server's truth
    }
  }

  function handleAddTag(student: Student, tag: string) {
    if (student.tags.includes(tag) || student.tags.length >= 10) return;
    updateTags(student, [...student.tags, tag]);
  }

  function handleRemoveTag(student: Student, tag: string) {
    updateTags(student, student.tags.filter((x) => x !== tag));
  }

  if (students.length === 0) return null;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('First name')}</th>
            <th>{t('Last name')}</th>
            <th>{t('Gender')}</th>
            <th>{t('Tags')}</th>
            <th>{t('Actions')}</th>
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
                <td><GenderCell student={s} onCycle={() => cycleGender(s.id)} /></td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', opacity: saving ? 0.5 : 1, pointerEvents: saving ? 'none' : undefined }}>
                    {s.tags.map((tag) => (
                      <TagPill key={tag} tag={tag} onRemove={() => handleRemoveTag(s, tag)} />
                    ))}
                    {s.tags.length < 10 && <TagInput onAdd={(tag) => handleAddTag(s, tag)} />}
                    {saving && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
                  </div>
                </td>
                <td>
                  {deleting ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>
                        {t('Remove {name}?', { name: `${s.first_name} ${s.last_name}` })}
                      </span>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => deleteMutation.mutate(s.id)}
                        disabled={deleteMutation.isPending}
                      >
                        {deleteMutation.isPending ? '…' : t('Remove')}
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => setConfirmDelete(null)}
                      >
                        {t('Cancel')}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 10px', fontSize: 12, color: 'var(--coral)' }}
                      onClick={() => setConfirmDelete(s.id)}
                    >
                      {t('Delete')}
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
