"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

type User = {
  id: number;
  email: string;
  display_name: string;
  avatar_url: string | null;
};

type Meeting = {
  id: number;
  meeting_code: string;
  title: string;
  status: string;
  scheduled_at: string | null;
  duration_minutes: number | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  participant_count: number;
};

function formatCode(code: string) {
  return `${code.slice(0, 3)} ${code.slice(3, 7)} ${code.slice(7)}`;
}

// The API sends naive UTC; append Z so the browser renders it in local time.
function localTime(value: string) {
  return new Date(value + "Z").toLocaleString();
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [duration, setDuration] = useState(60);
  const [allowJoinBeforeHost, setAllowJoinBeforeHost] = useState(false);
  const [waitingRoom, setWaitingRoom] = useState(false);
  const [passcode, setPasscode] = useState("");
  // Section 20: only one meeting may be ACTIVE per host, so a second one has
  // to be refused with a way out rather than silently allowed.
  const [conflict, setConflict] = useState<{
    message: string;
    meeting_code: string;
    title: string;
    retry: "new" | string;
  } | null>(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Meeting | null>(null);
  const [actionError, setActionError] = useState("");

  async function loadMeetings() {
    const res = await fetch(`${BACKEND_URL}/api/meetings`, { credentials: "include" });
    setMeetings(await res.json());
  }

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/auth/me`, { credentials: "include" }).then(async (res) => {
      if (!res.ok) {
        router.replace("/");
        return;
      }
      setUser(await res.json());
      await loadMeetings();
    });
  }, [router]);

  async function newMeeting() {
    const res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_type: "instant" }),
    });
    if (res.status === 409) {
      const body = await res.json();
      setConflict({ ...body.detail, retry: "new" });
      return;
    }
    const meeting: Meeting = await res.json();
    router.push(`/meeting/${meeting.meeting_code}`);
  }

  async function endMeeting(code: string) {
    await fetch(`${BACKEND_URL}/api/meetings/${code}/end`, {
      method: "POST",
      credentials: "include",
    });
    await loadMeetings();
  }

  async function endPreviousAndRetry() {
    if (!conflict) return;
    const retry = conflict.retry;
    await endMeeting(conflict.meeting_code);
    setConflict(null);
    if (retry === "new") await newMeeting();
    else await startMeeting(retry);
  }

  async function scheduleMeeting() {
    setBusy(true);
    setFormError("");
    const res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meeting_type: "scheduled",
        title: title || null,
        description: description || null,
        // datetime-local gives a naive local string; toISOString converts it
        // to UTC. Sending it raw would land the meeting hours off.
        scheduled_at: new Date(startsAt).toISOString(),
        duration_minutes: Number(duration),
        allow_join_before_host: allowJoinBeforeHost,
        waiting_room_enabled: waitingRoom,
        passcode: passcode || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json();
      setFormError(typeof body.detail === "string" ? body.detail : "Could not schedule");
      return;
    }
    setCreated(await res.json());
    setShowForm(false);
    setTitle("");
    setDescription("");
    setStartsAt("");
    setDuration(60);
    setAllowJoinBeforeHost(false);
    setWaitingRoom(false);
    setPasscode("");
    await loadMeetings();
  }

  async function startMeeting(code: string) {
    const res = await fetch(`${BACKEND_URL}/api/meetings/${code}/start`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      router.push(`/meeting/${code}`);
      return;
    }
    if (res.status === 401) {
      router.replace("/");
      return;
    }
    if (res.status === 409) {
      const body = await res.json();
      if (body.detail?.meeting_code) {
        setConflict({ ...body.detail, retry: code });
        return;
      }
    }
    // Most likely the session changed in another tab — signing in as a second
    // account rebinds the cookie and leaves this list showing someone else's
    // meetings. Reload both so the page stops lying.
    const body = await res.json();
    setActionError(typeof body.detail === "string" ? body.detail : "Could not start");
    const me = await fetch(`${BACKEND_URL}/api/auth/me`, { credentials: "include" });
    if (!me.ok) {
      router.replace("/");
      return;
    }
    setUser(await me.json());
    await loadMeetings();
  }

  async function logout() {
    await fetch(`${BACKEND_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    router.replace("/");
  }

  function copyInvite(code: string) {
    navigator.clipboard.writeText(`${window.location.origin}/join/${code}`);
  }

  if (!user) return <p>Loading...</p>;

  const upcoming = meetings.filter((m) => m.status === "scheduled");
  const active = meetings.filter((m) => m.status === "active");
  const recent = meetings.filter((m) => m.status === "ended");

  return (
    <main>
      <p>
        Signed in as {user.display_name} ({user.email}) —{" "}
        <a href="/profile">Profile</a>
      </p>
      <button onClick={logout}>Logout</button>
      {actionError && <p>{actionError}</p>}

      {conflict && (
        <div style={{ border: "1px solid #ccc", padding: 8 }}>
          <p>{conflict.message}</p>
          <p>
            {conflict.title} — {formatCode(conflict.meeting_code)}
          </p>
          <button onClick={() => setConflict(null)}>Cancel</button>{" "}
          <button onClick={endPreviousAndRetry}>End previous meeting</button>
        </div>
      )}

      <div>
        <button onClick={newMeeting}>New Meeting</button>
        <button onClick={() => router.push("/join")}>Join Meeting</button>
        <button onClick={() => setShowForm(!showForm)}>Schedule Meeting</button>
        <button>Settings</button>
      </div>

      {showForm && (
        <div>
          <h2>Schedule a meeting</h2>
          <div>
            <input
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <textarea
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div>
            <input
              type="number"
              value={duration}
              min={1}
              max={1440}
              onChange={(e) => setDuration(Number(e.target.value))}
            />{" "}
            minutes
          </div>
          <div>
            <label>
              <input
                type="checkbox"
                checked={allowJoinBeforeHost}
                onChange={(e) => setAllowJoinBeforeHost(e.target.checked)}
              />
              Allow participants to join before host
            </label>
          </div>
          <div>
            <label>
              <input
                type="checkbox"
                checked={waitingRoom}
                onChange={(e) => setWaitingRoom(e.target.checked)}
              />
              Waiting room (host admits each participant)
            </label>
          </div>
          <div>
            <input
              placeholder="Passcode (optional)"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
            />
          </div>
          <button onClick={scheduleMeeting} disabled={busy || !startsAt}>
            Schedule
          </button>
          {formError && <p>{formError}</p>}
        </div>
      )}

      {created && (
        <p>
          Scheduled {created.title} — code {formatCode(created.meeting_code)}{" "}
          <button onClick={() => copyInvite(created.meeting_code)}>
            Copy invite link
          </button>
        </p>
      )}

      <h2>Upcoming</h2>
      <ul>
        {upcoming.map((m) => (
          <li key={m.id}>
            {m.title} — {m.scheduled_at ? localTime(m.scheduled_at) : "no time"} —{" "}
            {m.duration_minutes} min — {formatCode(m.meeting_code)}{" "}
            <button onClick={() => copyInvite(m.meeting_code)}>Copy invite link</button>{" "}
            <button onClick={() => startMeeting(m.meeting_code)}>Start</button>
          </li>
        ))}
      </ul>

      <h2>Active</h2>
      <ul>
        {active.map((m) => (
          <li key={m.id}>
            {m.title} — {formatCode(m.meeting_code)} — started{" "}
            {m.started_at ? localTime(m.started_at) : "—"}{" "}
            <button onClick={() => router.push(`/meeting/${m.meeting_code}`)}>
              Rejoin
            </button>{" "}
            <button onClick={() => endMeeting(m.meeting_code)}>End</button>
          </li>
        ))}
      </ul>

      <h2>Recent</h2>
      <ul>
        {recent.map((m) => (
          <li key={m.id}>
            {formatCode(m.meeting_code)} — {m.title} — {m.participant_count} participants
            — ended {m.ended_at ? localTime(m.ended_at) : "—"}
          </li>
        ))}
      </ul>
    </main>
  );
}
