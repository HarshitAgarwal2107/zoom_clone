from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from . import auth, meetings, otp, passwords, signaling
from .config import settings
from .database import Base, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Zoom Clone API", lifespan=lifespan)

# Credentialed cross-origin requests require an explicit origin — browsers
# reject "*" once allow_credentials is on, and the cookie is silently dropped.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Authlib stores the OAuth state/nonce in a signed session cookie between the
# redirect to Google and the callback.
app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY, same_site="lax")

app.include_router(auth.router)
app.include_router(otp.router)
app.include_router(passwords.router)
app.include_router(meetings.router)
app.include_router(signaling.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
