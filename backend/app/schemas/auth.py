from pydantic import BaseModel, EmailStr, field_validator
import re


class RegisterRequest(BaseModel):
    email:       EmailStr
    password:    str
    school_name: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("school_name")
    @classmethod
    def school_name_clean(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("school_name is required")
        if len(v) > 200:
            raise ValueError("school_name too long")
        return v


class LoginRequest(BaseModel):
    email:    EmailStr
    password: str


class TeacherOut(BaseModel):
    id:          str
    email:       str
    school_name: str

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    teacher: TeacherOut
