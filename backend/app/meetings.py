import random
from datetime import UTC, datetime

import bcrypt

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .auth import current_user, current_user_optional, set_auth_cookie
from .database import get_db
from .models import (
    MEETING_STATUS_ACTIVE,
    MEETING_STATUS_ENDED,
    MEETING_STATUS_SCHEDULED,
    MEETING_TYPE_INSTANT,
    MEETING_TYPE_SCHEDULED,
    MEETING_TYPES,
    Meeting,
    MeetingParticipant,
    User,
)
from .schemas import MeetingCreate, MeetingOut, MeetingPublic
from .signaling import end_meeting, start_meeting

DEFAULT_DURATION_MINUTES = 60
MAX_DURATION_MINUTES = 1440
MAX_PASSCODE_LENGTH = 16

router = APIRouter(prefix="/api/meetings", tags=["meetings"])


def generate_meeting_code(db: Session) -> str:
    while True:
        code = "".join(random.choices("0123456789", k=11))
        if db.scalar(select(Meeting).where(Meeting.meeting_code == code)) is None:
            return code


def active_meeting_for(db: Session, host_id: int, exclude_id: int | None = None):
    query = select(Meeting).where(
        Meeting.host_id == host_id, Meeting.status == MEETING_STATUS_ACTIVE
    )
    if exclude_id is not None:
        query = query.where(Meeting.id != exclude_id)
    return db.scalar(query)


def reject_if_already_hosting(db: Session, host_id: int, exclude_id: int | None = None):
    """Section 20: one ACTIVE meeting per host at a time."""
    running = active_meeting_for(db, host_id, exclude_id)
    if running is None:
        return
    raise HTTPException(
        status_code=409,
        detail={
            "message": "You already have a meeting running.",
            "meeting_code": running.meeting_code,
            "title": running.title,
        },
    )


def to_naive_utc(value: datetime) -> datetime:
    # Everything in the database is naive UTC; a client sends ISO 8601 UTC.
    if value.tzinfo is not None:
        return value.astimezone(UTC).replace(tzinfo=None)
    return value


@router.post("", response_model=MeetingOut, status_code=201)
def create_meeting(
    payload: MeetingCreate,
    response: Response,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
):
    # A guest starting a meeting becomes a real (if anonymous) user and gets a
    # normal session. Every host check downstream — start, end, lock, remove,
    # admit, one-active-meeting — then works unchanged, because there is only
    # ever one notion of who a host is.
    if user is None:
        user = User(email=None, email_verified=False, display_name="Guest")
        db.add(user)
        db.commit()
        db.refresh(user)
        set_auth_cookie(response, user.id)
    if payload.meeting_type not in MEETING_TYPES:
        raise HTTPException(status_code=422, detail="Invalid meeting_type")

    duration = payload.duration_minutes
    if duration is not None and not 1 <= duration <= MAX_DURATION_MINUTES:
        raise HTTPException(
            status_code=400, detail="duration_minutes must be between 1 and 1440"
        )

    passcode = (payload.passcode or "").strip()
    if passcode and len(passcode) > MAX_PASSCODE_LENGTH:
        raise HTTPException(
            status_code=400, detail=f"Passcode must be at most {MAX_PASSCODE_LENGTH} characters"
        )
    # Hashed, never stored in the clear — the same reasoning as a password,
    # even though a meeting passcode is shorter-lived.
    passcode_hash = (
        bcrypt.hashpw(passcode.encode(), bcrypt.gensalt()).decode() if passcode else None
    )

    if payload.meeting_type == MEETING_TYPE_SCHEDULED:
        if payload.scheduled_at is None:
            raise HTTPException(
                status_code=400, detail="scheduled_at is required for a scheduled meeting"
            )
        scheduled_at = to_naive_utc(payload.scheduled_at)
        if scheduled_at <= datetime.now(UTC).replace(tzinfo=None):
            raise HTTPException(status_code=400, detail="scheduled_at must be in the future")

        meeting = Meeting(
            meeting_code=generate_meeting_code(db),
            title=payload.title or f"{user.display_name}'s Meeting",
            description=payload.description,
            host_id=user.id,
            meeting_type=MEETING_TYPE_SCHEDULED,
            scheduled_at=scheduled_at,
            duration_minutes=duration or DEFAULT_DURATION_MINUTES,
            allow_join_before_host=payload.allow_join_before_host,
            waiting_room_enabled=payload.waiting_room_enabled,
            passcode_hash=passcode_hash,
            status=MEETING_STATUS_SCHEDULED,
            started_at=None,
        )
    else:
        # An instant meeting is active on creation, so it is subject to the
        # one-active-meeting rule immediately.
        reject_if_already_hosting(db, user.id)
        meeting = Meeting(
            meeting_code=generate_meeting_code(db),
            title=payload.title or f"{user.display_name}'s Meeting",
            description=payload.description,
            host_id=user.id,
            meeting_type=MEETING_TYPE_INSTANT,
            scheduled_at=None,
            duration_minutes=None,
            allow_join_before_host=payload.allow_join_before_host,
            waiting_room_enabled=payload.waiting_room_enabled,
            passcode_hash=passcode_hash,
            status=MEETING_STATUS_ACTIVE,
            started_at=datetime.now(UTC).replace(tzinfo=None),
        )

    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return meeting


@router.get("", response_model=list[MeetingOut])
def list_meetings(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    rows = db.execute(
        select(Meeting, func.count(MeetingParticipant.id))
        .outerjoin(MeetingParticipant, MeetingParticipant.meeting_id == Meeting.id)
        .where(Meeting.host_id == user.id)
        .group_by(Meeting.id)
    ).all()

    out = [
        MeetingOut.model_validate(meeting).model_copy(update={"participant_count": count})
        for meeting, count in rows
    ]
    # Scheduled meetings read as an agenda (soonest first); everything else is
    # history (newest first).
    upcoming = sorted(
        (m for m in out if m.status == MEETING_STATUS_SCHEDULED),
        key=lambda m: m.scheduled_at or m.created_at,
    )
    rest = sorted(
        (m for m in out if m.status != MEETING_STATUS_SCHEDULED),
        key=lambda m: m.created_at,
        reverse=True,
    )
    return upcoming + rest


@router.post("/{meeting_code}/start", response_model=MeetingOut)
async def start(
    meeting_code: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    meeting = db.scalar(select(Meeting).where(Meeting.meeting_code == meeting_code))
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if meeting.host_id != user.id:
        raise HTTPException(status_code=403, detail="Only the host can start this meeting")
    if meeting.status == MEETING_STATUS_ENDED:
        raise HTTPException(status_code=409, detail="This meeting has ended")
    reject_if_already_hosting(db, user.id, exclude_id=meeting.id)

    # Starting twice is idempotent: the host may click it from two tabs.
    await start_meeting(db, meeting)
    db.refresh(meeting)
    return meeting


@router.post("/{meeting_code}/end", response_model=MeetingOut)
async def end(
    meeting_code: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Section 8: an explicit end, distinct from the host merely disconnecting."""
    meeting = db.scalar(select(Meeting).where(Meeting.meeting_code == meeting_code))
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if meeting.host_id != user.id:
        raise HTTPException(status_code=403, detail="Only the host can end this meeting")

    await end_meeting(db, meeting)
    db.refresh(meeting)
    return meeting


# Unauthenticated on purpose: the join flow needs to resolve a meeting before
# the joiner is known to be a participant. Resolving it does not grant entry —
# the WebSocket decides that.
@router.get("/{meeting_code}", response_model=MeetingPublic)
def get_meeting(meeting_code: str, db: Session = Depends(get_db)):
    meeting = db.scalar(select(Meeting).where(Meeting.meeting_code == meeting_code))
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    # 410 rather than 404: a code that is over is a different user experience
    # from a code that never existed.
    if meeting.status == MEETING_STATUS_ENDED:
        raise HTTPException(status_code=410, detail="This meeting has ended")
    return MeetingPublic(
        meeting_code=meeting.meeting_code,
        title=meeting.title,
        host_display_name=meeting.host.display_name,
        status=meeting.status,
        scheduled_at=meeting.scheduled_at,
        passcode_required=meeting.passcode_hash is not None,
    )
