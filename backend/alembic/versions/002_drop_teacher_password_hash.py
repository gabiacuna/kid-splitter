"""drop teachers.password_hash — Supabase is the only password store

Revision ID: 002
Revises: 001
Create Date: 2026-11-23

A separate migration (not folded into 001) because the dev database now holds real
cohorts that must survive the upgrade.
"""
from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("teachers", "password_hash")


def downgrade() -> None:
    # Rows created after the upgrade have no hash; '' keeps NOT NULL satisfiable.
    op.add_column("teachers", sa.Column("password_hash", sa.String(), nullable=False, server_default=""))
    op.alter_column("teachers", "password_hash", server_default=None)
