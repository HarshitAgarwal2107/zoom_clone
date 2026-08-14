"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import "./join.css";

export default function Join() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function submit() {
    // Accept the display format too, so a pasted "123 4567 8901" works.
    router.push(`/meeting/${code.replace(/\D/g, "")}`);
  }

  const isValid = code.replace(/\D/g, "").length >= 9; // Zoom meetings can be 9-11 digits typically

  return (
    <div className="join-layout">
      {/* Header */}
      <header className="join-header">
        <div className="join-logo">
          zoom
        </div>
        <nav className="join-nav">
          <span className="join-nav-link">Support</span>
          <span className="join-nav-link">Schedule</span>
          <span className="join-nav-link">Join</span>
          <span className="join-nav-link">
            Host
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
          <span className="join-nav-link">
            Web App
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
          <div className="join-avatar">
            <svg viewBox="0 0 24 24" fill="#555"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
          </div>
        </nav>
      </header>

      {/* Main Area */}
      <main className="join-main">
        <h1 className="join-title">Join Meeting</h1>
        
        <div className="join-form">
          <label className="join-label">Meeting ID or Personal Link Name</label>
          <input
            className="join-input"
            placeholder="Enter Meeting ID or Personal Link Name"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isValid) submit();
            }}
          />
          <button className="join-btn" onClick={submit} disabled={!isValid}>
            Join
          </button>
        </div>

        <span className="join-h323-link">
          Join a meeting from an H.323/SIP room system
        </span>
      </main>

      {/* Footer */}
      <footer className="join-footer">
        <span className="join-footer-text">
          © 2026 Zoom Communications, Inc. All rights reserved. Privacy & Legal Policies
        </span>
        <span className="join-footer-lang">
          English
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
        
        {/* Floating Chat Icon */}
        <div className="join-chat-bubble">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>
            <path d="M7 9h10v2H7zm0-3h10v2H7zm0 6h7v2H7z"/>
          </svg>
        </div>
      </footer>
    </div>
  );
}
