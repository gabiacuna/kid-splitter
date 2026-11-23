// Stable per-cohort icon tint: hashed from the id, so it never reshuffles when
// cohorts are created or deleted (an array index would).
const TINTS = [
  { bg: 'var(--teal-light)', fg: 'var(--teal-dark)' },
  { bg: 'var(--sage-light)', fg: 'oklch(42% 0.09 155)' },
  { bg: 'var(--lavender-light)', fg: 'var(--lavender)' },
  { bg: 'var(--coral-light)', fg: 'var(--coral)' },
];

export function cohortTint(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}
