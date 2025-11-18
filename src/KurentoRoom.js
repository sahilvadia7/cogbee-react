import { useEffect, useRef, useState } from "react";

export default function KurentoRoom() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);

  const iceBufferRef = useRef([]);
  const joinedConfirmedRef = useRef(false);

  const [roomId, setRoomId] = useState("");
  const [isJoined, setIsJoined] = useState(false);

  useEffect(() => {
    const init = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      localStreamRef.current = stream;
      localVideoRef.current.srcObject = stream;

      const ws = new WebSocket(
        "wss://delmar-drearier-arvilla.ngrok-free.dev/kurento~"
      );
      wsRef.current = ws;

      ws.onopen = () => console.log("WS OPEN");

      ws.onclose = () => console.log("WS CLOSED");

      ws.onmessage = async (msg) => {
        const data = JSON.parse(msg.data);
        console.log("WS MSG:", data);

        if (data.type === "id") {
          console.log("Connected with ID:", data.id);
        }

        if (data.type === "joined") {
          console.log("JOIN CONFIRMED ✔️");
          joinedConfirmedRef.current = true;
          await createPeerAndSendOffer();
        }

        if (data.type === "answer") {
          await pcRef.current.setRemoteDescription({
            type: "answer",
            sdp: data.answer,
          });

          iceBufferRef.current.forEach((c) => {
            pcRef.current.addIceCandidate(c);
          });
          iceBufferRef.current = [];
        }

        if (data.type === "candidate") {
          const cand = new RTCIceCandidate(data.candidate);

          if (!pcRef.current || !pcRef.current.remoteDescription) {
            console.log("⏳ Buffer ICE");
            iceBufferRef.current.push(cand);
            return;
          }

          pcRef.current.addIceCandidate(cand);
        }
      };
    };

    init();
  }, []);

  const joinRoom = () => {
    const ws = wsRef.current;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log("WS NOT READY → retry…");
      setTimeout(joinRoom, 300);
      return;
    }

    console.log("SENDING JOIN");
    ws.send(JSON.stringify({ type: "join", roomId }));
    setIsJoined(true);
  };

  const createPeerAndSendOffer = async () => {
    if (!joinedConfirmedRef.current) {
      console.error("❌ Backend not ready → blocking offer");
      return;
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pcRef.current = pc;

    localStreamRef.current.getTracks().forEach((t) =>
      pc.addTrack(t, localStreamRef.current)
    );

    pc.ontrack = (e) => {
      remoteVideoRef.current.srcObject = e.streams[0];
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        wsRef.current.send(
          JSON.stringify({
            type: "candidate",
            candidate: {
              candidate: e.candidate.candidate,
              sdpMid: e.candidate.sdpMid,
              sdpMLineIndex: e.candidate.sdpMLineIndex,
            },
          })
        );
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    wsRef.current.send(
      JSON.stringify({
        type: "offer",
        offer: offer.sdp,
      })
    );
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Kurento Room</h2>

      <input
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
        placeholder="Room ID"
      />

      <button onClick={joinRoom} disabled={isJoined}>
        Join Room
      </button>

      <h3>Local</h3>
      <video ref={localVideoRef} autoPlay muted width={300} />

      <h3>Remote</h3>
      <video ref={remoteVideoRef} autoPlay width={300} />
    </div>
  );
}
