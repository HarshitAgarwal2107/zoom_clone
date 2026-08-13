from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

PROVIDER_GOOGLE = "google"
PROVIDER_EMAIL_OTP = "email_otp"
PROVIDER_PASSWORD = "password"
PROVIDERS = (PROVIDER_GOOGLE, PROVIDER_EMAIL_OTP, PROVIDER_PASSWORD)

MEETING_TYPE_INSTANT = "instant"
MEETING_TYPE_SCHEDULED = "scheduled"
MEETING_TYPES = (MEETING_TYPE_INSTANT, MEETING_TYPE_SCHEDULED)

ROLE_HOST = "host"
ROLE_PARTICIPANT = "participant"
ROLES = (ROLE_HOST, ROLE_PARTICIPANT)

PARTICIPANT_STATUS_JOINED = "joined"
PARTICIPANT_STATUS_LEFT = "left"
PARTICIPANT_STATUS_REMOVED = "removed"
PARTICIPANT_STATUSES = (
    PARTICIPANT_STATUS_JOINED,
    PARTICIPANT_STATUS_LEFT,
    PARTICIPANT_STATUS_REMOVED,
)

MEETING_STATUS_SCHEDULED = "scheduled"
MEETING_STATUS_ACTIVE = "active"
MEETING_STATUS_ENDED = "ended"
MEETING_STATUSES = (
    MEETING_STATUS_SCHEDULED,
    MEETING_STATUS_ACTIVE,
    MEETING_STATUS_ENDED,
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    email_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    identities: Mapped[list["AuthIdentity"]] = relationship(
        "AuthIdentity", back_populates="user", cascade="all, delete-orphan"
    )
    meetings: Mapped[list["Meeting"]] = relationship(
        "Meeting", back_populates="host", cascade="all, delete-orphan"
    )


class AuthIdentity(Base):
    __tablename__ = "auth_identities"
    __table_args__ = (UniqueConstraint("provider", "provider_user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    provider_user_id: Mapped[str] = mapped_column(String, nullable=False)
    # Only the password provider carries a credential; google and email_otp
    # delegate authentication elsewhere and leave this null.
    secret_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    user: Mapped["User"] = relationship("User", back_populates="identities")


class LoginCode(Base):
    __tablename__ = "login_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, index=True, nullable=False)
    code_hash: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    attempt_count: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(
        ForeignKey("meetings.id"), index=True, nullable=False
    )
    participant_id: Mapped[int] = mapped_column(
        ForeignKey("meeting_participants.id"), nullable=False
    )
    # Denormalised on purpose: a participant row can be reused across a rejoin,
    # and a message should show the name the sender had when they sent it.
    # Storing only the FK would rewrite history retroactively.
    sender_name: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_code: Mapped[str] = mapped_column(
        String(11), unique=True, index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    meeting_type: Mapped[str] = mapped_column(String, nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    allow_join_before_host: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    # Waiting Room is a separate concept from waiting for the host: the meeting
    # can be running and a participant still be held for admission.
    waiting_room_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    # Locked keeps existing participants in and turns new ones away; it is not
    # the same as ending the meeting.
    locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    passcode_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    # scheduled_at is intent, started_at is fact, created_at is bookkeeping.
    # A meeting started early has started_at < scheduled_at, which is correct:
    # the scheduled time stays as historical metadata and is never rewritten.
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    host: Mapped["User"] = relationship("User", back_populates="meetings")
    participants: Mapped[list["MeetingParticipant"]] = relationship(
        "MeetingParticipant", back_populates="meeting", cascade="all, delete-orphan"
    )


class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(
        ForeignKey("meetings.id"), index=True, nullable=False
    )
    # Nullable on purpose: joining takes a display name only, so identity in a
    # room is weaker than identity in the app. A guest is a real participant
    # row with no user behind it.
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    # left_at alone cannot distinguish leaving from being removed.
    status: Mapped[str] = mapped_column(
        String, nullable=False, default=PARTICIPANT_STATUS_JOINED
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    left_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    meeting: Mapped["Meeting"] = relationship("Meeting", back_populates="participants")
