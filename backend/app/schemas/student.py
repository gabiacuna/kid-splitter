from pydantic import BaseModel, field_validator
from typing import Literal, Optional
from datetime import datetime
import re

TAG_RE = re.compile(r'^[a-zA-Z0-9\-]{1,30}$')

Gender = Literal["boy", "girl"]


def validate_tags(tags: list[str]) -> list[str]:
    if len(tags) > 10:
        raise ValueError("Max 10 tags per student")
    for tag in tags:
        if not TAG_RE.match(tag):
            raise ValueError(f"Invalid tag '{tag}': alphanumeric + hyphens only, max 30 chars")
    return tags


def validate_name(v: str, field: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError(f"{field} is required")
    if len(v) > 100:
        raise ValueError(f"{field} max 100 characters")
    if "<" in v or ">" in v:
        raise ValueError(f"{field} must not contain HTML")
    return v


class StudentCreate(BaseModel):
    first_name: str
    last_name:  str
    tags:       list[str] = []
    gender:     Optional[Gender] = None

    @field_validator("first_name")
    @classmethod
    def clean_first(cls, v): return validate_name(v, "first_name")

    @field_validator("last_name")
    @classmethod
    def clean_last(cls, v): return validate_name(v, "last_name")

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, v): return validate_tags(v)


class StudentUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name:  Optional[str] = None
    tags:       Optional[list[str]] = None
    # None means "unknown" here, not "unchanged": the router checks model_fields_set.
    gender:     Optional[Gender] = None

    @field_validator("first_name")
    @classmethod
    def clean_first(cls, v):
        if v is None:
            return v
        return validate_name(v, "first_name")

    @field_validator("last_name")
    @classmethod
    def clean_last(cls, v):
        if v is None:
            return v
        return validate_name(v, "last_name")

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, v):
        if v is None:
            return v
        return validate_tags(v)


class ImportStudent(StudentCreate):
    preferences: list[str] = []   # classmate names; resolved server-side into soft "together" constraints


class ImportConfirmRequest(BaseModel):
    students: list[ImportStudent]


class StudentOut(BaseModel):
    id:            str
    cohort_id:     str
    first_name:    str
    last_name:     str
    tags:          list[str]
    import_source: Optional[str]
    gender:        Optional[Gender]
    created_at:    datetime

    model_config = {"from_attributes": True}


class PreferenceMatchOut(BaseModel):
    name:            str
    status:          Literal["matched", "ambiguous", "unresolved"]
    matched_display: Optional[str] = None
    suggestions:     list[str] = []


class ColumnNoteOut(BaseModel):
    column: str
    action: Literal["tags", "ignored"]
    detail: str


class ImportPreviewRow(BaseModel):
    row_index:      int
    first_name:     str
    last_name:      str
    tags:           list[str]
    gender:         Optional[Gender] = None
    status:         str
    status_message: Optional[str] = None
    preferences:    list[PreferenceMatchOut] = []


class ImportPreviewResponse(BaseModel):
    rows:                   list[ImportPreviewRow]
    total:                  int
    ok_count:               int
    error_count:            int
    preferences_matched:    int
    preferences_unresolved: int
    column_notes:           list[ColumnNoteOut] = []


class RosterRow(BaseModel):
    row_index:  int
    first_name: str
    last_name:  str
    importable: bool


class RematchRequest(BaseModel):
    name:           str
    self_row_index: int
    rows:           list[RosterRow]


class ImportConfirmResponse(BaseModel):
    students:            list[StudentOut]
    constraints_created: int
