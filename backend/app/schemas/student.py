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


MAX_PREFERENCE_KEYS = 20
MAX_IMPORT_ROWS = 600  # 500-row upload plus students added from preference names


def validate_keys(keys: list[str]) -> list[str]:
    if len(keys) > MAX_PREFERENCE_KEYS:
        raise ValueError(f"Max {MAX_PREFERENCE_KEYS} preferences per student")
    for k in keys:
        if not k or len(k) > 64:
            raise ValueError("Invalid preference key")
    return keys


class ImportStudent(StudentCreate):
    row_index:       int
    # Resolved candidates from the preview: a student id of this cohort, or "row:<row_index>"
    # of another row in this request. Each becomes a soft "together" rule.
    preference_keys: list[str] = []

    @field_validator("preference_keys")
    @classmethod
    def clean_keys(cls, v): return validate_keys(v)


class ExistingPreferences(BaseModel):
    """A row that duplicates a student already in the cohort but lists new preferences:
    no new student, the preferences are added to the existing one."""
    student_id:      str
    preference_keys: list[str] = []

    @field_validator("preference_keys")
    @classmethod
    def clean_keys(cls, v): return validate_keys(v)


class ImportConfirmRequest(BaseModel):
    students:             list[ImportStudent]
    existing_preferences: list[ExistingPreferences] = []

    @field_validator("students")
    @classmethod
    def unique_rows(cls, v: list[ImportStudent]):
        if len(v) > MAX_IMPORT_ROWS:
            raise ValueError(f"Max {MAX_IMPORT_ROWS} students per import")
        if len({s.row_index for s in v}) != len(v):
            raise ValueError("row_index must be unique")
        return v


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


class CandidateOut(BaseModel):
    key:       str                                # student id, or "row:<row_index>"
    display:   str
    source:    Literal["existing", "upload"]
    row_index: Optional[int] = None


class PreferenceMatchOut(BaseModel):
    name:            str
    status:          Literal["matched", "ambiguous", "unresolved"]
    matched_key:     Optional[str] = None
    matched_display: Optional[str] = None
    suggestions:     list[CandidateOut] = []


class ColumnNoteOut(BaseModel):
    column: str
    action: Literal["tags", "ignored"]
    detail: str
    code:   str = ""
    params: dict[str, str] = {}


class NameSplitOut(BaseModel):
    column:        str
    order:         Literal["surname_first", "given_first"]
    example_full:  str
    example_first: str
    example_last:  str


ImportStatus = Literal["ok", "duplicate_exact", "duplicate_similar", "missing_name", "invalid_tag", "invalid_gender"]


class ImportPreviewRow(BaseModel):
    row_index:      int
    first_name:     str
    last_name:      str
    tags:           list[str]
    gender:         Optional[Gender] = None
    gender_guessed: bool = False                   # gender came from the first name, not the file
    status:         ImportStatus
    status_message: Optional[str] = None           # English; the UI uses status_code + status_params
    status_code:    Optional[str] = None
    status_params:  dict[str, str] = {}
    importable:     bool = True   # imported unless the teacher unticks it (duplicate_exact defaults to False)
    existing_student_id: Optional[str] = None      # duplicate_exact of this cohort student
    preferences:    list[PreferenceMatchOut] = []


class ImportPreviewResponse(BaseModel):
    rows:                   list[ImportPreviewRow]
    total:                  int
    ok_count:               int
    error_count:            int
    preferences_matched:    int
    preferences_unresolved: int
    column_notes:           list[ColumnNoteOut] = []
    name_split:             Optional[NameSplitOut] = None


class RosterRow(BaseModel):
    row_index:  int
    first_name: str
    last_name:  str
    importable: bool


class RematchRequest(BaseModel):
    name:           str
    self_row_index: int
    rows:           list[RosterRow]


class ExistingUpdated(BaseModel):
    student_id:          str
    display:             str
    constraints_created: int


class SkippedPreferenceOut(BaseModel):
    owner:      str
    target_key: str
    reason:     Literal["target_not_imported", "unknown_student"]


class ImportConfirmResponse(BaseModel):
    students:            list[StudentOut]
    constraints_created: int
    existing_updated:    list[ExistingUpdated] = []
    skipped_preferences: list[SkippedPreferenceOut] = []
