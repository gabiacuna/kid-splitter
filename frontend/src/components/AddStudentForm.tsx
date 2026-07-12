import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

const TAG_REGEX = /^[a-z0-9-]+$/;

export default function AddStudentForm({ cohortId }: { cohortId: string }) {
  const qc = useQueryClient();
  const firstRef = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: (body: object) => api.post(`/cohorts/${cohortId}/students`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students', cohortId] });
      qc.invalidateQueries({ queryKey: ['cohorts'] });
      setFirstName(''); setLastName(''); setTags([]); setErrors({}); setServerError('');
      setTimeout(() => firstRef.current?.focus(), 50);
    },
    onError: () => setServerError('Failed to add student. Try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!firstName.trim()) errs.firstName = 'First name is required.';
    if (!lastName.trim()) errs.lastName = 'Last name is required.';
    if (firstName.trim().length > 100) errs.firstName = 'Name must be 100 characters or fewer.';
    if (lastName.trim().length > 100) errs.lastName = 'Name must be 100 characters or fewer.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setServerError('');
    mutation.mutate({ first_name: firstName.trim(), last_name: lastName.trim(), tags });
  }

  function addTag() {
    const t = tagInput.toLowerCase().trim();
    if (t && TAG_REGEX.test(t) && t.length <= 30 && !tags.includes(t) && tags.length < 10) {
      setTags((prev) => [...prev, t]);
    }
    setTagInput('');
  }

  if (!open) {
    return (
      <button className="btn btn-secondary" onClick={() => { setOpen(true); setTimeout(() => firstRef.current?.focus(), 50); }}>
        + Add student
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: 'var(--card)', border: '1.5px solid var(--border)', borderRadius: 'var(--r-sm)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="form-field">
          <label className="form-label">First name *</label>
          <input ref={firstRef} type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={100} disabled={mutation.isPending} placeholder="Alice" />
          {errors.firstName && <span className="form-error">{errors.firstName}</span>}
        </div>
        <div className="form-field">
          <label className="form-label">Last name *</label>
          <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={100} disabled={mutation.isPending} placeholder="Smith" />
          {errors.lastName && <span className="form-error">{errors.lastName}</span>}
        </div>
      </div>
      <div className="form-field">
        <label className="form-label">Tags (optional)</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {tags.map((t) => (
            <span key={t} className="tag-pill">
              {t}
              <button type="button" onClick={() => setTags((prev) => prev.filter((x) => x !== t))}>×</button>
            </span>
          ))}
          {tags.length < 10 && (
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              onBlur={addTag}
              maxLength={30}
              style={{ width: 90, padding: '4px 8px', fontSize: 12 }}
              placeholder="add tag…"
            />
          )}
        </div>
      </div>
      {serverError && <span className="form-error">{serverError}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Adding…' : 'Add student'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={mutation.isPending}>
          Cancel
        </button>
      </div>
    </form>
  );
}
