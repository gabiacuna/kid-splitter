from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Integer, ForeignKey, DateTime, func
from ..db import Base
import uuid


class Cohort(Base):
    __tablename__ = "cohorts"

    id:          Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    teacher_id:  Mapped[str] = mapped_column(String, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False)
    name:        Mapped[str] = mapped_column(String, nullable=False)
    year:        Mapped[int | None] = mapped_column(Integer, nullable=True)
    num_classes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at:  Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:  Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    students  = relationship("Student", back_populates="cohort", cascade="all, delete-orphan")
    solutions = relationship("Solution", back_populates="cohort", cascade="all, delete-orphan")
