import { getLocale, translate } from '../i18n';

/** "just now", "3 hours ago", "2 days ago", … — localised to the current UI language. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [365 * 86400, 'year'],
    [30 * 86400, 'month'],
    [7 * 86400, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'always' });
  for (const [size, name] of units) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return rtf.format(-n, name);
  }
  return translate('just now');
}
