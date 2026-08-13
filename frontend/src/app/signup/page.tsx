"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PasswordHints from "../password-hints";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export default function SignUp() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code" | "profile">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [hintsOpen, setHintsOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(path: string, body: object) {
    setBusy(true);
    setError("");
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    return res;
  }

  async function fail(res: Response, fallback: string) {
    const body = await res.json().catch(() => ({}));
    setError(typeof body.detail === "string" ? body.detail : fallback);
  }

  async function sendCode(resend = false) {
    setNotice("");
    const res = await post("/api/auth/otp/request", { email });
    if (!res.ok) {
      await fail(res, "Could not send code");
      return;
    }
    setStep("code");
    if (resend) setNotice("Code resent.");
  }

  async function verify() {
    const res = await post("/api/auth/otp/verify", { email, code });
    if (res.ok) setStep("profile");
    else await fail(res, "Invalid code");
  }

  async function createAccount() {
    // The OTP verify above signed us in, so this call is authenticated.
    const res = await post("/api/auth/password/set", {
      password,
      first_name: firstName,
      last_name: lastName,
    });
    if (res.ok) router.push("/dashboard");
    else await fail(res, "Could not create your account");
  }

  return (
    <main>
      {step === "email" && (
        <div>
          <h1>Sign up</h1>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button onClick={() => sendCode()} disabled={busy || !email}>
            Continue
          </button>
          <p>
            Already have an account? <a href="/">Sign in</a>
          </p>
        </div>
      )}

      {step === "code" && (
        <div>
          <h1>Check your email for a code</h1>
          <p>Please enter the verification code sent to your email address {email}</p>
          <input
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button onClick={verify} disabled={busy || !code}>
            Verify
          </button>
          <p>
            Didn&apos;t get the code?{" "}
            <button onClick={() => sendCode(true)} disabled={busy}>
              Resend code
            </button>
          </p>
          <button onClick={() => setStep("email")}>Use a different email</button>
        </div>
      )}

      {step === "profile" && (
        <div>
          <h1>Create your account</h1>
          <p>Enter your full name and password.</p>
          <div>
            <input
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div>
            <input
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <div>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setHintsOpen(true)}
              onBlur={() => setHintsOpen(false)}
            />
          </div>
          <PasswordHints show={hintsOpen} />
          <button
            onClick={createAccount}
            disabled={busy || !password || !firstName.trim()}
          >
            Continue
          </button>
        </div>
      )}

      {notice && <p>{notice}</p>}
      {error && <p>{error}</p>}
    </main>
  );
}
