import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import current_user, set_auth_cookie
from .database import get_db
from .models import PROVIDER_PASSWORD, AuthIdentity, User
from .schemas import PasswordLogin, PasswordSet

MIN_LENGTH = 8
# bcrypt itself refuses anything longer; reject it as input rather than 500.
MAX_LENGTH = 72
MAX_RUN = 4

KEYBOARD_ROWS = ("qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890")

# Compared against when no identity exists, so a missing account and a wrong
# password take the same time. Not a timing-attack framework — one hash.
DUMMY_HASH = bcrypt.hashpw(b"dummy-password-for-constant-time", bcrypt.gensalt())


def _has_run(password: str) -> bool:
    """Four or more consecutive characters: repeats, sequences, or keyboard runs."""
    lowered = password.lower()
    same = ascending = descending = 1
    for previous, current in zip(lowered, lowered[1:]):
        same = same + 1 if current == previous else 1
        ascending = ascending + 1 if ord(current) == ord(previous) + 1 else 1
        descending = descending + 1 if ord(current) == ord(previous) - 1 else 1
        if max(same, ascending, descending) >= MAX_RUN:
            return True

    for row in KEYBOARD_ROWS:
        # Direction-sensitive, like the checks above: "qwert" is a run, but
        # walking back and forth ("ewer") is not.
        forward = backward = 1
        for previous, current in zip(lowered, lowered[1:]):
            i, j = row.find(previous), row.find(current)
            step = j - i if i != -1 and j != -1 else None
            forward = forward + 1 if step == 1 else 1
            backward = backward + 1 if step == -1 else 1
            if max(forward, backward) >= MAX_RUN:
                return True
    return False


def validate_password(password: str) -> None:
    if len(password) < MIN_LENGTH:
        raise HTTPException(
            status_code=400, detail=f"Password must be at least {MIN_LENGTH} characters"
        )
    if len(password.encode()) > MAX_LENGTH:
        raise HTTPException(
            status_code=400, detail=f"Password must be at most {MAX_LENGTH} bytes"
        )
    if not any(c.isalpha() for c in password):
        raise HTTPException(status_code=400, detail="Password must include a letter")
    if not any(c.isdigit() for c in password):
        raise HTTPException(status_code=400, detail="Password must include a number")
    if not any(c.isupper() for c in password):
        raise HTTPException(
            status_code=400, detail="Password must include an uppercase letter"
        )
    if not any(c.islower() for c in password):
        raise HTTPException(
            status_code=400, detail="Password must include a lowercase letter"
        )
    if _has_run(password):
        raise HTTPException(
            status_code=400,
            detail='Password must not include 4 or more consecutive characters (e.g. "1111", "12345", "abcde", "qwert")',
        )


router = APIRouter(prefix="/api/auth/password", tags=["auth"])


@router.post("/set")
def set_password(
    payload: PasswordSet,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    # Requires a session: the mailbox is always proven — by OTP or Google —
    # before a password can exist. That is what closes the takeover hole.
    validate_password(payload.password)
    secret_hash = bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode()

    full_name = " ".join(
        part.strip() for part in (payload.first_name, payload.last_name) if part and part.strip()
    )
    if full_name:
        user.display_name = full_name

    identity = db.scalar(
        select(AuthIdentity).where(
            AuthIdentity.user_id == user.id,
            AuthIdentity.provider == PROVIDER_PASSWORD,
        )
    )
    if identity is None:
        db.add(
            AuthIdentity(
                user_id=user.id,
                provider=PROVIDER_PASSWORD,
                provider_user_id=user.email,
                secret_hash=secret_hash,
            )
        )
    else:
        # Overwriting is the change-password path; it needs no second endpoint.
        identity.secret_hash = secret_hash
    db.commit()
    return {"ok": True}


@router.post("/login")
def login(payload: PasswordLogin, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    identity = db.scalar(
        select(AuthIdentity).where(
            AuthIdentity.provider == PROVIDER_PASSWORD,
            AuthIdentity.provider_user_id == email,
        )
    )

    stored = identity.secret_hash.encode() if identity and identity.secret_hash else DUMMY_HASH
    matched = bcrypt.checkpw(payload.password.encode()[:MAX_LENGTH], stored)

    # Identical response for unknown email and wrong password: distinct ones
    # would make this an account-existence oracle.
    if identity is None or not matched:
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    # Deliberately does not call resolve_user: a password login can only match
    # an existing identity. There is no create-or-link path here, so nobody can
    # register a password against someone else's address and wait to be linked.
    response = JSONResponse({"ok": True})
    set_auth_cookie(response, identity.user_id)
    return response
