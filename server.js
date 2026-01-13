// server.js - WebRTC Signaling Server (FIXED)
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store active rooms and their participants
const rooms = new Map();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, uptime: process.uptime() });
});

// Root endpoint to prevent 404
app.get('/', (req, res) => {
  res.json({ 
    status: 'Video Call Signaling Server',
    version: '1.0.1',
    rooms: rooms.size,
    uptime: process.uptime()
  });
});

// Create room endpoint (for Calendly integration later)
app.post('/api/create-room', (req, res) => {
  const roomId = generateRoomId();
  rooms.set(roomId, new Set());
  
  res.json({
    roomId,
    url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}?room=${roomId}`
  });
});

function generateRoomId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

wss.on('connection', (ws) => {
  console.log('New client connected');
  let currentRoom = null;
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received:', data.type, 'for room:', data.room);
      
      switch(data.type) {
        case 'join':
          handleJoin(ws, data.room);
          currentRoom = data.room;
          break;
          
        case 'offer':
          console.log('Broadcasting offer to room:', data.room);
          broadcastToRoom(data.room, data, ws);
          break;
          
        case 'answer':
          console.log('Broadcasting answer to room:', data.room);
          broadcastToRoom(data.room, data, ws);
          break;
          
        case 'ice-candidate':
          console.log('Broadcasting ICE candidate to room:', data.room);
          broadcastToRoom(data.room, data, ws);
          break;
          
        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
    if (currentRoom) {
      leaveRoom(ws, currentRoom);
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

function handleJoin(ws, roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  
  const room = rooms.get(roomId);
  const isInitiator = room.size === 0;
  
  room.add(ws);
  ws.roomId = roomId;
  
  console.log(`Client joined room ${roomId}. Room size: ${room.size}, Initiator: ${isInitiator}`);
  
  // Notify the client whether they should initiate the connection
  ws.send(JSON.stringify({
    type: 'ready',
    initiator: isInitiator,
    roomSize: room.size
  }));
  
  // If there's already someone in the room, notify them too
  if (room.size > 1) {
    console.log(`Notifying other peers in room ${roomId}`);
    broadcastToRoom(roomId, { 
      type: 'ready', 
      initiator: false,
      roomSize: room.size 
    }, ws);
  }
}

function broadcastToRoom(roomId, data, sender) {
  if (!rooms.has(roomId)) {
    console.log(`Room ${roomId} not found for broadcast`);
    return;
  }
  
  const room = rooms.get(roomId);
  let sentCount = 0;
  
  room.forEach(client => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
      sentCount++;
    }
  });
  
  console.log(`Broadcasted ${data.type} to ${sentCount} clients in room ${roomId}`);
}

function leaveRoom(ws, roomId) {
  if (!rooms.has(roomId)) return;
  
  const room = rooms.get(roomId);
  room.delete(ws);
  
  console.log(`Client left room ${roomId}. Room size: ${room.size}`);
  
  if (room.size === 0) {
    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted (empty)`);
  } else {
    // Notify remaining participants
    broadcastToRoom(roomId, { type: 'peer-left' }, ws);
  }
}

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`WebSocket server ready`);
});
