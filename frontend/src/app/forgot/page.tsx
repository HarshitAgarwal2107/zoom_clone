"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import PasswordHints from "../password-hints";
import "../auth.css";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

function ForgotIllustration() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Lock icon */}
      <rect x="145" y="80" width="110" height="90" rx="12" fill="#E8EEF7" stroke="#C5D3E8" strokeWidth="2"/>
      <rect x="170" y="55" width="60" height="45" rx="30" fill="none" stroke="#C5D3E8" strokeWidth="4"/>
      <circle cx="200" cy="120" r="12" fill="#8BA3C4"/>
      <rect x="196" y="128" width="8" height="16" rx="3" fill="#8BA3C4"/>
      {/* Person left */}
      <circle cx="65" cy="195" r="14" fill="#FFD6A8"/>
      <rect x="52" y="215" width="26" height="35" rx="6" fill="#5B6EAE"/>
      {/* Person right */}
      <circle cx="335" cy="195" r="14" fill="#C4A882"/>
      <rect x="322" y="215" width="26" height="35" rx="6" fill="#FF7EB3"/>
      {/* Key icon */}
      <g transform="translate(260, 140) rotate(30)">
        <circle cx="0" cy="0" r="14" fill="none" stroke="#FFB347" strokeWidth="3"/>
        <line x1="14" y1="0" x2="45" y2="0" stroke="#FFB347" strokeWidth="3"/>
        <line x1="38" y1="0" x2="38" y2="8" stroke="#FFB347" strokeWidth="3"/>
        <line x1="45" y1="0" x2="45" y2="10" stroke="#FFB347" strokeWidth="3"/>
      </g>
    </svg>
  );
}

function GreenCheck() {
  return (
    <span className="auth-feature-check">
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="12" fill="#2D8C3C"/>
        <path d="M7 12.5l3 3 7-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );
}

// Same three steps as signup — prove the mailbox, then set a credential — with
// reset wording and no name fields, since the account already exists.
export default function ForgotPassword() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // OTP individual digit inputs
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    setCode(otpDigits.join(""));
  }, [otpDigits]);

  function handleOtpChange(index: number, value: string) {
    if (value.length > 1) value = value.slice(-1);
    if (value && !/^\d$/.test(value)) return;
    const newDigits = [...otpDigits];
    newDigits[index] = value;
    setOtpDigits(newDigits);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const newDigits = [...otpDigits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = pasted[i] || "";
    }
    setOtpDigits(newDigits);
    const focusIdx = Math.min(pasted.length, 5);
    otpRefs.current[focusIdx]?.focus();
  }

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
    if (res.ok) setStep("password");
    else await fail(res, "Invalid code");
  }

  async function savePassword() {
    const res = await post("/api/auth/password/set", { password });
    if (res.ok) router.push("/dashboard");
    else await fail(res, "Could not set your password");
  }

  return (
    <div>
      {/* Header */}
      <header className="auth-header">
        <div className="auth-header-logo">ZOOM</div>
        <div className="auth-header-right">
          <span>Remember your password?</span>
          <a href="/signin">Sign In</a>
          <span className="auth-header-separator">|</span>
          <span>Support</span>
        </div>
      </header>

      {/* Content */}
      <div className="auth-content">
        {/* Left Panel */}
        <div className="auth-left">
          <div className="auth-illustration">
            <ForgotIllustration />
          </div>
          <div className="auth-features">
            <div className="auth-features-title">Create your free Basic account</div>
            <div className="auth-features-list">
              <div className="auth-feature-item"><GreenCheck />Get up to 40 minutes and 100 participants per meeting</div>
              <div className="auth-feature-item"><GreenCheck />Share AI Docs</div>
              <div className="auth-feature-item"><GreenCheck />Get 3 editable whiteboards</div>
              <div className="auth-feature-item"><GreenCheck />Unlimited instant messaging</div>
              <div className="auth-feature-item"><GreenCheck />Create up to 5 two-minute video messages</div>
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="auth-right">
          <div className="auth-form-container">
            {/* Step 1: Email */}
            {step === "email" && (
              <>
                <h1 className="auth-form-title">Reset your password</h1>
                <div className="auth-form-subtitle">Enter your email and we&apos;ll send you a verification code.</div>

                <div className="auth-field">
                  <input
                    type="email"
                    placeholder=" "
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && email && !busy) sendCode(); }}
                  />
                  <span className="auth-field-label">Email address</span>
                </div>

                <button
                  className={`auth-submit-btn ${email ? "active" : ""}`}
                  onClick={() => sendCode()}
                  disabled={busy || !email}
                >
                  {busy ? "Sending..." : "Continue"}
                </button>

                <div className="auth-link-row">
                  <a href="/signin">Back to sign in</a>
                </div>

                {error && <div className="auth-error">{error}</div>}
              </>
            )}

            {/* Step 2: OTP Code */}
            {step === "code" && (
              <>
                <h1 className="auth-form-title">Check your email for a code</h1>
                <div className="auth-form-subtitle">
                  Please enter the verification code sent to your email address <strong>{email}</strong>
                </div>

                <div className="otp-container" onPaste={handleOtpPaste}>
                  {otpDigits.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { otpRefs.current[i] = el; }}
                      className="otp-input"
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      autoFocus={i === 0}
                    />
                  ))}
                </div>

                <div className="otp-resend">
                  Didn&apos;t get the code?{" "}
                  <button onClick={() => sendCode(true)} disabled={busy}>Resend code</button>
                </div>

                <button
                  className={`auth-submit-btn ${code.length === 6 ? "active" : ""}`}
                  onClick={verify}
                  disabled={busy || !code}
                >
                  {busy ? "Verifying..." : "Verify"}
                </button>

                <div className="auth-mail-buttons">
                  <a href="https://mail.google.com" target="_blank" rel="noopener noreferrer" className="auth-mail-btn">
                    <svg viewBox="0 0 24 24">
                      <path d="M20 18H4V8l8 5 8-5v10zm0-12H4l8 5 8-5z" fill="#EA4335"/>
                    </svg>
                    Open Gmail
                  </a>
                  <a href="https://outlook.live.com" target="_blank" rel="noopener noreferrer" className="auth-mail-btn">
                    <svg viewBox="0 0 24 24">
                      <path d="M2 6v12h8V6H2zm1 1.5L6 10l3-2.5V7H3v.5zM14 6v12h8V6h-8zm1 1.5L18 10l3-2.5V7h-6v.5z" fill="#0078D4"/>
                    </svg>
                    Open Outlook
                  </a>
                </div>

                <div style={{ textAlign: "center", marginTop: 16 }}>
                  <button className="auth-change-link" onClick={() => setStep("email")}>Use a different email</button>
                </div>

                <div className="auth-bottom-links">
                  <a href="#">Help</a>
                  <a href="#">Terms</a>
                  <a href="#">Privacy</a>
                </div>

                {notice && <div className="auth-notice">{notice}</div>}
                {error && <div className="auth-error">{error}</div>}
              </>
            )}

            {/* Step 3: New Password */}
            {step === "password" && (
              <>
                <h1 className="auth-form-title">Set a new password</h1>
                <div className="auth-form-subtitle">Choose a strong password for your account.</div>

                <PasswordHints show={hintsOpen} value={password} />

                <div className="auth-field auth-field-password">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder=" "
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setHintsOpen(true)}
                    onBlur={() => setHintsOpen(false)}
                  />
                  <span className="auth-field-label">New password</span>
                  <button className="password-toggle" onClick={() => setShowPassword(!showPassword)} type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      {showPassword ? (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                          <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                          <path d="M1 1l22 22"/>
                          <path d="M14.12 14.12a3 3 0 11-4.24-4.24"/>
                        </>
                      ) : (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </>
                      )}
                    </svg>
                  </button>
                </div>

                <button
                  className={`auth-submit-btn ${password ? "active" : ""}`}
                  onClick={savePassword}
                  disabled={busy || !password}
                >
                  {busy ? "Saving..." : "Save password"}
                </button>

                {error && <div className="auth-error">{error}</div>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
