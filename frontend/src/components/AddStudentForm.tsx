import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { Gender } from '../lib/types';
import { genderLabel } from '../lib/gender';
import { useT } from '../i18n';

const TAG_REGEX = /^[a-z0-9-]+$/;

export default function AddStudentForm({ cohortId }: { cohortId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const firstRef = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [gender, setGender] = useState<Gender>(null);
  const [tagInput, setTagInput] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: (body: object) => api.post(`/cohorts/${cohortId}/students`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students', cohortId] });
      qc.invalidateQueries({ queryKey: ['cohorts'] });
      setFirstName(''); setLastName(''); setTags([]); setGender(null); setErrors({}); setServerError('');
      setTimeout(() => firstRef.current?.focus(), 50);
    },
    onError: () => setServerError(t('Failed to add student. Try again.')),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!firstName.trim()) errs.firstName = t('First name is required.');
    if (!lastName.trim()) errs.lastName = t('Last name is required.');
    if (firstName.trim().length > 100) errs.firstName = t('Name must be 100 characters or fewer.');
    if (lastName.trim().length > 100) errs.lastName = t('Name must be 100 characters or fewer.');
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setServerError('');
    mutation.mutate({ first_name: firstName.trim(), last_name: lastName.trim(), tags, gender });
  }

  function addTag() {
    const tag = tagInput.toLowerCase().trim();
    if (tag && TAG_REGEX.test(tag) && tag.length <= 30 && !tags.includes(tag) && tags.length < 10) {
      setTags((prev) => [...prev, tag]);
    }
    setTagInput('');
  }

  if (!open) {
    return (
      <button className="btn btn-secondary" onClick={() => { setOpen(true); setTimeout(() => firstRef.current?.focus(), 50); }}>
        {t('+ Add student')}
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: 'var(--card)', border: '1.5px solid var(--border)', borderRadius: 'var(--r-sm)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="form-field">
          <label className="form-label">{t('First name *')}</label>
          <input ref={firstRef} type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={100} disabled={mutation.isPending} placeholder={t('Alice')} />
          {errors.firstName && <span className="form-error">{errors.firstName}</span>}
        </div>
        <div className="form-field">
          <label className="form-label">{t('Last name *')}</label>
          <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={100} disabled={mutation.isPending} placeholder={t('Smith')} />
          {errors.lastName && <span className="form-error">{errors.lastName}</span>}
        </div>
      </div>
      <div className="form-field">
        <span className="form-label" id="add-student-gender">{t('Gender')}</span>
        <div className="dist-toggle" role="radiogroup" aria-labelledby="add-student-gender" style={{ alignSelf: 'flex-start' }}>
          {(['boy', 'girl', null] as Gender[]).map((value) => [value, genderLabel(value, t('Not specified'))] as const).map(([value, label]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={gender === value}
              className={`dist-toggle-opt${gender === value ? ' active' : ''}`}
              onClick={() => setGender(value)}
              disabled={mutation.isPending}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="form-field">
        <label className="form-label">{t('Tags (optional)')}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {tags.map((tag) => (
            <span key={tag} className="tag-pill">
              {tag}
              <button type="button" onClick={() => setTags((prev) => prev.filter((x) => x !== tag))}>×</button>
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
              placeholder={t('add tag…')}
            />
          )}
        </div>
      </div>
      {serverError && <span className="form-error">{serverError}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? t('Adding…') : t('Add student')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={mutation.isPending}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  );
}
