from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Float, Integer, Boolean, ForeignKey, DateTime, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from ..db import Base
import uuid


class Solution(Base):
    __tablename__ = "solutions"

    id:              Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    cohort_id:       Mapped[str] = mapped_column(String, ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=False)
    label:           Mapped[str | None] = mapped_column(String, nullable=True)
    score:           Mapped[float | None] = mapped_column(Float, nullable=True)
    hard_violations: Mapped[int | None] = mapped_column(Integer, nullable=True)
    soft_violations: Mapped[int | None] = mapped_column(Integer, nullable=True)
    share_token:     Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    share_enabled:   Mapped[bool] = mapped_column(Boolean, default=False)
    solver_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at:      Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:      Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    assignments = relationship("ClassAssignment", back_populates="solution", cascade="all, delete-orphan")
    cohort      = relationship("Cohort", back_populates="solutions")


class ClassAssignment(Base):
    __tablename__ = "class_assignments"
    __table_args__ = (
        UniqueConstraint("solution_id", "student_id", name="uq_solution_student"),
    )

    id:           Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    solution_id:  Mapped[str] = mapped_column(String, ForeignKey("solutions.id", ondelete="CASCADE"), nullable=False)
    student_id:   Mapped[str] = mapped_column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    class_number: Mapped[int] = mapped_column(Integer, nullable=False)

    solution = relationship("Solution", back_populates="assignments")
