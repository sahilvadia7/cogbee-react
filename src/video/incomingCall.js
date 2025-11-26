const IncomingCall = ({ callerId, onAccept, onReject }) => {
  return (
    <div style={{ padding: 20, background: "#222", color: "#fff" }}>
      <h3>{callerId} is calling you...</h3>
      <button onClick={onAccept}>Accept</button>
      <button onClick={onReject}>Reject</button>
    </div>
  );
};

export default IncomingCall;
