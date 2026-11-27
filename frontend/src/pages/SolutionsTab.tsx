import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { SOLVE_TIMEOUT_MS } from '../lib/api';
import HelpTip from '../components/HelpTip';
import ErrorState from '../components/ErrorState';
import { errorDetail, httpStatus, isCancelled, isNetworkError, isTimeout, loadErrorMessage } from '../lib/errors';
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
      <h4 className="caps-label">{t('Boy / girl balance')}<HelpTip text={t('Only a tie-breaker: it never breaks a preference. Students without a gender are placed freely.')} /></h4>
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
        <HelpTip text={t('% of flexible preferences met. Doesn’t include the gender balance.')} />
      </div>
      <div className="stat-chips-head">
        <span className="caps-label">{t('Preferences not met')}</span>
        <HelpTip text={t('Flexible: allowed. Required: should always be 0.')} />
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
        <span className="badge-with-tip">
          <span className="badge badge-warn">{t('Not proven optimal')}</span>
          <HelpTip text={t('The calculation stopped at 8 s; a slightly better option might exist.')} />
        </span>
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

function SolvePanel({ cohortId, hasContradictions, rulesState, onRetryRules, retryingRules, totalStudents, defaultClasses, onSolved }: {
  cohortId: string;
  /** The class count the teacher chose for this cohort; the panel starts from it. */
  defaultClasses: number;
  hasContradictions: boolean;
  /** The contradiction check: still loading, failed, or done. Generating is only allowed once it's done. */
  rulesState: 'loading' | 'error' | 'ok';
  onRetryRules: () => void;
  retryingRules: boolean;
  totalStudents: number;
  onSolved: () => void;
}) {
  const t = useT();
  const reasonId = useId();
  const [mode, setMode] = useState<'num_classes' | 'target_size'>('num_classes');
  const startClasses = Math.min(MAX_CLASSES, Math.max(MIN_CLASSES, defaultClasses || MIN_CLASSES));
  const [numClasses, setNumClasses] = useState(String(startClasses));
  // Same split expressed as a class size, so both modes start from the teacher's choice.
  const [targetSize, setTargetSize] = useState(String(totalStudents > 0 ? Math.ceil(totalStudents / startClasses) : 15));
  const [solving, setIsSolving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [solveError, setSolveError] = useState('');
  const [cancelled, setCancelled] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const resolvedNum = mode === 'num_classes'
    ? parseInt(numClasses) || 0
    : Math.ceil(totalStudents / (parseInt(targetSize) || 1));

  let disabledReason = '';
  let reasonLinksToRules = false;
  if (rulesState === 'loading') disabledReason = t('Checking your rules…');
  else if (rulesState === 'error') disabledReason = t('We couldn’t check the rules.');
  else if (hasContradictions) { disabledReason = t('Resolve constraint contradictions before solving.'); reasonLinksToRules = true; }
  else if (totalStudents === 0) disabledReason = t('Add students before solving.');
  else if (!resolvedNum || resolvedNum < MIN_CLASSES) disabledReason = t('Minimum {min} classes.', { min: MIN_CLASSES });
  else if (resolvedNum > MAX_CLASSES) disabledReason = t('Maximum {max} classes — raise the target class size.', { max: MAX_CLASSES });
  else if (resolvedNum >= totalStudents) disabledReason = t('Number of classes cannot exceed number of students ({total}).', { total: totalStudents });

  async function handleSolve() {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsSolving(true);
    setSolveError('');
    setCancelled(false);
    setElapsed(0);
    const timer = setInterval(() => setElapsed((p) => p + 1), 1000);
    try {
      await api.post(`/cohorts/${cohortId}/solve`, { num_classes: resolvedNum }, { signal: controller.signal, timeout: SOLVE_TIMEOUT_MS });
      onSolved();
    } catch (err: unknown) {
      const status = httpStatus(err);
      if (isCancelled(err)) {
        setCancelled(true);
        onSolved(); // the server may still finish and save the lists; refresh in case it already did
      } else if (isTimeout(err)) {
        setSolveError(t('This is taking too long. Try again; if it keeps happening, try fewer rules or a different number of classes.'));
      } else if (isNetworkError(err)) {
        setSolveError(t('We lost the connection while generating. Check your connection and try again.'));
      } else if (status === 422) {
        // The backend uses 422 for three cases; tell them apart by the detail.
        const detail = errorDetail(err);
        if (detail && typeof detail === 'object') {
          setSolveError(t('Some rules contradict each other. Fix them in the Preferences tab, then try again.'));
        } else if (typeof detail === 'string' && detail.includes('feasible')) {
          setSolveError(t('No valid arrangement exists with these constraints. Check for conflicting hard constraints.'));
        } else {
          setSolveError(t('Number of classes cannot exceed number of students ({total}).', { total: totalStudents }));
        }
      } else if (status === 429) {
        setSolveError(t('You’ve generated lists many times in a short while. Wait a few minutes and try again.'));
      } else {
        setSolveError(t('Solve failed. Try again.'));
      }
    } finally {
      clearInterval(timer);
      setIsSolving(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{t('Generate class lists')}</h3>
      <div className="solve-mode-row">
        <div className="dist-toggle" role="group" aria-label={t('How to choose the number of classes')}>
          <button type="button" aria-pressed={mode === 'num_classes'} className={`dist-toggle-opt${mode === 'num_classes' ? ' active' : ''}`} onClick={() => setMode('num_classes')}>
            {t('Number of classes')}
          </button>
          <button type="button" aria-pressed={mode === 'target_size'} className={`dist-toggle-opt${mode === 'target_size' ? ' active' : ''}`} onClick={() => setMode('target_size')}>
            {t('Target class size')}
          </button>
        </div>
        <HelpTip text={t('Between {min} and {max} classes, or worked out from the class size you want.', { min: MIN_CLASSES, max: MAX_CLASSES })} />
      </div>

      {mode === 'num_classes' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <label htmlFor={`${reasonId}-n`} style={{ fontSize: 13.5 }}>{t('Split into')}</label>
          <input id={`${reasonId}-n`} type="number" min={MIN_CLASSES} max={MAX_CLASSES} value={numClasses} onChange={(e) => setNumClasses(e.target.value)} style={{ width: 70 }} />
          <span style={{ fontSize: 13.5 }}>{t('classes')}</span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <label htmlFor={`${reasonId}-size`} style={{ fontSize: 13.5 }}>{t('Target')}</label>
          <input id={`${reasonId}-size`} type="number" min={2} max={200} value={targetSize} onChange={(e) => setTargetSize(e.target.value)} style={{ width: 70 }} />
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
        <p id={reasonId} className="solve-disabled-reason">
          {disabledReason}{' '}
          {reasonLinksToRules && <Link to="?tab=constraints">{t('Go to Preferences')}</Link>}
          {rulesState === 'error' && (
            <button type="button" className="link-button" onClick={onRetryRules} disabled={retryingRules}>
              {retryingRules ? t('Retrying…') : t('Retry')}
            </button>
          )}
          {totalStudents === 0 && rulesState === 'ok' && !hasContradictions && <Link to="?tab=students">{t('Go to Students')}</Link>}
        </p>
      )}
      {solveError && (
        <div className="warn-banner" role="alert" style={{ marginBottom: 12 }}>{solveError}</div>
      )}
      {cancelled && (
        <p className="form-hint" role="status" style={{ marginBottom: 12 }}>
          {t('Stopped waiting. If the server finishes anyway, the lists will appear below.')}
        </p>
      )}

      <div className="solve-actions">
        <button
          className="btn btn-primary"
          onClick={handleSolve}
          disabled={!!disabledReason || solving}
          aria-describedby={disabledReason ? reasonId : undefined}
          style={{ minWidth: 180 }}
        >
          {solving ? t('Solving… ({s} s)', { s: elapsed }) : t('Generate class lists')}
        </button>
        {solving && (
          <button type="button" className="btn btn-secondary" onClick={() => abortRef.current?.abort()}>
            {t('Cancel')}
          </button>
        )}
      </div>
      {solving && elapsed > 8 && (
        <p style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 8 }}>{t('Taking longer than expected…')}</p>
      )}
    </div>
  );
}

export default function SolutionsTab({ cohortId, numStudents, numClasses }: { cohortId: string; numStudents: number; numClasses: number }) {
  const t = useT();
  const qc = useQueryClient();
  const { showToast } = useToast();

  const { data: solutions, isLoading, isError, error, refetch, isRefetching } = useQuery<Solution[]>({
    queryKey: ['solutions', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/solutions`).then((r) => r.data),
  });

  // Shared with the constraint editor, which invalidates it after edits settle.
  const { data: validation, isError: validationFailed, isLoading: validationLoading, refetch: refetchValidation, isRefetching: refetchingValidation } = useQuery<ValidationResult>({
    queryKey: validationKey(cohortId),
    queryFn: () => api.get(`/cohorts/${cohortId}/constraints/validate`).then((r) => r.data),
  });

  // If the check itself failed we don't know: Generate stays disabled (it used to fall back to "fine").
  const hasContradictions = validation?.has_contradictions ?? false;
  const rulesState: 'loading' | 'error' | 'ok' = validation ? 'ok' : validationFailed ? 'error' : validationLoading ? 'loading' : 'error';

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/solutions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['solutions', cohortId] }),
    onError: () => showToast(t('Failed to delete solution.'), 'error'),
  });

  if (isLoading) return <div><div className="spinner" /></div>;
  // A failed load used to look like "no lists yet".
  if (isError && !solutions) {
    return <ErrorState message={loadErrorMessage(error, 'We couldn’t load the class lists.')} onRetry={() => refetch()} retrying={isRefetching} />;
  }

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
        defaultClasses={numClasses}
        hasContradictions={hasContradictions}
        rulesState={rulesState}
        onRetryRules={() => refetchValidation()}
        retryingRules={refetchingValidation}
        totalStudents={numStudents}
        onSolved={() => { qc.invalidateQueries({ queryKey: ['solutions', cohortId] }); qc.invalidateQueries({ queryKey: ['cohorts'] }); }}
      />

      {!latest && (
        <div className="empty-state">
          <h3>{t('No class lists yet')}</h3>
          {numStudents === 0 ? (
            <p>{t('First add your students in the Students tab; then come back here to generate the lists.')} <Link to="?tab=students">{t('Go to Students')}</Link></p>
          ) : (
            <p>{t('Use the form above to generate class arrangement options.')}</p>
          )}
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
