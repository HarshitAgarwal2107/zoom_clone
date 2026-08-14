"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import "./meeting.css";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
// STUN alone cannot get through carrier-grade NAT — both peers end up with
// only server-reflexive candidates that neither side can reach, and ICE goes
// straight to failed. TURN relays the media instead. This is the fallback used
// when no TURN is configured or the credential fetch fails.
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

// Metered mints short-lived TURN credentials, so nothing long-lived is baked
// into the bundle. Fetched once per room and shared by every connection.
async function fetchIceServers(): Promise<RTCIceServer[]> {
  const url = process.env.NEXT_PUBLIC_METERED_API_URL;
  if (!url) {
    console.warn("[ice] NEXT_PUBLIC_METERED_API_URL unset — STUN only, no TURN relay");
    return ICE_SERVERS;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const iceServers = await res.json();
    if (!Array.isArray(iceServers) || iceServers.length === 0) {
      throw new Error("empty iceServers array");
    }
    return iceServers;
  } catch (error) {
    console.warn("[ice] TURN credential fetch failed — STUN only, no TURN relay", error);
    return ICE_SERVERS;
  }
}

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

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// srcObject cannot be set as a JSX attribute, so a tiny wrapper does it in an effect.
function VideoTile({
  stream,
  muted,
  contain = false,
  className = "",
}: {
  stream: MediaStream;
  muted?: boolean;
  contain?: boolean;
  className?: string;
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
      className={className}
      // Letterbox a 16:9 capture rather than cropping it.
      style={contain ? { objectFit: "contain", background: "#000" } : undefined}
    />
  );
}

/* ===== SVG ICONS ===== */
function MicIcon({ muted: isMuted }: { muted: boolean }) {
  if (isMuted) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="1" y1="1" x2="23" y2="23"/>
        <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/>
        <path d="M17 16.95A7 7 0 015 12"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
      <path d="M19 10v2a7 7 0 01-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  );
}

function VideoIcon({ off }: { off: boolean }) {
  if (off) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34"/>
        <line x1="23" y1="7" x2="16" y2="12"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M23 7l-7 5 7 5V7z"/>
      <rect x="1" y="5" width="15" height="14" rx="2"/>
    </svg>
  );
}

function ParticipantsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87"/>
      <path d="M16 3.13a4 4 0 010 7.75"/>
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
      <polyline points="16 6 12 2 8 6"/>
      <line x1="12" y1="2" x2="12" y2="15"/>
    </svg>
  );
}

function HostToolsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="2"/>
      <circle cx="12" cy="12" r="2"/>
      <circle cx="12" cy="19" r="2"/>
    </svg>
  );
}

function EndCallIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="6" y1="6" x2="18" y2="18"/>
      <line x1="18" y1="6" x2="6" y2="18"/>
    </svg>
  );
}

function ReactIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
    </svg>
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
  const [hostToolsOpen, setHostToolsOpen] = useState(false);
  const [endMenuOpen, setEndMenuOpen] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  // Resolved once on room entry, before any connection exists, and shared by
  // camera and screen connections alike.
  const iceServersRef = useRef<RTCIceServer[]>(ICE_SERVERS);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraPcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const screenPcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCameraRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const pendingScreenRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const startedRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    } else {
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
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
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
      pc.ontrack = (event) => {
        setRemoteScreenStreams((prev) => ({ ...prev, [peerId]: event.streams[0] }));
      };
    }
    screenPcsRef.current.set(peerId, pc);
    return pc;
  }

  async function offerScreenTo(peerId: string) {
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

    fetch(`${BACKEND_URL}/api/auth/me`, { credentials: "include" }).then(async (res) => {
      if (res.ok) setName((await res.json()).display_name);
    });
  }, [code]);

  useEffect(() => {
    if (!joined) return;

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
        setMediaError("No camera or microphone — you can watch but not publish.");
      }
      if (!startedRef.current) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Before the socket opens, because every peer connection is created in
      // response to a socket message — so this is the last moment at which no
      // connection can exist yet.
      iceServersRef.current = await fetchIceServers();
      if (!startedRef.current) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }

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
        const reason = (text: string) => setLoadError((prev) => prev || text);
        if (event.code === 4404) reason("No meeting found with that code.");
        if (event.code === 4410) reason("This meeting has ended.");
        if (event.code === 4403) reason("This meeting is locked.");
        if (event.code === 4405) reason("You were removed from this meeting.");
        if (event.code === 4406) reason("The host did not admit you.");
        if (event.code === 4401) {
          teardown();
          setJoined(false);
          setJoinError("Incorrect passcode.");
        }
      };
    })();

    return () => {
      closeTimerRef.current = setTimeout(() => {
        teardown();
        closeTimerRef.current = null;
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, code, name]);

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
      return;
    }
    screenStreamRef.current = stream;
    isSharingRef.current = true;
    setLocalScreenStream(stream);
    setIsSharing(true);
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

  const hostSend = (message: object) => send(message);

  function toggleChat() {
    const next = !chatOpen;
    setChatOpen(next);
    chatOpenRef.current = next;
    if (next) setUnread(0);
  }

  function toggleParticipants() {
    const next = !participantsOpen;
    setParticipantsOpen(next);
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
    setTimeout(() => setCopied(false), 2000);
  }

  // ===== ERROR SCREEN =====
  if (loadError) {
    return (
      <div className="meeting-error">
        <div className="meeting-error-text">{loadError}</div>
        <a href="/dashboard" className="meeting-error-link">Back to dashboard</a>
      </div>
    );
  }

  // ===== LOADING =====
  if (!meeting) {
    return (
      <div className="waiting-screen">
        <div className="waiting-spinner" />
      </div>
    );
  }

  // ===== PRE-JOIN SCREEN =====
  if (!joined) {
    return (
      <div className="meeting-prejoin">
        <div className="prejoin-card">
          <div className="prejoin-title">{meeting.title}</div>
          <div className="prejoin-subtitle">Hosted by {meeting.host_display_name}</div>
          <div className="prejoin-field">
            <input
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {meeting.passcode_required && (
            <div className="prejoin-field">
              <input
                type="password"
                placeholder="Meeting passcode"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
              />
            </div>
          )}
          <button
            className="prejoin-join-btn"
            onClick={() => {
              setJoinError("");
              setJoined(true);
            }}
            disabled={!name.trim() || (meeting.passcode_required && !passcode)}
          >
            Join
          </button>
          {joinError && <div className="prejoin-error">{joinError}</div>}
        </div>
      </div>
    );
  }

  // ===== WAITING ROOM =====
  if (inWaitingRoom) {
    return (
      <div className="waiting-screen">
        <div className="waiting-spinner" />
        <div className="waiting-title">{meeting.title}</div>
        <div className="waiting-text">Waiting for the host to let you in.</div>
        <button className="waiting-leave-btn" onClick={leave}>Leave</button>
      </div>
    );
  }

  // ===== WAITING FOR HOST =====
  if (waitingInfo) {
    return (
      <div className="waiting-screen">
        <div className="waiting-spinner" />
        <div className="waiting-title">{waitingInfo.title}</div>
        {waitingInfo.scheduled_at && (
          <div className="waiting-text">
            Scheduled for {new Date(waitingInfo.scheduled_at + "Z").toLocaleString()}
          </div>
        )}
        <div className="waiting-text">Waiting for the host to start this meeting.</div>
        <button className="waiting-leave-btn" onClick={leave}>Leave</button>
      </div>
    );
  }

  // ===== IN-MEETING VIEW =====
  const remoteScreens = Object.entries(remoteScreenStreams);
  const someoneSharing = isSharing || remoteScreens.length > 0;
  const nameFor = (peerId: string) =>
    participants.find((p) => p.peer_id === peerId)?.display_name ?? "Someone";
  const totalCount = participants.length + 1;
  const tileClass = totalCount <= 1 ? "solo" : "multi";

  return (
    <div className="meeting-layout">
      {/* ===== TOP BAR ===== */}
      <div className="meeting-topbar">
        <div className="meeting-topbar-left">
          <button className="topbar-icon-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
            </svg>
          </button>
          <button className="topbar-icon-btn chevron-only">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <span className="meeting-topbar-title">{meeting.title}</span>
        </div>
        <div className="meeting-topbar-right">
          <button className="topbar-icon-btn active" title="Encryption">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="M9 12l2 2 4-4"/>
            </svg>
          </button>
          <button className="topbar-icon-btn" onClick={copyInvite} title={copied ? "Copied!" : "Copy invite link"}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ===== MAIN AREA ===== */}
      <div className="meeting-main-content">
        {/* ===== VIDEO AREA ===== */}
        <div className="meeting-video-area">
          {mediaError && <div className="media-error-banner">{mediaError}</div>}

          {/* Local Screen Share Widget */}
          {isSharing && (
            <div className="local-screenshare-widget">
              <div className="local-screenshare-bar">
                <span className="screenshare-bar-text">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  You're screen sharing
                </span>
                <div className="screenshare-bar-actions">
                  <button className="screenshare-pause-btn">||</button>
                  <button className="screenshare-stop-btn" onClick={stopShare}>
                    <svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                    Stop Share
                  </button>
                </div>
              </div>
              {localScreenStream && (
                <div className="local-screenshare-preview">
                  <VideoTile stream={localScreenStream} muted contain />
                </div>
              )}
            </div>
          )}

          {remoteScreens.length > 0 ? (
            <div className="screenshare-layout">
              <div className="screenshare-main">
                {remoteScreens.map(([peerId, stream]) => (
                  <VideoTile key={peerId} stream={stream} contain />
                ))}
              </div>
              <div className="screenshare-sidebar">
                {localStream && (
                  <div className={`video-tile`}>
                    {videoOff ? (
                      <div className="video-tile-placeholder">{getInitials(name)}</div>
                    ) : (
                      <VideoTile stream={localStream} muted />
                    )}
                    <div className="video-tile-name">
                      {muted && <span className="video-tile-muted-icon"><MicIcon muted={true} /></span>}
                      {name}
                    </div>
                  </div>
                )}
                {participants.map((p) => (
                  <div className={`video-tile`} key={p.peer_id}>
                    {remoteCameraStreams[p.peer_id] && !peerStates[p.peer_id]?.videoOff ? (
                      <VideoTile stream={remoteCameraStreams[p.peer_id]} />
                    ) : (
                      <div className="video-tile-placeholder">{getInitials(p.display_name)}</div>
                    )}
                    <div className="video-tile-name">
                      {peerStates[p.peer_id]?.muted && <span className="video-tile-muted-icon"><MicIcon muted={true} /></span>}
                      {p.display_name}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="video-grid">
              {/* Local video */}
              <div className={`video-tile ${tileClass}`}>
                {localStream && !videoOff ? (
                  <VideoTile stream={localStream} muted />
                ) : (
                  <div className="video-tile-placeholder">{getInitials(name)}</div>
                )}
                <div className="video-tile-name">
                  {muted && <span className="video-tile-muted-icon"><MicIcon muted={true} /></span>}
                  {name}
                </div>
              </div>
              {/* Remote videos */}
              {participants.map((p) => (
                <div className={`video-tile ${tileClass}`} key={p.peer_id}>
                  {remoteCameraStreams[p.peer_id] && !peerStates[p.peer_id]?.videoOff ? (
                    <VideoTile stream={remoteCameraStreams[p.peer_id]} />
                  ) : (
                    <div className="video-tile-placeholder">{getInitials(p.display_name)}</div>
                  )}
                  <div className="video-tile-name">
                    {peerStates[p.peer_id]?.muted && <span className="video-tile-muted-icon"><MicIcon muted={true} /></span>}
                    {p.display_name}
                  </div>
                </div>
              ))}
            </div>
          )}

          {locked && (
            <div className="locked-banner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              Meeting locked
            </div>
          )}
        </div>

        {/* ===== SIDEBAR CONTAINER ===== */}
        {(participantsOpen || chatOpen) && (
          <div className="meeting-sidebar-container">
            {/* ===== PARTICIPANTS PANEL ===== */}
            {participantsOpen && (
              <div className="meeting-side-panel participants-panel">
                <div className="panel-header">
                  <span className="panel-title">Participants ({totalCount})</span>
                  <div className="panel-header-actions">
                    <button className="panel-icon-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg></button>
                    <button className="panel-icon-btn" onClick={() => setParticipantsOpen(false)}>
                      <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18"/>
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="participants-list">
                  {/* Waiting room */}
                  {isHost && knocks.length > 0 && (
                    <div className="participants-section">
                      <div className="participants-section-title">Waiting Room ({knocks.length})</div>
                      {knocks.map((k) => (
                        <div className="participant-item" key={k.peer_id}>
                          <div className="participant-info">
                            <div className="participant-avatar">{getInitials(k.display_name)}</div>
                            <span className="participant-name">{k.display_name}</span>
                          </div>
                          <div className="participant-actions">
                            <button
                              className="participant-action-btn admit"
                              onClick={() => {
                                hostSend({ type: "admit", peer_id: k.peer_id });
                                setKnocks((prev) => prev.filter((x) => x.peer_id !== k.peer_id));
                              }}
                            >Admit</button>
                            <button
                              className="participant-action-btn deny"
                              onClick={() => {
                                hostSend({ type: "deny", peer_id: k.peer_id });
                                setKnocks((prev) => prev.filter((x) => x.peer_id !== k.peer_id));
                              }}
                            >Deny</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* In meeting */}
                  <div className="participants-section">
                    <div className="participant-item">
                      <div className="participant-info">
                        <div className="participant-avatar">{getInitials(name)}</div>
                        <span className="participant-name">
                          {name}<span className="participant-role"> (Host, me)</span>
                        </span>
                      </div>
                      <div className="participant-status-icons">
                        <span className={`participant-status-icon ${muted ? "muted" : ""}`}><MicIcon muted={muted} /></span>
                        <span className={`participant-status-icon ${videoOff ? "muted" : ""}`}><VideoIcon off={videoOff} /></span>
                      </div>
                    </div>
                    {/* Others */}
                    {participants.map((p) => (
                      <div className="participant-item" key={p.peer_id}>
                        <div className="participant-info">
                          <div className="participant-avatar">{getInitials(p.display_name)}</div>
                          <span className="participant-name">{p.display_name}</span>
                        </div>
                        <div className="participant-status-icons">
                          <span className={`participant-status-icon ${peerStates[p.peer_id]?.muted ? "muted" : ""}`}><MicIcon muted={!!peerStates[p.peer_id]?.muted} /></span>
                          <span className={`participant-status-icon ${peerStates[p.peer_id]?.videoOff ? "muted" : ""}`}><VideoIcon off={!!peerStates[p.peer_id]?.videoOff} /></span>
                        </div>
                        {isHost && (
                          <div className="participant-menu">
                            <button className="participant-more-btn" onClick={() => setMenuFor(menuFor === p.peer_id ? null : p.peer_id)}>
                              <MoreIcon />
                            </button>
                            {menuFor === p.peer_id && (
                              <>
                                <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setMenuFor(null)} />
                                <div className="participant-context-menu">
                                  <button className="participant-context-item" onClick={() => { hostSend({ type: "host-mute", target: p.peer_id }); setMenuFor(null); }}>Mute</button>
                                  <button className="participant-context-item" onClick={() => { hostSend({ type: "host-stop-video", target: p.peer_id }); setMenuFor(null); }}>Stop Video</button>
                                  <button className="participant-context-item danger" onClick={() => { hostSend({ type: "host-remove", target: p.peer_id }); setMenuFor(null); }}>Remove</button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {/* Participants bottom bar */}
                <div className="participants-bottom-bar">
                  <button className="participants-bottom-btn">Invite</button>
                  {isHost && <button className="participants-bottom-btn" onClick={() => hostSend({ type: "host-mute-all" })}>Mute All</button>}
                  <button className="participants-bottom-btn">More</button>
                </div>
              </div>
            )}

            {/* ===== CHAT PANEL ===== */}
            {chatOpen && (
              <div className="meeting-side-panel chat-panel">
                <div className="panel-header">
                  <span className="panel-title">Meeting Chat</span>
                  <div className="panel-header-actions">
                    <button className="panel-icon-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg></button>
                    <button className="panel-icon-btn" onClick={toggleChat}>
                      <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18"/>
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="chat-messages" ref={messageListRef}>
                  {messages.map((m) => (
                    <div className="chat-msg" key={m.message_id}>
                      <div className="chat-msg-header">
                        <span className="chat-msg-sender">{m.sender_name}</span>
                        <span className="chat-msg-time">{new Date(m.created_at + "Z").toLocaleTimeString()}</span>
                      </div>
                      <div className="chat-msg-body">{m.body}</div>
                    </div>
                  ))}
                </div>
                <div className="chat-input-container">
                  <div className="chat-privacy-notice">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                    Who can see your messages?
                  </div>
                  <div className="chat-input-box">
                    <div className="chat-to-row">
                      <span className="chat-to-label">To:</span>
                      <button className="chat-to-pill">Everyone <span>▾</span></button>
                    </div>
                    <textarea
                      className="chat-textarea"
                      value={chatInput}
                      placeholder="Type message here ..."
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendChat();
                        }
                      }}
                    />
                    <div className="chat-input-toolbar">
                      <div className="chat-input-tools-left">
                        <button className="chat-tool-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></button>
                        <button className="chat-tool-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></button>
                        <button className="chat-tool-btn"><MoreIcon /></button>
                      </div>
                      <button className="chat-send-btn-icon" onClick={sendChat} disabled={!chatInput.trim()}>
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== BOTTOM TOOLBAR ===== */}
      <div className="meeting-toolbar">
        <div className="toolbar-left">
          {/* Mute Split Button */}
          <div className="toolbar-btn-group">
            <button className={`toolbar-btn muted-btn split-left ${muted ? "is-muted" : ""}`} onClick={toggleMute} title={muted ? "Unmute" : "Mute"}>
              <MicIcon muted={muted} />
              <span className="toolbar-btn-label">{muted ? "Unmute" : "Mute"}</span>
            </button>
            <button className="toolbar-btn split-right">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
          </div>

          {/* Video Split Button */}
          <div className="toolbar-btn-group">
            <button className={`toolbar-btn video-btn split-left ${videoOff ? "is-muted" : ""}`} onClick={toggleVideo} title={videoOff ? "Start Video" : "Stop Video"}>
              <VideoIcon off={videoOff} />
              <span className="toolbar-btn-label">{videoOff ? "Start Video" : "Stop Video"}</span>
            </button>
            <button className="toolbar-btn split-right">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
          </div>
        </div>

        <div className="toolbar-center">
          {/* Participants */}
          <button className={`toolbar-btn ${participantsOpen ? "active" : ""}`} onClick={toggleParticipants}>
            <ParticipantsIcon />
            <span className="toolbar-btn-label">
              Participants
            </span>
            <div className="toolbar-chevron">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
            </div>
            {(knocks.length > 0 && isHost) && (
              <span className="toolbar-badge">{knocks.length}</span>
            )}
          </button>

          {/* Chat */}
          <button className={`toolbar-btn ${chatOpen ? "active" : ""}`} onClick={toggleChat}>
            <ChatIcon />
            <span className="toolbar-btn-label">Chat</span>
            {unread > 0 && !chatOpen && (
              <span className="toolbar-badge">{unread}</span>
            )}
          </button>

          {/* React */}
          <button className="toolbar-btn">
            <ReactIcon />
            <span className="toolbar-btn-label">React</span>
          </button>

          {/* Share */}
          <button
            className={`toolbar-btn share-btn`}
            onClick={isSharing ? stopShare : startShare}
          >
            <div className="share-icon-wrapper">
              <ShareIcon />
            </div>
            <span className="toolbar-btn-label">Share Screen</span>
            <div className="toolbar-chevron">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
            </div>
          </button>

          {/* Host tools */}
          {isHost && (
            <div style={{ position: "relative" }}>
              <button
                className={`toolbar-btn ${hostToolsOpen ? "active" : ""}`}
                onClick={() => setHostToolsOpen(!hostToolsOpen)}
              >
                <HostToolsIcon />
                <span className="toolbar-btn-label">Host tools</span>
              </button>
              {hostToolsOpen && (
                <>
                  <div className="dropdown-backdrop" onClick={() => setHostToolsOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 150 }} />
                  <div className="host-tools-dropdown">
                    <button className="host-tools-dropdown-item" onClick={() => { hostSend({ type: "host-lock", locked: !locked }); setHostToolsOpen(false); }}>
                      <span className="host-tools-dropdown-check">{locked ? "✓" : ""}</span>
                      Lock Meeting
                    </button>
                    <button className="host-tools-dropdown-item">
                      <span className="host-tools-dropdown-check">✓</span>
                      Enable waiting room
                    </button>
                    <button className="host-tools-dropdown-item">
                      <span className="host-tools-dropdown-check"></span>
                      Hide profile pictures
                    </button>
                    
                    <div className="host-tools-dropdown-divider" />
                    
                    <div className="host-tools-dropdown-title">Allow participants to:</div>
                    <button className="host-tools-dropdown-item">
                      <span className="host-tools-dropdown-check"></span>
                      Share Screen
                    </button>
                    <button className="host-tools-dropdown-item">
                      <span className="host-tools-dropdown-check">✓</span>
                      Chat
                    </button>
                    <button className="host-tools-dropdown-item">
                      <span className="host-tools-dropdown-check">✓</span>
                      Rename Themselves
                    </button>
                    <button className="host-tools-dropdown-item">
                      <span className="host-tools-dropdown-check">✓</span>
                      Unmute Themselves
                    </button>
                    <button className="host-tools-dropdown-item">
                      <span className="host-tools-dropdown-check">✓</span>
                      Start Video
                    </button>
                    <button className="host-tools-dropdown-item">
                      <span className="host-tools-dropdown-check">✓</span>
                      Share Whiteboards
                    </button>
                    <button className="host-tools-dropdown-item">
                      <span className="host-tools-dropdown-check">✓</span>
                      Transcribe in My Notes
                    </button>
                    
                    <div className="host-tools-dropdown-divider" />
                    <button className="host-tools-dropdown-item danger" onClick={() => { hostSend({ type: "end-meeting" }); setHostToolsOpen(false); }}>
                      Suspend Participant Activities
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* More */}
          <button className="toolbar-btn">
            <MoreIcon />
            <span className="toolbar-btn-label">More</span>
          </button>
        </div>

        <div className="toolbar-right" style={{ position: "relative" }}>
          {endMenuOpen && (
            <>
              <div className="dropdown-backdrop" onClick={() => setEndMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 150 }} />
              <div className="end-meeting-menu">
                {isHost && (
                  <button className="end-meeting-btn red" onClick={() => { hostSend({ type: "end-meeting" }); setEndMenuOpen(false); }}>
                    End Meeting for All
                  </button>
                )}
                <button className="end-meeting-btn grey" onClick={() => { leave(); setEndMenuOpen(false); }}>
                  Leave Meeting
                </button>
                <div className="end-meeting-cancel-row">
                  <button className="end-meeting-cancel-btn" onClick={() => setEndMenuOpen(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </>
          )}

          {/* End / Leave */}
          <button className="toolbar-btn end-call-btn" onClick={() => setEndMenuOpen(!endMenuOpen)} title={isHost ? "End meeting" : "Leave"}>
            <div className="end-icon-square">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="6" y1="6" x2="18" y2="18"/>
                <line x1="18" y1="6" x2="6" y2="18"/>
              </svg>
            </div>
            <span className="toolbar-btn-label">End</span>
          </button>
        </div>
      </div>

    </div>
  );
}
