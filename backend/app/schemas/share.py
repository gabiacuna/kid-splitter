from pydantic import BaseModel


class ShareTokenOut(BaseModel):
    solution_id:   str
    share_token:   str
    share_url:     str
    share_enabled: bool


class PublicStudentOut(BaseModel):
    first_name: str
    tags:       list[str]


class PublicClassOut(BaseModel):
    class_number: int
    students:     list[PublicStudentOut]


class PublicSolutionOut(BaseModel):
    """Names-only view. Score/violation numbers are deliberately not exposed publicly."""
    solution_id: str
    cohort_name: str
    label:       str
    classes:     list[PublicClassOut]
