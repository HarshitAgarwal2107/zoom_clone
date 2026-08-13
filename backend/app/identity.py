from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import AuthIdentity, User


def resolve_user(
    db: Session,
    *,
    provider: str,
    provider_user_id: str,
    email: str,
    email_verified: bool,
    # None means "this provider has no profile data to report". Email OTP knows
    # only the address, so it must not overwrite a real name with the local
    # part on every sign-in or password reset.
    display_name: str | None,
    avatar_url: str | None,
) -> User:
    # Deliberately no Gmail dot/+tag canonicalisation: it surprises users and
    # does not generalise to other providers.
    email = email.strip().lower()

    identity = db.scalar(
        select(AuthIdentity).where(
            AuthIdentity.provider == provider,
            AuthIdentity.provider_user_id == provider_user_id,
        )
    )
    if identity is not None:
        user = identity.user
        user.email = email
        if display_name:
            user.display_name = display_name
        # Not clobbered with None: the OTP provider has no picture to report,
        # and losing a Google avatar on an OTP login would be a regression.
        if avatar_url is not None:
            user.avatar_url = avatar_url
        # Verification only ever moves up: a provider reporting False later
        # should not strip a status another verified flow already established.
        if email_verified:
            user.email_verified = True
        db.commit()
        db.refresh(user)
        return user

    # Account linking. Both sides must be verified: merging an unverified
    # identity into an existing address is pre-account-takeover — an attacker
    # signs up as victim@example.com and waits to be handed the real account.
    if email_verified:
        existing = db.scalar(select(User).where(User.email == email))
        if existing is not None:
            db.add(
                AuthIdentity(
                    user_id=existing.id,
                    provider=provider,
                    provider_user_id=provider_user_id,
                )
            )
            db.commit()
            db.refresh(existing)
            return existing

    user = User(
        email=email,
        email_verified=email_verified,
        # Placeholder for a provider that reports no name; signup replaces it.
        display_name=display_name or email.split("@")[0],
        avatar_url=avatar_url,
    )
    user.identities.append(
        AuthIdentity(provider=provider, provider_user_id=provider_user_id)
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Raced by a concurrent first-login: either on the identity, or on the
        # restored users.email unique constraint.
        db.rollback()
        identity = db.scalar(
            select(AuthIdentity).where(
                AuthIdentity.provider == provider,
                AuthIdentity.provider_user_id == provider_user_id,
            )
        )
        if identity is not None:
            return identity.user

        existing = db.scalar(select(User).where(User.email == email))
        if existing is None:
            raise
        # The same guard as the linking branch above: losing the race must not
        # buy an unverified identity a link the normal path would have refused.
        if not email_verified:
            raise HTTPException(
                status_code=409,
                detail="That email is already registered with a different sign-in method.",
            )
        db.add(
            AuthIdentity(
                user_id=existing.id,
                provider=provider,
                provider_user_id=provider_user_id,
            )
        )
        db.commit()
        db.refresh(existing)
        return existing

    db.refresh(user)
    return user
