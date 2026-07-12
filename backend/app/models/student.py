from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, ARRAY, ForeignKey, DateTime, func
from ..db import Base
import uuid


class Student(Base):
    __tablename__ = "students"

    id:            Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    cohort_id:     Mapped[str] = mapped_column(String, ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=False)
    first_name:    Mapped[str] = mapped_column(String, nullable=False)
    last_name:     Mapped[str] = mapped_column(String, nullable=False)
    tags:          Mapped[list[str]] = mapped_column(ARRAY(String), server_default="{}")
    import_source: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at:    Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:    Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    cohort = relationship("Cohort", back_populates="students")
