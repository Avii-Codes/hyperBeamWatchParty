import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const clientDistPath = join(__dirname, '../client/dist');

const app = express();
const server = createServer(app);
// Only handle WS upgrades on the /ws path so it doesn't conflict with Vite HMR
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

const PORT = process.env.PORT || 3000;
const HYPERBEAM_API_KEY = process.env.HYPERBEAM_API_KEY;
const MAX_ROOMS = parseInt(process.env.MAX_ROOMS || '2');
const HYPERBEAM_API = 'https://engine.hyperbeam.com/v0/vm';

// In-memory room store
// rooms[roomId] = { id, name, embedUrl, sessionId, adminToken, createdAt, users: Set, messages: [] }
const rooms = new Map();

// WebSocket clients
// clients[ws] = { roomId, username }
const clients = new Map();

app.use(cors());
app.use(express.json());

// ─── REST API ─────────────────────────────────────────────────────────────────

// GET /api/rooms — list active rooms (id + name + user count)
app.get('/api/rooms', (req, res) => {
  const list = [...rooms.values()].map(r => ({
    id: r.id,
    name: r.name,
    userCount: r.users.size,
    createdAt: r.createdAt,
  }));
  res.json({ rooms: list, maxRooms: MAX_ROOMS });
});

// POST /api/rooms — create a new room
app.post('/api/rooms', async (req, res) => {
  if (rooms.size >= MAX_ROOMS) {
    return res.status(429).json({ error: `Max ${MAX_ROOMS} rooms allowed. Delete an existing room first.` });
  }

  if (!HYPERBEAM_API_KEY || HYPERBEAM_API_KEY === 'your_hyperbeam_api_key_here') {
    return res.status(500).json({ error: 'Server not configured: missing HYPERBEAM_API_KEY in .env' });
  }

  const { name } = req.body;
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: 'Room name is required.' });
  }

  try {
    // Create HyperBeam session
    const hbRes = await fetch(HYPERBEAM_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HYPERBEAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://www.youtube.com',
        timeout: {
          offline: 300,  // destroy after 5 min of no one connected
        },
      }),
    });

    if (!hbRes.ok) {
      const err = await hbRes.text();
      console.error('HyperBeam error:', hbRes.status, err);
      return res.status(502).json({ error: `HyperBeam API error: ${hbRes.status}` });
    }

    const hbData = await hbRes.json();
    const roomId = generateId();

    const room = {
      id: roomId,
      name: name.trim().slice(0, 40),
      embedUrl: hbData.embed_url,
      sessionId: hbData.session_id,
      adminToken: hbData.admin_token,
      createdAt: new Date().toISOString(),
      users: new Set(),
      messages: [],
    };

    rooms.set(roomId, room);
    console.log(`[Room] Created "${room.name}" (${roomId})`);

    res.json({ id: roomId, name: room.name, embedUrl: room.embedUrl });
  } catch (err) {
    console.error('Create room error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/rooms/:id — get room info (embed URL) for joining
app.get('/api/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found or has expired.' });
  res.json({
    id: room.id,
    name: room.name,
    embedUrl: room.embedUrl,
    userCount: room.users.size,
    createdAt: room.createdAt,
    messages: room.messages.slice(-50), // last 50 messages
  });
});

// DELETE /api/rooms/:id — destroy a room
app.delete('/api/rooms/:id', async (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found.' });

  // Terminate HyperBeam session
  try {
    await fetch(`${HYPERBEAM_API}/${room.sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${HYPERBEAM_API_KEY}` },
    });
  } catch (e) {
    console.warn('Could not terminate HB session:', e.message);
  }

  // Notify clients in room
  broadcastToRoom(room.id, {
    type: 'room_closed',
    message: 'This room has been closed by the host.',
  });

  rooms.delete(room.id);
  console.log(`[Room] Deleted "${room.name}" (${room.id})`);
  res.json({ success: true });
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

wss.on('connection', (ws, req) => {
  clients.set(ws, { roomId: null, username: null });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const client = clients.get(ws);

    switch (msg.type) {

      case 'join': {
        const room = rooms.get(msg.roomId);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found.' }));
          return;
        }
        const username = sanitize(msg.username);
        client.roomId = msg.roomId;
        client.username = username;
        room.users.add(username);

        // Send chat history
        ws.send(JSON.stringify({ type: 'history', messages: room.messages.slice(-50) }));

        // Notify room
        broadcastToRoom(room.id, {
          type: 'user_joined',
          username,
          userCount: room.users.size,
        });

        console.log(`[WS] ${username} joined "${room.name}"`);
        break;
      }

      case 'chat': {
        if (!client.roomId || !client.username) return;
        const room = rooms.get(client.roomId);
        if (!room) return;

        const text = sanitize(msg.text, 500);
        if (!text) return;

        const chatMsg = {
          type: 'chat',
          username: client.username,
          text,
          ts: Date.now(),
        };

        room.messages.push(chatMsg);
        if (room.messages.length > 200) room.messages.shift();

        broadcastToRoom(room.id, chatMsg);
        break;
      }

      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      }
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client?.roomId && client?.username) {
      const room = rooms.get(client.roomId);
      if (room) {
        room.users.delete(client.username);
        broadcastToRoom(room.id, {
          type: 'user_left',
          username: client.username,
          userCount: room.users.size,
        });
        console.log(`[WS] ${client.username} left "${room.name}"`);
      }
    }
    clients.delete(ws);
  });

  ws.on('error', (err) => console.error('[WS] Error:', err.message));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function broadcastToRoom(roomId, data) {
  const payload = JSON.stringify(data);
  for (const [ws, client] of clients) {
    if (client.roomId === roomId && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function sanitize(str = '', maxLen = 60) {
  return String(str).replace(/[<>]/g, '').trim().slice(0, maxLen);
}

// ─── Static Files (Production Single-Server Deploy) ───────────────────────────

if (existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/ws') return next();
    res.sendFile(join(clientDistPath, 'index.html'));
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n🎬  WatchParty server running on http://localhost:${PORT}`);
  if (!HYPERBEAM_API_KEY || HYPERBEAM_API_KEY === 'your_hyperbeam_api_key_here') {
    console.warn('⚠️  HYPERBEAM_API_KEY not set — copy .env.example to .env and add your key!');
  }
});
