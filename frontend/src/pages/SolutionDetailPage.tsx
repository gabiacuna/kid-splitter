import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import type { BinaryConstraint, ClassAssignment, Solution, Student, UnaryConstraint } from '../lib/types';
import Nav from '../components/Nav';
import ShareModal from '../components/ShareModal';
import { useToast } from '../components/Toast';
import { classColorStyle, classLabel } from '../lib/classes';
import { variantName } from '../lib/solutions';
import { groupByClass, studentName } from '../lib/roster';
import { useT } from '../i18n';

function computeBinarySatisfaction(
  constraint: BinaryConstraint,
  asgn: Map<string, number>,
): { satisfied: boolean; classA: number | null; classB: number | null } {
  const ca = asgn.get(constraint.student_a_id) ?? null;
  const cb = asgn.get(constraint.student_b_id) ?? null;
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
  const t = useT();

  // Built once per render, not once per rule (CSV imports create hundreds of rules).
  const asgn = new Map(assignments.map((a) => [a.student_id, a.class_number]));
  const byId = new Map(students.map((s) => [s.id, s]));
  const results = binary.map((c) => {
    const { satisfied, classA, classB } = computeBinarySatisfaction(c, asgn);
    const nameA = studentName(byId.get(c.student_a_id));
    const nameB = studentName(byId.get(c.student_b_id));
    const hardLabel = c.is_hard ? t('hard') : t('soft, w{w}', { w: c.weight.toFixed(1) });
    const description = t('{a} + {b}: {type} ({label})', { a: nameA, b: nameB, type: t(c.type), label: hardLabel });
    let detail = satisfied ? t('Satisfied') : '';
    if (!satisfied) {
      if (classA !== null && classB !== null) {
        if (c.type === 'together') {
          detail = t('Violated ({a} in {ca}, {b} in {cb})', { a: nameA, ca: classLabel(classA), b: nameB, cb: classLabel(classB) });
        } else {
          detail = t('Violated (both in {c})', { c: classLabel(classA) });
        }
      } else {
        detail = t('Violated (student missing from assignments)');
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
        <span style={{ fontSize: 15, fontWeight: 700 }}>{t('Constraint satisfaction')}</span>
        <span style={{ fontSize: 13, color: 'var(--text3)' }}>
          {t('{n} satisfied', { n: satisfiedCount })} · {t('{n} violated', { n: violatedCount })} {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="constraint-summary-list">
          {results.length === 0 && (
            <p style={{ fontSize: 13.5, color: 'var(--text3)' }}>{t('No binary constraints.')}</p>
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
  const t = useT();
  return (
    <div className="roster-grid">
      {groupByClass(assignments, students).map(({ classNumber: cn, members }) => (
        <div key={cn} className="roster-class-card" style={classColorStyle(cn)}>
          <div className="roster-class-header">
            <span>{classLabel(cn)}</span>
            <span style={{ fontWeight: 500 }}>{members.length === 1 ? t('{n} student', { n: members.length }) : t('{n} students', { n: members.length })}</span>
          </div>
          {members.map((m) => (
            <div key={m.studentId} className="roster-student-row">
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{m.name}</span>
              {m.student?.tags.map((t) => (
                <span key={t} className="tag-pill" style={{ fontSize: 11 }}>{t}</span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function SolutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const t = useT();
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
      showToast(t('Solution not found.'), 'error');
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
  const effectiveShareToken = shareToken;
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
            {t('← Back to class lists')}
          </Link>

          {solution.hard_violations > 0 && (
            <div className="warn-banner" style={{ marginBottom: 16, borderColor: '#ef4444', background: '#fee2e2', color: '#b91c1c' }}>
              {solution.hard_violations === 1
                ? t('⚠ This solution has {n} hard constraint violation. This indicates a solver problem — do not use this arrangement.', { n: solution.hard_violations })
                : t('⚠ This solution has {n} hard constraint violations. This indicates a solver problem — do not use this arrangement.', { n: solution.hard_violations })}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h1 className="page-title">{variantName(solution.label)}</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                <span>
                  <span className="solution-score" style={{ fontSize: 22 }}>{Math.round(solution.score)}</span>
                  <span style={{ fontSize: 13, color: 'var(--text3)', marginLeft: 6 }}>{t('/ 100 score')}</span>
                </span>
                {solution.hard_violations > 0 && (
                  <span className="badge badge-red">
                    {solution.hard_violations === 1
                      ? t('⚠ {n} hard violation', { n: solution.hard_violations })
                      : t('⚠ {n} hard violations', { n: solution.hard_violations })}
                  </span>
                )}
                <span className="badge badge-teal">{t('{n} soft unmet', { n: solution.soft_violations })}</span>
              </div>
            </div>
            <button
              className={`btn ${effectiveShareEnabled ? 'btn-secondary' : 'btn-outline'}`}
              onClick={() => setShowShare(true)}
            >
              {effectiveShareEnabled ? t('Shared ✓') : t('Share')}
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
