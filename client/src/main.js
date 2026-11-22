import './style.css';
import { getUsername, setUsername, formatTime, getRoomUrl, escHtml, copyToClipboard, toast, extractYouTubeId } from './utils.js';
import { RoomSocket } from './socket.js';

// ─── App state ────────────────────────────────────────────────────────────────
let currentView = 'home'; // 'home' | 'room'
let roomSocket = null;
let currentRoom = null;   // { id, name, source, embedUrl, ytState, hyperbeam }
let unreadCount = 0;
let chatOpen = true;
let activeSidebarTab = 'chat'; // 'chat' | 'queue'

// YouTube player instance & sync state
let ytPlayer = null;
let ytPlayerReady = false;
let isApplyingRemoteSync = false;
let seekDebounceTimer = null;
let resumeTimer = null;
let seekCheckInterval = null;
let lastKnownTime = 0;
let lastKnownTimestamp = Date.now();

// Track active Hyperbeam availability from server
let currentHbInfo = { active: 0, max: 2, available: 2 };

// ─── Curated Animated Emoji Whitelist & Reactions ─────────────────────────────
const ANIMATED_EMOJI_WHITELIST = {
  '🔥': '1f525',
  '😂': '1f602',
  '❤️': '2764_fe0f',
  '❤': '2764_fe0f',
  '😱': '1f631',
  '👏': '1f44f',
  '🎉': '1f389',
  '😭': '1f62d',
  '💀': '1f480',
  '👍': '1f44d',
  '👋': '1f44b',
  '🍿': '1f37f'
};

const QUICK_REACTIONS = [
  { emoji: '🔥', hex: '1f525' },
  { emoji: '😂', hex: '1f602' },
  { emoji: '❤️', hex: '2764_fe0f' },
  { emoji: '😱', hex: '1f631' },
  { emoji: '👏', hex: '1f44f' },
  { emoji: '🎉', hex: '1f389' },
  { emoji: '😭', hex: '1f62d' },
  { emoji: '💀', hex: '1f480' },
];

const EMOJI_WHITELIST_KEYS = Object.keys(ANIMATED_EMOJI_WHITELIST).sort((a, b) => b.length - a.length);

const ICON_JOIN = `<img class="system-animated-emoji" src="https://fonts.gstatic.com/s/e/notoemoji/latest/1f389/512.webp" alt="🎉" />`;
const ICON_LEAVE = `<img class="system-animated-emoji" src="https://fonts.gstatic.com/s/e/notoemoji/latest/1f44b/512.webp" alt="👋" />`;
const ICON_STAGE = `<img class="system-animated-emoji" src="https://fonts.gstatic.com/s/e/notoemoji/latest/1f37f/512.webp" alt="🍿" />`;
const ICON_PLAY = `<svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
const ICON_PAUSE = `<svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const ICON_SEEK = `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const ICON_INFO = `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

// ─── Router ───────────────────────────────────────────────────────────────────
function getUrlRoom() {
  return new URL(location.href).searchParams.get('room');
}

function navigate(view, roomId = null) {
  const url = new URL(location.href);
  if (view === 'room' && roomId) {
    url.searchParams.set('room', roomId);
  } else {
    url.searchParams.delete('room');
  }
  history.pushState({ view, roomId }, '', url);
  render(view, roomId);
}

window.addEventListener('popstate', (e) => {
  const { view, roomId } = e.state || {};
  if (view === 'room' && roomId) render('room', roomId);
  else render('home');
});

// ─── API helpers ──────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Unknown error');
  return data;
}

// ─── Time Helper ──────────────────────────────────────────────────────────────
function formatSeconds(sec = 0) {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem < 10 ? '0' : ''}${rem}`;
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render(view, roomId = null) {
  currentView = view;
  document.getElementById('app').innerHTML = view === 'home' ? renderHome() : renderRoom();

  if (view === 'home') {
    initHome();
  } else if (view === 'room' && roomId) {
    initRoom(roomId);
  }
}

// ─── HOME VIEW ────────────────────────────────────────────────────────────────
function renderHome() {
  const username = getUsername();
  const avatarLetter = username ? username[0].toUpperCase() : '?';
  return `
  <div id="view-home">
    <nav class="home-nav">
      <div class="home-logo">
        <div class="logo-icon">🎬</div>
        <span>WatchBeam</span>
      </div>
      <div class="nav-user">
        ${username
          ? `<span class="text-muted text-sm hide-xs">Watching as</span>
             <div class="nav-avatar" title="${escHtml(username)}">${escHtml(avatarLetter)}</div>
             <strong class="text-sm">${escHtml(username)}</strong>
             <button class="btn btn-ghost btn-sm" id="btn-change-username">Change</button>`
          : `<button class="btn btn-ghost btn-sm" id="btn-set-username">Set username</button>`
        }
      </div>
    </nav>

    <div class="home-hero">
      <div class="hero-glow"></div>
      <div class="hero-badge">
        <span class="badge badge-purple"><span class="dot dot-pulse"></span> YouTube Sync & Hyperbeam Cloud Browser</span>
      </div>
      <h1 class="hero-title">Watch together,<br><span class="grad-text">anywhere.</span></h1>
      <p class="hero-sub">Create a room and invite friends. Watch YouTube videos in sync with zero lag, or browse any website together in a cloud browser.</p>
      <div class="hero-actions">
        <button class="btn btn-primary" id="btn-create-room">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          Create a Room
        </button>
        <button class="btn btn-ghost" id="btn-join-link">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          Join via Link
        </button>
      </div>
    </div>

    <div class="rooms-section" id="rooms-section">
      <div class="slots-banner" id="slots-banner">
        <div class="slots-item">
          <span class="badge badge-cyan">🔴 YouTube Sync</span>
          <span class="text-muted">Unlimited Rooms • 0 Lag • 1080p/4K</span>
        </div>
        <div class="slots-item" id="hb-status-pill">
          <span class="badge badge-purple">🌐 Hyperbeam Browser</span>
          <span class="text-muted" id="hb-slot-text">Checking capacity…</span>
        </div>
      </div>

      <div class="section-header">
        <h2 class="section-title">Active Rooms</h2>
        <button class="btn btn-ghost btn-sm" id="btn-refresh-rooms">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
          Refresh
        </button>
      </div>
      <div id="rooms-list" class="rooms-grid">
        <div class="rooms-empty">
          <div class="spinner" style="margin:0 auto 12px"></div>
          <p>Loading rooms…</p>
        </div>
      </div>
    </div>

    <div class="feature-strip">
      <div class="feature-item"><span class="feature-icon">🔴</span> YouTube Sync (Zero-lag playback)</div>
      <div class="feature-item"><span class="feature-icon">🌐</span> Hyperbeam VM (Multiplayer browser)</div>
      <div class="feature-item"><span class="feature-icon">💬</span> Live text chat</div>
      <div class="feature-item"><span class="feature-icon">📱</span> Fully responsive & Fullscreen</div>
    </div>
  </div>`;
}

function initHome() {
  loadRooms();

  document.getElementById('btn-create-room')?.addEventListener('click', () => {
    ensureUsername(() => showCreateRoomModal());
  });

  document.getElementById('btn-join-link')?.addEventListener('click', showJoinModal);
  document.getElementById('btn-refresh-rooms')?.addEventListener('click', loadRooms);
  document.getElementById('btn-change-username')?.addEventListener('click', showUsernameModal);
  document.getElementById('btn-set-username')?.addEventListener('click', showUsernameModal);
}

async function loadRooms() {
  const list = document.getElementById('rooms-list');
  const hbSlotText = document.getElementById('hb-slot-text');
  if (!list) return;
  list.innerHTML = `<div class="rooms-empty"><div class="spinner" style="margin:0 auto 12px"></div><p>Loading rooms…</p></div>`;

  try {
    const data = await api('/rooms');
    const { rooms = [], hyperbeam = { active: 0, max: 2, available: 2 } } = data;
    currentHbInfo = hyperbeam;

    if (hbSlotText) {
      if (hyperbeam.available > 0) {
        hbSlotText.innerHTML = `<strong>${hyperbeam.active}/${hyperbeam.max}</strong> in use (<span style="color:var(--green)">${hyperbeam.available} slot available</span>)`;
      } else {
        hbSlotText.innerHTML = `<strong>${hyperbeam.active}/${hyperbeam.max}</strong> in use (<span style="color:var(--yellow)">Slots Full</span>)`;
      }
    }

    if (rooms.length === 0) {
      list.innerHTML = `
        <div class="rooms-empty" style="grid-column:1/-1">
          <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8"/><path d="M12 3v4"/></svg>
          <p style="font-weight:600;margin-bottom:4px">No active rooms</p>
          <p class="text-sm text-muted">Create a room to start watching together.</p>
        </div>`;
      return;
    }

    list.innerHTML = rooms.map(r => {
      let badge = `<span class="badge badge-cyan">🔴 YouTube Sync</span>`;
      if (r.source === 'hyperbeam') {
        badge = `<span class="badge badge-purple">🌐 Hyperbeam Browser</span>`;
      } else if (r.source === 'drawer') {
        badge = `<span class="badge badge-green">📱 App Launcher</span>`;
      }

      return `
      <div class="room-card" data-room-id="${escHtml(r.id)}">
        <div class="room-card-top">
          <span class="room-card-name">${escHtml(r.name)}</span>
          <span class="badge badge-${r.userCount > 0 ? 'green' : 'cyan'}">
            <span class="dot"></span>
            ${r.userCount} watching
          </span>
        </div>
        <div class="flex items-center gap-2" style="position:relative">
          ${badge}
        </div>
        <div class="room-card-meta">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Created ${new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div class="room-card-actions">
          <button class="btn btn-primary btn-sm btn-join-room" data-room-id="${escHtml(r.id)}">Join Room</button>
          <button class="btn btn-ghost btn-sm btn-copy-room" data-room-id="${escHtml(r.id)}" title="Copy invite link">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy
          </button>
          <button class="btn btn-danger btn-sm btn-delete-room" data-room-id="${escHtml(r.id)}" title="Delete room">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
      </div>`;
    }).join('');

    // Bind events
    list.querySelectorAll('.btn-join-room').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const roomId = btn.dataset.roomId;
        ensureUsername(() => navigate('room', roomId));
      });
    });

    list.querySelectorAll('.btn-copy-room').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const url = getRoomUrl(btn.dataset.roomId);
        const ok = await copyToClipboard(url);
        toast(ok ? 'Link copied to clipboard!' : 'Could not copy. URL: ' + url, ok ? 'success' : 'error');
      });
    });

    list.querySelectorAll('.btn-delete-room').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const roomId = btn.dataset.roomId;
        showConfirm('Delete Room', 'This will close the room for all viewers. Continue?', async () => {
          try {
            await api(`/rooms/${roomId}`, { method: 'DELETE' });
            toast('Room deleted.', 'success');
            loadRooms();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      });
    });

  } catch (err) {
    list.innerHTML = `<div class="rooms-empty" style="grid-column:1/-1"><p style="color:var(--red)">${escHtml(err.message)}</p></div>`;
  }
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function showModal(html) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  return backdrop;
}

function showUsernameModal(onSuccess = null) {
  const username = getUsername();
  const backdrop = showModal(`
    <div class="username-logo">👤</div>
    <div class="modal-title" style="text-align:center">Your Display Name</div>
    <div class="modal-desc" style="text-align:center">This name is shown in chat. Stored locally on your device.</div>
    <div class="form-group">
      <label class="form-label" for="inp-username">Username</label>
      <input class="form-input" id="inp-username" type="text" placeholder="e.g. MovieFan42"
        value="${escHtml(username)}" maxlength="30" autocomplete="off" />
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Save & Continue</button>
    </div>
  `);

  const inp = backdrop.querySelector('#inp-username');
  inp.focus();
  inp.select();

  backdrop.querySelector('#modal-cancel').onclick = () => backdrop.remove();
  backdrop.querySelector('#modal-save').onclick = () => saveUsername(backdrop, inp, onSuccess);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveUsername(backdrop, inp, onSuccess);
  });
}

function saveUsername(backdrop, inp, onSuccess) {
  const val = inp.value.trim();
  if (!val) { inp.classList.add('error'); inp.focus(); return; }
  setUsername(val);
  backdrop.remove();
  if (onSuccess) onSuccess();
  else render('home');
}

function ensureUsername(callback) {
  if (getUsername()) { callback(); return; }
  showUsernameModal(callback);
}

// Fix 1: No mode selection at room creation. Show notice only if Hyperbeam is full.
function showCreateRoomModal() {
  const isHbFull = currentHbInfo.available === 0;

  const backdrop = showModal(`
    <div class="modal-title">🎬 Create a Room</div>
    <div class="modal-desc">Give your watch party a name. Once inside, you can launch YouTube Sync or Hyperbeam anytime.</div>
    
    <div class="form-group">
      <label class="form-label" for="inp-room-name">Room Name</label>
      <input class="form-input" id="inp-room-name" type="text" placeholder="e.g. Movie Night" maxlength="40" autocomplete="off" />
    </div>

    ${isHbFull ? `
      <div style="margin-top:14px;padding:10px 14px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);border-radius:var(--radius);font-size:12px;color:var(--text-muted);display:flex;align-items:flex-start;gap:8px">
        <span style="font-size:16px">⚠️</span>
        <div>
          <strong style="color:var(--text)">Hyperbeam slots currently in use (2/2)</strong><br>
          YouTube Sync is available immediately in all rooms. Hyperbeam will unlock as soon as an active slot is released.
        </div>
      </div>
    ` : ''}

    <div class="modal-actions">
      <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-create">
        <span id="create-btn-text">Create Room</span>
      </button>
    </div>
  `);

  const inp = backdrop.querySelector('#inp-room-name');
  inp.focus();

  backdrop.querySelector('#modal-cancel').onclick = () => backdrop.remove();
  backdrop.querySelector('#modal-create').onclick = () => createRoom(backdrop, inp);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createRoom(backdrop, inp);
  });
}

async function createRoom(backdrop, inp) {
  const name = inp.value.trim();
  if (!name) { inp.focus(); return; }

  const btn = backdrop.querySelector('#modal-create');
  btn.disabled = true;
  backdrop.querySelector('#create-btn-text').textContent = 'Creating…';

  try {
    const { id } = await api('/rooms', { method: 'POST', body: { name, username: getUsername() } });
    backdrop.remove();
    toast('Room created! Joining now…', 'success');
    navigate('room', id);
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    backdrop.querySelector('#create-btn-text').textContent = 'Create Room';
  }
}

function showJoinModal() {
  const backdrop = showModal(`
    <div class="modal-title">🔗 Join via Link</div>
    <div class="modal-desc">Paste a room invite link or enter a Room ID directly.</div>
    <div class="form-group">
      <label class="form-label" for="inp-join">Room Link or ID</label>
      <input class="form-input" id="inp-join" type="text" placeholder="https://... or room ID" autocomplete="off" />
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-join">Join</button>
    </div>
  `);

  const inp = backdrop.querySelector('#inp-join');
  inp.focus();

  backdrop.querySelector('#modal-cancel').onclick = () => backdrop.remove();
  backdrop.querySelector('#modal-join').onclick = () => {
    const val = inp.value.trim();
    if (!val) return;
    let roomId = val;
    try {
      const url = new URL(val);
      roomId = url.searchParams.get('room') || val;
    } catch {}
    if (!roomId) return;
    backdrop.remove();
    ensureUsername(() => navigate('room', roomId));
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') backdrop.querySelector('#modal-join').click(); });
}

function showConfirm(title, msg, onConfirm) {
  const backdrop = showModal(`
    <div class="modal-title">${escHtml(title)}</div>
    <div class="modal-desc">${escHtml(msg)}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn btn-danger" id="modal-confirm">Confirm</button>
    </div>
  `);
  backdrop.querySelector('#modal-cancel').onclick = () => backdrop.remove();
  backdrop.querySelector('#modal-confirm').onclick = () => { backdrop.remove(); onConfirm(); };
}

// ─── ROOM VIEW ────────────────────────────────────────────────────────────────
// Fix 4: Removed player-fs-btn and fs-corner-controls. Controls kept clean in header.
function renderRoom() {
  return `
  <div id="view-room">
    <header class="room-header" id="room-header">
      <div class="room-header-left">
        <div class="room-brand" title="WatchBeam">
          <div class="logo-icon room-logo-icon">🎬</div>
        </div>
        <span class="room-header-title" id="room-title">Connecting…</span>
      </div>

      <div class="room-header-right">
        <!-- Live members count pill (moved to right side with upgraded UI) -->
        <div class="live-members-pill" id="room-user-count" style="display:none" title="Live participants">
          <span class="live-pulse-dot"></span>
          <svg class="live-members-icon" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <span class="live-members-count" id="user-count-num">1</span>
          <span class="live-members-text hide-xs">live</span>
        </div>

        <!-- Add Member / Share Room button -->
        <button class="btn btn-secondary btn-sm btn-invite-member" id="btn-invite-member" title="Add members / Share room" aria-label="Add members">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <line x1="19" y1="8" x2="19" y2="14"/>
            <line x1="22" y1="11" x2="16" y2="11"/>
          </svg>
          <span class="hide-xs">Invite</span>
        </button>

        <!-- Exit / Leave button (moved to far right corner, arrow pointing right) -->
        <button class="btn-icon btn-sm btn-header-exit" id="btn-back" title="Leave room" aria-label="Leave room">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </header>

    <div class="room-body" id="room-body">
      <!-- Main Screen Area with Universal Controls Bar & Viewport -->
      <div class="room-screen-area" id="room-screen-area">
        
        <!-- Universal Controls Bar (Available in Drawer, Hyperbeam, YouTube Sync) -->
        <div class="room-controls-bar" id="room-controls-bar">
          <!-- Left side: App Drawer button + Mode info pill -->
          <div class="bar-left">
            <button class="btn-icon btn-sm bar-ctrl-btn" id="btn-bar-drawer" title="Back to Apps" aria-label="Back to App Drawer">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
            </button>
            <!-- Mode pill info (hidden) -->
            <div class="bar-mode-info hidden" id="bar-mode-info">
              <span class="bar-mode-pill" id="bar-mode-pill"></span>
            </div>
          </div>

          <!-- Center area: YouTube URL Input & Merged Add Button (Only visible in YouTube mode) -->
          <div class="bar-center">
            <div class="yt-mode-controls hidden" id="yt-mode-controls">
              <div class="yt-input-group">
                <input class="yt-input" id="yt-url-input" type="text" placeholder="Paste YouTube link or ID (e.g. youtu.be/...)" />
                <button class="yt-load-btn" id="yt-load-btn" title="Add video to room">
                  <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M4 6h16M4 12h10M4 18h10M18 15v6M15 18h6"/>
                  </svg>
                  <span>Add</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Right side: Play controls group + Fullscreen + Chat toggle -->
          <div class="bar-actions">
            <!-- YouTube Playback Controls (visible only in YouTube mode) -->
            <div class="yt-playback-controls hidden" id="yt-playback-controls">
              <div class="playback-controls-group">
                <button class="btn-icon btn-sm bar-ctrl-btn" id="btn-seek-back" title="Rewind 5s" aria-label="Rewind 5 seconds">
                  <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </button>

                <button class="btn-icon btn-sm bar-ctrl-btn bar-play-btn" id="btn-play-pause" title="Play" aria-label="Play or Pause">
                  <svg id="icon-bar-play" width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  <svg id="icon-bar-pause" class="hidden" width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                </button>

                <button class="btn-icon btn-sm bar-ctrl-btn" id="btn-seek-forward" title="Forward 5s" aria-label="Forward 5 seconds">
                  <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
                </button>

                <button class="btn-icon btn-sm bar-ctrl-btn" id="btn-bar-next" title="Next in Queue" aria-label="Play next in queue">
                  <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M5 4l10 8-10 8V4z"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
                </button>
              </div>
            </div>

            <!-- Fullscreen button -->
            <button class="btn-icon btn-sm bar-ctrl-btn" id="btn-fullscreen" title="Toggle Fullscreen" aria-label="Toggle Fullscreen">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
            </button>

            <!-- Sidebar toggle button (desktop only) -->
            <button class="btn-icon btn-sm bar-ctrl-btn" id="btn-bar-chat" title="Toggle sidebar" aria-label="Toggle sidebar">
              <svg id="icon-bar-chat-open" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                <rect width="18" height="18" x="3" y="3" rx="2"/>
                <path d="M15 3v18"/>
                <path d="m10 15-3-3 3-3"/>
              </svg>
              <svg id="icon-bar-chat-close" class="hidden" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                <rect width="18" height="18" x="3" y="3" rx="2"/>
                <path d="M15 3v18"/>
                <path d="m8 9 3 3-3 3"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Full-Width & Full-Height Viewport -->
        <div class="screen-viewport" id="screen-viewport">
          <!-- Floating Stage Reactions Layer -->
          <div class="stage-reactions-layer" id="stage-reactions-layer"></div>

          <!-- Playback Sync HUD Status Pill (Current modern theme) -->
          <div class="sync-hud-pill hidden" id="sync-hud-pill"></div>

          <!-- App Drawer Launcher -->
          <div class="app-drawer" id="app-drawer">
            <div class="app-drawer-grid" id="app-drawer-grid">
              <!-- Dynamically populated from APPS_CONFIG -->
            </div>
          </div>

          <!-- Hyperbeam View -->
          <div class="hb-loading hidden" id="hb-loading">
            <div class="spinner"></div>
            <p class="text-muted text-sm">Starting cloud browser…</p>
          </div>
          <iframe class="hb-iframe hidden" id="hb-iframe"
            allow="autoplay; clipboard-write; clipboard-read; fullscreen; microphone; camera"
            allowfullscreen></iframe>

          <!-- YouTube Player View -->
          <div class="yt-player-container hidden" id="yt-player-container">
            <div id="yt-player-target"></div>
          </div>

          <!-- Floating Chat Toggle Button (Fixed / Draggable in Fullscreen) -->
          <button class="player-floating-chat-btn" id="player-floating-chat" title="Open chat" aria-label="Toggle chat">
            <svg id="icon-fs-chat-open" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <svg id="icon-fs-chat-close" class="hidden" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
            <span class="chat-badge-dot hidden" id="player-chat-badge"></span>
          </button>
        </div>
      </div>

      <!-- Sliding Chat, Queue & Members Sidebar -->
      <div class="chat-sidebar" id="chat-sidebar">
        <!-- Sidebar Header with Navigation (Desktop only; matching mobile bottom nav styling) -->
        <div class="sidebar-header chat-header" id="sidebar-header">
          <nav class="sidebar-nav-tabs" role="tablist">
            <button class="sidebar-nav-btn" id="tab-btn-members" role="tab" aria-selected="false" data-tab="members" title="Room Members">
              <div class="sidebar-nav-icon-wrap">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <span class="sidebar-nav-label">Members</span>
            </button>

            <button class="sidebar-nav-btn active" id="tab-btn-chat" role="tab" aria-selected="true" data-tab="chat" title="Live Chat">
              <div class="sidebar-nav-icon-wrap">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span class="sidebar-nav-badge-dot hidden" id="player-chat-badge"></span>
              </div>
              <span class="sidebar-nav-label">Chat</span>
            </button>

            <button class="sidebar-nav-btn hidden" id="tab-btn-queue" role="tab" aria-selected="false" data-tab="queue" title="Video Queue">
              <div class="sidebar-nav-icon-wrap">
                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/><polyline points="16 15 19 18 16 21"/></svg>
              </div>
              <span class="sidebar-nav-label">Queue</span>
            </button>
          </nav>
        </div>

        <!-- Sliding Viewport: Houses Members, Chat, and Queue views -->
        <div class="sidebar-viewport sidebar-panels-viewport" id="sidebar-viewport">
          <div class="sidebar-track sidebar-panels-track slide-chat" id="sidebar-track">
            
            <!-- Panel 1: Room Members -->
            <div class="sidebar-panel sidebar-view panel-members sidebar-members-view" id="panel-members" role="tabpanel">
              <div class="members-header-bar">
                <span class="members-title">Room Members</span>
                <span class="badge badge-green" id="members-count-badge">
                  <span class="dot"></span> <span id="members-count-num">1</span>
                </span>
              </div>
              <div class="members-list-container" id="members-list-container"></div>
              <div class="members-footer-bar">
                <button class="btn btn-ghost btn-sm btn-members-invite" id="btn-members-invite" style="width:100%;justify-content:center;gap:6px">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  <span>Invite Friends</span>
                </button>
              </div>
            </div>

            <!-- Panel 2: Live Chat -->
            <div class="sidebar-panel sidebar-view panel-chat sidebar-chat-view" id="panel-chat" role="tabpanel">
              <div class="chat-messages" id="chat-messages"></div>
              
              <!-- Quick Reaction Strip (8 curated reactions) -->
              <div class="quick-reaction-strip" id="quick-reaction-strip"></div>

              <div class="chat-input-area">
                <textarea class="chat-textarea" id="chat-input" placeholder="Say something…" rows="1" maxlength="500"></textarea>
                <button class="chat-send-btn" id="chat-send" title="Send message" aria-label="Send message">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>
            </div>

            <!-- Panel 3: Embedded Video Queue -->
            <div class="sidebar-panel sidebar-view panel-queue sidebar-queue-view" id="panel-queue" role="tabpanel">
              <!-- 1. Header & Now Playing Section (Featured, larger embed) -->
              <div class="queue-now-playing-wrap" id="queue-now-playing-wrap">
                <div class="queue-section-header">
                  <span class="queue-section-title-text">Now Playing</span>
                  <span class="now-playing-live-pill"><span class="dot dot-pulse"></span> Live Sync</span>
                </div>
                <div class="queue-now-playing-card now-playing-featured" id="embedded-now-playing-card"></div>
              </div>

              <!-- 2. Queue Bar: "1 video in queue" along with Next and Clear options -->
              <div class="queue-header-bar queue-sub-header">
                <div class="queue-header-info">
                  <span class="queue-count-label" id="queue-count-label">Queue</span>
                </div>
                <div class="queue-header-actions" id="queue-header-actions">
                  <button class="btn btn-primary btn-sm btn-queue-action" id="btn-sidebar-play-next" style="padding:2px 8px;font-size:11px" title="Play next video in queue">▶ Next</button>
                  <button class="btn btn-ghost btn-sm btn-queue-action" id="btn-clear-queue" style="padding:2px 8px;font-size:11px" title="Clear all videos from queue">Clear</button>
                </div>
              </div>

              <!-- 3. Scrollable List of Queued Videos -->
              <div class="queue-scroll-area embedded-queue-list-wrap sidebar-queue-list-container" id="queue-scroll-area">
                <div class="queue-list-container" id="queue-list-container">
                  <!-- Populated dynamically -->
                </div>
              </div>

              <!-- 4. Dedicated Video Input Field & Add Button strictly BELOW the list of queued videos -->
              <div class="queue-input-area sidebar-queue-add-box" id="queue-input-area">
                <div class="queue-add-box">
                  <input class="form-input sidebar-queue-input" id="inp-embedded-queue" placeholder="Paste YouTube link or ID..." autocomplete="off" />
                  <button class="btn btn-primary btn-sm sidebar-queue-add-btn" id="btn-embedded-add-queue" style="white-space:nowrap">Add</button>
                </div>
              </div>

            </div>

          </div>
        </div>

        <!-- Mobile Bottom Navigation Bar (Hidden on Desktop) -->
        <nav class="mobile-bottom-nav" id="mobile-bottom-nav" role="tablist">
          <button class="mob-nav-btn" id="mob-tab-members" data-tab="members" role="tab" aria-selected="false" title="Room Members">
            <div class="mob-nav-icon-wrap">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <span class="mob-nav-label">Members</span>
          </button>

          <button class="mob-nav-btn active" id="mob-tab-chat" data-tab="chat" role="tab" aria-selected="true" title="Live Chat">
            <div class="mob-nav-icon-wrap">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span class="mob-nav-badge mob-nav-badge-dot hidden" id="mob-chat-badge"></span>
            </div>
            <span class="mob-nav-label">Chat</span>
          </button>

          <button class="mob-nav-btn hidden" id="mob-tab-queue" data-tab="queue" role="tab" aria-selected="false" title="Video Queue">
            <div class="mob-nav-icon-wrap">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/><polyline points="16 15 19 18 16 21"/></svg>
            </div>
            <span class="mob-nav-label">Queue</span>
          </button>
        </nav>
      </div>
    </div>

    <!-- Dim overlay for mobile chat / fullscreen overlay -->
    <div class="chat-dim-overlay" id="chat-dim-overlay"></div>
  </div>`;
}

// ─── YouTube API Loader ───────────────────────────────────────────────────────
let ytApiPromise = null;
function loadYouTubeIframeApi() {
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      resolve(window.YT);
    };

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript.parentNode.insertBefore(tag, firstScript);
  });

  return ytApiPromise;
}

// ─── Room Initialization ──────────────────────────────────────────────────────
async function initRoom(roomId) {
  unreadCount = 0;
  chatOpen = true; // Chat open by default in desktop view
  activeSidebarTab = 'chat'; // Reset to chat tab by default

  const sidebar = document.getElementById('chat-sidebar');
  const dimOverlay = document.getElementById('chat-dim-overlay');
  const playerContainer = document.getElementById('yt-player-container');
  sidebar?.classList.remove('collapsed');

  function isMobileViewport() {
    return window.innerWidth <= 768;
  }

  // ── Format Duration (min:sec or hour:min:sec) ──
  function formatDuration(seconds = 0) {
    const secNum = Number(seconds);
    if (isNaN(secNum) || !isFinite(secNum) || secNum < 0) return '0:00';
    if (secNum >= 86400) {
      return 'Live';
    }
    const total = Math.floor(secNum);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const sStr = s < 10 ? '0' + s : String(s);
    if (h > 0) {
      const mStr = m < 10 ? '0' + m : String(m);
      return `${h}:${mStr}:${sStr}`;
    }
    return `${m}:${sStr}`;
  }

  function isLiveStream() {
    try {
      if (ytPlayer?.getVideoData?.()?.isLive) return true;
      if (ytPlayer?.getDuration?.() === 0) return true;
    } catch {}
    return false;
  }

  // ── Format Seek Time (handles regular videos & live streams cleanly) ──
  function formatSeekTime(seconds) {
    const secNum = Number(seconds);
    if (isNaN(secNum) || !isFinite(secNum)) return '0:00';

    const isLive = isLiveStream() || secNum >= 86400;
    if (isLive) {
      try {
        const range = ytPlayer?.getSeekableRange?.();
        if (range && typeof range.end === 'number' && range.end > 0) {
          const behind = Math.round(range.end - secNum);
          if (behind <= 10) {
            return 'Live';
          } else {
            return `-${formatDuration(behind)}`;
          }
        }
      } catch {}
      return 'Live';
    }

    return formatDuration(secNum);
  }

  // ── Modern Floating Sync HUD Feedback Popup ──
  let hudTimer = null;
  function showSyncHud(htmlContent, duration = 2400) {
    const hud = document.getElementById('sync-hud-pill');
    if (!hud) return;
    hud.innerHTML = htmlContent;
    hud.classList.remove('hidden');
    if (hudTimer) clearTimeout(hudTimer);
    hudTimer = setTimeout(() => {
      hud.classList.add('hidden');
    }, duration);
  }

  const view = document.getElementById('view-room');
  const floatingChatBtn = document.getElementById('player-floating-chat');

  // ── Sidebar State & Icon Updates ──
  function updateBarChatIcons() {
    const isClosed = sidebar?.classList.contains('collapsed');
    const barChatOpenIcon = document.getElementById('icon-bar-chat-open');
    const barChatCloseIcon = document.getElementById('icon-bar-chat-close');
    const barChatBtn = document.getElementById('btn-bar-chat');

    if (isClosed) {
      barChatOpenIcon?.classList.remove('hidden');
      barChatCloseIcon?.classList.add('hidden');
      if (barChatBtn) {
        barChatBtn.title = 'Open sidebar';
        barChatBtn.setAttribute('aria-label', 'Open sidebar');
      }
    } else {
      barChatOpenIcon?.classList.add('hidden');
      barChatCloseIcon?.classList.remove('hidden');
      if (barChatBtn) {
        barChatBtn.title = 'Close sidebar';
        barChatBtn.setAttribute('aria-label', 'Close sidebar');
      }
    }
  }

  function updateFsChatIcons() {
    const isOpen = sidebar?.classList.contains('fs-chat-open');
    const fsChatOpenIcon = document.getElementById('icon-fs-chat-open');
    const fsChatCloseIcon = document.getElementById('icon-fs-chat-close');

    if (isOpen) {
      fsChatOpenIcon?.classList.add('hidden');
      fsChatCloseIcon?.classList.remove('hidden');
      if (floatingChatBtn) floatingChatBtn.title = 'Close chat';
    } else {
      fsChatOpenIcon?.classList.remove('hidden');
      fsChatCloseIcon?.classList.add('hidden');
      if (floatingChatBtn) floatingChatBtn.title = 'Open chat';
    }
  }

  function closeDesktopSidebar() {
    if (isMobileViewport()) return; // Disallow closing on mobile (R3)
    sidebar?.classList.add('collapsed');
    chatOpen = false;
    updateBarChatIcons();
  }

  function openDesktopSidebar(targetTab = null) {
    sidebar?.classList.remove('collapsed');
    chatOpen = true;
    updateBarChatIcons();
    if (targetTab) {
      if (targetTab === 'queue' && currentRoom?.source !== 'youtube') {
        targetTab = 'chat';
      }
      switchSidebarTab(targetTab);
    }
  }

  function toggleNormalChat() {
    if (isMobileViewport()) return; // Disallow closing on mobile (R3)
    if (sidebar?.classList.contains('collapsed')) {
      openDesktopSidebar('chat');
    } else if (activeSidebarTab === 'queue') {
      switchSidebarTab('chat');
    } else {
      closeDesktopSidebar();
    }
  }

  function renderMembersList() {
    const container = document.getElementById('members-list-container');
    if (!container) return;
    const currentUsername = getUsername();
    const users = (currentRoom?.users && currentRoom.users.length) ? currentRoom.users : [currentUsername];

    // Live count in the members panel header
    const countBadge = document.getElementById('members-count-num');
    if (countBadge) countBadge.textContent = users.length;

    container.innerHTML = users.map(u => {
      const isMe = u === currentUsername;
      const initial = (u || '?')[0].toUpperCase();
      return `
        <div class="member-item">
          <div class="member-avatar">${escHtml(initial)}</div>
          <div class="member-info">
            <div class="member-name-row">
              <span class="member-name">${escHtml(u)}</span>
              ${isMe ? '<span class="member-tag-you">You</span>' : ''}
            </div>
            <span class="member-status"><span class="dot dot-pulse" style="color:var(--green)"></span> Watching</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function switchSidebarTab(tab) {
    // Queue tab can ONLY be accessed if YouTube Sync mode is active
    if (tab === 'queue' && currentRoom?.source !== 'youtube') {
      return;
    }

    activeSidebarTab = tab;
    const track = document.getElementById('sidebar-track');
    const viewport = document.getElementById('sidebar-viewport');
    if (viewport && viewport.scrollLeft !== 0) {
      viewport.scrollLeft = 0;
    }

    // Desktop tabs
    const tabMembers = document.getElementById('tab-btn-members');
    const tabChat = document.getElementById('tab-btn-chat');
    const tabQueue = document.getElementById('tab-btn-queue');

    // Mobile tabs
    const mobMembers = document.getElementById('mob-tab-members');
    const mobChat = document.getElementById('mob-tab-chat');
    const mobQueue = document.getElementById('mob-tab-queue');

    track?.classList.remove('slide-members', 'slide-chat', 'slide-queue');

    // Reset desktop tab states
    [tabMembers, tabChat, tabQueue].forEach(btn => {
      btn?.classList.remove('active');
      btn?.setAttribute('aria-selected', 'false');
    });

    // Reset mobile tab states
    [mobMembers, mobChat, mobQueue].forEach(btn => {
      btn?.classList.remove('active');
      btn?.setAttribute('aria-selected', 'false');
    });

    if (tab === 'members') {
      track?.classList.add('slide-members');
      tabMembers?.classList.add('active');
      tabMembers?.setAttribute('aria-selected', 'true');
      mobMembers?.classList.add('active');
      mobMembers?.setAttribute('aria-selected', 'true');
      renderMembersList();
    } else if (tab === 'queue') {
      track?.classList.add('slide-queue');
      tabQueue?.classList.add('active');
      tabQueue?.setAttribute('aria-selected', 'true');
      mobQueue?.classList.add('active');
      mobQueue?.setAttribute('aria-selected', 'true');
      renderEmbeddedQueue();
    } else {
      track?.classList.add('slide-chat');
      tabChat?.classList.add('active');
      tabChat?.setAttribute('aria-selected', 'true');
      mobChat?.classList.add('active');
      mobChat?.setAttribute('aria-selected', 'true');
      unreadCount = 0;
      document.getElementById('player-chat-badge')?.classList.add('hidden');
      document.getElementById('mob-chat-badge')?.classList.add('hidden');
      const msgs = document.getElementById('chat-messages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
      const chatInput = document.getElementById('chat-input');
      if (!isMobileViewport()) chatInput?.focus({ preventScroll: true });
    }
  }

  // Desktop header tab events
  document.getElementById('tab-btn-members')?.addEventListener('click', () => switchSidebarTab('members'));
  document.getElementById('tab-btn-chat')?.addEventListener('click', () => switchSidebarTab('chat'));
  document.getElementById('tab-btn-queue')?.addEventListener('click', () => switchSidebarTab('queue'));

  // Mobile bottom nav tab events
  document.getElementById('mob-tab-members')?.addEventListener('click', () => switchSidebarTab('members'));
  document.getElementById('mob-tab-chat')?.addEventListener('click', () => switchSidebarTab('chat'));
  document.getElementById('mob-tab-queue')?.addEventListener('click', () => switchSidebarTab('queue'));

  // Members invite button -> native share or direct copy
  document.getElementById('btn-members-invite')?.addEventListener('click', () => {
    const url = getRoomUrl(roomId);
    handleInviteShare(url);
  });

  document.getElementById('btn-sidebar-close')?.addEventListener('click', () => {
    if (view?.classList.contains('is-fullscreen')) {
      sidebar?.classList.remove('fs-chat-open');
      dimOverlay?.classList.remove('active');
      updateFsChatIcons();
    } else {
      closeDesktopSidebar();
    }
  });

  function onWindowResize() {
    if (isMobileViewport()) {
      sidebar?.classList.remove('collapsed');
      chatOpen = true;
      updateBarChatIcons();
    }
  }
  window.addEventListener('resize', onWindowResize);

  // Lock horizontal scroll on sidebar viewport to prevent layout shift during input focus
  const sidebarViewport = document.getElementById('sidebar-viewport');
  sidebarViewport?.addEventListener('scroll', () => {
    if (sidebarViewport.scrollLeft !== 0) {
      sidebarViewport.scrollLeft = 0;
    }
  }, { passive: true });

  function toggleFsChat() {
    const wasOpen = sidebar?.classList.contains('fs-chat-open');
    sidebar?.classList.toggle('fs-chat-open');
    dimOverlay?.classList.toggle('active', !wasOpen);
    updateFsChatIcons();
    if (!wasOpen) {
      unreadCount = 0;
      document.getElementById('player-chat-badge')?.classList.add('hidden');
      const msgs = document.getElementById('chat-messages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    }
  }

  document.getElementById('btn-bar-chat')?.addEventListener('click', toggleNormalChat);
  updateBarChatIcons();

  dimOverlay?.addEventListener('click', () => {
    sidebar?.classList.remove('fs-chat-open');
    dimOverlay?.classList.remove('active');
    updateFsChatIcons();
  });

  // ── Draggable Floating Chat Button (Fixed to Viewport in Fullscreen) ──
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let btnStartX = 0;
  let btnStartY = 0;
  let hasMoved = false;

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    isDragging = true;
    hasMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;

    const rect = floatingChatBtn.getBoundingClientRect();
    btnStartX = rect.left;
    btnStartY = rect.top;

    try {
      floatingChatBtn.setPointerCapture(e.pointerId);
    } catch {}
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    if (Math.hypot(dx, dy) > 5) {
      hasMoved = true;
    }

    if (hasMoved) {
      let newX = btnStartX + dx;
      let newY = btnStartY + dy;

      const btnW = floatingChatBtn.offsetWidth || 44;
      const btnH = floatingChatBtn.offsetHeight || 44;
      const maxX = window.innerWidth - btnW - 12;
      const maxY = window.innerHeight - btnH - 12;

      newX = Math.max(12, Math.min(newX, maxX));
      newY = Math.max(12, Math.min(newY, maxY));

      floatingChatBtn.style.left = `${newX}px`;
      floatingChatBtn.style.top = `${newY}px`;
      floatingChatBtn.style.right = 'auto';
      floatingChatBtn.style.bottom = 'auto';
    }
  }

  function onPointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    try {
      floatingChatBtn.releasePointerCapture(e.pointerId);
    } catch {}

    // Clicked without dragging: toggle fullscreen chat overlay!
    if (!hasMoved) {
      toggleFsChat();
    }
  }

  floatingChatBtn?.addEventListener('pointerdown', onPointerDown);
  floatingChatBtn?.addEventListener('pointermove', onPointerMove);
  floatingChatBtn?.addEventListener('pointerup', onPointerUp);
  floatingChatBtn?.addEventListener('pointercancel', () => { isDragging = false; });

  // ── Fullscreen Toggle & Change Listeners ──
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      view?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  document.getElementById('btn-fullscreen')?.addEventListener('click', toggleFullscreen);

  let fsIdleTimer = null;
  function resetFsInactivity() {
    if (!view?.classList.contains('is-fullscreen')) return;
    floatingChatBtn?.classList.remove('fs-btn-idle');
    if (fsIdleTimer) clearTimeout(fsIdleTimer);
    fsIdleTimer = setTimeout(() => {
      if (!isDragging && !sidebar?.classList.contains('fs-chat-open')) {
        floatingChatBtn?.classList.add('fs-btn-idle');
      }
    }, 2500);
  }

  view?.addEventListener('mousemove', resetFsInactivity);
  view?.addEventListener('pointerdown', resetFsInactivity);

  function onFullscreenChange() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      view?.classList.add('is-fullscreen');
      // If a sub-iframe requested fullscreen directly (e.g. YouTube player controls maximize), elevate to view:
      if (fsEl.tagName === 'IFRAME' && fsEl !== view) {
        try { view?.requestFullscreen?.(); } catch {}
      }
      resetFsInactivity();
    } else {
      view?.classList.remove('is-fullscreen');
      floatingChatBtn?.classList.remove('fs-btn-idle');
      if (fsIdleTimer) clearTimeout(fsIdleTimer);
      sidebar?.classList.remove('fs-chat-open');
      dimOverlay?.classList.remove('active');
      updateFsChatIcons();
    }
  }

  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  function cleanupRoomListeners() {
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    window.removeEventListener('resize', onWindowResize);
    view?.removeEventListener('mousemove', resetFsInactivity);
    view?.removeEventListener('pointerdown', resetFsInactivity);
    if (fsIdleTimer) clearTimeout(fsIdleTimer);
  }

  // ── Back button ──
  document.getElementById('btn-back').addEventListener('click', () => {
    cleanupRoomListeners();
    if (document.fullscreenElement) {
      try { document.exitFullscreen?.(); } catch {}
    }
    if (seekCheckInterval) clearInterval(seekCheckInterval);
    if (ytPlayer && ytPlayer.destroy) {
      try { ytPlayer.destroy(); } catch {}
      ytPlayer = null;
      ytPlayerReady = false;
    }
    if (roomSocket) { roomSocket.disconnect(); roomSocket = null; }
    navigate('home');
  });

  // ── Share / Add Member (directly opens OS native device share modal) ──
  async function handleInviteShare(url) {
    const shareData = {
      title: 'Watch together on WatchBeam',
      url: url,
    };

    // Locate native share provider (supports standalone window, child iframe, or parent window)
    const shareTargets = [];
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      shareTargets.push(navigator);
    }
    try {
      if (typeof window !== 'undefined' && window.parent && window.parent.navigator && typeof window.parent.navigator.share === 'function') {
        shareTargets.push(window.parent.navigator);
      }
      if (typeof window !== 'undefined' && window.top && window.top.navigator && typeof window.top.navigator.share === 'function') {
        shareTargets.push(window.top.navigator);
      }
    } catch {}

    for (const target of shareTargets) {
      try {
        await target.share(shareData);
        return; // Successfully opened device native share modal!
      } catch (err) {
        // User closed / cancelled the native dialog
        if (err && (err.name === 'AbortError' || err.code === 20)) {
          return;
        }
        // Try fallback with just url
        try {
          await target.share({ url: url });
          return;
        } catch (e) {
          if (e && (e.name === 'AbortError' || e.code === 20)) return;
        }
      }
    }

    // Only if the browser/environment strictly lacks native Web Share API
    const ok = await copyToClipboard(url);
    if (ok) toast('Invite link copied! 📋', 'success');
  }

  // ── Add Member / Invite button ──
  document.getElementById('btn-invite-member')?.addEventListener('click', () => {
    const url = getRoomUrl(roomId);
    handleInviteShare(url);
  });

  // ── Open Drawer (from control bar) ──
  document.getElementById('btn-bar-drawer')?.addEventListener('click', () => {
    switchToMode('drawer');
  });

  // ── Apps Launcher Registry & Renderer ──
  // Easily extendable: to add future apps, simply add a new object to APPS_CONFIG!
  const APPS_CONFIG = [
    {
      id: 'youtube',
      tileId: 'card-launch-yt',
      name: 'YouTube',
      source: 'youtube',
      gradient: 'linear-gradient(145deg, #ef4444 0%, #b91c1c 100%)',
      glow: 'rgba(239, 68, 68, 0.45)',
      iconSvg: `<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
      isAvailable: () => true
    },
    {
      id: 'hyperbeam',
      tileId: 'card-launch-hb',
      name: 'Browser',
      source: 'hyperbeam',
      gradient: 'linear-gradient(145deg, #6366f1 0%, #3b82f6 50%, #06b6d4 100%)',
      glow: 'rgba(99, 102, 241, 0.45)',
      iconSvg: `<svg width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
      isAvailable: () => (currentRoom?.hyperbeam ? currentRoom.hyperbeam.canSwitchToHb : currentHbInfo.available > 0),
      unavailableReason: 'All cloud browser slots are currently in use by other rooms. Please try again later or enjoy YouTube together!'
    }
  ];

  function showAppUnavailableModal(appName, reason) {
    document.getElementById('app-unavailable-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'app-unavailable-modal';
    modal.className = 'app-modal-backdrop';
    modal.innerHTML = `
      <div class="app-modal-card" role="dialog" aria-modal="true" aria-labelledby="app-modal-title">
        <div class="app-modal-icon">
          <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3 class="app-modal-title" id="app-modal-title">${escHtml(appName)} Not Available</h3>
        <p class="app-modal-desc">${escHtml(reason || `${appName} is currently unavailable. Please try again later.`)}</p>
        <button class="btn btn-primary app-modal-btn" id="app-modal-btn-close">Got it</button>
      </div>
    `;

    const targetContainer = document.getElementById('screen-viewport') || document.body;
    targetContainer.appendChild(modal);

    const close = () => {
      modal.classList.add('fade-out');
      setTimeout(() => modal.remove(), 160);
    };

    modal.querySelector('#app-modal-btn-close')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
  }

  function renderAppDrawer() {
    const grid = document.getElementById('app-drawer-grid');
    if (!grid) return;
    grid.innerHTML = '';

    APPS_CONFIG.forEach(app => {
      const isAvail = typeof app.isAvailable === 'function' ? app.isAvailable() : true;
      const tile = document.createElement('div');
      tile.className = `app-drawer-tile ${isAvail ? '' : 'app-tile-dimmed'}`;
      tile.id = app.tileId;
      tile.setAttribute('data-app-id', app.id);
      tile.setAttribute('title', isAvail ? `Launch ${app.name}` : `${app.name} (Not available)`);

      tile.innerHTML = `
        <div class="app-drawer-icon" style="background: ${app.gradient}; --app-glow: ${app.glow};">
          ${app.iconSvg}
        </div>
        <span class="app-drawer-name">${escHtml(app.name)}</span>
      `;

      tile.addEventListener('click', () => {
        if (!isAvail) {
          showAppUnavailableModal(app.name, app.unavailableReason);
          return;
        }
        switchToMode(app.source);
      });

      grid.appendChild(tile);
    });
  }

  function spawnStageReaction(hex) {
    const layer = document.getElementById('stage-reactions-layer');
    if (!layer) return;

    const item = document.createElement('div');
    item.className = 'floating-stage-reaction';
    const randX = (Math.random() * 50 - 25).toFixed(1);
    const randRot = (Math.random() * 24 - 12).toFixed(1);
    item.style.setProperty('--rand-x', `${randX}px`);
    item.style.setProperty('--rand-rot', `${randRot}deg`);

    item.innerHTML = `<img src="https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/512.webp" alt="reaction" loading="eager" onerror="this.remove()" />`;
    layer.appendChild(item);

    setTimeout(() => {
      item.remove();
    }, 2100);
  }

  function renderQuickReactionStrip() {
    const strip = document.getElementById('quick-reaction-strip');
    if (!strip) return;
    strip.innerHTML = '';

    QUICK_REACTIONS.forEach(({ emoji, hex }) => {
      const btn = document.createElement('button');
      btn.className = 'quick-reaction-btn';
      btn.type = 'button';
      btn.title = `Send ${emoji}`;
      btn.setAttribute('aria-label', `Send ${emoji}`);
      btn.innerHTML = `<img src="https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/512.webp" alt="${emoji}" class="reaction-strip-icon" loading="lazy" onerror="this.replaceWith('${emoji}')" />`;

      btn.addEventListener('click', () => {
        if (!roomSocket) return;
        roomSocket.chat(emoji);
      });

      strip.appendChild(btn);
    });
  }

  renderAppDrawer();
  renderQuickReactionStrip();

  // ── Send chat ──
  const chatInput = document.getElementById('chat-input');
  document.getElementById('chat-send').addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
  });

  // ── Mode Switcher Logic ──
  async function switchToMode(targetSource) {
    if (!currentRoom) return;

    try {
      const res = await api(`/rooms/${roomId}/switch-mode`, {
        method: 'POST',
        body: { source: targetSource },
      });
      currentRoom.source = res.source;
      if (res.embedUrl) currentRoom.embedUrl = res.embedUrl;
      if (res.ytState) currentRoom.ytState = res.ytState;
      if (res.hyperbeam) currentRoom.hyperbeam = res.hyperbeam;

      applyViewMode(res.source);
      toast(`Switched to ${res.source === 'youtube' ? 'YouTube' : res.source === 'hyperbeam' ? 'Browser' : 'App Drawer'}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function applyViewMode(source) {
    const drawer = document.getElementById('app-drawer');
    const hbIframe = document.getElementById('hb-iframe');
    const hbLoading = document.getElementById('hb-loading');
    const ytPlayerContainer = document.getElementById('yt-player-container');
    const ytModeControls = document.getElementById('yt-mode-controls');
    const ytPlaybackControls = document.getElementById('yt-playback-controls');
    const barModeInfo = document.getElementById('bar-mode-info');
    const barModePill = document.getElementById('bar-mode-pill');

    updateDrawerCardLook();

    // The Queue navigation is exclusively accessible during YouTube Sync mode
    const tabQueue = document.getElementById('tab-btn-queue');
    const mobQueue = document.getElementById('mob-tab-queue');
    const panelQueue = document.getElementById('panel-queue');
    const viewport = document.getElementById('sidebar-viewport');
    if (viewport && viewport.scrollLeft !== 0) viewport.scrollLeft = 0;

    if (source === 'youtube') {
      tabQueue?.classList.remove('hidden');
      mobQueue?.classList.remove('hidden');
      if (panelQueue) {
        panelQueue.style.visibility = 'visible';
        panelQueue.removeAttribute('inert');
      }
    } else {
      tabQueue?.classList.add('hidden');
      mobQueue?.classList.add('hidden');
      if (panelQueue) {
        panelQueue.style.visibility = 'hidden';
        panelQueue.setAttribute('inert', '');
      }
      if (activeSidebarTab === 'queue') {
        switchSidebarTab('chat');
      }
    }

    if (source === 'drawer') {
      drawer?.classList.remove('hidden');
      hbIframe?.classList.add('hidden');
      hbLoading?.classList.add('hidden');
      ytPlayerContainer?.classList.add('hidden');

      ytModeControls?.classList.add('hidden');
      ytPlaybackControls?.classList.add('hidden');
      barModeInfo?.classList.add('hidden');

      if (ytPlayer && ytPlayer.pauseVideo) {
        try { ytPlayer.pauseVideo(); } catch {}
      }
    } else if (source === 'youtube') {
      drawer?.classList.add('hidden');
      hbIframe?.classList.add('hidden');
      hbLoading?.classList.add('hidden');
      ytPlayerContainer?.classList.remove('hidden');

      ytModeControls?.classList.remove('hidden');
      ytPlaybackControls?.classList.remove('hidden');
      barModeInfo?.classList.add('hidden');

      const targetYt = currentRoom?.ytState || { videoId: '4xDzrJKXOOY', time: 0, isPlaying: false };
      updatePlayPauseIcon(targetYt.isPlaying);
      if (!ytPlayer) {
        setupYouTubePlayer(targetYt.videoId, targetYt.time, targetYt.isPlaying);
      } else {
        loadYtVideo(targetYt.videoId, targetYt.time, targetYt.isPlaying);
      }
    } else if (source === 'hyperbeam') {
      drawer?.classList.add('hidden');
      ytPlayerContainer?.classList.add('hidden');

      ytModeControls?.classList.add('hidden');
      ytPlaybackControls?.classList.add('hidden');
      barModeInfo?.classList.add('hidden');

      if (ytPlayer && ytPlayer.pauseVideo) {
        try { ytPlayer.pauseVideo(); } catch {}
      }

      if (currentRoom?.embedUrl) {
        if (hbIframe.src !== currentRoom.embedUrl) {
          hbIframe.src = currentRoom.embedUrl;
        }
        hbIframe.classList.remove('hidden');
        hbLoading.classList.add('hidden');
      } else {
        hbLoading.classList.remove('hidden');
        hbIframe.classList.add('hidden');
      }
    }
  }

  function updateDrawerCardLook() {
    renderAppDrawer();
  }

  // ── YouTube Queue Management ──
  function updateQueueBadge() {
    // Dynamic count badges removed from nav icons per user request
  }

  function renderEmbeddedQueue() {
    const queue = currentRoom?.queue || [];
    const currentVid = currentRoom?.ytState?.videoId;
    const isPlaying = ytPlayer?.getPlayerState ? ytPlayer.getPlayerState() === 1 : false;

    // 1. Update queue count label
    const countLabel = document.getElementById('queue-count-label');
    if (countLabel) {
      countLabel.textContent = queue.length === 1 ? '1 video in queue' : `${queue.length} videos in queue`;
    }

    // 2. Play Next and Clear Queue header actions
    const clearBtn = document.getElementById('btn-clear-queue');
    const playNextBtn = document.getElementById('btn-sidebar-play-next');
    if (clearBtn) clearBtn.style.display = queue.length > 0 ? 'inline-block' : 'none';
    if (playNextBtn) playNextBtn.style.display = queue.length > 0 ? 'inline-block' : 'none';

    // 3. Render Now Playing Card (Prominently featured, larger than queue items)
    const nowPlayingCard = document.getElementById('embedded-now-playing-card');
    const nowPlayingWrap = document.getElementById('queue-now-playing-wrap');
    if (nowPlayingCard) {
      if (currentVid) {
        const videoData = ytPlayer?.getVideoData ? ytPlayer.getVideoData() : null;
        const resolvedTitle = (videoData && videoData.title && videoData.title.trim())
          ? videoData.title
          : `YouTube (${currentVid})`;

        nowPlayingCard.innerHTML = `
          <div class="now-playing-thumb-wrap">
            <img class="queue-thumb-featured" src="https://img.youtube.com/vi/${escHtml(currentVid)}/mqdefault.jpg" alt="Thumbnail" />
            <div class="now-playing-badge-icon">${isPlaying ? '▶' : '⏸'}</div>
          </div>
          <div class="queue-video-info now-playing-info">
            <div class="now-playing-title" title="${escHtml(resolvedTitle)}">${escHtml(resolvedTitle)}</div>
            <div class="now-playing-meta">
              <span class="badge ${isPlaying ? 'badge-green' : 'badge-cyan'} now-playing-status-badge">
                <span class="dot ${isPlaying ? 'dot-pulse' : ''}"></span>
                ${isPlaying ? 'Playing' : 'Paused'}
              </span>
            </div>
          </div>
        `;
        nowPlayingCard.style.display = 'flex';
        if (nowPlayingWrap) nowPlayingWrap.style.display = 'block';
      } else {
        nowPlayingCard.style.display = 'none';
        if (nowPlayingWrap) nowPlayingWrap.style.display = 'none';
      }
    }

    // 4. Render Queue List
    const listContainer = document.getElementById('queue-list-container');
    if (!listContainer) return;

    if (queue.length === 0) {
      listContainer.innerHTML = `
        <div class="queue-empty">
          <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" style="margin:0 auto 8px;opacity:0.6"><path d="M4 6h16M4 12h16M4 18h10"/><polyline points="16 15 19 18 16 21"/></svg>
          <p class="text-muted text-sm" style="font-weight:600;margin-bottom:2px">Queue is empty</p>
          <p class="text-muted text-xs">Add videos below to build your watch party playlist.</p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = `
      <div class="queue-list">
        ${queue.map((item, idx) => `
          <div class="queue-item" data-item-id="${escHtml(item.id)}">
            <span class="queue-item-num">#${idx + 1}</span>
            <img class="queue-thumb" src="https://img.youtube.com/vi/${escHtml(item.videoId)}/default.jpg" alt="Thumbnail" />
            <div class="queue-video-info">
              <div class="queue-video-title" title="${escHtml(item.title || item.videoId)}">${escHtml(item.title || item.videoId)}</div>
              <div class="queue-video-meta">Added by ${escHtml(item.addedBy || 'Viewer')}</div>
            </div>
            <div class="queue-item-actions">
              <button class="btn btn-primary btn-sm btn-queue-item-play" data-item-id="${escHtml(item.id)}" title="Play now" style="padding:3px 8px;font-size:11px">Play</button>
              <button class="btn btn-danger btn-sm btn-queue-item-remove" data-item-id="${escHtml(item.id)}" title="Remove" style="padding:3px 6px">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    // Bind item Play and Remove buttons
    listContainer.querySelectorAll('.btn-queue-item-play').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.itemId;
        roomSocket?.ytAction('queue_play_item', { itemId });
      });
    });

    listContainer.querySelectorAll('.btn-queue-item-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.itemId;
        roomSocket?.ytAction('queue_remove', { itemId });
      });
    });
  }

  // Clear queue listener
  document.getElementById('btn-clear-queue')?.addEventListener('click', () => {
    if ((currentRoom?.queue?.length || 0) === 0) return;
    roomSocket?.ytAction('queue_clear');
  });

  // Play next listener
  document.getElementById('btn-sidebar-play-next')?.addEventListener('click', () => {
    if ((currentRoom?.queue?.length || 0) === 0) return;
    roomSocket?.ytAction('queue_play_next');
  });

  // Embedded queue add input handler (strictly below the queued videos list)
  const embeddedQueueInp = document.getElementById('inp-embedded-queue');
  const embeddedQueueBtn = document.getElementById('btn-embedded-add-queue');

  function submitEmbeddedQueue() {
    const raw = embeddedQueueInp?.value.trim();
    if (!raw) return;
    const vid = extractYouTubeId(raw);
    if (!vid) {
      toast('Please enter a valid YouTube video link or ID', 'error');
      return;
    }
    roomSocket?.ytAction('queue_add', { videoId: vid });
    if (embeddedQueueInp) embeddedQueueInp.value = '';
    toast('Added video to queue! 📋', 'success');
  }

  embeddedQueueBtn?.addEventListener('click', submitEmbeddedQueue);
  embeddedQueueInp?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitEmbeddedQueue();
    }
  });

  // ── YouTube URL Input & Add Button ──
  const ytUrlInput = document.getElementById('yt-url-input');
  const ytLoadBtn = document.getElementById('yt-load-btn');

  function submitYouTubeUrl(rawVal) {
    const vid = extractYouTubeId(rawVal);
    if (!vid) {
      toast('Please enter a valid YouTube video link or ID', 'error');
      return;
    }
    const isPlaying = Boolean((ytPlayer?.getPlayerState && ytPlayer.getPlayerState() === 1) || currentRoom?.ytState?.isPlaying);
    const hasQueue = (currentRoom?.queue?.length || 0) > 0;

    if (isPlaying || hasQueue) {
      roomSocket?.ytAction('queue_add', { videoId: vid });
      toast('Added video to queue! 📋', 'success');
    } else {
      roomSocket?.ytAction('change_video', { videoId: vid });
      toast('Playing video… 🎬', 'success');
    }
    if (ytUrlInput) ytUrlInput.value = '';
  }

  ytLoadBtn?.addEventListener('click', () => submitYouTubeUrl(ytUrlInput?.value));
  ytUrlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitYouTubeUrl(ytUrlInput?.value);
  });

  // ── YouTube Play/Pause, Seek & Queue Controls ──
  function updatePlayPauseIcon(isPlaying) {
    const playIcon = document.getElementById('icon-bar-play');
    const pauseIcon = document.getElementById('icon-bar-pause');
    const btn = document.getElementById('btn-play-pause');
    if (!playIcon || !pauseIcon) return;
    if (isPlaying) {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
      if (btn) btn.title = 'Pause';
    } else {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
      if (btn) btn.title = 'Play';
    }
  }

  function togglePlayPause() {
    if (!ytPlayer) return;
    const playerState = ytPlayer.getPlayerState ? ytPlayer.getPlayerState() : -1;
    const curTime = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
    if (playerState === 1) { // Currently playing
      ytPlayer.pauseVideo();
      roomSocket?.ytAction('pause', { time: curTime });
      updatePlayPauseIcon(false);
      showSyncHud(`<svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> <span>Paused</span>`, 1800);
    } else {
      ytPlayer.playVideo();
      roomSocket?.ytAction('play', { time: curTime });
      updatePlayPauseIcon(true);
      showSyncHud(`<svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> <span>Played</span>`, 1800);
    }
  }

  function seekRelative(deltaSeconds) {
    if (!ytPlayer) return;
    const curTime = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
    const duration = ytPlayer.getDuration ? ytPlayer.getDuration() : Infinity;
    const maxTime = duration > 0 ? duration : Infinity;
    const newTime = Math.max(0, Math.min(curTime + deltaSeconds, maxTime));
    const isPlaying = ytPlayer.getPlayerState ? ytPlayer.getPlayerState() === 1 : false;

    roomSocket?.ytAction('seek', { time: newTime, wasPlaying: isPlaying });
    showSyncHud(`<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> <span>Seeked to <strong class="hud-time">${formatSeekTime(newTime)}</strong></span>`, 2400);
  }

  document.getElementById('btn-play-pause')?.addEventListener('click', togglePlayPause);
  document.getElementById('btn-seek-back')?.addEventListener('click', () => seekRelative(-5));
  document.getElementById('btn-seek-forward')?.addEventListener('click', () => seekRelative(5));
  // Next in Queue button (control bar)
  document.getElementById('btn-bar-next')?.addEventListener('click', () => {
    if ((currentRoom?.queue?.length || 0) === 0) return;
    roomSocket?.ytAction('queue_play_next');
  });

  // ── YouTube Player & Sync Algorithm ──
  async function setupYouTubePlayer(initialVideoId = '4xDzrJKXOOY', startTime = 0, autoPlay = false) {
    const YT = await loadYouTubeIframeApi();

    if (ytPlayer) {
      loadYtVideo(initialVideoId, startTime, autoPlay);
      return;
    }

    isApplyingRemoteSync = true;

    ytPlayer = new YT.Player('yt-player-target', {
      videoId: initialVideoId,
      playerVars: {
        autoplay: autoPlay ? 1 : 0,
        start: Math.floor(startTime),
        enablejsapi: 1,
        rel: 0,
        modestbranding: 1,
        fs: 1, // Enable YouTube native fullscreen maximize button
        origin: window.location.origin,
      },
      events: {
        onReady: (e) => {
          ytPlayerReady = true;
          isApplyingRemoteSync = true;

          try {
            const iframe = e.target.getIframe();
            if (iframe) {
              iframe.setAttribute('allowfullscreen', 'true');
              iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
            }
          } catch {}

          if (startTime > 0) e.target.seekTo(startTime, true);
          if (autoPlay) {
            e.target.playVideo();
            updatePlayPauseIcon(true);
          } else {
            e.target.pauseVideo();
            updatePlayPauseIcon(false);
          }

          // Settle time before ticker or auto state sync to prevent false seeks / pauses
          setTimeout(() => {
            if (ytPlayer && ytPlayer.getCurrentTime) {
              lastKnownTime = ytPlayer.getCurrentTime();
              lastKnownTimestamp = Date.now();
            }
            isApplyingRemoteSync = false;
            renderEmbeddedQueue();
            startSeekCheckTicker();
          }, 2500);
        },
        onStateChange: (e) => {
          const state = e.data;
          const curTime = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;

          if (state === YT.PlayerState.PLAYING) {
            updatePlayPauseIcon(true);
            renderEmbeddedQueue();
            if (!isApplyingRemoteSync) roomSocket?.ytAction('play', { time: curTime });
          } else if (state === YT.PlayerState.PAUSED) {
            updatePlayPauseIcon(false);
            renderEmbeddedQueue();
            if (!isApplyingRemoteSync) roomSocket?.ytAction('pause', { time: curTime });
          } else if (state === YT.PlayerState.ENDED) {
            updatePlayPauseIcon(false);
            renderEmbeddedQueue();
            if (currentRoom?.queue && currentRoom.queue.length > 0) {
              roomSocket?.ytAction('queue_play_next');
            }
          }
          // Do NOT emit on BUFFERING! (Prevents feedback loops)
        },
      },
    });
  }

  function isLiveStream() {
    try {
      if (ytPlayer?.getVideoData?.()?.isLive) return true;
      if (ytPlayer?.getDuration?.() === 0) return true;
    } catch {}
    return false;
  }

  function startSeekCheckTicker() {
    if (seekCheckInterval) clearInterval(seekCheckInterval);
    lastKnownTime = ytPlayer?.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
    lastKnownTimestamp = Date.now();

    seekCheckInterval = setInterval(() => {
      if (!ytPlayer || !ytPlayerReady || isApplyingRemoteSync) {
        if (ytPlayer && ytPlayerReady) {
          lastKnownTime = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
          lastKnownTimestamp = Date.now();
        }
        return;
      }

      const curTime = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
      const playerState = ytPlayer.getPlayerState ? ytPlayer.getPlayerState() : -1;
      const isPlaying = playerState === 1;

      let expectedTime = lastKnownTime;
      if (isPlaying) {
        const elapsed = (Date.now() - lastKnownTimestamp) / 1000;
        expectedTime += elapsed;
      }

      const isLive = isLiveStream();
      const diff = Math.abs(curTime - expectedTime);

      // Check if user manually clicked or scrubbed the timeline (> 2.0s jump on VOD)
      if (!isLive && diff > 2.0 && curTime >= 0) {
        if (seekDebounceTimer) clearTimeout(seekDebounceTimer);
        seekDebounceTimer = setTimeout(() => {
          if (isApplyingRemoteSync) return;
          const seekTime = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
          roomSocket?.ytAction('seek', { time: seekTime, wasPlaying: isPlaying });
        }, 200);
      }

      lastKnownTime = curTime;
      lastKnownTimestamp = Date.now();
    }, 250);
  }

  function loadYtVideo(videoId, startSeconds = 0, play = false) {
    if (!ytPlayer || !ytPlayer.loadVideoById) return;
    isApplyingRemoteSync = true;
    ytPlayer.loadVideoById({
      videoId,
      startSeconds: Math.floor(startSeconds),
    });
    if (!play) ytPlayer.pauseVideo();
    setTimeout(() => {
      if (ytPlayer && ytPlayer.getCurrentTime) {
        lastKnownTime = ytPlayer.getCurrentTime();
        lastKnownTimestamp = Date.now();
      }
      isApplyingRemoteSync = false;
    }, 2000);
  }

  function onYtSync(msg) {
    if (!ytPlayer || !ytPlayerReady) return;
    const { action, time, videoId, wasPlaying, username } = msg;

    isApplyingRemoteSync = true;

    if (action === 'change_video') {
      loadYtVideo(videoId, 0, true);
      updatePlayPauseIcon(true);
      if (currentRoom && currentRoom.ytState) {
        currentRoom.ytState.videoId = videoId;
        currentRoom.ytState.isPlaying = true;
      }
      renderEmbeddedQueue();
      showSyncHud(`<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> <span><strong class="hud-user">${escHtml(username)}</strong> loaded video</span>`, 2500);
    } else if (action === 'seek') {
      if (resumeTimer) clearTimeout(resumeTimer);
      ytPlayer.pauseVideo();
      updatePlayPauseIcon(false);

      if (typeof time === 'number') {
        ytPlayer.seekTo(time, true);
      }

      showSyncHud(`<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> <span><strong class="hud-user">${escHtml(username)}</strong> seeked to <strong class="hud-time">${formatSeekTime(time)}</strong></span>`, 2800);

      if (wasPlaying) {
        resumeTimer = setTimeout(() => {
          ytPlayer.playVideo();
          updatePlayPauseIcon(true);
          showSyncHud(`<svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> <span>Resumed in sync</span>`, 1800);

          setTimeout(() => {
            isApplyingRemoteSync = false;
          }, 1200);
        }, 3000);
      } else {
        setTimeout(() => { isApplyingRemoteSync = false; }, 1200);
      }
    } else if (action === 'play') {
      const curTime = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
      if (typeof time === 'number' && Math.abs(curTime - time) > 2.5) {
        ytPlayer.seekTo(time, true);
      }
      ytPlayer.playVideo();
      updatePlayPauseIcon(true);
      if (currentRoom && currentRoom.ytState) currentRoom.ytState.isPlaying = true;
      renderEmbeddedQueue();
      showSyncHud(`<svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> <span><strong class="hud-user">${escHtml(username)}</strong> played</span>`, 2000);
      setTimeout(() => { isApplyingRemoteSync = false; }, 800);
    } else if (action === 'pause') {
      const curTime = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
      if (typeof time === 'number' && Math.abs(curTime - time) > 2.0) {
        ytPlayer.seekTo(time, true);
      }
      ytPlayer.pauseVideo();
      updatePlayPauseIcon(false);
      if (currentRoom && currentRoom.ytState) currentRoom.ytState.isPlaying = false;
      renderEmbeddedQueue();
      showSyncHud(`<svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> <span><strong class="hud-user">${escHtml(username)}</strong> paused</span>`, 2200);
      setTimeout(() => { isApplyingRemoteSync = false; }, 800);
    }
  }

  // ── Load room data & connect ──
  try {
    const room = await api(`/rooms/${roomId}`);
    currentRoom = room;

    const titleEl = document.getElementById('room-title');
    if (titleEl) {
      const capName = room.name ? (room.name.charAt(0).toUpperCase() + room.name.slice(1)) : 'Room';
      titleEl.textContent = capName;
      titleEl.title = `Room: ${capName}`;
    }
    document.title = `${room.name} — WatchBeam`;

    // Initialize display mode
    applyViewMode(room.source || 'drawer');

    // Chat history
    if (room.messages?.length) {
      room.messages.forEach(addChatMessage);
    }
    updateQueueBadge();
    renderEmbeddedQueue();
    renderMembersList();

    // Connect WebSocket
    connectSocket(roomId, {
      onHistory: (msg) => {
        const sourceChanged = currentRoom.source !== msg.source;
        currentRoom.source = msg.source;
        if (msg.embedUrl) currentRoom.embedUrl = msg.embedUrl;
        if (msg.ytState) currentRoom.ytState = msg.ytState;
        if (msg.queue) currentRoom.queue = msg.queue;
        if (msg.users) currentRoom.users = msg.users;
        updateQueueBadge();
        renderEmbeddedQueue();
        renderMembersList();
        if (sourceChanged) {
          applyViewMode(msg.source);
        } else {
          updateDrawerCardLook();
        }
      },
      onModeChanged: (msg) => {
        currentRoom.source = msg.source;
        if (msg.embedUrl) currentRoom.embedUrl = msg.embedUrl;
        if (msg.ytState) currentRoom.ytState = msg.ytState;
        applyViewMode(msg.source);
        toast(`Room switched to ${msg.source === 'youtube' ? 'YouTube' : msg.source === 'hyperbeam' ? 'Browser' : 'App Drawer'}`, 'info');
      },
      onYtSync,
      onQueueUpdate: () => {
        updateQueueBadge();
        renderEmbeddedQueue();
      },
    });

  } catch (err) {
    toast(err.message, 'error');
    setTimeout(() => navigate('home'), 2000);
  }
}

function connectSocket(roomId, extraHandlers = {}) {
  const username = getUsername();

  roomSocket = new RoomSocket({
    history: (msg) => {
      if (msg.hyperbeam) {
        currentHbInfo = msg.hyperbeam;
      }
      if (msg.queue && currentRoom) {
        currentRoom.queue = msg.queue;
      }
      if (msg.users && currentRoom) {
        currentRoom.users = msg.users;
      }
      extraHandlers.onHistory?.(msg);
    },
    chat: (msg) => {
      addChatMessage(msg);
      if (!chatOpen || activeSidebarTab !== 'chat') {
        unreadCount++;
        document.getElementById('player-chat-badge')?.classList.remove('hidden');
        document.getElementById('mob-chat-badge')?.classList.remove('hidden');
      }
    },
    yt_sync: (msg) => {
      extraHandlers.onYtSync?.(msg);
    },
    yt_queue_update: (msg) => {
      if (currentRoom) {
        currentRoom.queue = msg.queue || [];
      }
      extraHandlers.onQueueUpdate?.(msg);
    },
    reaction: (msg) => {
      if (msg.emoji) spawnStageReaction(msg.emoji);
    },
    mode_changed: (msg) => {
      extraHandlers.onModeChanged?.(msg);
      const stageName = msg.source === 'youtube' ? 'YouTube' : msg.source === 'hyperbeam' ? 'Browser' : 'App Drawer';
      addSystemMessage({ icon: ICON_STAGE, text: `Stage switched to <strong>${stageName}</strong>` });
    },
    user_joined: (msg) => {
      addSystemMessage({ icon: ICON_JOIN, text: `<strong class="chat-sys-user">${escHtml(msg.username)}</strong> joined the room` }, 'join');
      updateUserCount(msg.userCount);
      if (msg.users && currentRoom) {
        currentRoom.users = msg.users;
      } else if (currentRoom) {
        if (!currentRoom.users) currentRoom.users = [];
        if (!currentRoom.users.includes(msg.username)) currentRoom.users.push(msg.username);
      }
      renderMembersList();
    },
    user_left: (msg) => {
      addSystemMessage({ icon: ICON_LEAVE, text: `<strong class="chat-sys-user">${escHtml(msg.username)}</strong> left the room` }, 'leave');
      updateUserCount(msg.userCount);
      if (msg.users && currentRoom) {
        currentRoom.users = msg.users;
      } else if (currentRoom?.users) {
        currentRoom.users = currentRoom.users.filter(u => u !== msg.username);
      }
      renderMembersList();
    },
    room_closed: (msg) => {
      toast(msg.message, 'info');
      setTimeout(() => navigate('home'), 2500);
    },
    error: (msg) => toast(msg.message, 'error'),
    disconnected: () => {
      addSystemMessage({ icon: ICON_INFO, text: 'Disconnected from server. Try refreshing.' });
    },
  });

  roomSocket.connect()
    .then(() => {
      roomSocket.join(roomId, username);
    })
    .catch(() => {
      toast('Could not connect to chat server.', 'error');
    });
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input?.value.trim();
  if (!text || !roomSocket) return;
  roomSocket.chat(text);
  input.value = '';
  input.style.height = 'auto';
  input.focus({ preventScroll: true });
}

function getAvatarColor(name) {
  const colors = [
    'linear-gradient(135deg, #ec4899, #f43f5e)',
    'linear-gradient(135deg, #8b5cf6, #6366f1)',
    'linear-gradient(135deg, #3b82f6, #06b6d4)',
    'linear-gradient(135deg, #10b981, #059669)',
    'linear-gradient(135deg, #f59e0b, #d97706)',
    'linear-gradient(135deg, #6366f1, #a855f7)',
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getSenderColor(name) {
  const colors = ['#f59e0b', '#38bdf8', '#ec4899', '#a855f7', '#34d399', '#f97316', '#60a5fa'];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getJumboEmojis(rawText) {
  if (!rawText) return null;
  const trimmed = rawText.trim();
  let remaining = trimmed;
  const matched = [];
  while (remaining.length > 0) {
    remaining = remaining.trimStart();
    if (!remaining) break;
    const found = EMOJI_WHITELIST_KEYS.find(e => remaining.startsWith(e));
    if (!found) return null;
    matched.push(found);
    remaining = remaining.slice(found.length);
  }
  if (matched.length >= 1 && matched.length <= 3) {
    return matched;
  }
  return null;
}

function renderMessageContent(text) {
  const jumbo = getJumboEmojis(text);
  if (jumbo) {
    const images = jumbo.map(e => {
      const hex = ANIMATED_EMOJI_WHITELIST[e];
      return `<img class="animated-emoji-jumbo" src="https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/512.webp" alt="${e}" loading="lazy" onerror="this.replaceWith(this.alt)" />`;
    }).join('');
    return { isJumbo: true, html: images };
  }

  let escaped = escHtml(text);
  for (const emoji of EMOJI_WHITELIST_KEYS) {
    const hex = ANIMATED_EMOJI_WHITELIST[emoji];
    const imgTag = `<img class="animated-emoji-inline" src="https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/512.webp" alt="${emoji}" loading="lazy" onerror="this.replaceWith(this.alt)" />`;
    escaped = escaped.split(emoji).join(imgTag);
  }
  return { isJumbo: false, html: escaped };
}

let lastChatMessage = null;
let lastSystemPlaybackEl = null;

function addChatMessage(msg) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  if (msg.isSystem) {
    addSystemMessage({ icon: ICON_INFO, text: escHtml(msg.text) });
    return;
  }

  const me = getUsername();
  const isSelf = msg.username === me;
  const isHost = currentRoom?.creator && msg.username === currentRoom.creator;
  const isMod = !isHost && (msg.role === 'mod' || (msg.username && msg.username.toLowerCase() === 'admin'));

  const isGrouped = lastChatMessage &&
    lastChatMessage.username === msg.username &&
    !lastChatMessage.isSystem &&
    (msg.ts - lastChatMessage.ts < 120000);

  const { isJumbo, html: contentHtml } = renderMessageContent(msg.text);
  const timeFormatted = formatTime(msg.ts);

  const row = document.createElement('div');
  row.className = `chat-row ${isSelf ? 'chat-row-self' : 'chat-row-other'} ${isGrouped ? 'grouped' : ''}`;

  if (isSelf) {
    row.innerHTML = `
      <div class="chat-bubble-wrap">
        <div class="chat-bubble ${isJumbo ? 'chat-bubble-jumbo' : `chat-bubble-self ${!isGrouped ? 'has-tail-self' : ''}`}">
          ${!isGrouped && !isJumbo ? `
            <svg class="chat-tail-self" viewBox="0 0 8 13" width="8" height="13" aria-hidden="true">
              <path opacity="0.13" fill="#000" d="M6.467 3.568L0 12.193V1h5.188c1.77 0 2.338 1.156 1.279 2.568z"/>
              <path fill="currentColor" d="M6.467 2.568L0 11.193V0h5.188c1.77 0 2.338 1.156 1.279 2.568z"/>
            </svg>
          ` : ''}
          ${isJumbo ? `
            <div class="chat-jumbo-body">
              <span class="chat-text">${contentHtml}</span>
              <span class="chat-meta chat-meta-self">
                <span class="chat-time">${timeFormatted}</span>
              </span>
            </div>
          ` : `
            <span class="chat-text">${contentHtml}</span>
            <span class="chat-meta chat-meta-self">
              <span class="chat-time">${timeFormatted}</span>
            </span>
          `}
        </div>
      </div>
    `;
  } else {
    const avatarColor = getAvatarColor(msg.username);
    const initial = (msg.username || '?').charAt(0).toUpperCase();
    const senderColor = isHost ? '#fbbf24' : isMod ? '#22d3ee' : getSenderColor(msg.username);

    row.innerHTML = `
      ${!isGrouped ? `
        <div class="chat-avatar" style="background: ${avatarColor};" title="${escHtml(msg.username)}">${initial}</div>
      ` : `
        <div class="chat-avatar chat-avatar-spacer" aria-hidden="true"></div>
      `}
      <div class="chat-bubble-wrap">
        <div class="chat-bubble ${isJumbo ? 'chat-bubble-jumbo' : `chat-bubble-other ${!isGrouped ? 'has-tail-other' : ''}`}">
          ${!isGrouped ? `
            ${!isJumbo ? `
              <svg class="chat-tail-other" viewBox="0 0 8 13" width="8" height="13" aria-hidden="true">
                <path opacity="0.13" fill="#000" d="M1.533 3.568L8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z"/>
                <path fill="currentColor" d="M1.533 2.568L8 11.193V0H2.812C1.042 0 .474 1.156 1.533 2.568z"/>
              </svg>
            ` : ''}
            <div class="chat-sender-name" style="color: ${senderColor};">
              ${escHtml(msg.username)}
              ${isHost ? '<span class="chat-role-pill role-host">HOST</span>' : isMod ? '<span class="chat-role-pill role-mod">MOD</span>' : ''}
            </div>
          ` : ''}
          ${isJumbo ? `
            <div class="chat-jumbo-body">
              <span class="chat-text">${contentHtml}</span>
              <span class="chat-meta">
                <span class="chat-time">${timeFormatted}</span>
              </span>
            </div>
          ` : `
            <span class="chat-text">${contentHtml}</span>
            <span class="chat-meta">
              <span class="chat-time">${timeFormatted}</span>
            </span>
          `}
        </div>
      </div>
    `;
  }

  container.appendChild(row);
  container.scrollTop = container.scrollHeight;

  lastChatMessage = { username: msg.username, ts: msg.ts, isSystem: false };
  lastSystemPlaybackEl = null;
}

function addSystemMessage(textOrOpts, category = 'general') {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  let textHtml = '';
  let icon = ICON_INFO;
  let isPlayback = false;

  if (typeof textOrOpts === 'object' && textOrOpts !== null) {
    textHtml = textOrOpts.text;
    icon = textOrOpts.icon || ICON_INFO;
    isPlayback = Boolean(textOrOpts.isPlayback);
  } else {
    textHtml = escHtml(String(textOrOpts));
    isPlayback = category === 'playback';
    if (category === 'join') icon = ICON_JOIN;
    else if (category === 'leave') icon = ICON_LEAVE;
    else if (category === 'stage') icon = ICON_STAGE;
    else if (category === 'play') icon = ICON_PLAY;
    else if (category === 'pause') icon = ICON_PAUSE;
    else if (category === 'seek') icon = ICON_SEEK;
  }

  // Auto-collapse or replace consecutive seek/pause system pills so scrubbing a video doesn't spam chat
  if (isPlayback && lastSystemPlaybackEl && container.lastElementChild === lastSystemPlaybackEl) {
    const iconEl = lastSystemPlaybackEl.querySelector('.chat-system-icon');
    const textEl = lastSystemPlaybackEl.querySelector('.chat-system-text');
    if (iconEl) iconEl.innerHTML = icon;
    if (textEl) textEl.innerHTML = textHtml;
    lastChatMessage = null;
    return;
  }

  const row = document.createElement('div');
  row.className = `chat-system-row ${isPlayback ? 'msg-system-playback' : ''}`;
  row.innerHTML = `
    <div class="chat-system-pill">
      <span class="chat-system-icon">${icon}</span>
      <span class="chat-system-text">${textHtml}</span>
    </div>
  `;

  container.appendChild(row);
  container.scrollTop = container.scrollHeight;

  if (isPlayback) {
    lastSystemPlaybackEl = row;
  } else {
    lastSystemPlaybackEl = null;
  }

  lastChatMessage = null;
}

function updateUserCount(count) {
  const badge = document.getElementById('room-user-count');
  const num = document.getElementById('user-count-num');
  const chatNum = document.getElementById('chat-user-count');
  if (badge) badge.style.display = 'inline-flex';
  if (num) num.textContent = count;
  if (chatNum) chatNum.textContent = `${count} watching`;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
(function boot() {
  const roomId = getUrlRoom();
  if (roomId) {
    history.replaceState({ view: 'room', roomId }, '', location.href);
    if (!getUsername()) {
      render('home');
      ensureUsername(() => navigate('room', roomId));
    } else {
      render('room', roomId);
    }
  } else {
    history.replaceState({ view: 'home' }, '', location.href);
    render('home');
  }
})();
