Zoom Clone

A lightweight Zoom-style video conferencing platform built around real-time WebRTC, WebSocket signaling, and a FastAPI backend.

FEATURES

- Google OAuth, email OTP, and password authentication
- Multiple sign-in methods linked to a single user account
- Instant and scheduled meetings
- Join by meeting code
- Real-time participant presence and signaling
- Peer-to-peer WebRTC audio/video
- In-meeting chat
- Screen sharing alongside camera
- Waiting room and meeting lock
- Host controls: mute/stop video for individuals or everyone, remove participants, and end meetings
- Meeting passcodes

STACK

- Frontend: Next.js, TypeScript
- Backend: FastAPI, SQLAlchemy
- Database: SQLite
- Real-time: WebSockets + WebRTC

SETUP

Prerequisites

- Python 3.x
- Node.js / npm
- Google OAuth credentials
- Resend API key (optional, for email OTP)
- STUN/TURN server for reliable deployment

1. Google OAuth

Create an OAuth 2.0 Client ID in Google Cloud Console.

For local development, add the following as an authorized redirect URI:

http://localhost:8000/api/auth/google/callback

Add the generated credentials to the backend .env file.

2. Backend

cd backend

python -m venv venv

Activate the virtual environment.

Windows:
venv\Scripts\activate

Linux/macOS:
source venv/bin/activate

Install dependencies:

pip install -r requirements.txt

Create .env from the provided example:

cp .env.example .env

Configure the required values:

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SECRET_KEY=

For email OTP:

RESEND_API_KEY=

Start the backend:

uvicorn app.main:app --reload --port 8000

3. Frontend

cd frontend
npm install

Create .env.local from the provided example and configure the backend URL if required.

Start the frontend:

npm run dev

The application will be available at:

http://localhost:3000

Backend:

http://localhost:8000

4. Email OTP

If RESEND_API_KEY is configured, OTPs are delivered through Resend.

Without it, the generated OTP is printed in the backend console for development/testing.

5. WebRTC Deployment

Local development primarily uses STUN for peer-to-peer connectivity.

For deployment, a TURN server is required as a fallback when clients cannot establish a direct P2P connection due to restrictive NAT/firewall configurations.

Update the WebRTC configuration with the appropriate STUN/TURN server credentials before deployment.

Google OAuth must also be updated for the deployed environment, including the production client credentials, secrets, and authorized callback URL.

DEVELOPMENT APPROACH

The project was developed backend-first and incrementally:

- V1: Core authentication and video conferencing
- V2: Google OAuth, account linking, mute/video controls, chat and screen sharing
- V3: Robustness, edge cases, waiting room, locking, mute-all, stop-video-all, and explicit meeting termination
- Frontend: Bare-bones functional UI -> shared CSS -> page-specific styling

Zoom's observed behavior was used as the behavioral reference wherever the requirements were ambiguous. Meeting lifecycle, host/participant behavior, authentication, and edge cases were documented separately and used as the project's practical "Zoom Bible."

ARCHITECTURE DECISIONS

WebRTC was implemented as a full-mesh peer-to-peer architecture rather than introducing a centralized SFU such as Janus. This reduced implementation complexity within the project timeline, at the cost of scalability: each participant maintains a connection to every other participant.

The architecture is therefore best suited to small meetings. A future production-scale implementation could replace the mesh with an SFU such as Janus, mediasoup, or LiveKit.

DEPLOYMENT NOTES

The WebSocket room registry currently exists in process memory, so the backend should run as a single worker. A production deployment would move shared room state/fan-out to something such as Redis.

MOCK DATA

No mock data is required.

SCOPE

The project prioritizes a functional and robust core conferencing experience within the available development timeline. Larger-scale media infrastructure, recording, reconnection, advanced chat, and other production Zoom features remain future extensions.
