import re
from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, Literal
from datetime import datetime

_TAG_RE = re.compile(r'^[a-zA-Z0-9_-]+$')

BINARY_TYPES = Literal["together", "separate"]
UNARY_TYPES  = Literal["small_class", "large_class", "max_flagged_peers", "max_conflict_peers"]


class BinaryConstraintCreate(BaseModel):
    student_a_id: str
    student_b_id: str
    type:         BINARY_TYPES
    is_hard:      bool = False
    weight:       float = 1.0
    notes:        Optional[str] = None

    @field_validator("weight")
    @classmethod
    def valid_weight(cls, v: float) -> float:
        if v < 0.1 or v > 10.0:
            raise ValueError("weight must be between 0.1 and 10.0")
        return v

    @model_validator(mode="after")
    def different_students(self):
        if self.student_a_id == self.student_b_id:
            raise ValueError("student_a_id and student_b_id must be different")
        return self


class BinaryConstraintUpdate(BaseModel):
    type:    Optional[BINARY_TYPES] = None
    is_hard: Optional[bool] = None
    weight:  Optional[float] = None
    notes:   Optional[str] = None

    @field_validator("weight")
    @classmethod
    def valid_weight(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and (v < 0.1 or v > 10.0):
            raise ValueError("weight must be between 0.1 and 10.0")
        return v


class UnaryConstraintCreate(BaseModel):
    student_id: str
    type:       UNARY_TYPES
    tag:        Optional[str] = None
    parameter:  Optional[int] = None
    is_hard:    bool = False
    weight:     float = 1.0

    @model_validator(mode="after")
    def validate_max_type_fields(self):
        if self.type in ("max_flagged_peers", "max_conflict_peers"):
            if self.parameter is None or self.parameter < 0:
                raise ValueError(f"parameter (>= 0) is required for type '{self.type}'")
            if not self.tag:
                raise ValueError(f"tag is required for type '{self.type}'")
            if not _TAG_RE.match(self.tag):
                raise ValueError(f"tag '{self.tag}' contains invalid characters (use letters, digits, hyphens, underscores)")
        return self

    @field_validator("weight")
    @classmethod
    def valid_weight(cls, v: float) -> float:
        if v < 0.1 or v > 10.0:
            raise ValueError("weight must be between 0.1 and 10.0")
        return v


class UnaryConstraintUpdate(BaseModel):
    type:      Optional[UNARY_TYPES] = None
    tag:       Optional[str] = None
    parameter: Optional[int] = None
    is_hard:   Optional[bool] = None
    weight:    Optional[float] = None

    @field_validator("tag")
    @classmethod
    def valid_tag(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _TAG_RE.match(v):
            raise ValueError(f"tag '{v}' contains invalid characters (use letters, digits, hyphens, underscores)")
        return v

    @field_validator("weight")
    @classmethod
    def valid_weight(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and (v < 0.1 or v > 10.0):
            raise ValueError("weight must be between 0.1 and 10.0")
        return v


class BinaryConstraintOut(BaseModel):
    id:           str
    cohort_id:    str
    student_a_id: str
    student_b_id: str
    type:         str
    is_hard:      bool
    weight:       float
    notes:        Optional[str]
    created_at:   datetime

    model_config = {"from_attributes": True}


class UnaryConstraintOut(BaseModel):
    id:         str
    cohort_id:  str
    student_id: str
    type:       str
    tag:        Optional[str]
    parameter:  Optional[int]
    is_hard:    bool
    weight:     float
    created_at: datetime

    model_config = {"from_attributes": True}


class ConstraintListOut(BaseModel):
    binary: list[BinaryConstraintOut]
    unary:  list[UnaryConstraintOut]


class ContradictionOut(BaseModel):
    type:        str
    message:     str
    student_ids: list[str]


class ValidationOut(BaseModel):
    has_contradictions: bool
    contradictions:     list[ContradictionOut]
