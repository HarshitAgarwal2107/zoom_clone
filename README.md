--Zoom Clone

A lightweight Zoom-style video conferencing platform built around real-time WebRTC, WebSocket signaling, and a FastAPI backend.

--Features

* Google OAuth, email OTP, and password authentication
* Multiple sign-in methods linked to a single user account
* Instant and scheduled meetings
* Join by meeting code
* Real-time participant presence and signaling
* Peer-to-peer WebRTC audio/video
* In-meeting chat
* Screen sharing alongside camera
* Waiting room and meeting lock
* Host controls: mute/stop video for individuals or everyone, remove participants, and end meetings
* Meeting passcodes

-- Stack

* Frontend: Next.js, TypeScript
* Backend: FastAPI, SQLAlchemy
* Database: SQLite
* Real-time: WebSockets + WebRTC

-- Development Approach

The project was developed backend-first and incrementally:

* V1: Core authentication and video conferencing
* V2: Google OAuth, account linking, mute/video controls, chat and screen sharing
* V3: Robustness, edge cases, waiting room, locking, mute-all, stop-video-all, and explicit meeting termination
* Frontend: Bare-bones functional UI → shared CSS → page-specific styling

Zoom's observed behavior was used as the behavioral reference wherever the requirements were ambiguous. Meeting lifecycle, host/participant behavior, authentication, and edge cases were documented separately and used as the project's practical "Zoom Bible."

-- Architecture Decisions

WebRTC was implemented as a full-mesh peer-to-peer architecture rather than introducing a centralized SFU such as Janus. This reduced implementation complexity within the project timeline, at the cost of scalability: each participant maintains a connection to every other participant.

The architecture is therefore best suited to small meetings. A future production-scale implementation could replace the mesh with an SFU such as Janus, mediasoup, or LiveKit.

-- Deployment Notes

Local WebRTC connectivity initially relied on STUN. During deployment, testing across different networks showed that STUN alone could not guarantee a direct connection. TURN was therefore required as a relay for restrictive network configurations.

Google OAuth also required deployment-specific configuration, including updated credentials, secrets, and authorized callback settings.

The WebSocket room registry currently exists in process memory, so the backend runs as a single worker. A production deployment would move shared room state/fan-out to something such as Redis.

-- Mock Data

No mock data is required.

-- Scope

The project prioritizes a functional and robust core conferencing experience within the available development timeline. Larger-scale media infrastructure, TURN-based production networking, recording, reconnection, advanced chat, and other production Zoom features remain future extensions.
