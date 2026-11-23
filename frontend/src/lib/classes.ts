import type { CSSProperties } from 'react';
import { translate } from '../i18n';

// Must match the num_classes validators in backend/app/schemas/{cohort,solve}.py.
export const MIN_CLASSES = 2;
export const MAX_CLASSES = 4;

/** CSS colour for a 1-indexed class number. Single source of truth for class identity colour. */
export function classColor(classNumber: number): string {
  const n = ((classNumber - 1) % MAX_CLASSES) + 1;
  return `var(--class-${n})`;
}

/** Inline style that exposes the class colour to CSS as --class-color. */
export function classColorStyle(classNumber: number): CSSProperties {
  return { '--class-color': classColor(classNumber) } as CSSProperties;
}

/** "Class A", "Class B", … — the design's naming; used everywhere a class is shown. */
export function classLabel(classNumber: number): string {
  return translate('Class {letter}', { letter: String.fromCharCode(64 + classNumber) });
}
