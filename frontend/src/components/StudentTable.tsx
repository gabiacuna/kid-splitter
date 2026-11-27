import { useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { BinaryConstraint, Student, UnaryConstraint } from '../lib/types';
import { genderLabel, nextGender } from '../lib/gender';
import { useToast } from './Toast';
import { useT } from '../i18n';
import HelpTip from './HelpTip';
import { normName } from '../lib/importPreview';

const TAG_REGEX = /^[a-z0-9-]+$/;
const MAX_TAGS = 10;

function TagPill({ tag, studentName, onRemove }: { tag: string; studentName: string; onRemove: () => void }) {
  const t = useT();
  return (
    <span className="tag-pill">
      {tag}
      <button type="button" onClick={onRemove} title={t('Remove tag')} aria-label={t('Remove tag {tag} from {name}', { tag, name: studentName })}>
        <span aria-hidden>×</span>
      </button>
    </span>
  );
}

function TagInput({ studentName, onAdd }: { studentName: string; onAdd: (tag: string) => void }) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');

  function commit() {
    const tag = val.toLowerCase().trim();
    if (tag && TAG_REGEX.test(tag) && tag.length <= 30) onAdd(tag);
    setVal('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="tag-add-btn"
        onClick={() => setOpen(true)}
        aria-label={t('Add a tag to {name}', { name: studentName })}
      >
        {t('+ tag')}
      </button>
    );
  }

  return (
    <>
      <label htmlFor={id} className="sr-only">{t('New tag for {name}', { name: studentName })}</label>
      <input
        id={id}
        autoFocus
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setVal(''); setOpen(false); }
        }}
        onBlur={commit}
        maxLength={30}
        style={{ width: 80, padding: '2px 6px', fontSize: 12 }}
        placeholder={t('tag-name')}
      />
    </>
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
  const searchId = useId();
  const qc = useQueryClient();
  const { showToast } = useToast();
  const [savingTags, setSavingTags] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const key = ['students', cohortId];

  // Same key as the Preferences tab: tells the delete confirmation how many rules go with a student.
  const { data: rules } = useQuery<{ binary: BinaryConstraint[]; unary: UnaryConstraint[] }>({
    queryKey: ['constraints', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/constraints`).then((r) => r.data),
  });
  const ruleCount = (id: string) =>
    (rules?.binary.filter((b) => b.student_a_id === id || b.student_b_id === id).length ?? 0)
    + (rules?.unary.filter((u) => u.student_id === id).length ?? 0);

  // Per-student write queue: tag and gender edits reach the server in click order.
  const writes = useRef(new Map<string, Promise<unknown>>());
  function enqueueWrite(studentId: string, body: object) {
    const write = (writes.current.get(studentId) ?? Promise.resolve()).catch(() => {})
      .then(() => api.put(`/students/${studentId}`, body));
    writes.current.set(studentId, write);
    return write;
  }

  const deleteMutation = useMutation({
    mutationFn: (s: { id: string; name: string; rules: number }) => api.delete(`/students/${s.id}`),
    onSuccess: (_, s) => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['cohorts'] });
      qc.invalidateQueries({ queryKey: ['constraints', cohortId] });
      qc.invalidateQueries({ queryKey: ['validation', cohortId] });
      // Only claim rules were removed when there were some.
      showToast(s.rules > 0
        ? t('Student removed. Any constraints involving {name} were also removed.', { name: s.name })
        : t('{name} removed.', { name: s.name }), 'success');
      setConfirmDelete(null);
    },
    onError: () => showToast(t('Failed to remove student.'), 'error'),
  });

  /**
   * Tags are computed from the latest cache, not the row's render-time props: two quick edits
   * (add then remove) would otherwise both start from the same stale list and the second
   * would undo the first.
   */
  async function editTags(studentId: string, change: (tags: string[]) => string[] | null) {
    await qc.cancelQueries({ queryKey: key });
    const current = qc.getQueryData<Student[]>(key)?.find((s) => s.id === studentId);
    if (!current) return;
    const next = change(current.tags);
    if (!next) return;
    qc.setQueryData<Student[]>(key, (old) => old?.map((s) => (s.id === studentId ? { ...s, tags: next } : s)));
    setSavingTags((prev) => new Set(prev).add(studentId));
    try {
      await enqueueWrite(studentId, { tags: next });
    } catch {
      showToast(t('Failed to update tags.'), 'error');
      qc.invalidateQueries({ queryKey: key }); // resync with the server's truth
    } finally {
      setSavingTags((prev) => { const s = new Set(prev); s.delete(studentId); return s; });
    }
  }

  async function cycleGender(studentId: string) {
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
      qc.invalidateQueries({ queryKey: key });
    }
  }

  const q = normName(query);
  const visible = useMemo(
    () => (q ? students.filter((s) => normName(`${s.first_name} ${s.last_name} ${s.tags.join(' ')}`).includes(q)) : students),
    [students, q],
  );

  if (students.length === 0) return null;

  return (
    <>
      <div className="student-search">
        <label htmlFor={searchId} className="sr-only">{t('Search students')}</label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Search by name or tag…')}
        />
        {q && <span className="form-hint" role="status">{t('{n} of {total} shown', { n: visible.length, total: students.length })}</span>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('First name')}</th>
              <th scope="col">{t('Last name')}</th>
              <th scope="col">{t('Gender')}</th>
              <th scope="col">{t('Tags')}<HelpTip text={t('Free labels (e.g. “support”) for group rules.')} /></th>
              <th scope="col">{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={5} style={{ color: 'var(--text3)', textAlign: 'center' }}>{t('No students match “{q}”.', { q: query })}</td></tr>
            )}
            {visible.map((s) => {
              const saving = savingTags.has(s.id);
              const deleting = confirmDelete === s.id;
              const name = `${s.first_name} ${s.last_name}`;
              const nRules = ruleCount(s.id);
              return (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.first_name}</td>
                  <td>{s.last_name}</td>
                  <td><GenderCell student={s} onCycle={() => cycleGender(s.id)} /></td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }} aria-busy={saving}>
                      {s.tags.map((tag) => (
                        <TagPill key={tag} tag={tag} studentName={name} onRemove={() => editTags(s.id, (tags) => tags.filter((x) => x !== tag))} />
                      ))}
                      {s.tags.length < MAX_TAGS && (
                        <TagInput
                          studentName={name}
                          onAdd={(tag) => editTags(s.id, (tags) => (tags.includes(tag) || tags.length >= MAX_TAGS ? null : [...tags, tag]))}
                        />
                      )}
                      {saving && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} aria-hidden />}
                    </div>
                  </td>
                  <td>
                    {deleting ? (
                      <div className="student-delete-confirm" role="group" aria-label={t('Remove {name}?', { name })}>
                        <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>
                          {t('Remove {name}?', { name })}
                          {nRules > 0 && (
                            <strong className="student-delete-warn">
                              {' '}{nRules === 1
                                ? t('Their {n} preference will be deleted too.', { n: nRules })
                                : t('Their {n} preferences will be deleted too.', { n: nRules })}
                            </strong>
                          )}
                        </span>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => deleteMutation.mutate({ id: s.id, name: s.first_name, rules: nRules })}
                          disabled={deleteMutation.isPending}
                        >
                          {deleteMutation.isPending ? t('Deleting…') : t('Remove')}
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(null)}>
                          {t('Cancel')}
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--coral)' }}
                        aria-label={t('Delete {name}', { name })}
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
    </>
  );
}
