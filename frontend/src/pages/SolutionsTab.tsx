import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { Solution, BinaryConstraint, ClassAssignment } from '../lib/types';
import SizeDistributionChart from '../components/SizeDistributionChart';
import { useToast } from '../components/Toast';

function computeSatisfied(constraint: BinaryConstraint, assignments: ClassAssignment[]) {
  const asgn = Object.fromEntries(assignments.map((a) => [a.student_id, a.class_number]));
  const ca = asgn[constraint.student_a_id];
  const cb = asgn[constraint.student_b_id];
  if (ca === undefined || cb === undefined) return null;
  return constraint.type === 'together' ? ca === cb : ca !== cb;
}

function DiffIndicators({ solution, reference, binaryConstraints }: { solution: Solution; reference: Solution; binaryConstraints: BinaryConstraint[] }) {
  const [expanded, setExpanded] = useState(false);

  if (solution.id === reference.id) return null;

  const diffs: { constraint: BinaryConstraint; nowSatisfied: boolean }[] = [];
  for (const c of binaryConstraints) {
    const refSat = computeSatisfied(c, reference.class_assignments);
    const nowSat = computeSatisfied(c, solution.class_assignments);
    if (refSat !== null && nowSat !== null && refSat !== nowSat) {
      diffs.push({ constraint: c, nowSatisfied: nowSat });
    }
  }

  if (diffs.length === 0) {
    return <p style={{ fontSize: 12.5, color: 'var(--text3)' }}>No difference in constraint satisfaction.</p>;
  }

  const gained = diffs.filter((d) => d.nowSatisfied);
  const lost = diffs.filter((d) => !d.nowSatisfied);

  return (
    <div>
      {gained.length > 0 && (
        <span style={{ fontSize: 12.5, color: 'var(--sage)', marginRight: 8 }}>
          ↑ {gained.length} satisfied
        </span>
      )}
      {lost.length > 0 && (
        <span style={{ fontSize: 12.5, color: 'var(--coral)' }}>
          ↓ {lost.length} violated
        </span>
      )}
      <button
        style={{ background: 'none', border: 'none', color: 'var(--teal)', fontSize: 12, cursor: 'pointer', marginLeft: 8 }}
        onClick={() => setExpanded((p) => !p)}
      >
        {expanded ? 'hide' : 'details'}
      </button>
      {expanded && (
        <ul style={{ marginTop: 6, marginLeft: 14, fontSize: 12.5, color: 'var(--text2)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {diffs.map((d, i) => (
            <li key={i} style={{ color: d.nowSatisfied ? 'var(--sage)' : 'var(--coral)' }}>
              {d.nowSatisfied ? '✓' : '✗'} {d.constraint.type}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SolutionCard({
  solution,
  allSolutions,
  binaryConstraints,
  onDelete,
}: {
  solution: Solution;
  allSolutions: Solution[];
  binaryConstraints: BinaryConstraint[];
  onDelete: () => void;
}) {
  const isBest = solution.score === Math.min(...allSolutions.map((s) => s.score));
  const hasViolations = solution.hard_violations > 0;
  const reference = allSolutions.find((s) => s.label === 'Soft priority') ?? allSolutions[0];

  return (
    <div className={`solution-card${isBest ? ' best' : ''}${hasViolations ? ' has-violations' : ''}`}>
      {isBest && <div className="solution-best-badge">✦ BEST</div>}
      <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.2px', marginBottom: 10 }}>{solution.label}</div>

      {hasViolations && (
        <div className="badge badge-red" style={{ marginBottom: 10 }}>
          ⚠ {solution.hard_violations} hard violation(s) — this solution has a problem
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <span className="solution-score">{solution.score.toFixed(1)}</span>
        <span style={{ fontSize: 12.5, color: 'var(--text3)', marginLeft: 6 }}>
          {isBest && allSolutions[0].id === solution.id ? '(lower is better)' : ''}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <span className="badge badge-teal">{solution.soft_violations} soft unmet</span>
        {solution.solver_metadata?.status === 'FEASIBLE' && (
          <span className="badge badge-warn">Not optimal</span>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text3)', marginBottom: 8 }}>
          Class sizes
        </div>
        <SizeDistributionChart
          assignments={solution.class_assignments}
          numClasses={Math.max(...solution.class_assignments.map((a) => a.class_number), 1)}
        />
      </div>

      <div style={{ marginBottom: 16, minHeight: 24 }}>
        <DiffIndicators solution={solution} reference={reference} binaryConstraints={binaryConstraints} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Link to={`/solutions/${solution.id}`} className="btn btn-primary" style={{ flex: 1, textAlign: 'center' }}>
          View class lists
        </Link>
        <button className="btn btn-ghost" style={{ padding: '6px 12px', color: 'var(--coral)', fontSize: 12 }} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

function SolvePanel({ cohortId, hasContradictions, totalStudents, onSolved }: { cohortId: string; hasContradictions: boolean; totalStudents: number; onSolved: () => void }) {
  const [mode, setMode] = useState<'num_classes' | 'target_size'>('num_classes');
  const [numClasses, setNumClasses] = useState('3');
  const [targetSize, setTargetSize] = useState('15');
  const [solving, setIsSolving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [solveError, setSolveError] = useState('');

  const resolvedNum = mode === 'num_classes'
    ? parseInt(numClasses) || 0
    : Math.ceil(totalStudents / (parseInt(targetSize) || 1));

  function distributionSummary(total: number, n: number) {
    if (!n || n < 2) return '';
    const base = Math.floor(total / n);
    const rem = total % n;
    if (rem === 0) return `${n} classes (${base} students each)`;
    const sizes = [...Array(rem).fill(base + 1), ...Array(n - rem).fill(base)];
    return `${n} classes (${sizes.join(' / ')})`;
  }

  let disabledReason = '';
  if (hasContradictions) disabledReason = 'Resolve constraint contradictions before solving.';
  else if (totalStudents === 0) disabledReason = 'Add students before solving.';
  else if (!resolvedNum || resolvedNum < 2) disabledReason = 'Minimum 2 classes.';
  else if (resolvedNum >= totalStudents) disabledReason = `Number of classes cannot exceed number of students (${totalStudents}).`;

  async function handleSolve() {
    setIsSolving(true);
    setSolveError('');
    setElapsed(0);
    const timer = setInterval(() => setElapsed((p) => p + 1), 1000);
    try {
      await api.post(`/cohorts/${cohortId}/solve`, { num_classes: resolvedNum });
      onSolved();
    } catch (err: unknown) {
      const status = (err as { response?: { status: number; data?: { detail?: string } } }).response?.status;
      if (status === 409) {
        setSolveError('No valid arrangement exists with these constraints. Check for conflicting hard constraints.');
      } else {
        setSolveError('Solve failed. Try again.');
      }
    } finally {
      clearInterval(timer);
      setIsSolving(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Generate class lists</h3>
      <div className="dist-toggle" style={{ marginBottom: 16 }}>
        <button className={`dist-toggle-opt${mode === 'num_classes' ? ' active' : ''}`} onClick={() => setMode('num_classes')}>
          Number of classes
        </button>
        <button className={`dist-toggle-opt${mode === 'target_size' ? ' active' : ''}`} onClick={() => setMode('target_size')}>
          Target class size
        </button>
      </div>

      {mode === 'num_classes' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 13.5 }}>Split into</span>
          <input type="number" min={2} max={20} value={numClasses} onChange={(e) => setNumClasses(e.target.value)} style={{ width: 70 }} />
          <span style={{ fontSize: 13.5 }}>classes</span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 13.5 }}>Target</span>
          <input type="number" min={2} max={200} value={targetSize} onChange={(e) => setTargetSize(e.target.value)} style={{ width: 70 }} />
          <span style={{ fontSize: 13.5 }}>students per class → <strong>{resolvedNum} classes</strong></span>
        </div>
      )}

      {totalStudents > 0 && resolvedNum >= 2 && resolvedNum < totalStudents && (
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14 }}>
          → {totalStudents} students will be split into {distributionSummary(totalStudents, resolvedNum)}
        </p>
      )}

      {disabledReason && (
        <p style={{ fontSize: 13, color: 'var(--coral)', marginBottom: 10 }}>{disabledReason}</p>
      )}
      {solveError && (
        <div className="warn-banner" style={{ marginBottom: 12 }}>{solveError}</div>
      )}

      <button
        className="btn btn-primary"
        onClick={handleSolve}
        disabled={!!disabledReason || solving}
        style={{ minWidth: 180 }}
      >
        {solving ? `Solving… (${elapsed}s)` : 'Generate class lists'}
      </button>
      {solving && elapsed > 8 && (
        <p style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 8 }}>Taking longer than expected…</p>
      )}
    </div>
  );
}

export default function SolutionsTab({ cohortId, numStudents }: { cohortId: string; numStudents: number }) {
  const qc = useQueryClient();
  const { showToast } = useToast();

  const { data: solutions, isLoading } = useQuery<Solution[]>({
    queryKey: ['solutions', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/solutions`).then((r) => r.data),
  });

  const { data: constraintData } = useQuery<{ binary: BinaryConstraint[] }>({
    queryKey: ['constraints', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/constraints`).then((r) => r.data),
  });

  const { data: contradictionData } = useQuery<{ length: number }>({
    queryKey: ['contradictions', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/constraints/validate`).then((r) => r.data),
  });

  const hasContradictions = Array.isArray(contradictionData) && contradictionData.length > 0;
  const binaryConstraints = constraintData?.binary ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/solutions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['solutions', cohortId] }),
    onError: () => showToast('Failed to delete solution.', 'error'),
  });

  if (isLoading) return <div><div className="spinner" /></div>;

  // Group by solve run (cluster by created_at within ~5s)
  const grouped: Solution[][] = [];
  const sorted = [...(solutions ?? [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  for (const s of sorted) {
    const last = grouped[grouped.length - 1];
    if (last && Math.abs(new Date(s.created_at).getTime() - new Date(last[0].created_at).getTime()) < 10000) {
      last.push(s);
    } else {
      grouped.push([s]);
    }
  }

  return (
    <div>
      <SolvePanel
        cohortId={cohortId}
        hasContradictions={hasContradictions}
        totalStudents={numStudents}
        onSolved={() => qc.invalidateQueries({ queryKey: ['solutions', cohortId] })}
      />

      {grouped.length === 0 && (
        <div className="empty-state">
          <h3>No class lists yet</h3>
          <p>Use the form above to generate class arrangement options.</p>
        </div>
      )}

      {grouped.map((group, gi) => {
        const isFeasible = group.some((s) => s.solver_metadata?.status === 'FEASIBLE');
        const date = new Date(group[0].created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        return (
          <div key={gi} style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>Generated on {date}</span>
              {isFeasible && (
                <span className="badge badge-warn">Solver reached time limit — results may not be optimal</span>
              )}
            </div>
            <div className="solution-cards">
              {group.map((s) => (
                <SolutionCard
                  key={s.id}
                  solution={s}
                  allSolutions={group}
                  binaryConstraints={binaryConstraints}
                  onDelete={() => deleteMutation.mutate(s.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
