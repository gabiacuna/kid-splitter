from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime


class CohortCreate(BaseModel):
    name:        str
    year:        Optional[int] = None
    num_classes: int
    balance_gender: bool = False

    @field_validator("name")
    @classmethod
    def name_clean(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        if len(v) > 200:
            raise ValueError("name too long")
        return v

    @field_validator("num_classes")
    @classmethod
    def valid_num_classes(cls, v: int) -> int:
        if v < 2 or v > 4:
            raise ValueError("num_classes must be between 2 and 4")
        return v

    @field_validator("year")
    @classmethod
    def valid_year(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 2000 or v > 2100):
            raise ValueError("year out of range")
        return v


class CohortUpdate(BaseModel):
    name:        Optional[str] = None
    year:        Optional[int] = None
    num_classes: Optional[int] = None
    balance_gender: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def name_clean(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        if len(v) > 200:
            raise ValueError("name too long")
        return v

    @field_validator("num_classes")
    @classmethod
    def valid_num_classes(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 2 or v > 4):
            raise ValueError("num_classes must be between 2 and 4")
        return v

    @field_validator("year")
    @classmethod
    def valid_year(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 2000 or v > 2100):
            raise ValueError("year out of range")
        return v


class CohortOut(BaseModel):
    id:            str
    name:          str
    year:          Optional[int]
    num_classes:   int
    balance_gender: bool
    student_count: int
    created_at:    datetime
    updated_at:    datetime

    model_config = {"from_attributes": True}


class CohortListOut(BaseModel):
    cohorts: list[CohortOut]
