import httpx

from .config import settings

RESEND_ENDPOINT = "https://api.resend.com/emails"


def send_otp_email(to_email: str, code: str) -> None:
    # Printed unconditionally so the flow is testable without an API key.
    # flush because stdout is block-buffered when it is not a terminal, and the
    # code would otherwise sit in the buffer when output is piped or captured.
    print(f"[otp] {to_email} -> {code}", flush=True)

    if not settings.RESEND_API_KEY:
        return

    try:
        response = httpx.post(
            RESEND_ENDPOINT,
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            json={
                "from": f"{settings.MAIL_FROM_NAME} <{settings.MAIL_FROM_ADDRESS}>",
                "to": [to_email],
                "subject": "Your Zoom Clone sign-in code",
                "text": (
                    f"Your sign-in code is {code}\n\n"
                    f"It expires in {settings.OTP_TTL_MINUTES} minutes.\n"
                ),
            },
            timeout=10,
        )
        # Resend reports rejections in the body, not by connection failure.
        if response.status_code >= 400:
            print(
                f"[otp] send failed for {to_email}: {response.status_code} {response.text}",
                flush=True,
            )
        else:
            print(f"[otp] resend accepted message for {to_email}", flush=True)
    except Exception as exc:
        # The code is already stored and printed; a failed send must not 500 a
        # request whose code the user can still read from the console.
        print(f"[otp] send failed for {to_email}: {exc}", flush=True)
