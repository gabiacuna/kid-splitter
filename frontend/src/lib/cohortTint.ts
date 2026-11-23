// Teal / sage / lavender accent pairs, shared by cohort icons and solution rank colours.
export const ACCENTS = [
  { bg: 'var(--teal-light)', fg: 'var(--teal-dark)' },
  { bg: 'var(--sage-light)', fg: 'var(--sage-dark)' },
  { bg: 'var(--lavender-light)', fg: 'var(--lavender)' },
  { bg: 'var(--coral-light)', fg: 'var(--coral)' },
];

// Stable per-cohort icon tint: hashed from the id, so it never reshuffles when
// cohorts are created or deleted (an array index would).
export function cohortTint(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}
