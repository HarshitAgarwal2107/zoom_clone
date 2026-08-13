"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export default function SignIn() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<"email" | "password">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  if (checking) return <p>Loading...</p>;

  return (
    <main>
      <h1>Sign in</h1>

      {step === "email" ? (
        <div>
          <input
            type="email"
            placeholder="Enter email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {/* Always advances. Asking the server what this email has would be
              an account-existence check wearing a Next button. */}
          <button onClick={() => setStep("password")} disabled={!email}>
            Next
          </button>
        </div>
      ) : (
        <div>
          <p>
            Signing in as {email}{" "}
            <button onClick={() => { setStep("email"); setError(""); }}>Change</button>
          </p>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button onClick={signIn} disabled={busy || !password}>
            Sign in
          </button>
          <p>
            <a href="/forgot">Forgot password?</a>
          </p>
        </div>
      )}

      {error && <p>{error}</p>}

      <hr />
      <p>Or sign in with</p>
      <a href={`${BACKEND_URL}/api/auth/google/login`}>Google</a>

      <hr />
      <p>
        <a href="/forgot">Forgot password?</a>
      </p>
      <p>
        New here? <a href="/signup">Sign up</a>
      </p>
    </main>
  );
}
