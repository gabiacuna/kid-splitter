export interface Teacher {
  id: string;
  email: string;
  school_name: string;
}

/** What deleting the account would remove (GET /account/summary). */
export interface AccountSummary {
  cohorts: number;
  students: number;
  solutions: number;
  share_links: number;
}

export interface Cohort {
  id: string;
  name: string;
  year: number | null;
  num_classes: number;
  balance_gender: boolean;
  student_count: number;
  last_solve_at: string | null;
  created_at: string;
  updated_at: string;
}

/** null = unknown: excluded from gender balancing, placed freely. */
export type Gender = 'boy' | 'girl' | null;

export interface Student {
  id: string;
  cohort_id: string;
  first_name: string;
  last_name: string;
  tags: string[];
  gender: Gender;
  import_source: string | null;
  created_at: string;
}

export interface BinaryConstraint {
  id: string;
  student_a_id: string;
  student_b_id: string;
  type: 'together' | 'separate';
  is_hard: boolean;
  weight: number;
  notes?: string;
}

export interface UnaryConstraint {
  id: string;
  student_id: string;
  type: 'small_class' | 'large_class' | 'max_flagged_peers' | 'max_conflict_peers';
  tag?: string | null;
  parameter?: number | null;
  is_hard: boolean;
  weight: number;
}

/** One computed conflict: every rule in it shares the badge number `id`. */
export interface ConflictGroup {
  id: number;
  type: 'direct_conflict' | 'chain_conflict' | 'cluster_overflow' | 'coloring_impossible' | 'soft_warning';
  severity: 'hard' | 'soft';
  constraint_ids: string[];
  student_ids: string[];
  explanation: string;
}

export interface ValidationResult {
  has_contradictions: boolean;
  conflict_groups: ConflictGroup[];
}


export interface ClassAssignment {
  student_id: string;
  class_number: number;
}

export interface GenderSplit {
  class_number: number;
  boys: number;
  girls: number;
  unknown: number;
}

export interface Solution {
  id: string;
  cohort_id: string;
  label: string;
  score: number;
  hard_violations: number;
  soft_violations: number;
  share_enabled: boolean;
  solver_metadata: {
    status: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN';
    wall_time_s: number;
    objective_value: number | null;
  };
  class_assignments: ClassAssignment[];
  gender_split: GenderSplit[];
  created_at: string;
}

export interface PreferenceMatch {
  name: string;
  status: 'matched' | 'ambiguous' | 'unresolved';
  matched_display?: string | null;
  /** For unmatched names: roster students the teacher may have meant. */
  suggestions?: string[];
}

export interface ColumnNote {
  column: string;
  action: 'tags' | 'ignored';
  detail: string;
}

export interface PreviewRow {
  row_index: number;
  first_name: string;
  last_name: string;
  tags: string[];
  gender?: Gender;
  status: 'ok' | 'duplicate' | 'missing_name' | 'invalid_tag' | 'invalid_gender';
  /** Server-decided: confirm imports exactly the rows where this is true. */
  importable: boolean;
  status_message?: string | null;
  preferences: PreferenceMatch[];
}

export interface ImportPreviewResponse {
  rows: PreviewRow[];
  total: number;
  ok_count: number;
  error_count: number;
  preferences_matched: number;
  preferences_unresolved: number;
  column_notes: ColumnNote[];
}

export interface ImportConfirmResponse {
  students: Student[];
  constraints_created: number;
}

export interface PublicStudent {
  first_name: string;
  tags: string[];
}

export interface PublicClass {
  class_number: number;
  students: PublicStudent[];
}

export interface PublicSolutionData {
  solution_id: string;
  cohort_name: string;
  label: string;
  classes: PublicClass[];
}
