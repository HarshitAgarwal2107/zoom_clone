"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

type Kind = "camera" | "screen";

type MeetingInfo = {
  meeting_code: string;
  title: string;
  host_display_name: string;
  status: string;
  passcode_required: boolean;
};

type Knock = { peer_id: string; display_name: string };

type Participant = { peer_id: string; display_name: string };
type PeerState = { muted: boolean; videoOff: boolean };
type WaitingInfo = { title: string; scheduled_at: string | null };
type ChatMessage = {
  message_id: number;
  peer_id: string;
  sender_name: string;
  body: string;
  created_at: string;
};

function formatCode(code: string) {
  return `${code.slice(0, 3)} ${code.slice(3, 7)} ${code.slice(7)}`;
}

// srcObject cannot be set as a JSX attribute, so a tiny wrapper does it in an effect.
function VideoTile({
  stream,
  muted,
  width = 240,
  contain = false,
}: {
  stream: MediaStream;
  muted?: boolean;
  width?: number;
  contain?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      width={width}
      // Letterbox a 16:9 capture rather than cropping it.
      style={contain ? { objectFit: "contain", background: "#000" } : undefined}
    />
  );
}

export default function Room() {
  const router = useRouter();
  const { code } = useParams<{ code: string }>();

  const [meeting, setMeeting] = useState<MeetingInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [selfId, setSelfId] = useState("");
  const [waitingInfo, setWaitingInfo] = useState<WaitingInfo | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [remoteCameraStreams, setRemoteCameraStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [peerStates, setPeerStates] = useState<Record<string, PeerState>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [unread, setUnread] = useState(0);
  const [passcode, setPasscode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [locked, setLocked] = useState(false);
  const [knocks, setKnocks] = useState<Knock[]>([]);
  const [inWaitingRoom, setInWaitingRoom] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  // Camera and screen are separate connections per peer. A screen connection
  // is created from nothing when a share starts, so it has no negotiation
  // state to collide with and the sharer is unambiguously the offerer.
  const cameraPcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const screenPcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Queues are split the same way: applying a screen candidate to a camera
  // connection fails, and the failure looks exactly like a dead network path.
  const pendingCameraRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const pendingScreenRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const startedRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors of values the socket handlers need. A render closure would hand
  // them a stale one — a peer joining after you mute would be told you are
  // unmuted, and a peer joining mid-share would get no screen.
  const mutedRef = useRef(false);
  const videoOffRef = useRef(false);
  const isSharingRef = useRef(false);
  const chatOpenRef = useRef(false);
  const messageListRef = useRef<HTMLDivElement>(null);

  const send = (message: object) =>
    socketRef.current?.send(JSON.stringify(message));

  const pcsFor = (kind: Kind) =>
    kind === "screen" ? screenPcsRef.current : cameraPcsRef.current;
  const pendingFor = (kind: Kind) =>
    kind === "screen" ? pendingScreenRef.current : pendingCameraRef.current;

  function getOrCreateCameraPc(peerId: string) {
    const existing = cameraPcsRef.current.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    } else {
      // No camera: still negotiate m-lines so this peer can receive.
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
    }
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        send({
          type: "ice-candidate",
          kind: "camera",
          target: peerId,
          payload: event.candidate.toJSON(),
        });
      }
    };
    pc.ontrack = (event) => {
      setRemoteCameraStreams((prev) => ({ ...prev, [peerId]: event.streams[0] }));
    };
    cameraPcsRef.current.set(peerId, pc);
    return pc;
  }

  function createScreenPc(peerId: string, outgoing: boolean) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        send({
          type: "ice-candidate",
          kind: "screen",
          target: peerId,
          payload: event.candidate.toJSON(),
        });
      }
    };
    if (outgoing) {
      const stream = screenStreamRef.current;
      stream?.getTracks().forEach((track) => pc.addTrack(track, stream));
    } else {
      // Receive-only by construction: a screen connection carries one
      // direction, so the answering side adds no tracks at all.
      pc.ontrack = (event) => {
        setRemoteScreenStreams((prev) => ({ ...prev, [peerId]: event.streams[0] }));
      };
    }
    screenPcsRef.current.set(peerId, pc);
    return pc;
  }

  async function offerScreenTo(peerId: string) {
    // Camera offers go to whoever was already in the room (the Phase 3 rule);
    // screen offers always come from the sharer. That asymmetry is the whole
    // reason screen gets its own connection.
    const pc = createScreenPc(peerId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: "offer", kind: "screen", target: peerId, payload: offer });
  }

  function closeScreenPeer(peerId: string) {
    screenPcsRef.current.get(peerId)?.close();
    screenPcsRef.current.delete(peerId);
    pendingScreenRef.current.delete(peerId);
    setRemoteScreenStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/meetings/${code}`).then(async (res) => {
      if (res.ok) {
        setMeeting(await res.json());
      } else if (res.status === 410) {
        setLoadError("This meeting has ended.");
      } else {
        setLoadError("No meeting found with that code.");
      }
    });

    // Prefill the name for a signed-in user, but still show the prompt.
    fetch(`${BACKEND_URL}/api/auth/me`, { credentials: "include" }).then(async (res) => {
      if (res.ok) setName((await res.json()).display_name);
    });
  }, [code]);

  useEffect(() => {
    if (!joined) return;

    // StrictMode tears effects down and re-runs them immediately in dev. The
    // cleanup below defers its teardown by a tick, so this re-run reclaims the
    // same socket instead of opening a second one.
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    async function drainCandidates(peerId: string, kind: Kind, pc: RTCPeerConnection) {
      const queued = pendingFor(kind).get(peerId);
      if (!queued) return;
      for (const candidate of queued) await pc.addIceCandidate(candidate);
      pendingFor(kind).delete(peerId);
    }

    function closePeer(peerId: string) {
      cameraPcsRef.current.get(peerId)?.close();
      cameraPcsRef.current.delete(peerId);
      pendingCameraRef.current.delete(peerId);
      setRemoteCameraStreams((prev) => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      setPeerStates((prev) => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      closeScreenPeer(peerId);
    }

    (async () => {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        // Denied or no device: joining to watch without publishing is valid.
        setMediaError("No camera or microphone — you can watch but not publish.");
      }
      // Teardown may have run while the permission prompt was open.
      if (!startedRef.current) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      localStreamRef.current = stream;
      setLocalStream(stream);

      const wsBase = BACKEND_URL!.replace(/^http/, "ws");
      const socket = new WebSocket(
        `${wsBase}/ws/${code}?name=${encodeURIComponent(name)}` +
          `&passcode=${encodeURIComponent(passcode)}`
      );
      socketRef.current = socket;

      socket.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        if (message.type === "waiting-for-host") {
          setWaitingInfo({ title: message.title, scheduled_at: message.scheduled_at });
          return;
        }

        if (message.type === "meeting-started") {
          setWaitingInfo(null);
          return;
        }

        if (message.type === "waiting-room") {
          setInWaitingRoom(true);
          return;
        }

        if (message.type === "knock") {
          setKnocks((prev) =>
            prev.some((k) => k.peer_id === message.peer_id)
              ? prev
              : [...prev, { peer_id: message.peer_id, display_name: message.display_name }]
          );
          return;
        }

        if (message.type === "locked") {
          setLocked(message.locked);
          return;
        }

        if (message.type === "meeting-ended") {
          teardown();
          setLoadError("The host ended this meeting.");
          return;
        }

        // Host controls arrive as instructions, not as state to display: the
        // local toggle does the work so the peer's own UI stays truthful.
        if (message.type === "force-mute") {
          if (!mutedRef.current) toggleMute();
          return;
        }

        if (message.type === "force-video-off") {
          if (!videoOffRef.current) toggleVideo();
          return;
        }

        if (message.type === "room-state") {
          setSelfId(message.peer_id);
          setInWaitingRoom(false);
          setIsHost(message.is_host);
          setLocked(message.locked);
          setParticipants(message.peers);
          // The newcomer never offers on camera — it only prepares a
          // connection per peer and waits.
          message.peers.forEach((p: Participant) => getOrCreateCameraPc(p.peer_id));
          return;
        }

        if (message.type === "peer-joined") {
          setParticipants((prev) => [
            ...prev,
            { peer_id: message.peer_id, display_name: message.display_name },
          ]);
          const pc = getOrCreateCameraPc(message.peer_id);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          send({ type: "offer", kind: "camera", target: message.peer_id, payload: offer });
          send({
            type: "state",
            target: message.peer_id,
            payload: { muted: mutedRef.current, videoOff: videoOffRef.current },
          });
          // Mid-share join: they need the screen as well as the camera.
          if (isSharingRef.current) await offerScreenTo(message.peer_id);
          return;
        }

        if (message.type === "offer") {
          const kind: Kind = message.kind === "screen" ? "screen" : "camera";
          const pc =
            kind === "screen"
              ? screenPcsRef.current.get(message.from) ??
                createScreenPc(message.from, false)
              : getOrCreateCameraPc(message.from);
          await pc.setRemoteDescription(message.payload);
          await drainCandidates(message.from, kind, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ type: "answer", kind, target: message.from, payload: answer });
          return;
        }

        if (message.type === "answer") {
          const kind: Kind = message.kind === "screen" ? "screen" : "camera";
          const pc = pcsFor(kind).get(message.from);
          if (!pc) return;
          await pc.setRemoteDescription(message.payload);
          await drainCandidates(message.from, kind, pc);
          return;
        }

        if (message.type === "ice-candidate") {
          const kind: Kind = message.kind === "screen" ? "screen" : "camera";
          const pc = pcsFor(kind).get(message.from);
          // Candidates routinely arrive before the description, and before the
          // screen connection exists at all.
          if (pc?.remoteDescription) {
            await pc.addIceCandidate(message.payload);
          } else {
            const queued = pendingFor(kind).get(message.from) ?? [];
            queued.push(message.payload);
            pendingFor(kind).set(message.from, queued);
          }
          return;
        }

        if (message.type === "screen-share") {
          // active:true needs no action — the sharer's offer is already coming.
          if (!message.active) closeScreenPeer(message.peer_id);
          return;
        }

        if (message.type === "chat") {
          setMessages((prev) => [...prev, message]);
          if (!chatOpenRef.current) setUnread((count) => count + 1);
          return;
        }

        if (message.type === "state") {
          setPeerStates((prev) => ({ ...prev, [message.from]: message.payload }));
          return;
        }

        if (message.type === "peer-left") {
          setParticipants((prev) => prev.filter((p) => p.peer_id !== message.peer_id));
          setKnocks((prev) => prev.filter((k) => k.peer_id !== message.peer_id));
          closePeer(message.peer_id);
        }
      };

      socket.onclose = (event) => {
        // A close follows the meeting-ended broadcast, so never overwrite a
        // reason already shown — the earlier one is the more specific.
        const reason = (text: string) => setLoadError((prev) => prev || text);
        if (event.code === 4404) reason("No meeting found with that code.");
        if (event.code === 4410) reason("This meeting has ended.");
        if (event.code === 4403) reason("This meeting is locked.");
        if (event.code === 4405) reason("You were removed from this meeting.");
        if (event.code === 4406) reason("The host did not admit you.");
        if (event.code === 4401) {
          // Retryable, unlike the others: send them back to the prompt.
          teardown();
          setJoined(false);
          setJoinError("Incorrect passcode.");
        }
      };
    })();

    // A genuine unmount lets the timer fire and tears everything down.
    return () => {
      closeTimerRef.current = setTimeout(() => {
        teardown();
        closeTimerRef.current = null;
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, code, name]);

  // Keep the newest message in view without a scroll library.
  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages, chatOpen]);

  async function startShare() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 } });
    } catch {
      // Cancelling the picker is a normal outcome: no connections, no message.
      return;
    }
    screenStreamRef.current = stream;
    isSharingRef.current = true;
    setLocalScreenStream(stream);
    setIsSharing(true);
    // Chrome's own "Stop sharing" bar ends the track without touching the app.
    stream.getVideoTracks()[0].addEventListener("ended", stopShare);

    for (const peerId of cameraPcsRef.current.keys()) await offerScreenTo(peerId);
    send({ type: "screen-share", active: true });
  }

  function stopShare() {
    screenPcsRef.current.forEach((pc) => pc.close());
    screenPcsRef.current.clear();
    pendingScreenRef.current.clear();
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    isSharingRef.current = false;
    setLocalScreenStream(null);
    setIsSharing(false);
    send({ type: "screen-share", active: false });
  }

  // Host controls. The server re-checks that the sender is the host; these
  // buttons are a convenience, not the authority.
  const hostSend = (message: object) => send(message);

  function toggleChat() {
    const next = !chatOpen;
    setChatOpen(next);
    chatOpenRef.current = next;
    if (next) setUnread(0);
  }

  function sendChat() {
    const body = chatInput.trim();
    if (!body) return;
    send({ type: "chat", body });
    setChatInput("");
  }

  function teardown() {
    cameraPcsRef.current.forEach((pc) => pc.close());
    cameraPcsRef.current.clear();
    screenPcsRef.current.forEach((pc) => pc.close());
    screenPcsRef.current.clear();
    pendingCameraRef.current.clear();
    pendingScreenRef.current.clear();
    // Without stopping tracks the camera light stays on after leaving.
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    startedRef.current = false;
    mutedRef.current = false;
    videoOffRef.current = false;
    isSharingRef.current = false;
    setMuted(false);
    setVideoOff(false);
    setIsSharing(false);
    setWaitingInfo(null);
    setLocalStream(null);
    setLocalScreenStream(null);
    setRemoteCameraStreams({});
    setRemoteScreenStreams({});
    setPeerStates({});
    setParticipants([]);
    setKnocks([]);
    setInWaitingRoom(false);
    setIsHost(false);
  }

  function broadcastState(next: { muted: boolean; videoOff: boolean }) {
    cameraPcsRef.current.forEach((_pc, peerId) =>
      send({ type: "state", target: peerId, payload: next })
    );
  }

  // Toggling `enabled` is instant and needs no renegotiation.
  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
    broadcastState({ muted: next, videoOff: videoOffRef.current });
  }

  function toggleVideo() {
    const next = !videoOffRef.current;
    videoOffRef.current = next;
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !next));
    setVideoOff(next);
    broadcastState({ muted: mutedRef.current, videoOff: next });
  }

  function leave() {
    teardown();
    router.push("/dashboard");
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(`${window.location.origin}/join/${code}`);
    setCopied(true);
  }

  if (loadError) {
    return (
      <main>
        <p>{loadError}</p>
        <a href="/dashboard">Back to dashboard</a>
      </main>
    );
  }

  if (!meeting) return <p>Loading...</p>;

  if (!joined) {
    return (
      <main>
        <h1>{meeting.title}</h1>
        <p>Hosted by {meeting.host_display_name}</p>
        <div>
          <input
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {meeting.passcode_required && (
          <div>
            <input
              type="password"
              placeholder="Meeting passcode"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
            />
          </div>
        )}
        <button
          onClick={() => {
            setJoinError("");
            setJoined(true);
          }}
          disabled={!name.trim() || (meeting.passcode_required && !passcode)}
        >
          Join
        </button>
        {joinError && <p>{joinError}</p>}
      </main>
    );
  }

  if (inWaitingRoom) {
    return (
      <main>
        <h1>{meeting.title}</h1>
        <p>Waiting for the host to let you in.</p>
        <button onClick={leave}>Leave</button>
      </main>
    );
  }

  if (waitingInfo) {
    return (
      <main>
        <h1>{waitingInfo.title}</h1>
        {waitingInfo.scheduled_at && (
          <p>Scheduled for {new Date(waitingInfo.scheduled_at + "Z").toLocaleString()}</p>
        )}
        <p>Waiting for the host to start this meeting.</p>
        <button onClick={leave}>Leave</button>
      </main>
    );
  }

  const remoteScreens = Object.entries(remoteScreenStreams);
  const someoneSharing = isSharing || remoteScreens.length > 0;
  const nameFor = (peerId: string) =>
    participants.find((p) => p.peer_id === peerId)?.display_name ?? "Someone";

  return (
    <main>
      <h1>{meeting.title}</h1>
      <p>Meeting code: {formatCode(meeting.meeting_code)}</p>
      <button onClick={copyInvite}>Copy invite link</button>
      {copied && <span> copied</span>}
      {mediaError && <p>{mediaError}</p>}

      {someoneSharing && (
        <div>
          {isSharing && localScreenStream && (
            <div>
              <VideoTile stream={localScreenStream} muted width={640} contain />
              <div>You are presenting</div>
            </div>
          )}
          {remoteScreens.map(([peerId, stream]) => (
            <div key={peerId}>
              <VideoTile stream={stream} width={640} contain />
              <div>{nameFor(peerId)} is presenting</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div>
          {localStream && <VideoTile stream={localStream} muted />}
          <div>
            {name} (you){muted && " [muted]"}
            {videoOff && " [video off]"}
          </div>
        </div>
        {participants.map((p) => (
          <div key={p.peer_id}>
            {remoteCameraStreams[p.peer_id] && (
              <VideoTile stream={remoteCameraStreams[p.peer_id]} />
            )}
            <div>
              {p.display_name}
              {peerStates[p.peer_id]?.muted && " [muted]"}
              {peerStates[p.peer_id]?.videoOff && " [video off]"}
            </div>
          </div>
        ))}
      </div>

      <div>
        <button onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
        <button onClick={toggleVideo}>{videoOff ? "Start Video" : "Stop Video"}</button>
        <button onClick={isSharing ? stopShare : startShare}>
          {isSharing ? "Stop sharing" : "Share screen"}
        </button>
        <button onClick={() => setParticipantsOpen(!participantsOpen)}>
          Participants ({participants.length + 1})
          {isHost && knocks.length > 0 ? ` · ${knocks.length} waiting` : ""}
        </button>
        <button onClick={toggleChat}>
          Chat{unread > 0 && !chatOpen ? ` (${unread})` : ""}
        </button>
        {isHost && (
          <button onClick={() => hostSend({ type: "end-meeting" })}>End meeting</button>
        )}
        <button onClick={leave}>Leave</button>
      </div>

      {participantsOpen && (
        <div style={{ border: "1px solid #ccc", padding: 8, maxWidth: 380 }}>
          <h2>Participants ({participants.length + 1})</h2>

          {isHost && knocks.length > 0 && (
            <div>
              <h3>Waiting room</h3>
              <ul>
                {knocks.map((k) => (
                  <li key={k.peer_id}>
                    {k.display_name}{" "}
                    <button
                      onClick={() => {
                        hostSend({ type: "admit", peer_id: k.peer_id });
                        setKnocks((prev) =>
                          prev.filter((x) => x.peer_id !== k.peer_id)
                        );
                      }}
                    >
                      Admit
                    </button>{" "}
                    <button
                      onClick={() => {
                        hostSend({ type: "deny", peer_id: k.peer_id });
                        setKnocks((prev) =>
                          prev.filter((x) => x.peer_id !== k.peer_id)
                        );
                      }}
                    >
                      Deny
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul>
            <li>
              {name} (you{isHost ? ", host" : ""}){muted && " [muted]"}
              {videoOff && " [video off]"}
            </li>
            {participants.map((p) => (
              <li key={p.peer_id}>
                {p.display_name}
                {peerStates[p.peer_id]?.muted && " [muted]"}
                {peerStates[p.peer_id]?.videoOff && " [video off]"}
                {isHost && (
                  <>
                    {" "}
                    <button
                      onClick={() =>
                        setMenuFor(menuFor === p.peer_id ? null : p.peer_id)
                      }
                    >
                      More
                    </button>
                    {menuFor === p.peer_id && (
                      <span>
                        <button
                          onClick={() =>
                            hostSend({ type: "host-mute", target: p.peer_id })
                          }
                        >
                          Mute
                        </button>
                        <button
                          onClick={() =>
                            hostSend({ type: "host-stop-video", target: p.peer_id })
                          }
                        >
                          Stop Video
                        </button>
                        <button
                          onClick={() =>
                            hostSend({ type: "host-remove", target: p.peer_id })
                          }
                        >
                          Remove
                        </button>
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>

          {isHost && (
            <div>
              <h3>Host tools</h3>
              <button onClick={() => hostSend({ type: "host-mute-all" })}>
                Mute All
              </button>
              <button onClick={() => hostSend({ type: "host-stop-video-all" })}>
                Stop All Video
              </button>
              <button
                onClick={() => hostSend({ type: "host-lock", locked: !locked })}
              >
                {locked ? "Unlock meeting" : "Lock meeting"}
              </button>
            </div>
          )}
        </div>
      )}

      {chatOpen && (
        <div>
          <h2>Chat</h2>
          <div
            ref={messageListRef}
            style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #ccc" }}
          >
            {messages.map((m) => (
              <div key={m.message_id}>
                <strong>{m.sender_name}</strong>{" "}
                <small>{new Date(m.created_at + "Z").toLocaleTimeString()}</small>
                {/* Rendered as text. Never dangerouslySetInnerHTML. */}
                <div>{m.body}</div>
              </div>
            ))}
          </div>
          <input
            value={chatInput}
            placeholder="Type a message"
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendChat();
            }}
          />
          <button onClick={sendChat} disabled={!chatInput.trim()}>
            Send
          </button>
        </div>
      )}

      {locked && <p>This meeting is locked — new participants cannot join.</p>}
      {selfId && <p>peer id: {selfId}</p>}
    </main>
  );
}
