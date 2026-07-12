from pydantic import BaseModel
from typing import Optional


class ShareTokenOut(BaseModel):
    solution_id:   str
    share_token:   str
    share_url:     str
    share_enabled: bool


class PublicAssignmentOut(BaseModel):
    first_name:   str
    class_number: int
    tags:         list[str]


class PublicSolutionOut(BaseModel):
    solution_id:     str
    cohort_name:     str
    label:           str
    score:           float
    soft_violations: int
    classes:         dict[int, list[PublicAssignmentOut]]
