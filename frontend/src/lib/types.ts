export interface Teacher {
  id: string;
  email: string;
  school_name: string;
}

export interface Cohort {
  id: string;
  name: string;
  year: number | null;
  num_classes: number;
  balance_gender: boolean;
  student_count?: number;
  last_solve_at?: string | null;
  created_at: string;
}

/** null = unknown: excluded from gender balancing, placed freely. */
export type Gender = 'boy' | 'girl' | null;

export interface Student {
  id: string;
  first_name: string;
  last_name: string;
  tags: string[];
  gender: Gender;
  import_source: 'csv' | 'manual';
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
  parameter?: number;
  is_hard: boolean;
  weight: number;
  notes?: string;
}

export interface Contradiction {
  type: 'hard_conflict' | 'cluster_too_large' | 'separation_impossible';
  message: string;
  student_ids: string[];
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
  share_token: string | null;
  share_enabled: boolean;
  solver_metadata: {
    status: 'OPTIMAL' | 'FEASIBLE';
    wall_time_seconds: number;
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
  cohort_name: string;
  classes: PublicClass[];
}
