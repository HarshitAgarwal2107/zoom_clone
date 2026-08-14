"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import "./dashboard.css";

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

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
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

  // UI-only state
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const profileRef = useRef<HTMLDivElement>(null);

  // Live clock - updates every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadMeetings = useCallback(async () => {
    const res = await fetch(`${BACKEND_URL}/api/meetings`, { credentials: "include" });
    setMeetings(await res.json());
  }, []);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/auth/me`, { credentials: "include" }).then(async (res) => {
      if (!res.ok) {
        router.replace("/");
        return;
      }
      setUser(await res.json());
      await loadMeetings();
    });
  }, [router, loadMeetings]);

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

  // Format clock
  const timeString = currentTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateString = currentTime.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const todayShort = currentTime.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  if (!user) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    );
  }

  const upcoming = meetings.filter((m) => m.status === "scheduled");
  const active = meetings.filter((m) => m.status === "active");
  const noMeetings = upcoming.length === 0 && active.length === 0;

  return (
    <div className="dashboard-layout">
      {/* ===== HEADER ===== */}
      <header className="dashboard-header">
        <div className="header-logo">zoom</div>
        <div className="header-right">
          <button className="upgrade-btn">Upgrade</button>
          <div className="avatar-container" ref={profileRef}>
            <button
              className="avatar-btn"
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              title={user.display_name}
            >
              {user.avatar_url ? (
                <img src={user.avatar_url} alt={user.display_name} />
              ) : (
                getInitials(user.display_name)
              )}
            </button>
            {showProfileMenu && (
              <>
                <div className="dropdown-backdrop" onClick={() => setShowProfileMenu(false)} />
                <div className="profile-dropdown">
                  <div className="profile-dropdown-header">
                    <div className="profile-dropdown-name">{user.display_name}</div>
                    <div className="profile-dropdown-email">{user.email}</div>
                  </div>
                  <div className="profile-dropdown-menu">
                    <a href="/profile" className="profile-dropdown-link">My Profile</a>
                    <div className="profile-dropdown-divider" />
                    <button className="profile-dropdown-item" onClick={logout}>Sign Out</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ===== MAIN CONTENT ===== */}
      <main className="dashboard-main">
        {/* Clock */}
        <section className="clock-section">
          <div className="clock-time">{timeString}</div>
          <div className="clock-date">{dateString}</div>
        </section>

        {/* Action Buttons */}
        <section className="action-buttons">
          <button className="action-btn" onClick={newMeeting}>
            <div className="action-btn-icon orange">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4z" fill="white"/>
                <rect x="3" y="6" width="12" height="12" rx="2" fill="white"/>
              </svg>
            </div>
            <span className="action-btn-label">
              New meeting
              <svg viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
            </span>
          </button>

          <button className="action-btn" onClick={() => router.push("/join")}>
            <div className="action-btn-icon blue">
              <svg viewBox="0 0 24 24">
                <path d="M12 4v16M4 12h16" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
              </svg>
            </div>
            <span className="action-btn-label">Join</span>
          </button>

          <button className="action-btn" onClick={() => setShowForm(!showForm)}>
            <div className="action-btn-icon blue">
              <svg viewBox="0 0 24 24" fill="white">
                <rect x="3" y="4" width="18" height="18" rx="2" fill="none" stroke="white" strokeWidth="2"/>
                <path d="M3 10h18" stroke="white" strokeWidth="2"/>
                <path d="M8 2v4M16 2v4" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                <rect x="7" y="14" width="4" height="3" rx="0.5" fill="white"/>
              </svg>
            </div>
            <span className="action-btn-label">Schedule</span>
          </button>
        </section>

        {/* Action Error */}
        {actionError && <div className="action-error">{actionError}</div>}

        {/* Conflict Dialog */}
        {conflict && (
          <div className="conflict-banner">
            <p>{conflict.message}</p>
            <p>
              <strong>{conflict.title}</strong> — {formatCode(conflict.meeting_code)}
            </p>
            <div className="conflict-banner-actions">
              <button className="btn-secondary" onClick={() => setConflict(null)}>Cancel</button>
              <button className="btn-primary" onClick={endPreviousAndRetry}>End previous meeting</button>
            </div>
          </div>
        )}

        {/* Created Confirmation */}
        {created && (
          <div className="created-banner">
            <div className="created-banner-info">
              <svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a10 10 0 11-20 0 10 10 0 0120 0z" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
              <span>Scheduled <strong>{created.title}</strong> — code {formatCode(created.meeting_code)}</span>
            </div>
            <button className="meeting-action-btn secondary" onClick={() => copyInvite(created.meeting_code)}>
              Copy invite link
            </button>
          </div>
        )}


        {/* Calendar Card */}
        <div className="calendar-card">
          {/* Date Header */}
          <div className="date-header">
          <div className="date-header-left">
            Today, {todayShort}
            <svg viewBox="0 0 14 14"><path d="M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
          </div>
          <div className="date-header-right">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </div>
        </div>

        {/* Calendar Navigation */}
        <div className="calendar-nav">
          <div className="calendar-nav-left">
            <span className="calendar-nav-today">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <path d="M3 10h18M8 2v4M16 2v4"/>
              </svg>
              Today
            </span>
            <button className="calendar-nav-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
            <button className="calendar-nav-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9 6l6 6-6 6"/>
              </svg>
            </button>
          </div>
          <button className="calendar-nav-more">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="2"/>
              <circle cx="12" cy="12" r="2"/>
              <circle cx="19" cy="12" r="2"/>
            </svg>
          </button>
        </div>

        {/* Meetings Lists */}
        <div className="meetings-section">
          {/* Active Meetings */}
          {active.length > 0 && (
            <>
              <div className="meetings-section-title">Active</div>
              {active.map((m) => (
                <div className="meeting-item" key={m.id}>
                  <div className="meeting-item-info">
                    <div className="meeting-item-title">{m.title}</div>
                    <div className="meeting-item-meta">
                      <span className="meeting-item-code">{formatCode(m.meeting_code)}</span>
                      <span>Started {m.started_at ? localTime(m.started_at) : "—"}</span>
                    </div>
                  </div>
                  <span className="meeting-item-status active">
                    <span className="meeting-item-status-dot" />
                    Live
                  </span>
                  <div className="meeting-item-actions">
                    <button className="meeting-action-btn primary" onClick={() => router.push(`/meeting/${m.meeting_code}`)}>
                      Rejoin
                    </button>
                    <button className="meeting-action-btn danger" onClick={() => endMeeting(m.meeting_code)}>
                      End
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Upcoming Meetings */}
          {upcoming.length > 0 && (
            <>
              <div className="meetings-section-title">Upcoming</div>
              {upcoming.map((m) => (
                <div className="meeting-item" key={m.id}>
                  <div className="meeting-item-info">
                    <div className="meeting-item-title">{m.title}</div>
                    <div className="meeting-item-meta">
                      <span className="meeting-item-code">{formatCode(m.meeting_code)}</span>
                      <span>{m.scheduled_at ? localTime(m.scheduled_at) : "No time"}</span>
                      <span>{m.duration_minutes} min</span>
                    </div>
                  </div>
                  <span className="meeting-item-status scheduled">
                    <span className="meeting-item-status-dot" />
                    Scheduled
                  </span>
                  <div className="meeting-item-actions">
                    <button className="meeting-action-btn secondary" onClick={() => copyInvite(m.meeting_code)}>
                      Copy invite
                    </button>
                    <button className="meeting-action-btn primary" onClick={() => startMeeting(m.meeting_code)}>
                      Start
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}



          {/* Empty State */}
          {noMeetings && (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 120 120">
                  <path d="M60 20 L85 55 L75 50 L80 95 L40 95 L45 50 L35 55 Z" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.4"/>
                  <path d="M30 85 Q60 70 90 85" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.3"/>
                </svg>
              </div>
              <div className="empty-state-text">No meetings for today</div>
            </div>
          )}
        </div>

        {/* Open Recordings */}
        <div className="open-recordings">
          Open recordings
          <svg viewBox="0 0 14 14"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
        </div>
      </div>
      </main>

      {/* ===== SCHEDULE MODAL ===== */}
      {showForm && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="modal">
            <div className="modal-header">
              <h2 className="modal-title">Schedule a Meeting</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>
                <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18"/>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Title</label>
                <input
                  placeholder="Meeting title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  placeholder="Add a description (optional)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label className="form-label">When</label>
                <input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Duration</label>
                <div className="form-row">
                  <input
                    type="number"
                    value={duration}
                    min={1}
                    max={1440}
                    onChange={(e) => setDuration(Number(e.target.value))}
                  />
                  <span className="form-row-label">minutes</span>
                </div>
              </div>
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={allowJoinBeforeHost}
                  onChange={(e) => setAllowJoinBeforeHost(e.target.checked)}
                />
                Allow participants to join before host
              </label>
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={waitingRoom}
                  onChange={(e) => setWaitingRoom(e.target.checked)}
                />
                Waiting room (host admits each participant)
              </label>
              <div className="form-group">
                <label className="form-label">Passcode (optional)</label>
                <input
                  placeholder="Enter passcode"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                />
              </div>
              {formError && <div className="form-error">{formError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={scheduleMeeting} disabled={busy || !startsAt}>
                Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
