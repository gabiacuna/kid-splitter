from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, DateTime, func
from ..db import Base
import uuid


class Teacher(Base):
    __tablename__ = "teachers"

    id:            Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email:         Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    school_name:   Mapped[str] = mapped_column(String, nullable=False)
    created_at:    Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:    Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
