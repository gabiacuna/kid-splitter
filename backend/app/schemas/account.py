from pydantic import BaseModel, field_validator


class AccountSummary(BaseModel):
    cohorts:     int
    students:    int
    solutions:   int
    share_links: int


class UpdateAccountRequest(BaseModel):
    school_name: str

    @field_validator("school_name")
    @classmethod
    def school_name_clean(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("school_name is required")
        if len(v) > 200:
            raise ValueError("school_name too long")
        return v


class DeleteAccountRequest(BaseModel):
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password:     str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

