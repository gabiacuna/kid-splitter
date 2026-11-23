import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { Solution, GenderSplit, ValidationResult } from '../lib/types';
import { validationKey } from '../lib/queryKeys';
import { useToast } from '../components/Toast';
import { MIN_CLASSES, MAX_CLASSES, classColor, classLabel } from '../lib/classes';
import { VARIANTS, variantName, rankSolutions } from '../lib/solutions';
import RosterModal from '../components/RosterModal';

// Score accent by rank (not threshold), so three 90+ scores still read as ranked.
const RANK_ACCENTS = [
  { fg: 'var(--teal)', bg: 'var(--teal-light)' },
  { fg: 'oklch(48% 0.1 155)', bg: 'var(--sage-light)' },
  { fg: 'var(--lavender)', bg: 'var(--lavender-light)' },
];

function classSizes(solution: Solution): number[] {
  const n = Math.max(1, ...solution.class_assignments.map((a) => a.class_number));
  const sizes = Array(n).fill(0);
  for (const a of solution.class_assignments) sizes[a.class_number - 1]++;
  return sizes;
}

function ClassSizeBars({ solution }: { solution: Solution }) {
  const sizes = classSizes(solution);
  const max = Math.max(...sizes, 1);
  return (
    <section className="bar-section" aria-label="Class sizes">
      <h4 className="caps-label">Class sizes</h4>
      {sizes.map((size, i) => (
        <div key={i} className="hbar-row">
          <span className="hbar-label">{classLabel(i + 1)}</span>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(size / max) * 100}%`, background: classColor(i + 1) }} />
          </div>
          <span className="hbar-value">{size}</span>
        </div>
      ))}
    </section>
  );
}

function GenderBars({ split }: { split: GenderSplit[] }) {
  return (
    <section className="bar-section" aria-label="Boy / girl balance">
      <h4 className="caps-label">Boy / girl balance</h4>
      {split.map((c) => {
        const total = c.boys + c.girls + c.unknown || 1;
        return (
          <div key={c.class_number} className="hbar-row">
            <span className="hbar-label">{classLabel(c.class_number)}</span>
            <div className="hbar-track segmented" role="img"
              aria-label={`${c.boys} boys, ${c.girls} girls${c.unknown ? `, ${c.unknown} unknown` : ''}`}>
              {c.boys > 0 && <div className="seg boys" style={{ width: `${(c.boys / total) * 100}%` }} />}
              {c.girls > 0 && <div className="seg girls" style={{ width: `${(c.girls / total) * 100}%` }} />}
              {c.unknown > 0 && <div className="seg unknown" style={{ width: `${(c.unknown / total) * 100}%` }} />}
            </div>
            <span className="hbar-value small">
              {c.boys}B / {c.girls}G{c.unknown ? ` / ${c.unknown}?` : ''}
            </span>
          </div>
        );
      })}
    </section>
  );
}

function SolutionCard({ solution, rank, showGender, onDelete }: {
  solution: Solution; rank: number; showGender: boolean; onDelete: () => void;
}) {
  const best = rank === 0;
  const accent = RANK_ACCENTS[Math.min(rank, RANK_ACCENTS.length - 1)];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  return (
    <article className={`solution-card${best ? ' best' : ''}${solution.hard_violations > 0 ? ' has-violations' : ''}`}>
      {best && <div className="solution-best-badge">✦ BEST</div>}
      <div>
        <h3 className="solution-name">{variantName(solution.label)}</h3>
        {VARIANTS[solution.label] && <p className="solution-subtitle">{VARIANTS[solution.label].subtitle}</p>}
      </div>
      <div className="solution-score-row">
        <span className="solution-score" style={{ color: accent.fg }}>{Math.round(solution.score)}</span>
        <span className="solution-score-unit">/ 100 score</span>
      </div>
      <div className="stat-chips">
        <div className="stat-chip" style={{ background: accent.bg, color: accent.fg }}>
          <span>Soft violations</span><strong>{solution.soft_violations}</strong>
        </div>
        <div className={`stat-chip${solution.hard_violations ? ' danger' : ' neutral'}`}>
          <span>Hard violations</span><strong>{solution.hard_violations}</strong>
        </div>
      </div>
      {solution.solver_metadata?.status === 'FEASIBLE' && (
        <span className="badge badge-warn" title="The solver hit its time limit; a slightly better split may exist.">Not proven optimal</span>
      )}
      <ClassSizeBars solution={solution} />
      {showGender && <GenderBars split={solution.gender_split} />}
      <div className="solution-actions">
        <button type="button" className={`btn ${best ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShowRoster(true)}>
          View class lists
        </button>
        {confirmDelete ? (
          <span className="solution-delete-confirm">
            Delete this option?{' '}
            <button type="button" className="link-button danger" onClick={onDelete}>Delete</button>{' '}
            <button type="button" className="link-button" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="link-button muted" onClick={() => setConfirmDelete(true)}>Delete</button>
        )}
      </div>
      {showRoster && <RosterModal solution={solution} onClose={() => setShowRoster(false)} />}
    </article>
  );
}

function SolutionRun({ solutions, onDelete }: { solutions: Solution[]; onDelete: (id: string) => void }) {
  const ranked = rankSolutions(solutions);
  const first = ranked[0];
  const totals = first.gender_split.reduce(
    (t, c) => ({ boys: t.boys + c.boys, girls: t.girls + c.girls, unknown: t.unknown + c.unknown }),
    { boys: 0, girls: 0, unknown: 0 },
  );
  const students = totals.boys + totals.girls + totals.unknown;
  // No gender data at all -> hide the section, legend and disclosure entirely.
  const showGender = totals.boys + totals.girls > 0;
  return (
    <>
      <div className="solution-cards">
        {ranked.map((s, i) => (
          <SolutionCard key={s.id} solution={s} rank={i} showGender={showGender} onDelete={() => onDelete(s.id)} />
        ))}
      </div>
      {showGender && (
        <div className="gender-legend" aria-hidden>
          <span><i className="swatch boys" />Boys</span>
          <span><i className="swatch girls" />Girls</span>
          {totals.unknown > 0 && <span><i className="swatch unknown" />Not set</span>}
        </div>
      )}
      {showGender && totals.unknown > 0 && (
        <p className="gender-disclosure">
          {totals.unknown} of {students} students have no gender set, so the balance bars only cover the rest.{' '}
          <Link to="?tab=students">Set it in the Students tab</Link>
        </p>
      )}
    </>
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
  else if (!resolvedNum || resolvedNum < MIN_CLASSES) disabledReason = `Minimum ${MIN_CLASSES} classes.`;
  else if (resolvedNum > MAX_CLASSES) disabledReason = `Maximum ${MAX_CLASSES} classes — raise the target class size.`;
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
          <input type="number" min={MIN_CLASSES} max={MAX_CLASSES} value={numClasses} onChange={(e) => setNumClasses(e.target.value)} style={{ width: 70 }} />
          <span style={{ fontSize: 13.5 }}>classes</span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 13.5 }}>Target</span>
          <input type="number" min={2} max={200} value={targetSize} onChange={(e) => setTargetSize(e.target.value)} style={{ width: 70 }} />
          <span style={{ fontSize: 13.5 }}>students per class → <strong>{resolvedNum} classes</strong></span>
        </div>
      )}

      {totalStudents > 0 && resolvedNum >= MIN_CLASSES && resolvedNum <= MAX_CLASSES && resolvedNum < totalStudents && (
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

  // Shared with the constraint editor, which invalidates it after edits settle.
  const { data: validation } = useQuery<ValidationResult>({
    queryKey: validationKey(cohortId),
    queryFn: () => api.get(`/cohorts/${cohortId}/constraints/validate`).then((r) => r.data),
  });

  // Previously read an object as an array, so this was always false and solve was never gated.
  const hasContradictions = validation?.has_contradictions ?? false;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/solutions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['solutions', cohortId] }),
    onError: () => showToast('Failed to delete solution.', 'error'),
  });

  if (isLoading) return <div><div className="spinner" /></div>;

  // Group by solve run (solutions of one run are created within seconds), newest first.
  const runs: Solution[][] = [];
  const sorted = [...(solutions ?? [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  for (const s of sorted) {
    const last = runs[runs.length - 1];
    if (last && Math.abs(new Date(s.created_at).getTime() - new Date(last[0].created_at).getTime()) < 10000) last.push(s);
    else runs.push([s]);
  }
  const [latest, ...earlier] = runs;
  const remove = (id: string) => deleteMutation.mutate(id);
  const when = (run: Solution[]) => new Date(run[0].created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      <SolvePanel
        cohortId={cohortId}
        hasContradictions={hasContradictions}
        totalStudents={numStudents}
        onSolved={() => { qc.invalidateQueries({ queryKey: ['solutions', cohortId] }); qc.invalidateQueries({ queryKey: ['cohorts'] }); }}
      />

      {!latest && (
        <div className="empty-state">
          <h3>No class lists yet</h3>
          <p>Use the form above to generate class arrangement options.</p>
        </div>
      )}

      {latest && (
        <>
          <p className="solutions-intro">
            Here are {latest.length} ways to split your students. Pick the one that feels right for your class.
            <span className="solutions-when"> Generated {when(latest)}.</span>
          </p>
          <SolutionRun solutions={latest} onDelete={remove} />
          <p className="solutions-caption">On a small screen? Cards stack so you can compare one at a time.</p>
        </>
      )}

      {earlier.length > 0 && (
        <details className="earlier-runs">
          <summary>Earlier runs ({earlier.length})</summary>
          {earlier.map((run) => (
            <div key={run[0].id} className="earlier-run">
              <h4>Generated {when(run)}</h4>
              <SolutionRun solutions={run} onDelete={remove} />
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
