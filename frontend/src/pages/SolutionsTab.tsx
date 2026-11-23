import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { Solution, GenderSplit, ValidationResult } from '../lib/types';
import { validationKey } from '../lib/queryKeys';
import { useToast } from '../components/Toast';
import { MIN_CLASSES, MAX_CLASSES, classColor, classLabel } from '../lib/classes';
import { VARIANTS, variantName, variantSubtitle, rankSolutions } from '../lib/solutions';
import { ACCENTS } from '../lib/cohortTint';
import RosterModal from '../components/RosterModal';
import { useT, translate, getLocale } from '../i18n';

// Score accent by rank (not threshold), so three 90+ scores still read as ranked.
const RANK_ACCENTS = ACCENTS.slice(0, 3);

// gender_split already counts every student per class, so sizes come from it too —
// the size bars and the gender bars can't disagree.
const classSizes = (solution: Solution) => solution.gender_split.map((c) => c.boys + c.girls + c.unknown);

function distributionSummary(total: number, n: number) {
  if (!n || n < 2) return '';
  const base = Math.floor(total / n);
  const rem = total % n;
  if (rem === 0) return translate('{n} classes ({base} students each)', { n, base });
  const sizes = [...Array(rem).fill(base + 1), ...Array(n - rem).fill(base)];
  return translate('{n} classes ({sizes})', { n, sizes: sizes.join(' / ') });
}

function ClassSizeBars({ solution }: { solution: Solution }) {
  const t = useT();
  const sizes = classSizes(solution);
  const max = Math.max(...sizes, 1);
  return (
    <section className="bar-section" aria-label={t('Class sizes')}>
      <h4 className="caps-label">{t('Class sizes')}</h4>
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
  const t = useT();
  return (
    <section className="bar-section" aria-label={t('Boy / girl balance')}>
      <h4 className="caps-label">{t('Boy / girl balance')}</h4>
      {split.map((c) => {
        const total = c.boys + c.girls + c.unknown || 1;
        return (
          <div key={c.class_number} className="hbar-row">
            <span className="hbar-label">{classLabel(c.class_number)}</span>
            <div className="hbar-track segmented" role="img"
              aria-label={c.unknown
                ? t('{boys} boys, {girls} girls, {unknown} unknown', { boys: c.boys, girls: c.girls, unknown: c.unknown })
                : t('{boys} boys, {girls} girls', { boys: c.boys, girls: c.girls })}>
              {c.boys > 0 && <div className="seg boys" style={{ width: `${(c.boys / total) * 100}%` }} />}
              {c.girls > 0 && <div className="seg girls" style={{ width: `${(c.girls / total) * 100}%` }} />}
              {c.unknown > 0 && <div className="seg unknown" style={{ width: `${(c.unknown / total) * 100}%` }} />}
            </div>
            <span className="hbar-value small">
              {c.unknown
                ? t('{boys}B / {girls}G / {unknown}?', { boys: c.boys, girls: c.girls, unknown: c.unknown })
                : t('{boys}B / {girls}G', { boys: c.boys, girls: c.girls })}
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
  const t = useT();
  const best = rank === 0;
  const accent = RANK_ACCENTS[Math.min(rank, RANK_ACCENTS.length - 1)];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  return (
    <article className={`solution-card${best ? ' best' : ''}${solution.hard_violations > 0 ? ' has-violations' : ''}`}>
      {best && <div className="solution-best-badge">✦ {t('BEST')}</div>}
      <div>
        <h3 className="solution-name">{variantName(solution.label)}</h3>
        {VARIANTS[solution.label] && <p className="solution-subtitle">{variantSubtitle(solution.label)}</p>}
      </div>
      <div className="solution-score-row">
        <span className="solution-score" style={{ color: accent.fg }}>{Math.round(solution.score)}</span>
        <span className="solution-score-unit">{t('/ 100 score')}</span>
      </div>
      <div className="stat-chips">
        <div className="stat-chip" style={{ background: accent.bg, color: accent.fg }}>
          <span>{t('Soft violations')}</span><strong>{solution.soft_violations}</strong>
        </div>
        <div className={`stat-chip${solution.hard_violations ? ' danger' : ' neutral'}`}>
          <span>{t('Hard violations')}</span><strong>{solution.hard_violations}</strong>
        </div>
      </div>
      {solution.solver_metadata?.status === 'FEASIBLE' && (
        <span className="badge badge-warn" title={t('The solver hit its time limit; a slightly better split may exist.')}>{t('Not proven optimal')}</span>
      )}
      <ClassSizeBars solution={solution} />
      {showGender && <GenderBars split={solution.gender_split} />}
      <div className="solution-actions">
        <button type="button" className={`btn ${best ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShowRoster(true)}>
          {t('View class lists')}
        </button>
        {confirmDelete ? (
          <span className="solution-delete-confirm">
            {t('Delete this option?')}{' '}
            <button type="button" className="link-button danger" onClick={onDelete}>{t('Delete')}</button>{' '}
            <button type="button" className="link-button" onClick={() => setConfirmDelete(false)}>{t('Cancel')}</button>
          </span>
        ) : (
          <button type="button" className="link-button muted" onClick={() => setConfirmDelete(true)}>{t('Delete')}</button>
        )}
      </div>
      {showRoster && <RosterModal solution={solution} onClose={() => setShowRoster(false)} />}
    </article>
  );
}

function SolutionRun({ solutions, onDelete }: { solutions: Solution[]; onDelete: (id: string) => void }) {
  const t = useT();
  const ranked = rankSolutions(solutions);
  const first = ranked[0];
  const totals = first.gender_split.reduce(
    (acc, c) => ({ boys: acc.boys + c.boys, girls: acc.girls + c.girls, unknown: acc.unknown + c.unknown }),
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
          <span><i className="swatch boys" />{t('Boys')}</span>
          <span><i className="swatch girls" />{t('Girls')}</span>
          {totals.unknown > 0 && <span><i className="swatch unknown" />{t('Not set')}</span>}
        </div>
      )}
      {showGender && totals.unknown > 0 && (
        <p className="gender-disclosure">
          {t('{unknown} of {students} students have no gender set, so the balance bars only cover the rest.', { unknown: totals.unknown, students })}{' '}
          <Link to="?tab=students">{t('Set it in the Students tab')}</Link>
        </p>
      )}
    </>
  );
}

function SolvePanel({ cohortId, hasContradictions, totalStudents, onSolved }: { cohortId: string; hasContradictions: boolean; totalStudents: number; onSolved: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<'num_classes' | 'target_size'>('num_classes');
  const [numClasses, setNumClasses] = useState('3');
  const [targetSize, setTargetSize] = useState('15');
  const [solving, setIsSolving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [solveError, setSolveError] = useState('');

  const resolvedNum = mode === 'num_classes'
    ? parseInt(numClasses) || 0
    : Math.ceil(totalStudents / (parseInt(targetSize) || 1));

  let disabledReason = '';
  if (hasContradictions) disabledReason = t('Resolve constraint contradictions before solving.');
  else if (totalStudents === 0) disabledReason = t('Add students before solving.');
  else if (!resolvedNum || resolvedNum < MIN_CLASSES) disabledReason = t('Minimum {min} classes.', { min: MIN_CLASSES });
  else if (resolvedNum > MAX_CLASSES) disabledReason = t('Maximum {max} classes — raise the target class size.', { max: MAX_CLASSES });
  else if (resolvedNum >= totalStudents) disabledReason = t('Number of classes cannot exceed number of students ({total}).', { total: totalStudents });

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
        setSolveError(t('No valid arrangement exists with these constraints. Check for conflicting hard constraints.'));
      } else {
        setSolveError(t('Solve failed. Try again.'));
      }
    } finally {
      clearInterval(timer);
      setIsSolving(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{t('Generate class lists')}</h3>
      <div className="dist-toggle" style={{ marginBottom: 16 }}>
        <button className={`dist-toggle-opt${mode === 'num_classes' ? ' active' : ''}`} onClick={() => setMode('num_classes')}>
          {t('Number of classes')}
        </button>
        <button className={`dist-toggle-opt${mode === 'target_size' ? ' active' : ''}`} onClick={() => setMode('target_size')}>
          {t('Target class size')}
        </button>
      </div>

      {mode === 'num_classes' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 13.5 }}>{t('Split into')}</span>
          <input type="number" min={MIN_CLASSES} max={MAX_CLASSES} value={numClasses} onChange={(e) => setNumClasses(e.target.value)} style={{ width: 70 }} />
          <span style={{ fontSize: 13.5 }}>{t('classes')}</span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 13.5 }}>{t('Target')}</span>
          <input type="number" min={2} max={200} value={targetSize} onChange={(e) => setTargetSize(e.target.value)} style={{ width: 70 }} />
          <span style={{ fontSize: 13.5 }}>
            {t('students per class →')}{' '}
            <strong>{resolvedNum === 1 ? t('{n} class', { n: resolvedNum }) : t('{n} classes', { n: resolvedNum })}</strong>
          </span>
        </div>
      )}

      {totalStudents > 0 && resolvedNum >= MIN_CLASSES && resolvedNum <= MAX_CLASSES && resolvedNum < totalStudents && (
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14 }}>
          {t('→ {total} students will be split into {summary}', { total: totalStudents, summary: distributionSummary(totalStudents, resolvedNum) })}
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
        {solving ? t('Solving… ({s} s)', { s: elapsed }) : t('Generate class lists')}
      </button>
      {solving && elapsed > 8 && (
        <p style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 8 }}>{t('Taking longer than expected…')}</p>
      )}
    </div>
  );
}

export default function SolutionsTab({ cohortId, numStudents }: { cohortId: string; numStudents: number }) {
  const t = useT();
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
    onError: () => showToast(t('Failed to delete solution.'), 'error'),
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
  const when = (run: Solution[]) => new Date(run[0].created_at).toLocaleString(getLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

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
          <h3>{t('No class lists yet')}</h3>
          <p>{t('Use the form above to generate class arrangement options.')}</p>
        </div>
      )}

      {latest && (
        <>
          <p className="solutions-intro">
            {latest.length === 1
              ? t('Here is {n} way to split your students. Pick the one that feels right for your class.', { n: latest.length })
              : t('Here are {n} ways to split your students. Pick the one that feels right for your class.', { n: latest.length })}
            <span className="solutions-when"> {t('Generated {when}.', { when: when(latest) })}</span>
          </p>
          <SolutionRun solutions={latest} onDelete={remove} />
          <p className="solutions-caption">{t('On a small screen? Cards stack so you can compare one at a time.')}</p>
        </>
      )}

      {earlier.length > 0 && (
        <details className="earlier-runs">
          <summary>{t('Earlier runs ({n})', { n: earlier.length })}</summary>
          {earlier.map((run) => (
            <div key={run[0].id} className="earlier-run">
              <h4>{t('Generated {when}', { when: when(run) })}</h4>
              <SolutionRun solutions={run} onDelete={remove} />
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
