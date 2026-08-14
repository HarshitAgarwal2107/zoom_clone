import asyncio
import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime

import bcrypt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import COOKIE_NAME, JWT_ALGORITHM
from .config import settings
from .database import SessionLocal
from .models import (
    MEETING_STATUS_ACTIVE,
    MEETING_STATUS_ENDED,
    PARTICIPANT_STATUS_JOINED,
    PARTICIPANT_STATUS_LEFT,
    PARTICIPANT_STATUS_REMOVED,
    ROLE_HOST,
    ROLE_PARTICIPANT,
    ChatMessage,
    Meeting,
    MeetingParticipant,
)

RELAY_TYPES = ("offer", "answer", "ice-candidate", "state")
MAX_CHAT_BODY = 2000
# Section 10: an empty room stays active briefly rather than ending at once,
# so a host alone who reloads or steps out comes back to the same meeting.
GRACE_SECONDS = 30

# Close codes the frontend distinguishes.
CLOSE_NOT_FOUND = 4404
CLOSE_ENDED = 4410
CLOSE_BAD_PASSCODE = 4401
CLOSE_LOCKED = 4403
CLOSE_REMOVED = 4405
CLOSE_DENIED = 4406

router = APIRouter()


@dataclass
class Peer:
    websocket: WebSocket
    display_name: str
    user_id: int | None
    is_host: bool = False
    # Only set once admitted — a peer that has not joined has no row.
    participant_id: int | None = field(default=None)


# In-process registries: {meeting_code: {peer_id: Peer}}. This is why the
# backend must run --workers 1. The production fix is Redis pub/sub.
rooms: dict[str, dict[str, Peer]] = {}
# Held because the meeting has not started. Not in the meeting.
waiting: dict[str, dict[str, Peer]] = {}
# Held because the host must admit them. A separate concept from the above:
# the meeting can be running and a participant still be waiting for approval.
knocking: dict[str, dict[str, Peer]] = {}
# Pending "end this empty meeting" timers, one per meeting at most. In-process
# and therefore lost on restart — see the README.
end_timers: dict[str, asyncio.Task] = {}


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _cancel_end_timer(meeting_code: str) -> None:
    task = end_timers.pop(meeting_code, None)
    if task is not None:
        task.cancel()


async def _end_after_grace(meeting_code: str) -> None:
    try:
        await asyncio.sleep(GRACE_SECONDS)
        if rooms.get(meeting_code):
            return  # somebody came back
        # The connection's session is long closed by now, so use a fresh one.
        db = SessionLocal()
        try:
            meeting = db.scalar(
                select(Meeting).where(Meeting.meeting_code == meeting_code)
            )
            if meeting is not None and meeting.status == MEETING_STATUS_ACTIVE:
                meeting.status = MEETING_STATUS_ENDED
                meeting.ended_at = _now()
                db.commit()
        finally:
            db.close()
    except asyncio.CancelledError:
        pass
    finally:
        # Only clear our own handle: a newer timer may already have replaced it.
        if end_timers.get(meeting_code) is asyncio.current_task():
            end_timers.pop(meeting_code, None)


def _user_id_from_cookie(websocket: WebSocket) -> int | None:
    token = websocket.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        return None


async def _send(peer: Peer, message: dict) -> None:
    try:
        await peer.websocket.send_json(message)
    except RuntimeError:
        # Disconnected between the registry read and the send; its own finally
        # block will clean it up.
        pass


async def _broadcast(meeting_code: str, message: dict, exclude: str | None = None):
    for peer_id, peer in list(rooms.get(meeting_code, {}).items()):
        if peer_id != exclude:
            await _send(peer, message)


async def _send_to_hosts(meeting_code: str, message: dict):
    for peer in list(rooms.get(meeting_code, {}).values()):
        if peer.is_host:
            await _send(peer, message)


async def _admit(db: Session, meeting: Meeting, peer_id: str, peer: Peer) -> None:
    # Anyone arriving calls off a pending end.
    _cancel_end_timer(meeting.meeting_code)

    participant = MeetingParticipant(
        meeting_id=meeting.id,
        user_id=peer.user_id,
        display_name=peer.display_name,
        role=ROLE_HOST if peer.is_host else ROLE_PARTICIPANT,
        status=PARTICIPANT_STATUS_JOINED,
        joined_at=_now(),
    )
    db.add(participant)
    db.commit()
    db.refresh(participant)
    peer.participant_id = participant.id

    code = meeting.meeting_code
    room = rooms.setdefault(code, {})
    # room-state must reach the newcomer before anyone is told they arrived,
    # or existing peers will offer to someone who does not know the room yet.
    await _send(
        peer,
        {
            "type": "room-state",
            "peer_id": peer_id,
            "is_host": peer.is_host,
            "locked": meeting.locked,
            "peers": [
                {"peer_id": pid, "display_name": p.display_name}
                for pid, p in room.items()
            ],
        },
    )
    await _broadcast(
        code,
        {"type": "peer-joined", "peer_id": peer_id, "display_name": peer.display_name},
    )
    room[peer_id] = peer

    # A host arriving needs to see anyone already knocking.
    if peer.is_host:
        for knock_id, knocker in knocking.get(code, {}).items():
            await _send(
                peer,
                {
                    "type": "knock",
                    "peer_id": knock_id,
                    "display_name": knocker.display_name,
                },
            )


async def start_meeting(db: Session, meeting: Meeting) -> None:
    """The explicit SCHEDULED -> ACTIVE transition. Idempotent."""
    if meeting.status == MEETING_STATUS_ACTIVE:
        return

    meeting.status = MEETING_STATUS_ACTIVE
    meeting.started_at = _now()
    # scheduled_at is never rewritten: starting early is legitimate.
    db.commit()

    code = meeting.meeting_code
    await _broadcast(code, {"type": "meeting-started"})
    for peer_id, peer in waiting.pop(code, {}).items():
        await _send(peer, {"type": "meeting-started"})
        # A held peer still has to clear the waiting room, if there is one.
        if meeting.waiting_room_enabled and not peer.is_host:
            knocking.setdefault(code, {})[peer_id] = peer
            await _send(peer, {"type": "waiting-room", "title": meeting.title})
            await _send_to_hosts(
                code,
                {"type": "knock", "peer_id": peer_id, "display_name": peer.display_name},
            )
        else:
            await _admit(db, meeting, peer_id, peer)


async def end_meeting(db: Session, meeting: Meeting) -> None:
    """Section 8: an explicit end. Terminal, and everyone is disconnected."""
    code = meeting.meeting_code
    _cancel_end_timer(code)
    if meeting.status != MEETING_STATUS_ENDED:
        meeting.status = MEETING_STATUS_ENDED
        meeting.ended_at = _now()
        for row in db.scalars(
            select(MeetingParticipant).where(
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.status == PARTICIPANT_STATUS_JOINED,
            )
        ):
            row.status = PARTICIPANT_STATUS_LEFT
            row.left_at = _now()
        db.commit()

    await _broadcast(code, {"type": "meeting-ended"})
    for registry in (rooms, waiting, knocking):
        for peer in list(registry.pop(code, {}).values()):
            try:
                await peer.websocket.close(code=CLOSE_ENDED)
            except RuntimeError:
                pass


@router.websocket("/ws/{meeting_code}")
async def signaling(
    websocket: WebSocket, meeting_code: str, name: str = "", passcode: str = ""
):
    await websocket.accept()

    db = SessionLocal()
    meeting = db.scalar(select(Meeting).where(Meeting.meeting_code == meeting_code))
    if meeting is None:
        db.close()
        await websocket.close(code=CLOSE_NOT_FOUND)
        return
    if meeting.status == MEETING_STATUS_ENDED:
        db.close()
        await websocket.close(code=CLOSE_ENDED)
        return

    user_id = _user_id_from_cookie(websocket)
    is_host = user_id is not None and user_id == meeting.host_id

    if meeting.passcode_hash and not is_host:
        if not bcrypt.checkpw(passcode.encode(), meeting.passcode_hash.encode()):
            db.close()
            await websocket.close(code=CLOSE_BAD_PASSCODE)
            return

    # Locked keeps existing participants in and turns new ones away.
    if meeting.locked and not is_host:
        db.close()
        await websocket.close(code=CLOSE_LOCKED)
        return

    peer_id = secrets.token_urlsafe(8)
    peer = Peer(websocket, name.strip() or "Guest", user_id, is_host)

    async def hold_in_waiting_room():
        knocking.setdefault(meeting_code, {})[peer_id] = peer
        await _send(peer, {"type": "waiting-room", "title": meeting.title})
        await _send_to_hosts(
            meeting_code,
            {"type": "knock", "peer_id": peer_id, "display_name": peer.display_name},
        )

    if meeting.status == MEETING_STATUS_ACTIVE:
        if meeting.waiting_room_enabled and not is_host:
            await hold_in_waiting_room()
        else:
            await _admit(db, meeting, peer_id, peer)
    elif is_host:
        # The host arriving is an explicit start.
        waiting.setdefault(meeting_code, {})[peer_id] = peer
        await start_meeting(db, meeting)
    elif meeting.allow_join_before_host:
        if meeting.waiting_room_enabled:
            await hold_in_waiting_room()
        else:
            # The meeting stays SCHEDULED: only the host starts it.
            await _admit(db, meeting, peer_id, peer)
    else:
        waiting.setdefault(meeting_code, {})[peer_id] = peer
        await _send(
            peer,
            {
                "type": "waiting-for-host",
                "title": meeting.title,
                "scheduled_at": (
                    meeting.scheduled_at.isoformat() if meeting.scheduled_at else None
                ),
            },
        )

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")
            room = rooms.get(meeting_code, {})
            in_room = peer_id in room
            # Host powers are checked server-side; the client's word is never
            # taken for who is host.
            host_here = in_room and peer.is_host

            if message_type in RELAY_TYPES:
                target = room.get(message.get("target"))
                if target is None:
                    # Peers legitimately race with disconnects.
                    continue
                await _send(
                    target,
                    {
                        "type": message_type,
                        "from": peer_id,
                        # Relayed verbatim; the server never branches on kind.
                        "kind": message.get("kind"),
                        "payload": message.get("payload"),
                    },
                )
                continue

            if message_type == "chat" and in_room:
                body = (message.get("body") or "").strip()[:MAX_CHAT_BODY]
                if not body:
                    continue
                row = ChatMessage(
                    meeting_id=meeting.id,
                    participant_id=peer.participant_id,
                    sender_name=peer.display_name,
                    body=body,
                    created_at=_now(),
                )
                db.add(row)
                db.commit()
                db.refresh(row)
                # Echoed to the sender too: the server's insert order is then
                # the only order, identical for everyone.
                await _broadcast(
                    meeting_code,
                    {
                        "type": "chat",
                        "message_id": row.id,
                        "peer_id": peer_id,
                        "sender_name": row.sender_name,
                        "body": row.body,
                        "created_at": row.created_at.isoformat(),
                    },
                )
                continue

            if message_type == "screen-share" and in_room:
                await _broadcast(
                    meeting_code,
                    {
                        "type": "screen-share",
                        "peer_id": peer_id,
                        "active": bool(message.get("active")),
                    },
                    exclude=peer_id,
                )
                continue

            if message_type == "admit" and host_here:
                target_id = message.get("peer_id")
                held = knocking.get(meeting_code, {}).pop(target_id, None)
                if held is not None:
                    await _admit(db, meeting, target_id, held)
                continue

            if message_type == "deny" and host_here:
                target_id = message.get("peer_id")
                held = knocking.get(meeting_code, {}).pop(target_id, None)
                if held is not None:
                    try:
                        await held.websocket.close(code=CLOSE_DENIED)
                    except RuntimeError:
                        pass
                continue

            if message_type in ("host-mute", "host-stop-video") and host_here:
                target = room.get(message.get("target"))
                if target is not None:
                    await _send(
                        target,
                        {
                            "type": "force-mute"
                            if message_type == "host-mute"
                            else "force-video-off"
                        },
                    )
                continue

            if message_type in ("host-mute-all", "host-stop-video-all") and host_here:
                await _broadcast(
                    meeting_code,
                    {
                        "type": "force-mute"
                        if message_type == "host-mute-all"
                        else "force-video-off"
                    },
                    exclude=peer_id,
                )
                continue

            if message_type == "host-remove" and host_here:
                target_id = message.get("target")
                target = room.get(target_id)
                if target is not None:
                    row = db.get(MeetingParticipant, target.participant_id)
                    if row is not None:
                        # Distinct from leaving: Section 22 wants both.
                        row.status = PARTICIPANT_STATUS_REMOVED
                        row.left_at = _now()
                        db.commit()
                    try:
                        await target.websocket.close(code=CLOSE_REMOVED)
                    except RuntimeError:
                        pass
                continue

            if message_type == "host-lock" and host_here:
                meeting.locked = bool(message.get("locked"))
                db.commit()
                await _broadcast(
                    meeting_code, {"type": "locked", "locked": meeting.locked}
                )
                continue

            if message_type == "end-meeting" and host_here:
                await end_meeting(db, meeting)
                continue
    except WebSocketDisconnect:
        pass
    finally:
        held = knocking.get(meeting_code, {})
        waiters = waiting.get(meeting_code, {})

        if held.pop(peer_id, None) is not None:
            # Never joined: no row to close, nobody to notify.
            if not held:
                knocking.pop(meeting_code, None)
        elif waiters.pop(peer_id, None) is not None:
            if not waiters:
                waiting.pop(meeting_code, None)
        else:
            room = rooms.get(meeting_code, {})
            room.pop(peer_id, None)

            row = db.get(MeetingParticipant, peer.participant_id)
            if row is not None and row.status == PARTICIPANT_STATUS_JOINED:
                row.left_at = _now()
                row.status = PARTICIPANT_STATUS_LEFT

            db.refresh(meeting)
            # Nothing here looks at who left. A host disconnecting while others
            # remain leaves the meeting ACTIVE (Sections 7 and 19); only an
            # explicit End Meeting ends a meeting with people still in it.
            if not room:
                rooms.pop(meeting_code, None)
                if meeting.status == MEETING_STATUS_ACTIVE:
                    # Not ended here — the grace timer decides, and a rejoin
                    # within the window cancels it.
                    _cancel_end_timer(meeting_code)
                    end_timers[meeting_code] = asyncio.create_task(
                        _end_after_grace(meeting_code)
                    )
            db.commit()
            await _broadcast(meeting_code, {"type": "peer-left", "peer_id": peer_id})

        db.close()
