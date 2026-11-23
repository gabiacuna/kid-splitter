import type { BinaryConstraint, ClassAssignment, Student } from './types';

export interface RosterMember { studentId: string; name: string; student?: Student }
export interface RosterClass { classNumber: number; members: RosterMember[] }

export const studentName = (s?: Student) => (s ? `${s.first_name} ${s.last_name}` : '[Removed student]');

/** "Amara O." names, falling back to the full name where two would collide.
 *  Same rule as the backend's short_display_names(), so chips match explanations. */
export function shortNames(students: Student[]): Map<string, string> {
  const short = (s: Student) => (s.last_name ? `${s.first_name} ${s.last_name[0]}.` : s.first_name);
  const counts = new Map<string, number>();
  for (const s of students) counts.set(short(s), (counts.get(short(s)) ?? 0) + 1);
  return new Map(students.map((s) => [s.id, counts.get(short(s))! > 1 ? studentName(s) : short(s)]));
}

/** Classes in order, members sorted by last then first name. */
export function groupByClass(assignments: ClassAssignment[], students: Student[]): RosterClass[] {
  const byId = new Map(students.map((s) => [s.id, s]));
  const groups = new Map<number, RosterMember[]>();
  for (const a of assignments) {
    const student = byId.get(a.student_id);
    const list = groups.get(a.class_number) ?? [];
    list.push({ studentId: a.student_id, name: studentName(student), student });
    groups.set(a.class_number, list);
  }
  const key = (m: RosterMember) => (m.student ? `${m.student.last_name} ${m.student.first_name}` : '');
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([classNumber, members]) => ({ classNumber, members: members.sort((a, b) => key(a).localeCompare(key(b))) }));
}

/** Together pairs where both students are in this roster (they may be in different classes). */
export function togetherPairs(binary: BinaryConstraint[], assignments: ClassAssignment[]): [string, string][] {
  const present = new Set(assignments.map((a) => a.student_id));
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const c of binary) {
    if (c.type !== 'together' || !present.has(c.student_a_id) || !present.has(c.student_b_id)) continue;
    const k = [c.student_a_id, c.student_b_id].sort().join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([c.student_a_id, c.student_b_id]);
  }
  return out;
}
