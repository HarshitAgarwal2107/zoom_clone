"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import "./auth.css";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

/* ===== Inline SVG illustrations ===== */

function SignInIllustration() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Monitor */}
      <rect x="80" y="30" width="240" height="160" rx="12" fill="#E8EEF7" stroke="#C5D3E8" strokeWidth="2"/>
      <rect x="95" y="45" width="210" height="130" rx="4" fill="#D0DCF0"/>
      {/* Grid of people */}
      <rect x="105" y="55" width="92" height="55" rx="4" fill="#B8C9E2"/>
      <rect x="205" y="55" width="92" height="55" rx="4" fill="#B8C9E2"/>
      <rect x="105" y="115" width="92" height="50" rx="4" fill="#B8C9E2"/>
      <rect x="205" y="115" width="92" height="50" rx="4" fill="#B8C9E2"/>
      {/* Circles representing people */}
      <circle cx="151" cy="72" r="10" fill="#8BA3C4"/>
      <circle cx="251" cy="72" r="10" fill="#8BA3C4"/>
      <circle cx="151" cy="132" r="10" fill="#8BA3C4"/>
      <circle cx="251" cy="132" r="10" fill="#8BA3C4"/>
      {/* Monitor stand */}
      <rect x="175" y="190" width="50" height="12" rx="2" fill="#C5D3E8"/>
      <rect x="160" y="200" width="80" height="6" rx="3" fill="#C5D3E8"/>
      {/* Person left */}
      <circle cx="55" cy="195" r="14" fill="#FFD6A8"/>
      <path d="M38 240 Q55 215 72 240" fill="#FF7EB3"/>
      <rect x="42" y="220" width="26" height="30" rx="6" fill="#FF7EB3"/>
      {/* Person right */}
      <circle cx="345" cy="195" r="14" fill="#C4A882"/>
      <path d="M328 240 Q345 215 362 240" fill="#4ECDC4"/>
      <rect x="332" y="220" width="26" height="30" rx="6" fill="#4ECDC4"/>
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

export default function SignIn() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<"email" | "password">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/auth/me`, { credentials: "include" }).then((res) => {
      if (res.ok) router.replace("/dashboard");
      else setChecking(false);
    });
  }, [router]);

  async function signIn() {
    setBusy(true);
    setError("");
    const res = await fetch(`${BACKEND_URL}/api/auth/password/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/dashboard");
      return;
    }
    const body = await res.json().catch(() => ({}));
    setError(
      typeof body.detail === "string" ? body.detail : "Incorrect email or password"
    );
  }

  if (checking) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <header className="auth-header">
        <div className="auth-header-logo">ZOOM</div>
        <div className="auth-header-right">
          <span>New to Zoom?</span>
          <a href="/signup">Sign Up Free</a>
          <span className="auth-header-separator">|</span>
          <span>Support</span>
        </div>
      </header>

      {/* Content */}
      <div className="auth-content">
        {/* Left Panel */}
        <div className="auth-left">
          <div className="auth-illustration">
            <SignInIllustration />
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
            {step === "email" ? (
              <>
                <h1 className="auth-form-title">Sign In</h1>
                <div className="auth-form-subtitle" style={{ marginBottom: 32 }} />

                <div className="auth-field">
                  <input
                    type="email"
                    placeholder=" "
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && email) setStep("password"); }}
                  />
                  <span className="auth-field-label">Email address</span>
                </div>

                <button
                  className={`auth-submit-btn ${email ? "active" : ""}`}
                  onClick={() => setStep("password")}
                  disabled={!email}
                >
                  Next
                </button>

                <div className="auth-terms">
                  By proceeding, I agree to <a href="#">Zoom&apos;s Privacy Statement</a> and <a href="#">Terms of Service</a>.
                </div>

                <div className="auth-divider">
                  <div className="auth-divider-line" />
                  <span className="auth-divider-text">Or sign in with</span>
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

                <div className="auth-link-row">
                  New here? <a href="/signup">Sign up</a>
                </div>
              </>
            ) : (
              <>
                <h1 className="auth-form-title">Sign In</h1>
                <div className="auth-form-subtitle">
                  Signing in as <strong>{email}</strong>{" "}
                  <button className="auth-change-link" onClick={() => { setStep("email"); setError(""); }}>Change</button>
                </div>

                <div className="auth-field auth-field-password">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder=" "
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && password && !busy) signIn(); }}
                    autoFocus
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
                  className={`auth-submit-btn ${password ? "active" : ""}`}
                  onClick={signIn}
                  disabled={busy || !password}
                >
                  {busy ? "Signing in..." : "Sign in"}
                </button>

                <div style={{ textAlign: "center", marginTop: 16 }}>
                  <a href="/forgot" style={{ fontSize: 14, color: "var(--zoom-blue)" }}>Forgot password?</a>
                </div>

                {error && <div className="auth-error">{error}</div>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
