from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime
import re

TAG_RE = re.compile(r'^[a-zA-Z0-9\-]{1,30}$')


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


class ImportConfirmRequest(BaseModel):
    students: list[StudentCreate]


class StudentOut(BaseModel):
    id:            str
    cohort_id:     str
    first_name:    str
    last_name:     str
    tags:          list[str]
    import_source: Optional[str]
    created_at:    datetime

    model_config = {"from_attributes": True}


class ImportPreviewRow(BaseModel):
    row_index:      int
    first_name:     str
    last_name:      str
    tags:           list[str]
    status:         str
    status_message: Optional[str] = None


class ImportPreviewResponse(BaseModel):
    rows:        list[ImportPreviewRow]
    total:       int
    ok_count:    int
    error_count: int
