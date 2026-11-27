import type { Gender, ImportCandidate, PreferenceMatch, PreviewRow, Student } from './types';
import { translate } from '../i18n';

/**
 * Client-side state of the CSV preview (docs/design-review/01-ui-pass.md, phase 2).
 * Pure helpers, so the component only wires them to the UI.
 */

export interface PrefState extends PreferenceMatch {
  /** Candidate keys this preference resolves to; each becomes a "together" rule. */
  chosen: string[];
  /** The teacher chose to drop it. */
  skipped: boolean;
}

export interface RowState extends Omit<PreviewRow, 'preferences'> {
  include: boolean;
  prefs: PrefState[];
  /** Kept from the upload: the gender cell wasn't recognised. */
  genderUnclear: boolean;
  /** Added from a preference name ("añadir como nuevo/a"): the normalised name it came from. */
  addedFor?: string;
}

export const rowKey = (rowIndex: number) => `row:${rowIndex}`;
/** Who a row's preferences belong to: its existing twin, or the row itself. */
export const ownerKey = (r: RowState) => r.existing_student_id ?? rowKey(r.row_index);
export const display = (r: { first_name: string; last_name: string }) => `${r.first_name} ${r.last_name}`.trim();

export const normName = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');

const INJECTION = /^[=+\-@]/;

export function initialRows(rows: PreviewRow[]): RowState[] {
  return rows.map(({ preferences, ...r }) => ({
    ...r,
    include: r.importable,
    genderUnclear: r.status === 'invalid_gender',
    prefs: preferences.map((p) => ({
      ...p,
      chosen: p.status === 'matched' && p.matched_key ? [p.matched_key] : [],
      skipped: false,
    })),
  }));
}

/** Are this row's preferences going to be used? (created, or added to its existing twin) */
export const prefsApply = (r: RowState) => r.include || (!!r.existing_student_id && r.status === 'duplicate_exact');

export const isPending = (p: PrefState) => !p.skipped && p.chosen.length === 0;

/**
 * Re-check a row after the teacher edits its name: a fixed "Missing name" becomes importable,
 * and a rename can create or remove a duplicate. Approximate on purpose (the client doesn't
 * have the raw columns); the backend validates names again on confirm.
 */
export function revalidateRow(row: RowState, rows: RowState[], existing: Student[]): RowState {
  const first = row.first_name.trim();
  const last = row.last_name.trim();
  const base = { ...row, status_code: null, status_params: {}, status_message: null, existing_student_id: null };
  if (!first || !last || INJECTION.test(first) || INJECTION.test(last)) {
    return { ...base, status: 'missing_name', status_code: 'missing_name', status_params: { reason: first && last ? 'injection' : 'blank' }, importable: false, include: false };
  }
  if (row.status === 'invalid_tag') return row; // tags can't be edited here; stays skipped
  const name = normName(`${first} ${last}`);
  const wasImportable = row.status !== 'missing_name' && row.status !== 'duplicate_exact';
  const twin = existing.find((s) => normName(display(s)) === name);
  if (twin) {
    const fields = [
      (twin.gender ?? null) !== (row.gender ?? null) ? 'gender' : '',
      [...twin.tags].sort().join(',') !== [...row.tags].sort().join(',') ? 'tags' : '',
    ].filter(Boolean);
    if (fields.length === 0) {
      return { ...base, status: 'duplicate_exact', status_code: 'duplicate_exact', status_params: { of: 'existing' }, existing_student_id: twin.id, importable: false, include: false };
    }
    return { ...base, status: 'duplicate_similar', status_code: 'duplicate_similar', status_params: { of: 'existing', fields: fields.join(',') }, importable: true, include: wasImportable ? row.include : true };
  }
  const earlier = rows.find((r) => r.row_index !== row.row_index && r.row_index < row.row_index && r.status !== 'missing_name' && normName(display(r)) === name);
  if (earlier) {
    return { ...base, status: 'duplicate_similar', status_code: 'duplicate_similar', status_params: { of: 'row', line: String(earlier.row_index + 2) }, importable: true, include: wasImportable ? row.include : true };
  }
  const status = row.genderUnclear ? 'invalid_gender' : 'ok';
  return { ...base, status, status_code: status === 'ok' ? null : 'invalid_gender', importable: true, include: wasImportable ? row.include : true };
}

/** One group per distinct non-matched name, with every row that lists it. */
export interface PendingGroup {
  key: string;
  name: string;
  status: PreferenceMatch['status'];
  owners: { rowIndex: number; prefIndex: number; ownerKey: string; ownerName: string; pref: PrefState }[];
  candidates: ImportCandidate[];
  pending: number;
}

export function pendingGroups(rows: RowState[]): PendingGroup[] {
  const groups = new Map<string, PendingGroup>();
  rows.forEach((r, rowIndex) => {
    if (!prefsApply(r)) return;
    r.prefs.forEach((p, prefIndex) => {
      if (p.status === 'matched') return;
      const key = normName(p.name);
      let g = groups.get(key);
      if (!g) {
        g = { key, name: p.name, status: p.status, owners: [], candidates: [], pending: 0 };
        groups.set(key, g);
      }
      g.owners.push({ rowIndex, prefIndex, ownerKey: ownerKey(r), ownerName: display(r), pref: p });
      for (const c of p.suggestions ?? []) if (!g.candidates.some((x) => x.key === c.key)) g.candidates.push(c);
      if (isPending(p)) g.pending += 1;
    });
  });
  // Students added from this name are candidates too.
  for (const r of rows) {
    if (!r.addedFor) continue;
    const g = groups.get(r.addedFor);
    const c: ImportCandidate = { key: rowKey(r.row_index), display: display(r), source: 'upload', row_index: r.row_index };
    if (g && !g.candidates.some((x) => x.key === c.key)) g.candidates.push(c);
  }
  return [...groups.values()];
}

/** Preference names are written "Given Surname", so the last word is the surname. */
export function splitPreferenceName(name: string): { first: string; last: string } | null {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return null;
  return { first: words.slice(0, -1).join(' '), last: words[words.length - 1] };
}

export function newRowFromName(name: string, rows: RowState[], groupKey: string): RowState | null {
  const parts = splitPreferenceName(name);
  if (!parts) return null;
  return {
    row_index: Math.max(-1, ...rows.map((r) => r.row_index)) + 1,
    first_name: parts.first,
    last_name: parts.last,
    tags: [],
    gender: null as Gender,
    status: 'ok',
    status_code: 'added_from_preference',
    status_params: {},
    importable: true,
    include: true,
    genderUnclear: false,
    addedFor: groupKey,
    prefs: [],
  };
}

/** The translated one-line explanation for a row's status. */
export function statusText(r: Pick<RowState, 'status' | 'status_code' | 'status_params'>): string {
  const p = r.status_params ?? {};
  const fields = (p.fields ?? '').split(',').filter(Boolean)
    .map((f) => (f === 'gender' ? translate('gender') : f === 'tags' ? translate('tags') : f)).join(', ');
  switch (r.status_code ?? r.status) {
    case 'missing_name':
      return p.reason === 'injection'
        ? translate('A name can’t start with = + - or @.')
        : translate('First and last name are both needed — type them in.');
    case 'invalid_tag':
      return p.reason === 'injection'
        ? translate('Tag “{tag}” can’t start with = + - or @. This row will be skipped.', { tag: p.tag ?? '' })
        : translate('Tag “{tag}” can only use letters, numbers and hyphens. This row will be skipped.', { tag: p.tag ?? '' });
    case 'invalid_gender':
      return translate('Gender “{value}” not recognised — imported as not set.', { value: p.value ?? '' });
    case 'duplicate_exact':
      return p.of === 'existing'
        ? translate('Already in this cohort with the same details. Not imported.')
        : translate('Identical to line {line}. Not imported.', { line: p.line ?? '?' });
    case 'duplicate_similar':
      if (p.of === 'existing') {
        return fields
          ? translate('Possible duplicate: a student with this name is already in the cohort ({fields} differ).', { fields })
          : translate('Possible duplicate: a student with this name is already in the cohort.');
      }
      return fields
        ? translate('Possible duplicate of line {line} ({fields} differ).', { line: p.line ?? '?', fields })
        : translate('Possible duplicate of line {line}.', { line: p.line ?? '?' });
    case 'added_from_preference':
      return translate('Added from a pairing preference');
    default:
      return '';
  }
}
