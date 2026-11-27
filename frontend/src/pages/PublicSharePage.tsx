import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';
import type { PublicSolutionData } from '../lib/types';
import { classColorStyle, classLabel } from '../lib/classes';
import { useT } from '../i18n';
import { httpStatus, isNetworkError } from '../lib/errors';
import { Logo } from '../components/Nav';
import LangToggle from '../components/LangToggle';
import ErrorState from '../components/ErrorState';

type Status = 'loading' | 'loaded' | 'not_found' | 'network' | 'error';

export default function PublicSharePage() {
  const t = useT();
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicSolutionData | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  const load = useCallback(() => {
    setStatus('loading');
    api.get(`/share/${token}`)
      .then((r) => { setData(r.data); setStatus('loaded'); })
      .catch((err: unknown) => {
        if (httpStatus(err) === 404) setStatus('not_found');
        else if (isNetworkError(err)) setStatus('network');
        else setStatus('error');
      });
  }, [token]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="share-page">
      <header className="share-page-head">
        <Logo />
        <LangToggle />
      </header>

      {status === 'loading' && <div className="share-page-center"><div className="spinner spinner-lg" /></div>}

      {status === 'not_found' && (
        <div className="share-page-center">
          <h1 className="share-page-msg-title">{t('This link is no longer available.')}</h1>
          <p className="share-page-msg">{t('The teacher may have stopped sharing it or made a new list. Ask them for a new link.')}</p>
        </div>
      )}

      {(status === 'network' || status === 'error') && (
        <div className="share-page-center">
          <ErrorState
            message={status === 'network'
              ? t('We can’t reach the server. Check your connection.')
              : t('Something went wrong. Try again later.')}
            onRetry={load}
          />
        </div>
      )}

      {status === 'loaded' && data && (
        <main>
          <h1 className="share-page-title">{t('{cohort} — Class Lists', { cohort: data.cohort_name })}</h1>
          <p className="share-page-sub">{t('Shared view · Names only')}</p>
          <div className="roster-grid">
            {data.classes.map((cls) => (
              <section key={cls.class_number} className="roster-class-card" style={classColorStyle(cls.class_number)} aria-label={classLabel(cls.class_number)}>
                <div className="roster-class-header">
                  <span>{classLabel(cls.class_number)}</span>
                  <span style={{ fontWeight: 500, opacity: 0.75 }}>{cls.students.length === 1 ? t('{n} student', { n: cls.students.length }) : t('{n} students', { n: cls.students.length })}</span>
                </div>
                {[...cls.students].sort((a, b) => a.first_name.localeCompare(b.first_name)).map((s, i) => (
                  <div key={i} className="roster-student-row">
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{s.first_name}</span>
                    {s.tags.map((tag) => (
                      <span key={tag} className="tag-pill" style={{ fontSize: 11.5 }}>{tag}</span>
                    ))}
                  </div>
                ))}
              </section>
            ))}
          </div>
        </main>
      )}
    </div>
  );
}
