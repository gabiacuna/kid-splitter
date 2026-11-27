import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import type { BinaryConstraint, Solution, Student, UnaryConstraint } from '../lib/types';
import { classColor, classColorStyle, classLabel } from '../lib/classes';
import { variantName } from '../lib/solutions';
import { groupByClass, togetherPairs } from '../lib/roster';
import { layoutMap, MAP_H, MAP_W } from '../lib/preferenceMap';
import { CollapseIcon, ExpandIcon, SheetIcon } from './Icons';
import { useT } from '../i18n';
import { downloadFile } from '../lib/download';
import Modal from './Modal';
import HelpTip from './HelpTip';
import ErrorState from './ErrorState';
import { loadErrorMessage } from '../lib/errors';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');

function PreferenceMap({ classes, pairs, names }: {
  classes: ReturnType<typeof groupByClass>;
  pairs: [string, string][];
  names: Map<string, string>;
}) {
  const t = useT();
  const layout = useMemo(
    () => layoutMap(classes.map((c) => ({ classNumber: c.classNumber, ids: c.members.map((m) => m.studentId) }))),
    [classes],
  );
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  const size = layout.nodeRadius * 2;
  return (
    <div>
      <div className="pref-map" role="img"
        aria-label={t('Preference map: {students} in {classes}, {prefs} drawn as lines. The class table lists the same assignments.', {
          students: layout.nodes.length === 1 ? t('{n} student', { n: layout.nodes.length }) : t('{n} students', { n: layout.nodes.length }),
          classes: classes.length === 1 ? t('{n} class', { n: classes.length }) : t('{n} classes', { n: classes.length }),
          prefs: pairs.length === 1 ? t('{n} together preference', { n: pairs.length }) : t('{n} together preferences', { n: pairs.length }),
        })}>
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} aria-hidden>
          {layout.clusters.map((c) => (
            <circle key={c.classNumber} cx={c.x} cy={c.y} r={c.radius + 6} fill={classColor(c.classNumber)} opacity={0.08} />
          ))}
          {pairs.map(([a, b]) => {
            const p = pos.get(a), q = pos.get(b);
            return p && q ? (
              <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y}
                stroke="oklch(55% 0.02 85)" strokeWidth={1.3} opacity={0.4} />
            ) : null;
          })}
          {layout.nodes.map((n) => (
            <circle key={n.id} cx={n.x} cy={n.y} r={layout.nodeRadius} fill={classColor(n.classNumber)} stroke="#fff" strokeWidth={2}>
              <title>{names.get(n.id)}</title>
            </circle>
          ))}
        </svg>
        {/* HTML overlay, not SVG <text>: per the design handoff. */}
        {layout.nodes.map((n) => (
          <div key={n.id} className="pref-initials"
            style={{ left: `${(n.x / MAP_W) * 100}%`, top: `${(n.y / MAP_H) * 100}%`, width: size, fontSize: size < 20 ? 7 : size < 26 ? 8.5 : 10 }}>
            {initials(names.get(n.id) ?? '')}
          </div>
        ))}
      </div>
      <div className="pref-legend">
        {classes.map((c) => (
          <span key={c.classNumber}><i style={{ background: classColor(c.classNumber) }} />{classLabel(c.classNumber)}</span>
        ))}
        <span className="pref-legend-note">{t('— lines show paired preferences ({n})', { n: pairs.length })}</span>
      </div>
    </div>
  );
}

function ExportButton({ solutionId }: { solutionId: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function download() {
    setBusy(true); setFailed(false);
    try {
      await downloadFile(`/solutions/${solutionId}/export.xlsx`, t('class-list.xlsx'));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="export-wrap">
      {failed && <span className="export-error" role="alert">{t('Download failed — try again')}</span>}
      <button type="button" className="export-btn" onClick={download} disabled={busy}>
        <SheetIcon />{busy ? t('Preparing…') : t('Download .xlsx')}
      </button>
    </div>
  );
}

export default function RosterModal({ solution, onClose }: { solution: Solution; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const t = useT();
  const titleId = `roster-title-${solution.id}`;
  const cohortId = solution.cohort_id;

  const { data: students, isLoading: loadingStudents, isError: studentsFailed, error: studentsError, refetch: refetchStudents, isRefetching: refetchingStudents } = useQuery<Student[]>({
    queryKey: ['students', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/students`).then((r) => r.data),
  });
  const { data: constraints, isError: constraintsFailed, error: constraintsError, refetch: refetchConstraints, isRefetching: refetchingConstraints } = useQuery<{ binary: BinaryConstraint[]; unary: UnaryConstraint[] }>({
    queryKey: ['constraints', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/constraints`).then((r) => r.data),
    enabled: expanded, // only the preference map needs these
  });

  const classes = useMemo(() => groupByClass(solution.class_assignments, students ?? []), [solution, students]);
  const names = useMemo(() => new Map(classes.flatMap((c) => c.members.map((m) => [m.studentId, m.name] as const))), [classes]);
  const pairs = useMemo(() => togetherPairs(constraints?.binary ?? [], solution.class_assignments), [constraints, solution]);

  return (
    <Modal labelledBy={titleId} onClose={onClose} className={`roster-modal${expanded ? ' expanded' : ''}`} overlayClassName="roster-overlay">
        <div className="roster-modal-header">
          <h2 id={titleId} className="roster-modal-title">{t('{name} — class lists', { name: variantName(solution.label) })}</h2>
          <button type="button" className="pill-btn" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? <CollapseIcon /> : <ExpandIcon />}{expanded ? t('Collapse') : t('Expand')}
          </button>
          <button type="button" className="roster-close" aria-label={t('Close')} onClick={onClose}><span aria-hidden>✕</span></button>
        </div>

        {studentsFailed ? (
          <ErrorState message={loadErrorMessage(studentsError, 'We couldn’t load the students.')} onRetry={() => refetchStudents()} retrying={refetchingStudents} />
        ) : loadingStudents ? <div className="spinner" /> : !expanded ? (
          <div className="roster-compact">
            {classes.map((c) => (
              <section key={c.classNumber} className="roster-block" aria-label={classLabel(c.classNumber)}>
                <h3 className="roster-block-head"><span>{classLabel(c.classNumber)}</span><span>{c.members.length === 1 ? t('{n} student', { n: c.members.length }) : t('{n} students', { n: c.members.length })}</span></h3>
                <ul className="chip-list">
                  {c.members.map((m) => <li key={m.studentId} className="name-chip">{m.name}</li>)}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="roster-expanded">
            <section className="roster-col">
              <div className="roster-col-head">
                <h3 className="caps-label">{t('Class roster')}</h3>
                <ExportButton solutionId={solution.id} />
              </div>
              <div className="roster-table" role="table" aria-label={t('Class roster')}>
                <div className="roster-table-head" role="row">
                  <span role="columnheader">{t('Class')}</span><span role="columnheader">{t('Student')}</span>
                </div>
                {classes.flatMap((c) => c.members.map((m) => (
                  <div key={m.studentId} className="roster-table-row" role="row">
                    <span role="cell" className="roster-table-class" style={classColorStyle(c.classNumber)}>{classLabel(c.classNumber)}</span>
                    <span role="cell">{m.name}</span>
                  </div>
                )))}
              </div>
            </section>
            <section className="roster-col">
              <div className="roster-col-head">
                <h3 className="caps-label">
                  {t('Preference map')}
                  <HelpTip text={t('Lines join “together” pairs; “separate” rules aren’t drawn.')} />
                </h3>
              </div>
              {constraintsFailed && (
                <ErrorState compact message={loadErrorMessage(constraintsError, 'We couldn’t load the preferences, so no lines are drawn.')} onRetry={() => refetchConstraints()} retrying={refetchingConstraints} />
              )}
              <PreferenceMap classes={classes} pairs={pairs} names={names} />
            </section>
            <p className="roster-fullpage">
              <Link to={`/solutions/${solution.id}`}>{t('Open full page — sharing and permalink')}</Link>
            </p>
          </div>
        )}
    </Modal>
  );
}
