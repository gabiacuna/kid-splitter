import type { Solution } from './types';
import { translate } from '../i18n';

/** Teacher-facing name + one-line "what it optimises for" per solver variant. */
export const VARIANTS: Record<string, { name: string; subtitle: string }> = {
  balanced_sizes: { name: 'Balanced sizes', subtitle: 'Most equal class sizes — ignores preferences' },
  soft_priority: { name: 'Soft priority', subtitle: 'Best honours your together/apart preferences' },
  diversity_mix: { name: 'Diversity mix', subtitle: 'Honours preferences, spreads flagged students' },
};
const VARIANT_ORDER = ['soft_priority', 'diversity_mix', 'balanced_sizes'];

export const variantName = (label: string) => (VARIANTS[label] ? translate(VARIANTS[label].name) : label);
export const variantSubtitle = (label: string) => (VARIANTS[label] ? translate(VARIANTS[label].subtitle) : '');

/** Best first: higher score, then fewer soft violations, then the variant that honours
 *  preferences most. Rank (index) drives the accent colour and the BEST badge. */
export function rankSolutions(solutions: Solution[]): Solution[] {
  return [...solutions].sort((a, b) =>
    b.score - a.score
    || a.soft_violations - b.soft_violations
    || VARIANT_ORDER.indexOf(a.label) - VARIANT_ORDER.indexOf(b.label));
}
