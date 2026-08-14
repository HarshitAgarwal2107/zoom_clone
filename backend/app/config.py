from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    SECRET_KEY: str = "dev-secret-change-me"
    FRONTEND_URL: str = "http://localhost:3000"
    BACKEND_URL: str = "http://localhost:8000"
    DATABASE_URL: str = "sqlite:///./app.db"

    # Mail goes out over Resend's HTTP API: Render blocks outbound SMTP ports,
    # so an SMTP client cannot work there at all.
    RESEND_API_KEY: str = ""
    MAIL_FROM_NAME: str = "Zoom Clone"
    # Resend's shared sender, so no domain has to be verified first.
    MAIL_FROM_ADDRESS: str = "onboarding@resend.dev"
    OTP_TTL_MINUTES: int = 10
    OTP_MAX_ATTEMPTS: int = 5


settings = Settings()
