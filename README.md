# Zoom Clone — Phases 1–7

Three sign-in methods — Google, email code, and password — all resolving to
**one account**, a dashboard that creates instant and scheduled meetings, and
meeting rooms with join-by-code, live presence over a WebSocket, full-mesh
WebRTC video and audio, in-meeting chat, screen share alongside camera, and the
host controls: waiting room, mute/stop-video for one or all, remove, lock,
passcode, and an explicit End Meeting.

```
google      ──┐
email_otp   ──┼──> user ──> meetings
password    ──┘
```

Meeting behaviour follows `zoom_meeting_system_behavior.txt` and sign-in follows
`zoom_login_infrastructure_findings.txt`; section numbers below refer to
whichever is in context.

- **Frontend:** Next.js (App Router, TypeScript) on `:3000`
- **Backend:** FastAPI + SQLAlchemy 2.0 on `:8000`
- **Database:** SQLite at `backend/app.db`, created on startup via
  `Base.metadata.create_all()` (no migrations yet — the schema is still moving)

## Setup

### Google OAuth credentials

Create an OAuth 2.0 Client ID (type: Web application) in the Google Cloud
Console. The authorized redirect URI must be exactly:

```
http://localhost:8000/api/auth/google/callback
```

### Gmail SMTP (optional — see the no-credentials fallback below)

Gmail rejects account passwords for SMTP, so this needs an App Password:

1. Google Account → Security → **2-Step Verification must be on** (App
   Passwords don't exist without it).
2. Security → App passwords → generate one for "Mail".
3. Use the 16-character value as `SMTP_PASSWORD`, spaces removed.

Host `smtp.gmail.com`, port 465, `SMTP_USER` is the full Gmail address.

**If `SMTP_USER` is empty the send is skipped entirely and the code is only
printed to the server console.** This is deliberate: the whole OTP flow is
runnable on a fresh clone with no credentials. The code is printed either way,
so you never have to wait on mail delivery to test.

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SECRET_KEY
uvicorn app.main:app --reload --port 8000
```

Run the backend **single-worker** — `--workers 1`, which is uvicorn's default.
The WebSocket room registry lives in process memory, and multiple workers would
split that state across processes so peers could not see each other.

### Frontend

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

## API

| method | path | auth | behaviour |
|---|---|---|---|
| `GET` | `/api/auth/google/login` | — | Redirect to Google consent (`openid email profile`) |
| `GET` | `/api/auth/google/callback` | — | Code exchange, `resolve_user`, set JWT cookie, 302 to `/dashboard` |
| `POST` | `/api/auth/otp/request` | — | Issue a 6-digit code for an email; always 200 |
| `POST` | `/api/auth/otp/verify` | — | Validate the code, `resolve_user`, set JWT cookie |
| `POST` | `/api/auth/password/set` | cookie | Create or replace the password credential |
| `POST` | `/api/auth/password/login` | — | Sign in with email + password |
| `GET` | `/api/auth/methods` | cookie | The account's linked sign-in methods |
| `GET` | `/api/auth/me` | cookie | Current user, else 401 |
| `POST` | `/api/auth/logout` | — | Clear the cookie |
| `POST` | `/api/meetings` | cookie | Create a meeting hosted by the current user |
| `GET` | `/api/meetings` | cookie | The current user's meetings, newest first |
| `POST` | `/api/meetings/{meeting_code}/start` | cookie | Explicit SCHEDULED → ACTIVE; host only |
| `POST` | `/api/meetings/{meeting_code}/end` | cookie | Explicit ACTIVE → ENDED; host only |
| `GET` | `/api/meetings/{meeting_code}` | — | Fetch one by code; 404 if absent, 410 if ended |
| `WS` | `/ws/{meeting_code}?name=` | cookie optional | Room presence and signaling relay |
| `GET` | `/api/health` | — | Liveness |

## Design notes

**Backend-owned session.** The backend does the full authorization code
exchange and issues its own HS256 JWT (`sub` = user id, 7-day expiry) in an
httpOnly cookie. Both providers end at the same `set_auth_cookie` call, so a
session is identical no matter how you signed in.

**`resolve_user` is the only provider seam.** `identity.py` exposes one
function. Google and OTP both call it and nothing else; adding GitHub later is
a new route file plus one call, not a refactor. Identity lives in
`auth_identities`, keyed on `(provider, provider_user_id)`, so `users` has no
provider-specific columns at all — that is why `google_sub` is gone.

**One account, many sign-in methods.** `auth_identities` *is* the findings
document's model: methods are rows, the account is the row they point at.
Signing in to the same address through a second provider attaches a new
identity to the existing user rather than creating a second account
(Section 2), so `users.email` is unique. `/profile` is where this becomes
visible — one account carrying three methods.

**Linking is gated on `email_verified`, and that gate is the security story.**
Merging an unverified identity into an existing address is pre-account-takeover:
an attacker signs up as `victim@example.com` and waits to be handed the real
account. Google's claim is passed through honestly rather than hardcoded — it
really can be false on some Workspace domains. The `IntegrityError` recovery
path re-applies the same gate, so losing a concurrent-signup race cannot buy a
link the normal path would have refused.

**Password login never calls `resolve_user`.** It can only match an existing
identity — there is no create-or-link path — because a password identity is only
ever created by an already-authenticated user. That is the second half of the
takeover defence: you cannot register a password against someone else's address
and wait to be linked.

**Setting a password requires a session.** The mailbox is always proven, by a
code or by Google, before a password exists. Overwriting the hash is the
change-password path, so there is no separate endpoint.

**bcrypt for passwords, sha256 for OTP codes — deliberately different.** A
6-digit code with a five-attempt cap and a ten-minute expiry is bounded by the
attempt limit, so a slow hash buys nothing. A password is long-lived,
user-chosen and offline-attackable if the database leaks, so it needs one.

**The sign-in screen follows Zoom's shape: email → Next → password.** There is
no "pick a method" menu. Next always advances, and never asks the server what
that address has — branching there would be an account-existence check wearing
a Next button. A wrong email and a wrong password fail identically at the
credential step. Signup lives on its own page, as it does on Zoom.

**Names are captured at signup, not derived.** First and last name are joined
into `display_name` by `/password/set`, which takes them as optional fields —
one schema field rather than a separate profile endpoint and a second
round-trip. Consequently `resolve_user` treats `display_name=None` as "this
provider has no profile data": email OTP passes `None`, so signing in with a
code or resetting a password no longer overwrites the captured name with the
email local part. Google still refreshes it, because Google actually knows it.

**Login is not an existence oracle.** Unknown email and wrong password return an
identical 400, and bcrypt runs against a dummy hash when no identity is found so
the timing matches too. The landing page likewise never asks the server which
methods an address has — the user picks a method and fails at the credential
step.

**`/api/auth/methods` returns only `provider` and `created_at`.** No
`secret_hash`, and no `provider_user_id` — the Google `sub` is internal.

**Emails are lowercased and trimmed, nothing more.** No Gmail dot or `+tag`
canonicalisation: it surprises users and doesn't generalise across providers.

**OTP codes are stored as sha256 hashes only**, never in plaintext, with a
10-minute expiry and a 5-attempt cap. Plain sha256 is the right tool here — a
short-lived 6-digit code with an attempt cap is not a password, so bcrypt or
argon2 would be cargo cult. Codes come from `secrets`, zero-padded so `000042`
is valid.

**`/otp/request` always returns 200**, even for an address that has never been
seen. A different response for unknown addresses would turn the endpoint into
an account-existence oracle. It does return 429 if an unconsumed, unexpired
code for that address is under 60 seconds old — a timestamp comparison, not a
rate-limiting library.

**Mail is sent on a `BackgroundTasks` task** so the HTTP response doesn't block
on the SMTP handshake, and failures are logged and swallowed: the code is
already stored and printed, so a bounce must not 500 the request.

**Cookies across ports.** `:3000` → `:8000` is cross-origin, so
`CORSMiddleware` uses an explicit `allow_origins=[FRONTEND_URL]` with
`allow_credentials=True` — browsers reject wildcard origins once credentials
are enabled — and every frontend `fetch` passes `credentials: "include"`.

**`SessionMiddleware`** is present because Authlib stores the OAuth
state/nonce in a signed session cookie between the redirect to Google and the
callback. It is not a user session.

**Meeting codes** are 11 random digits, stored unformatted and regenerated on
collision. Formatting to `123 4567 8901` happens only in the UI.

**Room state lives in one process.** `signaling.py` keeps
`rooms: dict[meeting_code, dict[peer_id, Peer]]` in module memory, so **the
backend must run `--workers 1`**. Two workers means two independent dicts and
peers that silently cannot see each other. The production fix is Redis pub/sub
for the fan-out, not more workers.

**`peer_id` is server-generated** (`secrets.token_urlsafe(8)`) and never taken
from the client — otherwise a peer could impersonate another by claiming its ID
and receive its signaling traffic.

**The signaling server does not parse SDP or ICE.** `offer`, `answer` and
`ice-candidate` are relayed verbatim to one named target, with `target`
rewritten to `from`. Messages addressed to a peer that has already left are
dropped rather than erroring, because peers legitimately race with disconnects.

**Participants are never deleted, only marked with `left_at`**, so the rows
remain the meeting history behind the Recent list. When the last peer leaves,
the room key is dropped and the meeting is marked `ended` with `ended_at` —
without that, every meeting created would stay `live` forever.

**Guests have `user_id = NULL`.** Joining requires only a display name, so
identity in a room is deliberately weaker than identity in the app. Role is
`"host"` only when the request's auth cookie resolves to the meeting's host.

**SCHEDULED does not mean ACTIVE (Section 26).** This is the rule the whole
scheduling design turns on. A participant opening the link does not start the
meeting; only an explicit start does — either the host pressing Start or the
host arriving in the room. Everything else follows: the WebSocket no longer
flips a meeting active on connection, and a held participant gets no
`meeting_participants` row because they have not joined.

**Three timestamps, three meanings.** `scheduled_at` is intent, `started_at` is
fact, `created_at` is bookkeeping. A host may start early (Section 4), so
`started_at < scheduled_at` is normal and correct, and `scheduled_at` is never
rewritten — it stays as historical metadata.

**Waiting is a separate registry, not a flag.** Held connections live in
`waiting`, parallel to `rooms`. They are absent from `room-state`, receive no
`peer-joined`, and have no peer connections built against them — present, but
not in the meeting. On start they are moved across and run through the same
admit path as any other joiner.

**`room-state` before `peer-joined`.** When admitting, the newcomer must learn
the room exists before anyone is told they arrived, or existing peers will
offer to a peer that is not ready to answer.

**Times are stored UTC and displayed local.** `datetime-local` yields a naive
local string, so the client sends `new Date(value).toISOString()`; sending it
raw would make the server read local time as UTC and land the meeting hours
off. The API returns naive UTC and the dashboard appends `Z` before formatting.

**A scheduled meeting whose time passes stays scheduled (Section 11).** There
is no sweep job and no MISSED status — a meeting nobody started is still
startable, and still in Upcoming.

**Starting is idempotent.** The host may click Start in two tabs; the second
call returns 200 and changes nothing rather than erroring.

**Full mesh, one `RTCPeerConnection` per pair.** O(n²) connections and uplink,
which degrades past roughly five peers. See Scaling below.

**Glare avoidance is positional rather than perfect negotiation.** The peer
already in the room offers; the newcomer never does. Since exactly one side of
each pair offers, glare cannot happen and no rollback logic is needed. It is a
few lines instead of a subtle state machine, and it is explicable in one
sentence — which is why it beats the "correct" answer at this size.

**ICE candidates are queued until the remote description exists.** They
routinely arrive first, and applying one early throws and kills the connection.
Each peer has a pending-candidate list that is drained immediately after
`setRemoteDescription` resolves. This is the single most common cause of
"signaling looks fine but no video".

**A failed `getUserMedia` does not abort the join.** Without a camera the peer
adds `recvonly` transceivers instead of tracks, so it still negotiates and can
watch. That is also how you test with two tabs on one webcam.

**Mute and Stop Video toggle `track.enabled`** rather than renegotiating —
instant, and the connection is untouched. The state is mirrored to peers with a
`state` relay message so remote tiles can label it. Those handlers read the
current values from refs, not render closures: a closure would send a stale
value, so a peer joining after you mute would be told you are unmuted.

**Waiting Room and waiting-for-host are different states, so they get different
registries.** `rooms` is the meeting, `waiting` is "the meeting has not
started", `knocking` is "the meeting is running but the host must let you in".
Section 6 is explicit that these are separate concepts, and conflating them
would mean a participant admitted by the host still being stuck behind the
start transition, or vice versa. A knocking peer gets no
`meeting_participants` row — they have not joined.

**Host controls are authorised on the server, never by the client.** Every
`host-*` message is dropped unless the sender is the host *and* in the room;
`room-state` carries `is_host` purely so the UI knows what to render. Mute and
stop-video are delivered to the target as instructions it applies to its own
tracks, so the muted peer's own UI stays truthful rather than silently
diverging from what others see.

**Removal is not leaving.** `meeting_participants.status` becomes `"removed"`
rather than `"left"`, which is the distinction Section 22 asks for and the
reason that column exists.

**Locking is not ending.** Existing participants stay; new ones are turned away
with close code `4403`. Unlocking lets them in again.

**One ACTIVE meeting per host (Section 20).** Enforced where a meeting becomes
active — instant creation and explicit start. The 409's detail carries the
running meeting's code and title so the dashboard can offer "End previous
meeting" rather than a dead end. Scheduling any number of meetings is fine;
only running two at once is not.

**An explicit End Meeting (Section 8)** now exists, closing one of the two
divergences noted below: ending was previously only ever implicit.

**Chat rides the meeting WebSocket, not an `RTCDataChannel`.** The socket
already exists and already knows room membership, so chat costs one message type
and gets persistence and server-side visibility for free, instead of N data
channels to manage with neither.

**The server echoes chat to the sender rather than the client rendering
optimistically.** It costs a round trip, and it buys everyone the same ordering:
the server's insert order is the only order. **No history is replayed on join** —
a late joiner sees only what follows their arrival, matching Zoom's default. The
rows are still persisted; they are simply not replayed.

**`chat_messages.sender_name` is denormalised on purpose.** A participant row is
reused across a rejoin, so resolving the name through the FK at read time would
retroactively rewrite who said what. The message stores the name as it was.

**Screen share uses a second peer connection per pair, not `addTrack`.**
Adding a track to a live connection triggers renegotiation, and renegotiation
breaks the positional glare rule — that rule assigns the offer role by arrival
order and has no answer for "the sharer offers, whoever they are". A connection
created from nothing has no negotiation state to collide with, so the sharer is
unambiguously the offerer and the camera connections are never touched. The
alternative, `replaceTrack`, needs no renegotiation and is less code, but remote
peers would see the screen *instead of* the camera; Zoom shows both.

**The pending-ICE queue is split by kind as well as peer.** Applying a screen
candidate to a camera connection fails, and the failure is indistinguishable
from a dead network path. Every relay message routes on `kind` before anything
else; an untagged message is a bug, not a camera message.

**Capture is constrained to `frameRate: 5`** — ample for slides or code, and it
keeps two simultaneous outbound video streams affordable on a home connection.
No screen audio: it is Chrome-only, tab-only, and mixing it into an existing
audio track is not worth the complexity here.

**Stopping a share has three entry points and one handler**: the in-app button,
the browser's own "Stop sharing" bar via `track.onended`, and leaving. Missing
the `onended` wiring is the standard bug — the user stops via Chrome, the app
still believes it is presenting, and every remote tile freezes on a dead track.

**Leaving stops every local track.** Closing the peer connections is not enough
— without `track.stop()` the camera light stays on after leaving.

**The React StrictMode trap.** Dev remounts run effects twice, so a socket
opened directly in `useEffect` connects, disconnects and reconnects — phantom
join/leave events and duplicate participant rows that look like a backend bug.
The room page holds the socket in a ref and defers the cleanup's `close()` by a
tick, so the immediate StrictMode re-run reclaims the same socket while a real
unmount still closes it.

## Assumptions

- **Phase 2 dropped `users.google_sub`, so the old `app.db` was deleted and
  rebuilt by `create_all` rather than migrated.** It held dev test data only; a
  migration was not worth writing while the schema is still moving.
- **No unlinking of sign-in methods.** Removing one needs a guard against
  deleting the last remaining method, which is more code than the feature is
  worth here. `/profile` lists methods but cannot remove them.
- **`bcrypt` is used directly rather than through `passlib`.** The spec called
  for `passlib[bcrypt]`, but passlib 1.7.4 (last released 2020) crashes against
  bcrypt 5.x reading `bcrypt.__about__`. The `bcrypt` package's own API is two
  calls and is maintained, so it is used instead.
- **Passwords are capped at 72 bytes**, bcrypt's own limit — rejected as input
  rather than silently truncated or raised as a 500.
- **Password rules come from Zoom's signup screen**, not the phase spec's
  "minimum 8 characters, no composition rules": 8+ characters with at least one
  letter, number, uppercase and lowercase, and no run of 4 or more consecutive
  characters. Runs are direction-sensitive, so `qwert` is rejected but an
  alternating walk like `ewer` is not.
- **The status vocabulary is `scheduled` / `active` / `ended`**, renamed from
  phase 1's `live` to match the behaviour document. `app.db` was deleted and
  rebuilt by `create_all` rather than migrated.
- **An instant meeting is created `active` with `started_at` set.** It is by
  definition already started, which is what makes phase 1's original `live`
  guess principled rather than arbitrary.
- **`duration_minutes` is only set for scheduled meetings** (default 60). An
  instant meeting has no planned end, so it stays null.
- **An OTP account's `display_name` is the email local part.** The OTP
  "provider" only knows the address. Since accounts are no longer merged, this
  never overwrites a name that came from Google — they are different rows.
- **Removing the unique index from `users.email` needs a schema change.** On an
  existing dev database, `create_all` will not drop it; either delete `app.db`
  or run
  `DROP INDEX ix_users_email; CREATE INDEX ix_users_email ON users (email);`
- **Adding `meetings.ended_at` likewise needs a manual step** on an existing
  dev database: `ALTER TABLE meetings ADD COLUMN ended_at DATETIME`.
  `create_all` creates missing *tables*, never missing columns. The same applied
  to `waiting_room_enabled`, `locked` and `passcode_hash`.
- **A meeting passcode has no composition rules** — unlike an account password.
  It is a short-lived shared secret for one meeting, capped at 16 characters,
  and it is still stored as a bcrypt hash rather than plaintext.
- **The passcode is entered on the same screen as the display name** rather
  than a separate step before it. One fewer state for the same information.
- **The dashboard has three sections** — Upcoming (`scheduled`), Active
  (`active`), Recent (`ended`) — so a meeting is always visible somewhere.
- **`participant_count` counts every join ever recorded** for a meeting, not
  distinct people or people currently present. Rejoining counts twice.
- **One DB session is held open per WebSocket connection**, for the life of the
  call. Fine for SQLite at demo scale; a connection-pool concern at real scale.
- `POST /api/meetings` ignores `scheduled_at` / `duration_minutes`; both stay
  null until the schedule form exists. Creation returns `201`.
- The dashboard's *Join Meeting*, *Schedule Meeting*, and *Settings* buttons
  are inert placeholders with no handlers.
- `created_at` uses SQLite's `CURRENT_TIMESTAMP` server default, which is UTC
  but stored naive; the frontend appends `Z` before formatting to local time.

## Modelled but not implemented

The behaviour document describes more than this build implements. These are
deliberately deferred, and the tables are shaped to accept them without a
redesign — each needs only the listed fields plus the enforcement:

| Feature | Section | Fields needed |
|---|---|---|
| Co-host | 17–18 | a `"co_host"` value in `meeting_participants.role`; host controls would check `role in (host, co_host)` |
| Alternative host | 18 | `meetings.alternative_host_id` FK → `users.id` |
| MISSED status | 11 | a `"missed"` value in `meetings.status` plus a sweep job |
| PMI | 21 | `users.pmi_code`, kept distinct from `meetings.meeting_code` |
| Microsoft / Apple / Facebook | login 1, 4 | **no schema change** — a new provider module plus one `resolve_user` call. That extensibility is the point of the design. |
| Phone / SMS sign-in | login 6 | a `"phone"` provider with the number as `provider_user_id`; codes reuse `login_codes` |
| Unlinking a method | login 3 | no column, but a guard against deleting the last method — see below |
| Password reset by email | — | reuses `login_codes`; the reset flow is the OTP flow plus a set-password step |

`meeting_participants.status` is already live for exactly this reason: `left_at`
alone cannot tell "left" from "was removed", and Section 22 wants both.

The public/internal identifier split the document asks for in Sections 13 and 23
is already in place — `meetings.meeting_code` is the public identifier and the
integer primary key is never exposed. The document calls that column
`meeting_id`; this project calls it `meeting_code` for readability, with the
same semantics.

## Known divergences from the behaviour document

One remains:

**Ending on an empty room contradicts Sections 7, 10, 19 and 26.** The document
says a host disconnecting must not end the meeting, and that everyone leaving
should trigger a grace period rather than an immediate end. This build still
ends a meeting the moment the last peer disconnects, so a solo host who
refreshes their browser ends their own meeting. The fix is a host-disconnect
grace period, deliberately deferred.

That interacts with the one-active-meeting rule: with the grace period in place,
closing a tab would leave the meeting running, which is exactly the state the
"You already have a meeting running" screen is designed for. Today that screen
appears mainly when *other* participants are still connected.

The other divergence — no explicit End Meeting (Section 8) — is now closed.

## Scaling

**The mesh is the first ceiling.** Each participant holds one peer connection
per other participant, so an *n*-person call means *n−1* encodes and uploads per
person — O(n²) streams overall. **Screen share doubles this while active**:
connections go from *n−1* to 2(*n−1*) per peer, so three participants means four
connections each instead of two. That is a second concrete symptom of the same
architectural boundary. It is comfortable to about four or five peers
and falls apart above that. The fix is an **SFU** (Janus, mediasoup, or
LiveKit): every client sends one stream up and subscribes to the rest, turning
the per-client cost linear. That is a server-side change; the client's
offer/answer plumbing largely survives it.

**Room state is the second ceiling.** The registry is a plain dict in one
process, so the backend must run `--workers 1`. Horizontal scaling needs the
fan-out moved to Redis pub/sub, with each worker subscribing to the rooms it
holds sockets for.

**NAT traversal is the deployed limitation.** Only a public STUN server is
configured. STUN is enough for most home networks, but peers behind symmetric
NAT (common on corporate and some mobile networks) cannot connect without a
**TURN** relay, which is out of scope here and would be the first thing to add
for a real deployment.

## Verifying the account model

```bash
sqlite3 backend/app.db "select u.id, u.email, i.provider from users u join auth_identities i on i.user_id = u.id order by u.email, i.provider;"
```

Sign in with a code, set a password, log out and sign in with the password, then
sign in with Google using the same address. You should see **one** `users` id
against three providers, and the meetings created in the first session still
listed in the last. Two ids for one email would mean linking is broken.

## Not built yet (later phases)

Recording, co-host, reconnection after network drop, TURN,
bandwidth adaptation, grid layout maths, virtual backgrounds, Zoom-accurate
styling, tests, magic links, account unlinking, profile editing, phone/SMS
sign-in, SSO/SAML, password reset by email, session listing or per-device
revocation, rate limiting on login attempts. In chat: private messages, file
transfer, reactions, typing indicators, history replay on join, editing or
deletion. In screen share: screen audio, annotation, remote control, presenter
spotlight. See "Modelled but not implemented" above for the fields each would
need.
