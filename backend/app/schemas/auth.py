from pydantic import BaseModel, EmailStr, field_validator


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


class ResendRequest(BaseModel):
    email: EmailStr


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    access_token: str
    new_password: str

    @field_validator("access_token")
    @classmethod
    def token_shape(cls, v: str) -> str:
        if not v or len(v) > 4096:
            raise ValueError("invalid token")
        return v

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
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


class RegisterResponse(AuthResponse):
    # True when Supabase sent a confirmation email (no session yet); False when the
    # account is usable immediately and auth cookies were set.
    needs_confirmation: bool
