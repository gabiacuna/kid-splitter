from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Boolean, Float, Integer, ForeignKey, DateTime, func, CheckConstraint
from ..db import Base
import uuid


class BinaryConstraint(Base):
    __tablename__ = "binary_constraints"
    __table_args__ = (
        CheckConstraint("type IN ('together', 'separate')", name="binary_type_check"),
    )

    id:           Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    cohort_id:    Mapped[str] = mapped_column(String, ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=False)
    student_a_id: Mapped[str] = mapped_column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    student_b_id: Mapped[str] = mapped_column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    type:         Mapped[str] = mapped_column(String, nullable=False)
    is_hard:      Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    weight:       Mapped[float] = mapped_column(Float, default=1.0)
    notes:        Mapped[str | None] = mapped_column(String, nullable=True)
    created_at:   Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:   Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class UnaryConstraint(Base):
    __tablename__ = "unary_constraints"
    __table_args__ = (
        CheckConstraint(
            "type IN ('small_class','large_class','max_flagged_peers','max_conflict_peers')",
            name="unary_type_check",
        ),
    )

    id:         Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    cohort_id:  Mapped[str] = mapped_column(String, ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=False)
    student_id: Mapped[str] = mapped_column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    type:       Mapped[str] = mapped_column(String, nullable=False)
    tag:        Mapped[str | None] = mapped_column(String, nullable=True)
    parameter:  Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_hard:    Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    weight:     Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
