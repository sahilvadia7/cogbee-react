import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

let stompClient = null;

export const connectWebSocket = (userId, onIncomingCall) => {
  const socket = new SockJS("http://localhost:8080/ws");
  
  stompClient = new Client({
    webSocketFactory: () => socket,
    reconnectDelay: 5000,
    debug: () => {}
  });

  stompClient.onConnect = () => {
    console.log("Connected");

    stompClient.subscribe(`/topic/call/${userId}`, (message) => {
      onIncomingCall(JSON.parse(message.body));
    });
  };

  stompClient.activate();
};

export const sendCall = (callerId, receiverId, roomName) => {
  stompClient.publish({
    destination: "/app/call",
    body: JSON.stringify({ callerId, receiverId, roomName })
  });
};
