import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import type { BinaryConstraint, ClassAssignment, Solution, Student, UnaryConstraint } from '../lib/types';
import Nav from '../components/Nav';
import ShareModal from '../components/ShareModal';
import { useToast } from '../components/Toast';

function classLabel(classNum: number): string {
  return `Class ${classNum}`;
}

function getStudentName(id: string, students: Student[]): string {
  const s = students.find((x) => x.id === id);
  return s ? `${s.first_name} ${s.last_name}` : '[Removed student]';
}


function computeBinarySatisfaction(
  constraint: BinaryConstraint,
  assignments: ClassAssignment[]
): { satisfied: boolean; classA: number | null; classB: number | null } {
  const asgn = Object.fromEntries(assignments.map((a) => [a.student_id, a.class_number]));
  const ca = asgn[constraint.student_a_id] ?? null;
  const cb = asgn[constraint.student_b_id] ?? null;
  if (ca === null || cb === null) return { satisfied: false, classA: ca, classB: cb };
  const satisfied = constraint.type === 'together' ? ca === cb : ca !== cb;
  return { satisfied, classA: ca, classB: cb };
}

interface ConstraintSummaryProps {
  binary: BinaryConstraint[];
  assignments: ClassAssignment[];
  students: Student[];
}

function ConstraintSummary({ binary, assignments, students }: ConstraintSummaryProps) {
  const [open, setOpen] = useState(false);

  const results = binary.map((c) => {
    const { satisfied, classA, classB } = computeBinarySatisfaction(c, assignments);
    const nameA = getStudentName(c.student_a_id, students);
    const nameB = getStudentName(c.student_b_id, students);
    const hardLabel = c.is_hard ? 'hard' : `soft, w${c.weight.toFixed(1)}`;
    const description = `${nameA} + ${nameB}: ${c.type} (${hardLabel})`;
    let detail = satisfied ? 'Satisfied' : '';
    if (!satisfied) {
      if (classA !== null && classB !== null) {
        if (c.type === 'together') {
          detail = `Violated (${nameA} in Class ${classA}, ${nameB} in Class ${classB})`;
        } else {
          detail = `Violated (both in Class ${classA})`;
        }
      } else {
        detail = 'Violated (student missing from assignments)';
      }
    }
    return { satisfied, description, detail };
  });

  const satisfiedCount = results.filter((r) => r.satisfied).length;
  const violatedCount = results.length - satisfiedCount;

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <button
        onClick={() => setOpen((p) => !p)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0 }}
      >
        <span style={{ fontSize: 15, fontWeight: 700 }}>Constraint satisfaction</span>
        <span style={{ fontSize: 13, color: 'var(--text3)' }}>
          {satisfiedCount} satisfied · {violatedCount} violated {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="constraint-summary-list">
          {results.length === 0 && (
            <p style={{ fontSize: 13.5, color: 'var(--text3)' }}>No binary constraints.</p>
          )}
          {results.map((r, i) => (
            <div key={i} className={`constraint-summary-row${r.satisfied ? '' : ' violated'}`}>
              <span className="cs-icon">{r.satisfied ? '✓' : '✗'}</span>
              <div>
                <div style={{ fontWeight: 600 }}>{r.description}</div>
                <div style={{ fontSize: 12.5, color: r.satisfied ? 'var(--sage)' : 'var(--coral)', marginTop: 2 }}>{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ClassRosterProps {
  assignments: ClassAssignment[];
  students: Student[];
}

function ClassRoster({ assignments, students }: ClassRosterProps) {
  const byClass: Record<number, ClassAssignment[]> = {};
  for (const a of assignments) {
    if (!byClass[a.class_number]) byClass[a.class_number] = [];
    byClass[a.class_number].push(a);
  }

  const classNumbers = Object.keys(byClass).map(Number).sort((a, b) => a - b);

  return (
    <div className="roster-grid">
      {classNumbers.map((cn) => {
        const members = [...byClass[cn]].sort((a, b) => {
          const sa = students.find((s) => s.id === a.student_id);
          const sb = students.find((s) => s.id === b.student_id);
          const na = sa ? `${sa.last_name} ${sa.first_name}` : '';
          const nb = sb ? `${sb.last_name} ${sb.first_name}` : '';
          return na.localeCompare(nb);
        });
        return (
          <div key={cn} className="roster-class-card">
            <div className="roster-class-header">
              <span>{classLabel(cn)}</span>
              <span style={{ fontWeight: 500 }}>{members.length} students</span>
            </div>
            {members.map((a) => {
              const s = students.find((x) => x.id === a.student_id);
              return (
                <div key={a.student_id} className="roster-student-row">
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {s ? `${s.first_name} ${s.last_name}` : '[Removed student]'}
                  </span>
                  {s?.tags.map((t) => (
                    <span key={t} className="tag-pill" style={{ fontSize: 11 }}>{t}</span>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export default function SolutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [showShare, setShowShare] = useState(false);
  const [shareEnabled, setShareEnabled] = useState<boolean | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);

  const { data: solution, isLoading: solutionLoading, isError: solutionError, error: solutionErr } = useQuery<Solution>({
    queryKey: ['solution', id],
    queryFn: () => api.get(`/solutions/${id}`).then((r) => r.data),
    retry: false,
  });

  const cohortId = solution?.cohort_id;

  const { data: students = [] } = useQuery<Student[]>({
    queryKey: ['students', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/students`).then((r) => r.data),
    enabled: !!cohortId,
  });

  const { data: constraintData } = useQuery<{ binary: BinaryConstraint[]; unary: UnaryConstraint[] }>({
    queryKey: ['constraints', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/constraints`).then((r) => r.data),
    enabled: !!cohortId,
  });

  if (solutionError) {
    const status = (solutionErr as { response?: { status: number } })?.response?.status;
    if (status === 403 || status === 404) {
      showToast('Solution not found.', 'error');
      navigate('/cohorts');
      return null;
    }
  }

  if (solutionLoading) {
    return (
      <>
        <Nav />
        <div className="full-page-spinner"><div className="spinner spinner-lg" /></div>
      </>
    );
  }

  if (!solution) return null;

  const effectiveShareEnabled = shareEnabled ?? solution.share_enabled;
  const effectiveShareToken = shareToken !== null ? shareToken : solution.share_token;
  const binary = constraintData?.binary ?? [];

  return (
    <>
      <Nav />
      <div className="page-wrap">
        <div style={{ paddingTop: 28, paddingBottom: 24 }}>
          <Link
            to={`/cohorts/${cohortId}?tab=solutions`}
            style={{ fontSize: 13.5, color: 'var(--teal)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 20 }}
          >
            ← Back to class lists
          </Link>

          {solution.hard_violations > 0 && (
            <div className="warn-banner" style={{ marginBottom: 16, borderColor: '#ef4444', background: '#fee2e2', color: '#b91c1c' }}>
              ⚠ This solution has {solution.hard_violations} hard constraint violation(s). This indicates a solver problem — do not use this arrangement.
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h1 className="page-title">{solution.label}</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                <span>
                  <span className="solution-score" style={{ fontSize: 22 }}>{solution.score.toFixed(1)}</span>
                  <span style={{ fontSize: 13, color: 'var(--text3)', marginLeft: 6 }}>(lower is better)</span>
                </span>
                {solution.hard_violations > 0 && (
                  <span className="badge badge-red">⚠ {solution.hard_violations} hard violation(s)</span>
                )}
                <span className="badge badge-teal">{solution.soft_violations} soft unmet</span>
              </div>
            </div>
            <button
              className={`btn ${effectiveShareEnabled ? 'btn-secondary' : 'btn-outline'}`}
              onClick={() => setShowShare(true)}
            >
              {effectiveShareEnabled ? 'Shared ✓' : 'Share'}
            </button>
          </div>
        </div>

        <ClassRoster assignments={solution.class_assignments} students={students} />

        <ConstraintSummary
          binary={binary}
          assignments={solution.class_assignments}
          students={students}
        />
      </div>

      {showShare && (
        <ShareModal
          solutionId={solution.id}
          shareEnabled={effectiveShareEnabled}
          shareToken={effectiveShareToken}
          onClose={() => setShowShare(false)}
          onShareStateChange={(enabled, token) => {
            setShareEnabled(enabled);
            setShareToken(token);
          }}
        />
      )}
    </>
  );
}
