from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime


class SolveRequest(BaseModel):
    num_classes: int

    @field_validator("num_classes")
    @classmethod
    def valid_num_classes(cls, v: int) -> int:
        if v < 2 or v > 4:
            raise ValueError("num_classes must be between 2 and 4")
        return v


class AssignmentOut(BaseModel):
    student_id:   str
    class_number: int


class SolverMetadata(BaseModel):
    wall_time_s:     float
    objective_value: Optional[int]
    status:          str


class GenderSplit(BaseModel):
    class_number: int
    boys:         int
    girls:        int
    unknown:      int


class SolutionOut(BaseModel):
    id:              str
    cohort_id:       str
    label:           str
    score:           float
    hard_violations: int
    soft_violations: int
    share_enabled:   bool
    solver_metadata: SolverMetadata
    gender_split:    list[GenderSplit]
    created_at:      datetime

    model_config = {"from_attributes": True}


class SolutionDetailOut(SolutionOut):
    assignments: list[AssignmentOut]


class SolveResponse(BaseModel):
    solutions: list[SolutionOut]
