import smtplib
from email.message import EmailMessage

from .config import settings


def send_otp_email(to_email: str, code: str) -> None:
    # Printed unconditionally so the flow is testable without SMTP credentials.
    # flush because stdout is block-buffered when it is not a terminal, and the
    # code would otherwise sit in the buffer when output is piped or captured.
    print(f"[otp] {to_email} -> {code}", flush=True)

    if not settings.SMTP_USER:
        return

    message = EmailMessage()
    message["Subject"] = "Your Zoom Clone sign-in code"
    message["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_USER}>"
    message["To"] = to_email
    message.set_content(
        f"Your sign-in code is {code}\n\n"
        f"It expires in {settings.OTP_TTL_MINUTES} minutes.\n"
    )

    try:
        with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT) as smtp:
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            smtp.send_message(message)
    except Exception as exc:
        # The code is already stored and printed; a bounced mail must not 500.
        print(f"[otp] send failed for {to_email}: {exc}", flush=True)
        raise
