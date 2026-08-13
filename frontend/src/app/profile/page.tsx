"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PasswordHints from "../password-hints";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

type User = { id: number; email: string; display_name: string };
type Method = { provider: string; created_at: string };

const LABELS: Record<string, string> = {
  google: "Google",
  email_otp: "Email code",
  password: "Password",
};

export default function Profile() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [methods, setMethods] = useState<Method[]>([]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadMethods() {
    const res = await fetch(`${BACKEND_URL}/api/auth/methods`, {
      credentials: "include",
    });
    setMethods(await res.json());
  }

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/auth/me`, { credentials: "include" }).then(async (res) => {
      if (!res.ok) {
        router.replace("/");
        return;
      }
      setUser(await res.json());
      await loadMethods();
    });
  }, [router]);

  async function savePassword() {
    setBusy(true);
    setError("");
    setSaved(false);
    const res = await fetch(`${BACKEND_URL}/api/auth/password/set`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.detail === "string" ? body.detail : "Could not save");
      return;
    }
    setPassword("");
    setSaved(true);
    await loadMethods();
  }

  if (!user) return <p>Loading...</p>;

  const hasPassword = methods.some((m) => m.provider === "password");

  return (
    <main>
      <h1>Profile</h1>
      <p>Email: {user.email}</p>
      <p>Display name: {user.display_name}</p>
      <a href="/dashboard">Back to dashboard</a>

      <h2>Sign-in methods</h2>
      <ul>
        {methods.map((m) => (
          <li key={m.provider}>
            {LABELS[m.provider] ?? m.provider}
            {m.provider === "google" && ` — ${user.email}`} — added{" "}
            {new Date(m.created_at + "Z").toLocaleString()}
          </li>
        ))}
      </ul>

      <h3>{hasPassword ? "Change password" : "Set password"}</h3>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onFocus={() => setHintsOpen(true)}
        onBlur={() => setHintsOpen(false)}
      />
      <PasswordHints show={hintsOpen} />
      <button onClick={savePassword} disabled={busy || !password}>
        {hasPassword ? "Change password" : "Set password"}
      </button>
      {saved && <p>Password saved.</p>}
      {error && <p>{error}</p>}
    </main>
  );
}
