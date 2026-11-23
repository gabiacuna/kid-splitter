import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import type { BinaryConstraint, Solution, Student, UnaryConstraint } from '../lib/types';
import { classColor, classColorStyle, classLabel } from '../lib/classes';
import { variantName } from '../lib/solutions';
import { groupByClass, togetherPairs } from '../lib/roster';
import { layoutMap, MAP_H, MAP_W } from '../lib/preferenceMap';
import { CollapseIcon, ExpandIcon, SheetIcon } from './Icons';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');

function PreferenceMap({ classes, pairs, names }: {
  classes: ReturnType<typeof groupByClass>;
  pairs: [string, string][];
  names: Map<string, string>;
}) {
  const layout = useMemo(
    () => layoutMap(classes.map((c) => ({ classNumber: c.classNumber, ids: c.members.map((m) => m.studentId) }))),
    [classes],
  );
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  const size = layout.nodeRadius * 2;
  return (
    <div>
      <div className="pref-map" role="img"
        aria-label={`Preference map: ${layout.nodes.length} students in ${classes.length} classes, ${pairs.length} together ${pairs.length === 1 ? 'preference' : 'preferences'} drawn as lines. The class table lists the same assignments.`}>
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
        <span className="pref-legend-note">— lines show paired preferences ({pairs.length})</span>
      </div>
    </div>
  );
}

/** Filename from Content-Disposition, preferring the RFC 5987 form. */
function downloadName(header: string | undefined, fallback: string) {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) { try { return decodeURIComponent(star); } catch { /* fall through */ } }
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

function ExportButton({ solutionId }: { solutionId: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Blob rather than a bare link so an expired access token is refreshed by the api client.
  async function download() {
    setBusy(true); setFailed(false);
    try {
      const res = await api.get(`/solutions/${solutionId}/export.xlsx`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName(res.headers['content-disposition'], 'class-list.xlsx');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="export-wrap">
      {failed && <span className="export-error" role="alert">Download failed — try again</span>}
      <button type="button" className="export-btn" onClick={download} disabled={busy}>
        <SheetIcon />{busy ? 'Preparing…' : 'Download .xlsx'}
      </button>
    </div>
  );
}

export default function RosterModal({ solution, onClose }: { solution: Solution; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = `roster-title-${solution.id}`;
  const cohortId = solution.cohort_id;

  const { data: students, isLoading: loadingStudents } = useQuery<Student[]>({
    queryKey: ['students', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/students`).then((r) => r.data),
  });
  const { data: constraints } = useQuery<{ binary: BinaryConstraint[]; unary: UnaryConstraint[] }>({
    queryKey: ['constraints', cohortId],
    queryFn: () => api.get(`/cohorts/${cohortId}/constraints`).then((r) => r.data),
    enabled: expanded, // only the preference map needs these
  });

  const classes = useMemo(() => groupByClass(solution.class_assignments, students ?? []), [solution, students]);
  const names = useMemo(() => new Map(classes.flatMap((c) => c.members.map((m) => [m.studentId, m.name] as const))), [classes]);
  const pairs = useMemo(() => togetherPairs(constraints?.binary ?? [], solution.class_assignments), [constraints, solution]);

  // Focus: move into the dialog, trap Tab, close on Escape, give focus back to the opener.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  return (
    <div className="modal-overlay roster-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className={`modal roster-modal${expanded ? ' expanded' : ''}`}
        role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="roster-modal-header">
          <h2 id={titleId} className="roster-modal-title">{variantName(solution.label)} — class lists</h2>
          <button type="button" className="pill-btn" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? <CollapseIcon /> : <ExpandIcon />}{expanded ? 'Collapse' : 'Expand'}
          </button>
          <button type="button" className="roster-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        {loadingStudents ? <div className="spinner" /> : !expanded ? (
          <div className="roster-compact">
            {classes.map((c) => (
              <section key={c.classNumber} className="roster-block" aria-label={classLabel(c.classNumber)}>
                <h3 className="roster-block-head"><span>{classLabel(c.classNumber)}</span><span>{c.members.length} students</span></h3>
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
                <h3 className="caps-label">Class roster</h3>
                <ExportButton solutionId={solution.id} />
              </div>
              <div className="roster-table" role="table" aria-label="Class roster">
                <div className="roster-table-head" role="row">
                  <span role="columnheader">Class</span><span role="columnheader">Student</span>
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
              <div className="roster-col-head"><h3 className="caps-label">Preference map</h3></div>
              <PreferenceMap classes={classes} pairs={pairs} names={names} />
            </section>
            <p className="roster-fullpage">
              <Link to={`/solutions/${solution.id}`}>Open full page — sharing and permalink</Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
