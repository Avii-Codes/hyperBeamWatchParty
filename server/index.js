import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import 'dotenv/config';
import { searchYouTube, getSuggestions, fetchVideoTitle } from './ytSearch.js';
import { isCommandOrAiTrigger, handleAiCommand } from './aiAgent.js';

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
// Max 2 concurrent Hyperbeam VM sessions
const MAX_HB_SESSIONS = parseInt(process.env.MAX_HB_SESSIONS || process.env.MAX_ROOMS || '2');
const HYPERBEAM_API = 'https://engine.hyperbeam.com/v0/vm';

// In-memory room store:
// rooms[roomId] = {
//   id, name, source: 'drawer' | 'youtube' | 'hyperbeam',
//   sessionId, embedUrl, adminToken,
//   ytState: { videoId, isPlaying, time, lastUpdate },
//   createdAt, users: Set, messages: [], emptyTimeout: timer
// }
const rooms = new Map();

// WebSocket clients: clients[ws] = { roomId, username }
const clients = new Map();
// Grace period timers for temporary disconnects: key = `${roomId}:${username}`
const pendingDepartures = new Map();

app.use(cors());
app.use(express.json());

// ─── Hyperbeam Pool Helpers ───────────────────────────────────────────────────

function getActiveHbCount() {
  let count = 0;
  for (const r of rooms.values()) {
    if (r.sessionId && r.source === 'hyperbeam') count++;
  }
  return count;
}

async function createHbSession() {
  if (!HYPERBEAM_API_KEY || HYPERBEAM_API_KEY === 'your_hyperbeam_api_key_here') {
    throw new Error('Server missing HYPERBEAM_API_KEY in .env');
  }

  const hbRes = await fetch(HYPERBEAM_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HYPERBEAM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: 'https://www.youtube.com',
      timeout: { offline: 300 }, // destroy after 5 min of no one connected
    }),
  });

  if (!hbRes.ok) {
    const err = await hbRes.text();
    console.error('HyperBeam error:', hbRes.status, err);
    throw new Error(`HyperBeam API returned error ${hbRes.status}`);
  }

  return await hbRes.json();
}

async function terminateHbSession(room) {
  if (room && room.sessionId) {
    const sid = room.sessionId;
    room.sessionId = null;
    room.embedUrl = null;
    room.adminToken = null;
    try {
      await fetch(`${HYPERBEAM_API}/${sid}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${HYPERBEAM_API_KEY}` },
      });
      console.log(`[HyperBeam] Terminated VM session for room "${room.name}"`);
    } catch (e) {
      console.warn('Could not terminate HB session:', e.message);
    }
  }
}

function getCalculatedYtState(room) {
  let currentTime = room.ytState.time || 0;
  if (room.ytState.isPlaying) {
    currentTime += (Date.now() - room.ytState.lastUpdate) / 1000;
  }
  return {
    videoId: room.ytState.videoId,
    isPlaying: room.ytState.isPlaying,
    time: Math.max(0, currentTime),
  };
}

// ─── REST API ─────────────────────────────────────────────────────────────────

// GET /api/rooms — list rooms + Hyperbeam slot availability
app.get('/api/rooms', (req, res) => {
  const activeHb = getActiveHbCount();
  const list = [...rooms.values()].map(r => ({
    id: r.id,
    name: r.name,
    source: r.source,
    hasHyperbeam: Boolean(r.sessionId),
    userCount: r.users.size,
    createdAt: r.createdAt,
  }));
  res.json({
    rooms: list,
    hyperbeam: {
      active: activeHb,
      max: MAX_HB_SESSIONS,
      available: Math.max(0, MAX_HB_SESSIONS - activeHb),
    },
  });
});

// POST /api/rooms — create a new room (no source chosen upfront; starts in drawer/launcher)
app.post('/api/rooms', async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: 'Room name is required.' });
  }

  const roomId = generateId();
  const room = {
    id: roomId,
    name: name.trim().slice(0, 40),
    creator: (req.body.username && sanitize(req.body.username, 30)) || null,
    source: 'drawer', // Starts in App Drawer so user selects YouTube or Hyperbeam inside room!
    embedUrl: null,
    sessionId: null,
    adminToken: null,
    ytState: {
      videoId: '4xDzrJKXOOY', // Default: Synthwave Lofi stream
      isPlaying: false,
      time: 0,
      lastUpdate: Date.now(),
    },
    createdAt: new Date().toISOString(),
    users: new Set(),
    messages: [],
    queue: [],
    emptyTimeout: null,
  };

  rooms.set(roomId, room);
  console.log(`[Room] Created "${room.name}" (${roomId})`);

  res.json({
    id: roomId,
    name: room.name,
    creator: room.creator || null,
    source: room.source,
  });
});

// GET /api/rooms/:id — get full room info + live slot availability
app.get('/api/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found or has expired.' });

  const activeHb = getActiveHbCount();
  res.json({
    id: room.id,
    name: room.name,
    creator: room.creator || null,
    source: room.source,
    embedUrl: room.embedUrl,
    userCount: room.users.size,
    users: [...room.users],
    createdAt: room.createdAt,
    messages: room.messages.slice(-50),
    queue: room.queue || [],
    ytState: getCalculatedYtState(room),
    hyperbeam: {
      active: activeHb,
      max: MAX_HB_SESSIONS,
      available: Math.max(0, MAX_HB_SESSIONS - activeHb),
      canSwitchToHb: Boolean(room.sessionId) || activeHb < MAX_HB_SESSIONS,
    },
  });
});

// GET /api/yt/search?q=... — Free YouTube video search
app.get('/api/yt/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ videos: [] });
  try {
    const videos = await searchYouTube(q, 8);
    res.json({ videos });
  } catch (err) {
    console.error('[API] /yt/search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/yt/suggest?q=... — Free live YouTube search autocompletions
app.get('/api/yt/suggest', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ suggestions: [] });
  try {
    const suggestions = await getSuggestions(q);
    res.json({ suggestions });
  } catch (err) {
    res.json({ suggestions: [] });
  }
});

// POST /api/rooms/:id/switch-mode — select YouTube, Hyperbeam, or return to App Drawer
app.post('/api/rooms/:id/switch-mode', async (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found.' });

  const targetSource = req.body.source; // 'hyperbeam' | 'youtube' | 'drawer'

  if (targetSource === room.source) {
    const activeHb = getActiveHbCount();
    return res.json({
      success: true,
      source: room.source,
      embedUrl: room.embedUrl,
      ytState: getCalculatedYtState(room),
      hyperbeam: {
        active: activeHb,
        max: MAX_HB_SESSIONS,
        available: Math.max(0, MAX_HB_SESSIONS - activeHb),
        canSwitchToHb: Boolean(room.sessionId) || activeHb < MAX_HB_SESSIONS,
      },
    });
  }

  if (targetSource === 'hyperbeam') {
    // Needs a Hyperbeam VM session
    if (!room.sessionId) {
      const activeHb = getActiveHbCount();
      if (activeHb >= MAX_HB_SESSIONS) {
        return res.status(409).json({
          error: `All ${MAX_HB_SESSIONS} Hyperbeam virtual browser slots are currently in use by other rooms.`,
        });
      }
      try {
        const hbData = await createHbSession();
        room.sessionId = hbData.session_id;
        room.embedUrl = hbData.embed_url;
        room.adminToken = hbData.admin_token;
      } catch (err) {
        return res.status(502).json({ error: err.message });
      }
    }
    room.source = 'hyperbeam';
    broadcastToRoom(room.id, {
      type: 'mode_changed',
      source: 'hyperbeam',
      embedUrl: room.embedUrl,
    });
  } else if (targetSource === 'youtube') {
    // Switched to YouTube: terminate Hyperbeam VM immediately to free slot for other rooms!
    await terminateHbSession(room);
    room.source = 'youtube';
    broadcastToRoom(room.id, {
      type: 'mode_changed',
      source: 'youtube',
      ytState: getCalculatedYtState(room),
    });
  } else if (targetSource === 'drawer') {
    // Return to App Drawer
    // If was on Hyperbeam, release VM so other rooms can use it while in drawer
    await terminateHbSession(room);
    room.source = 'drawer';
    broadcastToRoom(room.id, {
      type: 'mode_changed',
      source: 'drawer',
    });
  }

  console.log(`[Room] "${room.name}" switched mode to: ${room.source}`);
  const activeHb = getActiveHbCount();
  res.json({
    success: true,
    source: room.source,
    embedUrl: room.embedUrl,
    ytState: getCalculatedYtState(room),
    hyperbeam: {
      active: activeHb,
      max: MAX_HB_SESSIONS,
      available: Math.max(0, MAX_HB_SESSIONS - activeHb),
    },
  });
});

// DELETE /api/rooms/:id — destroy a room
app.delete('/api/rooms/:id', async (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found.' });

  if (room.emptyTimeout) clearTimeout(room.emptyTimeout);
  await terminateHbSession(room);

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

  ws.on('message', async (raw) => {
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

        // Cancel inactive room deletion timer if active
        if (room.emptyTimeout) {
          clearTimeout(room.emptyTimeout);
          room.emptyTimeout = null;
        }

        const username = sanitize(msg.username);
        client.roomId = msg.roomId;
        client.username = username;

        const depKey = `${room.id}:${username}`;
        const wasReconnecting = pendingDepartures.has(depKey);
        if (wasReconnecting) {
          clearTimeout(pendingDepartures.get(depKey));
          pendingDepartures.delete(depKey);
        }

        const isNewJoin = !room.users.has(username) || !wasReconnecting;
        room.users.add(username);

        const activeHb = getActiveHbCount();

        // Send history & initial state
        ws.send(JSON.stringify({
          type: 'history',
          messages: room.messages.slice(-50),
          source: room.source,
          embedUrl: room.embedUrl,
          ytState: getCalculatedYtState(room),
          queue: room.queue || [],
          users: [...room.users],
          hyperbeam: {
            active: activeHb,
            max: MAX_HB_SESSIONS,
            available: Math.max(0, MAX_HB_SESSIONS - activeHb),
          },
        }));

        // Notify room if genuinely new join
        if (isNewJoin) {
          broadcastToRoom(room.id, {
            type: 'user_joined',
            username,
            userCount: room.users.size,
            users: [...room.users],
          });
          console.log(`[WS] ${username} joined "${room.name}" (${room.users.size} viewers)`);
        }
        break;
      }

      case 'chat': {
        if (!client.roomId || !client.username) return;
        const room = rooms.get(client.roomId);
        if (!room) return;

        const text = sanitize(msg.text, 500);
        if (!text) return;

        const msgId = msg.id || generateId();
        const chatMsg = {
          id: msgId,
          type: 'chat',
          username: client.username,
          text,
          replyTo: msg.replyTo && typeof msg.replyTo === 'object' ? {
            id: sanitize(msg.replyTo.id, 32),
            username: sanitize(msg.replyTo.username, 32),
            text: sanitize(msg.replyTo.text, 120),
          } : null,
          ts: Date.now(),
        };

        room.messages.push(chatMsg);
        if (room.messages.length > 200) room.messages.shift();

        broadcastToRoom(room.id, chatMsg);

        // Check if message targets Discord slash commands or pseudo-AI (@ai / @bot)
        if (isCommandOrAiTrigger(text)) {
          handleAiCommand({
            room,
            client,
            rawText: text,
            userMsgId: msgId,
            broadcastToRoom,
            addSystemMessage,
          }).catch(err => console.error('[AI] Handler error:', err));
        }
        break;
      }

      case 'reaction': {
        if (!client.roomId) return;
        const emoji = typeof msg.emoji === 'string' ? sanitize(msg.emoji, 16) : null;
        if (!emoji) return;
        broadcastToRoom(client.roomId, {
          type: 'reaction',
          username: client.username,
          emoji,
        });
        break;
      }

      // YouTube Sync Events: play, pause, seek, change_video
      case 'yt_action': {
        if (!client.roomId || !client.username) return;
        const room = rooms.get(client.roomId);
        if (!room || room.source !== 'youtube') return;

        const { action, time, videoId, wasPlaying } = msg;

        if (action === 'change_video') {
          const cleanVid = sanitize(videoId, 64);
          if (!cleanVid) return;
          room.ytState.videoId = cleanVid;
          room.ytState.time = 0;
          room.ytState.isPlaying = true;
          room.ytState.lastUpdate = Date.now();

          broadcastToRoom(room.id, {
            type: 'yt_sync',
            action: 'change_video',
            videoId: cleanVid,
            username: client.username,
          });

          addSystemMessage(room, `${client.username} loaded a new video 🎬`);
        } else if (action === 'seek') {
          const seekTime = typeof time === 'number' ? Math.max(0, time) : 0;
          const shouldResume = Boolean(wasPlaying);

          room.ytState.time = seekTime;
          room.ytState.isPlaying = shouldResume;
          room.ytState.lastUpdate = Date.now();

          broadcastToRoom(room.id, {
            type: 'yt_sync',
            action: 'seek',
            time: seekTime,
            wasPlaying: shouldResume,
            username: client.username,
          });
        } else if (action === 'play') {
          room.ytState.isPlaying = true;
          room.ytState.time = typeof time === 'number' ? Math.max(0, time) : 0;
          room.ytState.lastUpdate = Date.now();

          // Exclude sender to prevent echo feedback loop on local play
          broadcastToRoom(room.id, {
            type: 'yt_sync',
            action: 'play',
            time: room.ytState.time,
            username: client.username,
          }, ws);
        } else if (action === 'pause') {
          room.ytState.isPlaying = false;
          room.ytState.time = typeof time === 'number' ? Math.max(0, time) : 0;
          room.ytState.lastUpdate = Date.now();

          // Exclude sender to prevent echo feedback loop on local pause
          broadcastToRoom(room.id, {
            type: 'yt_sync',
            action: 'pause',
            time: room.ytState.time,
            username: client.username,
          }, ws);
        } else if (action === 'queue_add') {
          const cleanVid = sanitize(videoId, 64);
          if (!cleanVid) return;
          if (!room.queue) room.queue = [];

          let title = sanitize(msg.title, 100);
          if (!title || title.startsWith('YouTube (')) {
            const resolved = await fetchVideoTitle(cleanVid);
            if (resolved) title = resolved;
          }
          if (!title) title = `YouTube (${cleanVid})`;

          const item = {
            id: generateId(),
            videoId: cleanVid,
            title,
            addedBy: client.username,
          };
          room.queue.push(item);
          broadcastToRoom(room.id, {
            type: 'yt_queue_update',
            queue: room.queue,
            addedItem: item,
            username: client.username,
          });
          addSystemMessage(room, `${client.username} added "${title}" to queue 📋`);
        } else if (action === 'queue_remove') {
          if (!room.queue) room.queue = [];
          const index = room.queue.findIndex(q => q.id === msg.itemId);
          if (index !== -1) {
            room.queue.splice(index, 1);
            broadcastToRoom(room.id, {
              type: 'yt_queue_update',
              queue: room.queue,
              username: client.username,
            });
          }
        } else if (action === 'queue_play_next') {
          if (!room.queue) room.queue = [];
          if (room.lastQueueAdvance && (Date.now() - room.lastQueueAdvance < 2500)) {
            return; // Prevent duplicate rapid skip triggers from multiple clients
          }
          if (room.queue.length > 0) {
            room.lastQueueAdvance = Date.now();
            const nextItem = room.queue.shift();
            room.ytState.videoId = nextItem.videoId;
            room.ytState.time = 0;
            room.ytState.isPlaying = true;
            room.ytState.lastUpdate = Date.now();
            broadcastToRoom(room.id, {
              type: 'yt_sync',
              action: 'change_video',
              videoId: nextItem.videoId,
              username: client.username,
            });
            broadcastToRoom(room.id, {
              type: 'yt_queue_update',
              queue: room.queue,
              username: client.username,
            });
            addSystemMessage(room, `Playing next in queue: ${nextItem.title || nextItem.videoId} 🎬`);
          }
        } else if (action === 'queue_play_item') {
          if (!room.queue) room.queue = [];
          const index = room.queue.findIndex(q => q.id === msg.itemId);
          if (index !== -1) {
            const [item] = room.queue.splice(index, 1);
            room.ytState.videoId = item.videoId;
            room.ytState.time = 0;
            room.ytState.isPlaying = true;
            room.ytState.lastUpdate = Date.now();
            broadcastToRoom(room.id, {
              type: 'yt_sync',
              action: 'change_video',
              videoId: item.videoId,
              username: client.username,
            });
            broadcastToRoom(room.id, {
              type: 'yt_queue_update',
              queue: room.queue,
              username: client.username,
            });
            addSystemMessage(room, `Playing from queue: ${item.title || item.videoId} 🎬`);
          }
        } else if (action === 'queue_clear') {
          room.queue = [];
          broadcastToRoom(room.id, {
            type: 'yt_queue_update',
            queue: room.queue,
            username: client.username,
          });
          addSystemMessage(room, `${client.username} cleared the video queue 🧹`);
        }
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
    clients.delete(ws);
    if (client?.roomId && client?.username) {
      const room = rooms.get(client.roomId);
      if (room) {
        const depKey = `${room.id}:${client.username}`;
        if (pendingDepartures.has(depKey)) {
          clearTimeout(pendingDepartures.get(depKey));
        }

        // Grace period before announcing departure to absorb quick idle reconnects
        const timer = setTimeout(() => {
          pendingDepartures.delete(depKey);
          const isStillConnected = [...clients.values()].some(c => c.roomId === room.id && c.username === client.username);
          if (!isStillConnected) {
            room.users.delete(client.username);
            broadcastToRoom(room.id, {
              type: 'user_left',
              username: client.username,
              userCount: room.users.size,
              users: [...room.users],
            });
            console.log(`[WS] ${client.username} left "${room.name}" (${room.users.size} remaining)`);

            // If room is now empty, schedule auto-deletion in 5 minutes
            if (room.users.size === 0) {
              console.log(`[Room] "${room.name}" is now empty. Auto-cleanup scheduled in 5 minutes.`);
              if (room.emptyTimeout) clearTimeout(room.emptyTimeout);
              room.emptyTimeout = setTimeout(async () => {
                if (room.users.size === 0) {
                  await terminateHbSession(room);
                  rooms.delete(room.id);
                  console.log(`[Room] Deleted inactive room "${room.name}" and released resources.`);
                }
              }, 5 * 60 * 1000);
            }
          }
        }, 3500);

        pendingDepartures.set(depKey, timer);
      }
    }
  });

  ws.on('error', (err) => console.error('[WS] Error:', err.message));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function broadcastToRoom(roomId, data, excludeWs = null) {
  const payload = JSON.stringify(data);
  for (const [ws, client] of clients) {
    if (client.roomId === roomId && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function addSystemMessage(room, text) {
  const sysMsg = {
    type: 'chat',
    username: 'System',
    text,
    ts: Date.now(),
    isSystem: true,
  };
  room.messages.push(sysMsg);
  if (room.messages.length > 200) room.messages.shift();
  broadcastToRoom(room.id, sysMsg);
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
  console.log(`\n🎬  WatchBeam server running on http://localhost:${PORT}`);
  console.log(`⚡  Hyperbeam Max VM Concurrency: ${MAX_HB_SESSIONS}`);
  if (!HYPERBEAM_API_KEY || HYPERBEAM_API_KEY === 'your_hyperbeam_api_key_here') {
    console.warn('⚠️  HYPERBEAM_API_KEY not set — Hyperbeam rooms disabled, YouTube Sync fully active!');
  }
});
