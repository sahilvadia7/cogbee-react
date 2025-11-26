import { useEffect, useState } from "react";

const JitsiCall = ({ roomName, displayName, onEndCall }) => {
  const [api, setApi] = useState(null);

  useEffect(() => {
    if (!window.JitsiMeetExternalAPI) {
      console.error("JitsiMeetExternalAPI not loaded");
      return;
    }

    const domain = "meet.jit.si";

    const options = {
      roomName,
      width: "100%",
      height: "100vh",
      parentNode: document.getElementById("jitsi-container"),
      userInfo: { displayName },

      interfaceConfigOverwrite: {
        SHOW_JITSI_WATERMARK: false,
        SHOW_WATERMARK_FOR_GUESTS: false,
        DEFAULT_LOGO_URL: "https://google.com/",
        DEFAULT_WATERMARK: "https://google.com/",
        APP_NAME: "My Video Call",
        NATIVE_APP_NAME: "My App Video Call",
      },

      // 🔥 CONFIG OVERRIDES
      configOverwrite: {
        brandWatermarkLink: "https://google.com/",
        disableDeepLinking: false,
        startWithAudioMuted: false,
        startWithVideoMuted: false,
      }
    };

    const _api = new window.JitsiMeetExternalAPI(domain, options);

    // --------------------------------------------
    // 🔥 JITSI EVENT HANDLERS
    // --------------------------------------------

    // When user joins
    _api.addListener("participantJoined", (event) => {
      console.log("User joined: ", event);
    });

    // When user leaves
    _api.addListener("participantLeft", (event) => {
      console.log("User left: ", event);
    });

    // End Call Event
    _api.addListener("readyToClose", () => {
      console.log("Meeting ended");
      if (onEndCall) onEndCall();
    });

    setApi(_api);

    return () => {
      if (_api) _api.dispose();
    };
  }, [roomName]);


  // --------------------------------------------
  // ⭐ CUSTOM ACTIONS YOU CAN TRIGGER FROM UI
  // --------------------------------------------
  const muteAudio = () => api && api.executeCommand("toggleAudio");
  const muteVideo = () => api && api.executeCommand("toggleVideo");
  const openChat = () => api && api.executeCommand("toggleChat");
  const screenShare = () => api && api.executeCommand("toggleShareScreen");
  const hangup = () => api && api.executeCommand("hangup");

  // Copy link
  const shareLink = () => {
    const link = `https://meet.jit.si/${roomName}`;
    navigator.clipboard.writeText(link);
    alert("Meeting link copied!");
  };

  return (
    <div>
      {/* Custom Top Bar Buttons */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        padding: "10px",
        gap: "15px",
        background: "#111",
        color: "white"
      }}>
        <button onClick={muteAudio}>Mute</button>
        <button onClick={muteVideo}>Video</button>
        <button onClick={openChat}>Chat</button>
        <button onClick={screenShare}>Screen Share</button>
        <button onClick={shareLink}>Copy Link</button>
        <button style={{ background: "red" }} onClick={hangup}>End Call</button>
      </div>

      <div id="jitsi-container"></div>
    </div>
  );
};

export default JitsiCall;
