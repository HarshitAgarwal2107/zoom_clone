"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import PasswordHints from "../password-hints";
import "../auth.css";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

/* ===== Illustrations ===== */

function SignUpIllustration() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Monitor */}
      <rect x="80" y="30" width="240" height="160" rx="12" fill="#E8EEF7" stroke="#C5D3E8" strokeWidth="2"/>
      <rect x="95" y="45" width="210" height="130" rx="4" fill="#D0DCF0"/>
      {/* Video grid */}
      <rect x="105" y="55" width="92" height="55" rx="4" fill="#B8C9E2"/>
      <rect x="205" y="55" width="92" height="55" rx="4" fill="#B8C9E2"/>
      <rect x="105" y="115" width="92" height="50" rx="4" fill="#B8C9E2"/>
      <rect x="205" y="115" width="92" height="50" rx="4" fill="#B8C9E2"/>
      <circle cx="151" cy="72" r="10" fill="#8BA3C4"/>
      <circle cx="251" cy="72" r="10" fill="#8BA3C4"/>
      <circle cx="151" cy="132" r="10" fill="#8BA3C4"/>
      <circle cx="251" cy="132" r="10" fill="#8BA3C4"/>
      <rect x="175" y="190" width="50" height="12" rx="2" fill="#C5D3E8"/>
      <rect x="160" y="200" width="80" height="6" rx="3" fill="#C5D3E8"/>
      {/* Person left - woman with pink top */}
      <circle cx="50" cy="200" r="14" fill="#FFD6A8"/>
      <path d="M35 245 Q50 218 65 245" fill="#FF7EB3"/>
      <rect x="37" y="225" width="26" height="28" rx="6" fill="#FF7EB3"/>
      {/* Person right - person reaching up with teal shirt */}
      <circle cx="350" cy="168" r="14" fill="#C4A882"/>
      <rect x="337" y="185" width="26" height="35" rx="6" fill="#4ECDC4"/>
      <line x1="350" y1="185" x2="340" y2="155" stroke="#4ECDC4" strokeWidth="3" strokeLinecap="round"/>
      <line x1="350" y1="185" x2="362" y2="158" stroke="#4ECDC4" strokeWidth="3" strokeLinecap="round"/>
    </svg>
  );
}

function OtpIllustration() {
  return (
    <svg viewBox="0 0 400 320" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Monitor */}
      <rect x="60" y="80" width="220" height="160" rx="12" fill="#DCDCDC" stroke="#C0C0C0" strokeWidth="2"/>
      <rect x="75" y="95" width="190" height="125" rx="4" fill="#E8E8E8"/>
      <rect x="145" y="240" width="50" height="15" rx="3" fill="#C0C0C0"/>
      <rect x="120" y="253" width="100" height="6" rx="3" fill="#C0C0C0"/>
      {/* Envelope icon floating */}
      <g transform="translate(220, 60)">
        <rect x="0" y="10" width="80" height="55" rx="8" fill="#2D8CFF" opacity="0.9"/>
        <path d="M0 18 L40 45 L80 18" stroke="white" strokeWidth="3" fill="none" strokeLinejoin="round"/>
        <path d="M0 65 L28 40" stroke="white" strokeWidth="2" fill="none"/>
        <path d="M80 65 L52 40" stroke="white" strokeWidth="2" fill="none"/>
      </g>
      {/* Person at desk */}
      <circle cx="170" cy="180" r="8" fill="#D0D0D0"/>
    </svg>
  );
}

function ProfileIllustration() {
  return (
    <svg viewBox="0 0 400 300" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Screen frames */}
      <rect x="60" y="40" width="100" height="80" rx="4" stroke="#A8C4E6" strokeWidth="2" fill="none"/>
      <rect x="150" y="20" width="100" height="90" rx="4" stroke="#A8C4E6" strokeWidth="2" fill="none"/>
      <rect x="240" y="45" width="100" height="75" rx="4" stroke="#A8C4E6" strokeWidth="2" fill="none"/>
      {/* Person 1 - woman with dark hair */}
      <circle cx="110" cy="155" r="16" fill="#2C2C2C"/>
      <circle cx="110" cy="152" r="12" fill="#FFD6A8"/>
      <rect x="97" y="172" width="26" height="65" rx="6" fill="#5B6EAE"/>
      <line x1="97" y1="190" x2="82" y2="210" stroke="#5B6EAE" strokeWidth="4" strokeLinecap="round"/>
      <line x1="123" y1="190" x2="138" y2="210" stroke="#5B6EAE" strokeWidth="4" strokeLinecap="round"/>
      <rect x="100" y="237" width="10" height="25" rx="2" fill="#3D3D5C"/>
      <rect x="112" y="237" width="10" height="25" rx="2" fill="#3D3D5C"/>
      {/* Person 2 - center */}
      <circle cx="200" cy="140" r="16" fill="#2C2C2C"/>
      <circle cx="200" cy="137" r="12" fill="#C4A882"/>
      <rect x="187" y="157" width="26" height="70" rx="6" fill="#FF7EB3"/>
      <line x1="187" y1="175" x2="172" y2="195" stroke="#FF7EB3" strokeWidth="4" strokeLinecap="round"/>
      <line x1="213" y1="175" x2="228" y2="195" stroke="#FF7EB3" strokeWidth="4" strokeLinecap="round"/>
      <rect x="190" y="227" width="10" height="28" rx="2" fill="#3D3D5C"/>
      <rect x="202" y="227" width="10" height="28" rx="2" fill="#3D3D5C"/>
      {/* Person 3 - right */}
      <circle cx="290" cy="150" r="16" fill="#5C3D2E"/>
      <circle cx="290" cy="147" r="12" fill="#8B6B4D"/>
      <rect x="277" y="167" width="26" height="65" rx="6" fill="#FFB347"/>
      <line x1="277" y1="185" x2="262" y2="205" stroke="#FFB347" strokeWidth="4" strokeLinecap="round"/>
      <line x1="303" y1="185" x2="318" y2="205" stroke="#FFB347" strokeWidth="4" strokeLinecap="round"/>
      <rect x="280" y="232" width="10" height="25" rx="2" fill="#3D3D5C"/>
      <rect x="292" y="232" width="10" height="25" rx="2" fill="#3D3D5C"/>
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

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

export default function SignUp() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code" | "profile">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // OTP individual digit inputs
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Sync otpDigits → code
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
    <div>
      {/* Header */}
      <header className="auth-header">
        <div className="auth-header-logo">ZOOM</div>
        <div className="auth-header-right">
          <span>Already have an account?</span>
          <a href="/">Sign In</a>
          <span className="auth-header-separator">|</span>
          <span>Support</span>
        </div>
      </header>

      {/* Content */}
      <div className="auth-content">
        {/* Left Panel */}
        <div className="auth-left">
          <div className="auth-illustration">
            {step === "email" && <SignUpIllustration />}
            {step === "code" && <OtpIllustration />}
            {step === "profile" && <ProfileIllustration />}
          </div>
          {step !== "code" && (
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
          )}
        </div>

        {/* Right Panel */}
        <div className="auth-right">
          <div className="auth-form-container">
            {/* Step 1: Email */}
            {step === "email" && (
              <>
                <h1 className="auth-form-title">Sign up</h1>

                <div className="auth-field" style={{ marginTop: 32 }}>
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

                <div className="auth-terms">
                  By proceeding, I agree to <a href="#">Zoom&apos;s Privacy Statement</a> and <a href="#">Terms of Service</a>.
                </div>

                <div className="auth-divider">
                  <div className="auth-divider-line" />
                  <span className="auth-divider-text">Or sign up with</span>
                  <div className="auth-divider-line" />
                </div>

                <div className="auth-social-buttons">
                  <a href={`${BACKEND_URL}/api/auth/google/login`} className="auth-social-btn">
                    <div className="auth-social-icon">
                      <GoogleIcon />
                    </div>
                    <span className="auth-social-label">Google</span>
                  </a>
                </div>

                <div className="auth-footer">
                  Zoom is protected by reCAPTCHA and the Google <a href="#">Privacy Policy</a> and <a href="#">Terms of Service</a> apply.
                </div>

                <div className="auth-link-row">
                  Already have an account? <a href="/">Sign in</a>
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

            {/* Step 3: Profile */}
            {step === "profile" && (
              <>
                <h1 className="auth-form-title">Create your account</h1>
                <div className="auth-form-subtitle">Enter your full name and password.</div>

                <div className="auth-field">
                  <input
                    type="text"
                    placeholder=" "
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                  <span className="auth-field-label">First name</span>
                </div>

                <div className="auth-field">
                  <input
                    type="text"
                    placeholder=" "
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                  <span className="auth-field-label">Last name</span>
                </div>

                <PasswordHints show={hintsOpen} />

                <div className="auth-field auth-field-password">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder=" "
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setHintsOpen(true)}
                    onBlur={() => setHintsOpen(false)}
                  />
                  <span className="auth-field-label">Password</span>
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
                  className={`auth-submit-btn ${password && firstName.trim() ? "active" : ""}`}
                  onClick={createAccount}
                  disabled={busy || !password || !firstName.trim()}
                >
                  {busy ? "Creating..." : "Continue"}
                </button>

                {error && <div className="auth-error">{error}</div>}
                {notice && <div className="auth-notice">{notice}</div>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
