"""backfill gender columns on databases created from the pre-gender 001

Revision ID: 003
Revises: 002
Create Date: 2026-11-24

d1d8a67 added cohorts.balance_gender, students.gender and student_gender_check by
editing 001 after 001 had already been applied to production. Databases created
from the old 001 lack them, so this adds whatever is missing. Every statement is
idempotent: databases created from the current 001 are unchanged.

Do not edit an applied migration again; add a new one instead.
"""
from alembic import op

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE cohorts ADD COLUMN IF NOT EXISTS balance_gender BOOLEAN NOT NULL DEFAULT false")
    op.execute("ALTER TABLE students ADD COLUMN IF NOT EXISTS gender VARCHAR")
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_gender_check') THEN
                ALTER TABLE students ADD CONSTRAINT student_gender_check CHECK (gender IN ('boy', 'girl'));
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # 001 owns these objects; dropping them here would break databases created from it.
    pass
