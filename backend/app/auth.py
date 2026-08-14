from datetime import UTC, datetime, timedelta

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, Response
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .identity import resolve_user
from .models import PROVIDER_GOOGLE, User
from .schemas import AuthMethodOut, UserOut

COOKIE_NAME = "access_token"
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 7

router = APIRouter(prefix="/api/auth", tags=["auth"])

oauth = OAuth()
oauth.register(
    name="google",
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


def create_access_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(UTC) + timedelta(days=JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=JWT_ALGORITHM)


def set_auth_cookie(response: Response, user_id: int) -> None:
    response.set_cookie(
        COOKIE_NAME,
        create_access_token(user_id),
        httponly=True,
        samesite="none",
        secure=False,
        max_age=JWT_EXPIRY_DAYS * 24 * 60 * 60,
    )


def current_user(
    access_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: Session = Depends(get_db),
) -> User:
    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(access_token, settings.SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@router.get("/google/login")
async def google_login(request: Request):
    redirect_uri = f"{settings.BACKEND_URL}/api/auth/google/callback"
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/google/callback")
async def google_callback(request: Request, db: Session = Depends(get_db)):
    token = await oauth.google.authorize_access_token(request)
    claims = token["userinfo"]  # authlib verifies the id_token during the exchange

    user = resolve_user(
        db,
        provider=PROVIDER_GOOGLE,
        provider_user_id=claims["sub"],
        email=claims["email"],
        # Passed through honestly rather than hardcoded: this really can be
        # false on some Workspace domains.
        email_verified=bool(claims.get("email_verified")),
        display_name=claims.get("name") or claims["email"],
        avatar_url=claims.get("picture"),
    )

    response = RedirectResponse(url=f"{settings.FRONTEND_URL}/dashboard")
    set_auth_cookie(response, user.id)
    return response


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.get("/methods", response_model=list[AuthMethodOut])
def methods(user: User = Depends(current_user)):
    return sorted(user.identities, key=lambda identity: identity.created_at)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, httponly=True, samesite="none")
    return {"ok": True}
