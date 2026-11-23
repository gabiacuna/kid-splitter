import type { Gender } from './types';

export const GENDER_LABEL: Record<'boy' | 'girl', string> = { boy: 'Boy', girl: 'Girl' };

/** Label for a gender value; `unknown` is how null is shown in that context. */
export const genderLabel = (g: Gender | undefined, unknown = '—') => (g ? GENDER_LABEL[g] : unknown);

/** Click-to-cycle order: unknown → Boy → Girl → unknown. */
export const nextGender = (g: Gender | undefined): Gender => (g === null || g === undefined ? 'boy' : g === 'boy' ? 'girl' : null);
