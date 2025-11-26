import { useEffect, useRef, useState } from "react";

export default function WebRTCRoom() {
  const localVideoRef = useRef(null);

  const sttRecorderRef = useRef(null);
  const sessionIdRef = useRef(null);

  const [roomId, setRoomId] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [myId, setMyId] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const peersRef = useRef({});

  const [remoteStreams, setRemoteStreams] = useState({});
  const [createdLink, setCreatedLink] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [transcript, setTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);

  const API_BASE = "https://delmar-drearier-arvilla.ngrok-free.dev";
  const wsRef = useRef(null);

  // NEW → interval for sending video frame chunks
  const frameIntervalRef = useRef(null);

  // --------------------------------------------------------------------
  //  HELPERS
  // --------------------------------------------------------------------
  const safeSendWS = (msg) => {
    const socket = wsRef.current;
    if (!socket) return;
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(msg));
    } catch (err) {
      console.error("WS send error:", err);
    }
  };

  const generateSecureRoomId = () => {
    if (window.crypto && window.crypto.getRandomValues) {
      const arr = new Uint32Array(4);
      window.crypto.getRandomValues(arr);
      return Array.from(arr, (v) => v.toString(36)).join("").slice(0, 12);
    }
    return Math.random().toString(36).slice(2, 14);
  };

  const closeAllPeers = () => {
    Object.values(peersRef.current).forEach((pc) => pc.close());
    peersRef.current = {};
    setRemoteStreams({});
  };

  const updateRemoteSubtitle = (peerId, text) => {
    const el = document.getElementById("sub-" + peerId);
    if (!el) return;
    if (!text) {
      el.style.display = "none";
      el.innerText = "";
      return;
    }
    el.style.display = "block";
    el.innerText = `Peer: ${text}`;
  };

  // --------------------------------------------------------------------
  //  INIT
  // --------------------------------------------------------------------
  useEffect(() => {
    let isMounted = true;

    const setupMediaThenConnectWS = async () => {
      try {
        console.log("Requesting camera/mic...");

        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        console.log("🎥 Camera/Mic ready!");

        if (!isMounted) return;

        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        console.log("Connecting WebSocket...");
        const socket = new WebSocket(`${API_BASE.replace("https", "wss")}/signal`);
        wsRef.current = socket;

        socket.onopen = () => {
          console.log("🔥 WS OPEN AFTER MEDIA READY");
          const params = new URLSearchParams(window.location.search);
          const r = params.get("room");
          if (r) joinRoom(r, socket);
        };

        socket.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          handleSocket(data);
        };

        socket.onerror = console.error;
        socket.onclose = () => console.log("WS closed");
      } catch (err) {
        console.error("❌ Media init error:", err);
      }
    };

    setupMediaThenConnectWS();

    return () => {
      isMounted = false;
      if (wsRef.current) wsRef.current.close();
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      closeAllPeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------------------------------------------------------------------
  //  CAPTURE FRAME + SEND FRAME CHUNKS
  // --------------------------------------------------------------------
  const captureFrame = () => {
    try {
      const video = localVideoRef.current;
      if (!video) return null;

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0);

      return canvas.toDataURL("image/jpeg", 0.7);
    } catch (e) {
      console.error("Frame capture error:", e);
      return null;
    }
  };

  const sendFrameChunk = async () => {
  if (!sessionIdRef.current) return;

  const base64 = captureFrame();
  if (!base64) return;

  try {
    await fetch(`${API_BASE}/api/interview/frame-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionIdRef.current,
        frame: base64
      })
    });

    console.log("📤 Compressed frame sent");
  } catch (err) {
    console.error("Frame upload error:", err);
  }
};


  // --------------------------------------------------------------------
  //  SOCKET HANDLING
  // --------------------------------------------------------------------
  const handleSocket = async (data) => {
    switch (data.type) {
      case "id":
        setMyId(data.id);
        break;

      case "peers":
        for (const peerId of data.peers) {
          if (peerId) createPeer(peerId, true);
        }
        break;

      case "new_peer":
        if (data.peerId !== myId) createPeer(data.peerId, false);
        break;

      case "offer":
        await handleOffer(data);
        break;

      case "answer":
        await handleAnswer(data);
        break;

      case "candidate":
        await handleCandidate(data);
        break;

      case "leave":
        removeVideo(data.from);
        break;

      default:
        console.warn("Unknown:", data);
    }
  };

  // --------------------------------------------------------------------
  //  ROOM CONTROL
  // --------------------------------------------------------------------
  const createRoom = () => {
    const id = generateSecureRoomId();
    const link = `${window.location.origin}${window.location.pathname}?room=${id}`;
    setCreatedLink(link);
    setRoomId(id);
  };

  const joinRoom = (id, socket = wsRef.current) => {
    if (!id.trim()) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    setRoomId(id);
    safeSendWS({ type: "join", roomId: id });

    const link = `${window.location.origin}${window.location.pathname}?room=${id}`;
    setShareLink(link);
    setIsJoined(true);
  };

  // --------------------------------------------------------------------
  // WEBRTC
  // --------------------------------------------------------------------
  const createPeer = async (peerId, isCaller) => {
    if (!peerId) return;

    if (peersRef.current[peerId]) return;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    peersRef.current[peerId] = pc;

    // attach local tracks
    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        safeSendWS({
          type: "candidate",
          candidate: e.candidate,
          to: peerId,
          from: myId,
        });
      }
    };

    pc.ontrack = (e) => {
      const [stream] = e.streams;
      if (stream) {
        setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        removeVideo(peerId);
      }
    };

    if (isCaller) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      safeSendWS({ type: "offer", offer, to: peerId, from: myId });
    }
  };

  const handleOffer = async (data) => {
    const pc = peersRef.current[data.from];
    if (!pc) return;

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    safeSendWS({ type: "answer", answer, to: data.from, from: myId });
  };

  const handleAnswer = async (data) => {
    const pc = peersRef.current[data.from];
    if (!pc) return;

    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  };

  const handleCandidate = async (data) => {
    const pc = peersRef.current[data.from];
    if (!pc) return;
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  };

  const removeVideo = (peerId) => {
    setRemoteStreams((prev) => {
      const copy = { ...prev };
      delete copy[peerId];
      return copy;
    });

    if (peersRef.current[peerId]) {
      peersRef.current[peerId].close();
      delete peersRef.current[peerId];
    }
  };

  // --------------------------------------------------------------------
  //  START RECORDING = AUDIO + FRAME STREAMING
  // --------------------------------------------------------------------
  const startRecording = async () => {
    if (isRecording) return;

    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const recorder = new MediaRecorder(audioStream, {
        mimeType: "audio/webm;codecs=opus",
      });

      sttRecorderRef.current = recorder;
      sessionIdRef.current =
        Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

      setIsRecording(true);

      // 🔥 Start sending video frames every 5 seconds
      frameIntervalRef.current = setInterval(() => {
        sendFrameChunk();
      }, 5000);

      recorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
          const buf = await e.data.arrayBuffer();

          await fetch(
            `${API_BASE}/api/interview/answer-chunk?sessionId=${encodeURIComponent(
              sessionIdRef.current
            )}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/octet-stream" },
              body: buf,
            }
          );
        }
      };

      recorder.onstop = () => {
        audioStream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(1000);
    } catch (err) {
      console.error("Error starting recording:", err);
    }
  };

  // --------------------------------------------------------------------
  //  STOP RECORDING
  // --------------------------------------------------------------------
  const stopRecording = async () => {
    // stop sending video frames
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }

    if (sttRecorderRef.current?.state !== "inactive") {
      sttRecorderRef.current.stop();
    }

    setIsRecording(false);

    try {
      const res = await fetch(
        `${API_BASE}/api/interview/answer-finish?sessionId=${encodeURIComponent(
          sessionIdRef.current
        )}`,
        { method: "POST" }
      );

      const data = await res.json();
      if (data?.transcript) setTranscript(data.transcript);
    } catch (err) {
      console.error("Error finishing:", err);
    }
  };

  // --------------------------------------------------------------------
  //  UI
  // --------------------------------------------------------------------
  return (
    <div style={{ padding: 20 }}>
      <h2>Multi-User WebRTC</h2>

      <button onClick={createRoom}>Create Room</button>
      {createdLink && (
        <div style={{ background: "#eee", padding: 10, marginTop: 10 }}>
          Room Created:
          <br />
          <b>{createdLink}</b>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <input
          placeholder="Enter Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          disabled={isJoined}
        />
        <button onClick={() => joinRoom(roomId)} disabled={isJoined || !roomId.trim()}>
          {isJoined ? "Joined" : "Join Room"}
        </button>
      </div>

      {shareLink && (
        <div style={{ background: "#eee", padding: 10, marginTop: 10 }}>
          Invite: <b>{shareLink}</b>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <button onClick={startRecording} disabled={isRecording}>
          Start Answer
        </button>

        <button onClick={stopRecording} disabled={!isRecording} style={{ marginLeft: 10 }}>
          Stop Answer
        </button>
      </div>

      <h3>Transcript</h3>
      <pre style={{ background: "#fff", padding: 10, borderRadius: 6 }}>
        {transcript}
      </pre>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
          gap: 10,
          marginTop: 20,
        }}
      >
        {/* Local video */}
        <div
          style={{
            border: "1px solid #333",
            padding: 8,
            borderRadius: 10,
            background: "#111",
            color: "white",
          }}
        >
          <div>You</div>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            style={{ width: "100%", borderRadius: 6 }}
          />
        </div>

        {/* Remote videos */}
        {Object.entries(remoteStreams).map(([peerId, stream]) => (
          <div
            key={peerId}
            style={{
              border: "1px solid #333",
              padding: 8,
              borderRadius: 10,
              background: "#111",
              color: "white",
            }}
          >
            <div>Peer: {peerId.substring(0, 6)}</div>

            <video
              autoPlay
              playsInline
              style={{ width: "100%", borderRadius: 6 }}
              ref={(el) => {
                if (el && el.srcObject !== stream) el.srcObject = stream;
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
