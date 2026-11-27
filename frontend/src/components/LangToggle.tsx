import { useLang, type Lang } from '../i18n';

const LANGS: { code: Lang; label: string }[] = [
  { code: 'es', label: 'ES' },
  { code: 'en', label: 'EN' },
];

/** ES / EN switch. In the nav, and on pages without a nav (sign-in, sign-up, share links). */
export default function LangToggle({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useLang();
  return (
    <div className={`lang-toggle ${className}`.trim()} role="group" aria-label={t('Language')}>
      {LANGS.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          className={`lang-toggle-btn${lang === code ? ' active' : ''}`}
          aria-pressed={lang === code}
          lang={code}
          aria-label={code === 'es' ? 'Español' : 'English'}
          onClick={() => setLang(code)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
