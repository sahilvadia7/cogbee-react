import { useEffect, useRef, useState } from "react";

export default function WebRTCRoom() {
  const localVideoRef = useRef(null);
  const videosRef = useRef(null);

  const sttRecorderRef = useRef(null);
  const sessionIdRef = useRef(null);

  const [roomId, setRoomId] = useState("");
  const [myId, setMyId] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const peersRef = useRef({});

  const [createdLink, setCreatedLink] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [transcript, setTranscript] = useState("");

  const [isRecording, setIsRecording] = useState(false);

  const API_BASE = "https://delmar-drearier-arvilla.ngrok-free.dev";
  const wsRef = useRef(null);

  // ------------------------------------------------------------
  //  HELPERS
  // ------------------------------------------------------------
  const safeSendWS = (msg) => {
    const socket = wsRef.current;
    if (!socket) return;
    if (socket.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not open, cannot send:", msg);
      return;
    }
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

  const stopLocalStream = () => {
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
  };

  const closeAllPeers = () => {
    Object.values(peersRef.current).forEach((pc) => {
      try {
        pc.close();
      } catch (e) {
        console.error("Error closing peer:", e);
      }
    });
    peersRef.current = {};
  };

  // ------------------------------------------------------------
  //  INIT
  // ------------------------------------------------------------
  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const initialRoom = params.get("room") || "";
        if (!roomId) {
          setRoomId(initialRoom);
        }

        // Avoid multiple WS creation (React StrictMode)
        if (wsRef.current) return;

        const socket = new WebSocket(
          "wss://delmar-drearier-arvilla.ngrok-free.dev/signal"
        );
        wsRef.current = socket;

        socket.onopen = () => {
          console.log("WS connected");
          if (initialRoom) {
            console.log("Auto-joining room from URL:", initialRoom);
            joinRoom(initialRoom, socket);
          }
        };

        socket.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            console.log("WS message:", data);
            handleSocket(data, socket);
          } catch (e) {
            console.error("Invalid WS message:", e);
          }
        };

        socket.onerror = (err) => {
          console.error("WS error:", err);
        };

        socket.onclose = () => {
          console.log("WS closed");
        };

        // Get user media
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Init error (media or WS):", err);
      }
    };

    init();

    return () => {
      isMounted = false;

      try {
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
      } catch (e) {
        console.error("Error closing WS:", e);
      }

      if (sttRecorderRef.current && sttRecorderRef.current.state !== "inactive") {
        sttRecorderRef.current.stop();
      }

      stopLocalStream();
      closeAllPeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------
  //  SOCKET
  // ------------------------------------------------------------
  const handleSocket = async (data, socket) => {
    if (!data || typeof data !== "object") return;

    switch (data.type) {
      case "id": {
        if (typeof data.id === "string") {
          console.log("My ID from server:", data.id);
          setMyId(data.id);
        }
        break;
      }

      // List of peers already in the room (when *you* join)
      case "peers": {
        if (Array.isArray(data.peers)) {
          console.log("Existing peers in room:", data.peers);
          for (const peerId of data.peers) {
            if (!peerId) continue;
            await createPeer(peerId, true, socket); // we are the caller
          }
        }
        break;
      }

      // A new peer joined after you — server notifies you
      case "new_peer": {
        const peerId = data.peerId;
        console.log("New peer joined:", peerId);
        if (peerId && !peersRef.current[peerId]) {
          await createPeer(peerId, true, socket); // existing user calls new peer
        }
        break;
      }

      case "offer":
        await handleOffer(data, socket);
        break;

      case "answer":
        await handleAnswer(data);
        break;

      case "candidate":
        await handleCandidate(data);
        break;

      case "leave":
        if (data.from) {
          console.log("Peer left:", data.from);
          removeVideo(data.from);
        }
        break;

      default:
        console.warn("Unknown message type:", data.type);
    }
  };

  // ------------------------------------------------------------
  //  ROOM
  // ------------------------------------------------------------
  const createRoom = () => {
    const id = generateSecureRoomId();
    const link = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(
      id
    )}`;
    setCreatedLink(link);
    setRoomId(id);
    console.log("Room created:", id);
  };

  const joinRoom = (id, socket = wsRef.current) => {
    const trimmed = (id || "").trim();
    if (!trimmed) {
      console.warn("Room ID required");
      return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn("Cannot join, WS not open");
      return;
    }

    console.log("Joining room:", trimmed);
    setRoomId(trimmed);

    safeSendWS({ type: "join", roomId: trimmed });

    const link = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(
      trimmed
    )}`;
    setShareLink(link);
  };

  // ------------------------------------------------------------
  //  WEBRTC
  // ------------------------------------------------------------
  const createPeer = async (peerId, isCaller, socket = wsRef.current) => {
    if (!peerId) return;

    if (peersRef.current[peerId]) {
      console.log("Peer already exists:", peerId);
      return;
    }

    console.log("Creating RTCPeerConnection for:", peerId, "caller:", isCaller);

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    peersRef.current[peerId] = pc;

    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log("Sending ICE candidate to", peerId);
        safeSendWS({
          type: "candidate",
          candidate: e.candidate,
          to: peerId,
          from: myId,
        });
      }
    };

    pc.ontrack = (e) => {
      const [remoteStream] = e.streams;
      if (remoteStream) {
        console.log("Received remote stream from", peerId);
        addRemoteVideo(peerId, remoteStream);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("Connection state with", peerId, ":", pc.connectionState);
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        console.warn("Peer disconnected/failed:", peerId);
        removeVideo(peerId);
      }
    };

    if (isCaller) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        console.log("Sending offer to", peerId);
        safeSendWS({
          type: "offer",
          offer,
          to: peerId,
          from: myId,
        });
      } catch (err) {
        console.error("Error creating offer:", err);
      }
    }
  };

  const handleOffer = async (data, socket = wsRef.current) => {
    const peerId = data?.from;
    const offer = data?.offer;
    if (!peerId || !offer) return;

    if (!peersRef.current[peerId]) {
      console.log("Creating peer for incoming offer from", peerId);
      await createPeer(peerId, false, socket);
    }

    const pc = peersRef.current[peerId];
    if (!pc) return;

    try {
      console.log("Setting remote description (offer) from", peerId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      console.log("Sending answer to", peerId);
      safeSendWS({
        type: "answer",
        answer,
        to: peerId,
        from: myId,
      });
    } catch (err) {
      console.error("Error handling offer:", err);
    }
  };

  const handleAnswer = async (data) => {
    const peerId = data?.from;
    const answer = data?.answer;
    if (!peerId || !answer) return;

    const pc = peersRef.current[peerId];
    if (!pc) return;

    try {
      console.log("Setting remote description (answer) from", peerId);
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error("Error setting remote answer:", err);
    }
  };

  const handleCandidate = async (data) => {
    const peerId = data?.from;
    const candidate = data?.candidate;
    if (!peerId || !candidate) return;

    const pc = peersRef.current[peerId];
    if (!pc) return;

    try {
      console.log("Adding ICE candidate from", peerId);
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error("Error adding ICE candidate:", err);
    }
  };

  const addRemoteVideo = (peerId, stream) => {
    if (!videosRef.current) return;
    let el = document.getElementById("video-" + peerId);

    if (!el) {
      el = document.createElement("video");
      el.id = "video-" + peerId;
      el.autoplay = true;
      el.playsInline = true;
      el.style.width = "100%";
      el.style.background = "#000";
      videosRef.current.appendChild(el);
    }
    el.srcObject = stream;
  };

  const removeVideo = (peerId) => {
    const el = document.getElementById("video-" + peerId);
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }

    const pc = peersRef.current[peerId];
    if (pc) {
      try {
        pc.close();
      } catch (e) {
        console.error("Error closing peer:", e);
      }
    }
    delete peersRef.current[peerId];
  };

  // ------------------------------------------------------------
  //  AUDIO STT RECORDING
  // ------------------------------------------------------------
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

      recorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
          try {
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
          } catch (err) {
            console.error("Error sending audio chunk:", err);
          }
        }
      };

      recorder.onstop = () => {
        audioStream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(1000);
      console.log("🎙 Recording Started:", sessionIdRef.current);
    } catch (err) {
      console.error("Error starting recording (mic permission?):", err);
    }
  };

  const stopRecording = async () => {
    if (!sttRecorderRef.current) {
      console.error("Recorder not found!");
      return;
    }

    try {
      if (sttRecorderRef.current.state !== "inactive") {
        sttRecorderRef.current.stop();
      }
    } catch (e) {
      console.error("Error stopping recorder:", e);
    }

    setIsRecording(false);

    try {
      const res = await fetch(
        `${API_BASE}/api/interview/answer-finish?sessionId=${encodeURIComponent(
          sessionIdRef.current
        )}`,
        {
          method: "POST",
        }
      );

      if (!res.ok) {
        console.error("Finish STT failed:", res.status);
        return;
      }

      const data = await res.json();
      if (data?.transcript) {
        setTranscript(data.transcript);
      }
    } catch (err) {
      console.error("Error finishing transcription:", err);
    }
  };

  // ------------------------------------------------------------
  //  UI
  // ------------------------------------------------------------
  return (
    <div style={{ padding: 20 }}>
      <h2>Multi-User WebRTC Demo</h2>

      <button onClick={createRoom}>Create Room</button>
      {createdLink && (
        <div style={{ background: "#eee", padding: 10, marginTop: 10 }}>
          Room Created! Share:
          <br />
          <b>{createdLink}</b>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <input
          placeholder="Enter Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
        />
        <button onClick={() => joinRoom(roomId)}>Join Room</button>
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

        <button
          onClick={stopRecording}
          disabled={!isRecording}
          style={{ marginLeft: 10 }}
        >
          Stop Answer
        </button>
      </div>

      <h3>Transcript</h3>
      <pre style={{ background: "#fff", padding: 10, borderRadius: 6 }}>
        {transcript}
      </pre>

      <div
        ref={videosRef}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
          gap: 10,
          marginTop: 20,
        }}
      >
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          style={{ width: "100%", background: "#000" }}
        />
      </div>
    </div>
  );
}
