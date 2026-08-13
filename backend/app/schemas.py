from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from .models import MEETING_TYPE_INSTANT


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    email_verified: bool
    display_name: str
    avatar_url: str | None
    created_at: datetime


class OtpRequest(BaseModel):
    email: EmailStr


class OtpVerify(BaseModel):
    email: EmailStr
    code: str = Field(min_length=1)


class PasswordSet(BaseModel):
    password: str
    # Signup asks for these at account creation; a password change omits them.
    first_name: str | None = None
    last_name: str | None = None


class PasswordLogin(BaseModel):
    email: EmailStr
    password: str


class AuthMethodOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # Deliberately no secret_hash and no provider_user_id: the Google sub is an
    # internal identifier with no reason to reach the browser.
    provider: str
    created_at: datetime


class MeetingCreate(BaseModel):
    title: str | None = None
    description: str | None = None
    meeting_type: str = MEETING_TYPE_INSTANT
    scheduled_at: datetime | None = None
    duration_minutes: int | None = None
    allow_join_before_host: bool = False
    waiting_room_enabled: bool = False
    passcode: str | None = None


class MeetingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    meeting_code: str
    title: str
    description: str | None
    host_id: int
    meeting_type: str
    scheduled_at: datetime | None
    duration_minutes: int | None
    status: str
    allow_join_before_host: bool
    waiting_room_enabled: bool
    locked: bool
    started_at: datetime | None
    ended_at: datetime | None
    created_at: datetime
    participant_count: int = 0


class MeetingPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    meeting_code: str
    title: str
    host_display_name: str
    status: str
    scheduled_at: datetime | None
    # The meeting code is the secret; saying a passcode is needed is not a leak.
    passcode_required: bool
