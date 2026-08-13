import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import set_auth_cookie
from .config import settings
from .database import get_db
from .identity import resolve_user
from .mailer import send_otp_email
from .models import PROVIDER_EMAIL_OTP, PROVIDER_PASSWORD, AuthIdentity, LoginCode
from .schemas import OtpRequest, OtpVerify

RESEND_COOLDOWN_SECONDS = 60

router = APIRouter(prefix="/api/auth/otp", tags=["auth"])


def hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def latest_unconsumed_code(db: Session, email: str) -> LoginCode | None:
    return db.scalar(
        select(LoginCode)
        .where(LoginCode.email == email, LoginCode.consumed_at.is_(None))
        .order_by(LoginCode.id.desc())
    )


@router.post("/request")
def request_code(
    payload: OtpRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    email = payload.email.strip().lower()
    now = datetime.now(UTC).replace(tzinfo=None)

    outstanding = latest_unconsumed_code(db, email)
    if outstanding is not None:
        if (
            outstanding.expires_at > now
            and (now - outstanding.created_at).total_seconds() < RESEND_COOLDOWN_SECONDS
        ):
            raise HTTPException(
                status_code=429, detail="A code was just sent. Try again in a minute."
            )
        # Superseded by the code we are about to issue.
        outstanding.consumed_at = now

    code = f"{secrets.randbelow(1_000_000):06d}"
    db.add(
        LoginCode(
            email=email,
            code_hash=hash_code(code),
            expires_at=now + timedelta(minutes=settings.OTP_TTL_MINUTES),
            created_at=now,
        )
    )
    db.commit()

    background_tasks.add_task(send_otp_email, email, code)

    # Always 200, whether or not the address is known — a different response
    # for unknown addresses would be an account-existence oracle.
    return {"ok": True}


@router.post("/verify")
def verify_code(payload: OtpVerify, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    now = datetime.now(UTC).replace(tzinfo=None)

    login_code = latest_unconsumed_code(db, email)
    if login_code is None:
        raise HTTPException(status_code=400, detail="No code was requested")
    if login_code.expires_at < now:
        raise HTTPException(status_code=400, detail="Code expired")
    if login_code.attempt_count >= settings.OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=400, detail="Too many attempts")

    if not secrets.compare_digest(login_code.code_hash, hash_code(payload.code.strip())):
        login_code.attempt_count += 1
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid code")

    login_code.consumed_at = now
    db.commit()

    user = resolve_user(
        db,
        provider=PROVIDER_EMAIL_OTP,
        provider_user_id=email,
        email=email,
        email_verified=True,  # verified by construction: they read the mail
        display_name=None,  # a code proves the mailbox, not a name
        avatar_url=None,
    )

    has_password = (
        db.scalar(
            select(AuthIdentity).where(
                AuthIdentity.user_id == user.id,
                AuthIdentity.provider == PROVIDER_PASSWORD,
            )
        )
        is not None
    )

    response = JSONResponse({"ok": True, "has_password": has_password})
    set_auth_cookie(response, user.id)
    return response
