import React, { useEffect, useState } from "react";
import { connectWebSocket, sendCall } from "./video/websocket";
import JitsiCall from "./video/jitsiCall";
import IncomingCall from "./video/incomingCall";
import WebRTCRoom from "./WebRTCRoom";

function App() {
  const myUserId = "userA";  // Dynamic if logged-in
  const [incoming, setIncoming] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [roomName, setRoomName] = useState("");

  useEffect(() => {
    connectWebSocket(myUserId, (callData) => {
      setIncoming(callData);
    });
  }, []);

  const startCall = async (receiverId) => {
    const res = await fetch(
      `/api/video/create-room?caller=${myUserId}&receiver=${receiverId}`
    );
    const data = await res.json();
    setRoomName(data.roomName);
    setInCall(true);

    // Notify receiver
    sendCall(myUserId, receiverId, data.roomName);
  };

  const acceptCall = () => {
    setRoomName(incoming.roomName);
    setIncoming(null);
    setInCall(true);
  };

  return (
    <div>
      {!inCall && (
        <>
          <h2>Welcome {myUserId}</h2>
          <button onClick={() => startCall("userB")}>Call userB</button>
        </>
      )}

      {incoming && (
        <IncomingCall
          callerId={incoming.callerId}
          onAccept={acceptCall}
          onReject={() => setIncoming(null)}
        />
      )}

      {inCall && <JitsiCall roomName={roomName} displayName={myUserId} />}

      <WebRTCRoom/>
    </div>
  );
}

export default App;
