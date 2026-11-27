import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import type { Student } from '../lib/types';
import StudentTable from '../components/StudentTable';
import AddStudentForm from '../components/AddStudentForm';
import CsvUploadButton from '../components/CsvUpload';
import { useT } from '../i18n';
import ErrorState from '../components/ErrorState';
import HelpTip from '../components/HelpTip';
import { loadErrorMessage } from '../lib/errors';

export default function StudentListTab({ cohortId, balanceGender }: { cohortId: string; balanceGender: boolean }) {
  const t = useT();
  const { data: students, isLoading, isError, error, refetch, isRefetching } = useQuery<Student[]>({
    queryKey: ['students', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/students`).then((r) => r.data),
  });

  if (isLoading) return <div style={{ padding: 24 }}><div className="spinner" /></div>;
  if (isError && !students) return <ErrorState message={loadErrorMessage(error, 'We couldn’t load the students.')} onRetry={() => refetch()} retrying={isRefetching} />;

  const count = students?.length ?? 0;
  const unknownGender = students?.filter((s) => !s.gender).length ?? 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text2)' }}>
          {count === 1 ? t('{n} student', { n: count }) : t('{n} students', { n: count })}
        </span>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <AddStudentForm cohortId={cohortId} />
          <CsvUploadButton cohortId={cohortId} />
        </div>
      </div>

      {balanceGender && count > 0 && unknownGender > 0 && (
        <div className="warn-banner" style={{ marginBottom: 12 }}>
          {unknownGender === count
            ? t('Gender balancing is on, but no students have a gender set yet.')
            : t('{unknown} of {count} students have no gender set.', { unknown: unknownGender, count })}
          {' '}{t('Click the Gender cell to set it — students left unknown are placed freely and not balanced.')}
          <HelpTip text={t('Only a tie-breaker: it never breaks a preference. Students without a gender are placed freely.')} />
        </div>
      )}

      {count === 0 ? (
        <div className="empty-state" style={{ border: '2px dashed var(--border)', borderRadius: 'var(--r)', background: 'var(--bg2)' }}>
          <h3>{t('No students yet')}</h3>
          <p>{t('Add students one at a time or import a CSV file.')}</p>
          <p className="form-hint">
            {t('CSV columns:')} <code>{t('first_name,last_name,gender,tags,preferences')}</code>. {t('Tags are comma-separated; the optional')}{' '}
            <code>{t('gender')}</code> {t('column accepts boy/girl (or b/g, m/f); the optional')}{' '}
            <code>{t('preferences')}</code> {t('column lists classmate names (pipe-separated) to keep together.')}
          </p>
          <p className="form-hint">{t('Use “Download template” next to “Import CSV” for a ready-made file.')}</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <StudentTable cohortId={cohortId} students={students!} />
        </div>
      )}
    </div>
  );
}
