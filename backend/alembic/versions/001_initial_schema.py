"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-06-29

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teachers",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("email", sa.String(), unique=True, nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("school_name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    op.create_table(
        "cohorts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("teacher_id", sa.String(), sa.ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("num_classes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_cohorts_teacher_id", "cohorts", ["teacher_id"])

    op.create_table(
        "students",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("cohort_id", sa.String(), sa.ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("first_name", sa.String(), nullable=False),
        sa.Column("last_name", sa.String(), nullable=False),
        sa.Column("tags", sa.ARRAY(sa.String()), server_default="{}"),
        sa.Column("import_source", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_students_cohort_id", "students", ["cohort_id"])

    op.create_table(
        "binary_constraints",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("cohort_id", sa.String(), sa.ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_a_id", sa.String(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_b_id", sa.String(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("is_hard", sa.Boolean(), nullable=False, default=False),
        sa.Column("weight", sa.Float(), default=1.0),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.CheckConstraint("type IN ('together', 'separate')", name="binary_type_check"),
    )
    op.create_index("ix_binary_constraints_cohort_id", "binary_constraints", ["cohort_id"])

    op.create_table(
        "unary_constraints",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("cohort_id", sa.String(), sa.ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.String(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("parameter", sa.Integer(), nullable=True),
        sa.Column("is_hard", sa.Boolean(), nullable=False, default=False),
        sa.Column("weight", sa.Float(), default=1.0),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "type IN ('small_class','large_class','max_flagged_peers','max_conflict_peers')",
            name="unary_type_check",
        ),
    )
    op.create_index("ix_unary_constraints_cohort_id", "unary_constraints", ["cohort_id"])

    op.create_table(
        "solutions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("cohort_id", sa.String(), sa.ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("hard_violations", sa.Integer(), nullable=True),
        sa.Column("soft_violations", sa.Integer(), nullable=True),
        sa.Column("share_token", sa.String(), unique=True, nullable=True),
        sa.Column("share_enabled", sa.Boolean(), default=False),
        sa.Column("solver_metadata", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_solutions_cohort_id", "solutions", ["cohort_id"])
    op.create_index("ix_solutions_share_token", "solutions", ["share_token"])

    op.create_table(
        "class_assignments",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("solution_id", sa.String(), sa.ForeignKey("solutions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.String(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_number", sa.Integer(), nullable=False),
        sa.UniqueConstraint("solution_id", "student_id", name="uq_solution_student"),
    )
    op.create_index("ix_class_assignments_solution_id", "class_assignments", ["solution_id"])


def downgrade() -> None:
    op.drop_table("class_assignments")
    op.drop_table("solutions")
    op.drop_table("unary_constraints")
    op.drop_table("binary_constraints")
    op.drop_table("students")
    op.drop_table("cohorts")
    op.drop_table("teachers")
