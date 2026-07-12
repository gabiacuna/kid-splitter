import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import type { Student } from '../lib/types';
import StudentTable from '../components/StudentTable';
import AddStudentForm from '../components/AddStudentForm';
import CsvUploadButton from '../components/CsvUpload';

export default function StudentListTab({ cohortId }: { cohortId: string }) {
  const { data: students, isLoading, isError } = useQuery<Student[]>({
    queryKey: ['students', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/students`).then((r) => r.data),
  });

  if (isLoading) return <div style={{ padding: 24 }}><div className="spinner" /></div>;
  if (isError) return <div className="warn-banner">Failed to load students.</div>;

  const count = students?.length ?? 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text2)' }}>
          {count} {count === 1 ? 'student' : 'students'}
        </span>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <AddStudentForm cohortId={cohortId} />
          <CsvUploadButton cohortId={cohortId} />
        </div>
      </div>

      {count === 0 ? (
        <div className="empty-state" style={{ border: '2px dashed var(--border)', borderRadius: 'var(--r)', background: 'var(--bg2)' }}>
          <h3>No students yet</h3>
          <p>Add students one at a time or import a CSV file.</p>
          <p className="form-hint">
            CSV columns: <code>first_name,last_name,tags,preferences</code>. Tags are comma-separated;
            the optional <code>preferences</code> column lists classmate names (pipe-separated) to keep together.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <StudentTable cohortId={cohortId} students={students!} />
        </div>
      )}
    </div>
  );
}
