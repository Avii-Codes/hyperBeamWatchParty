import './style.css';
import { getUsername, setUsername, formatTime, getRoomUrl, escHtml, copyToClipboard, toast } from './utils.js';
import { RoomSocket } from './socket.js';

// ─── App state ────────────────────────────────────────────────────────────────
let currentView = 'home'; // 'home' | 'room'
let roomSocket = null;
let currentRoom = null;   // { id, name, embedUrl }
let unreadCount = 0;
let chatOpen = false;     // mobile

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
          ? `<span class="text-muted text-sm">Watching as</span>
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
        <span class="badge badge-purple"><span class="dot dot-pulse"></span> Powered by HyperBeam</span>
      </div>
      <h1 class="hero-title">Watch together,<br><span class="grad-text">anywhere.</span></h1>
      <p class="hero-sub">Create a room, share the link, and stream anything in a synchronized virtual browser — no installs, no sign-ups.</p>
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
      <div class="feature-item"><span class="feature-icon">🌐</span> Shared virtual browser</div>
      <div class="feature-item"><span class="feature-icon">💬</span> Live text chat</div>
      <div class="feature-item"><span class="feature-icon">📱</span> Works on any device</div>
      <div class="feature-item"><span class="feature-icon">🔗</span> Share via link</div>
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
  if (!list) return;
  list.innerHTML = `<div class="rooms-empty"><div class="spinner" style="margin:0 auto 12px"></div><p>Loading rooms…</p></div>`;

  try {
    const { rooms, maxRooms } = await api('/rooms');

    if (rooms.length === 0) {
      list.innerHTML = `
        <div class="rooms-empty" style="grid-column:1/-1">
          <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8"/><path d="M12 3v4"/></svg>
          <p style="font-weight:600;margin-bottom:4px">No active rooms</p>
          <p class="text-sm text-muted">Create a room to get started.</p>
        </div>`;
      return;
    }

    list.innerHTML = rooms.map(r => `
      <div class="room-card" data-room-id="${escHtml(r.id)}">
        <div class="room-card-top">
          <span class="room-card-name">${escHtml(r.name)}</span>
          <span class="badge badge-${r.userCount > 0 ? 'green' : 'cyan'}">
            <span class="dot ${r.userCount > 0 ? '' : ''}"></span>
            ${r.userCount} watching
          </span>
        </div>
        <div class="room-card-meta">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Created ${new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div class="room-card-actions">
          <button class="btn btn-primary btn-sm btn-join-room" data-room-id="${escHtml(r.id)}">Join Room</button>
          <button class="btn btn-ghost btn-sm btn-copy-room" data-room-id="${escHtml(r.id)}" title="Copy invite link">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy Link
          </button>
          <button class="btn btn-danger btn-sm btn-delete-room" data-room-id="${escHtml(r.id)}" title="Delete room">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
      </div>
    `).join('');

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

function showCreateRoomModal() {
  const backdrop = showModal(`
    <div class="modal-title">🎬 Create a Room</div>
    <div class="modal-desc">Give your watch party a name. Share the link with friends.</div>
    <div class="form-group">
      <label class="form-label" for="inp-room-name">Room Name</label>
      <input class="form-input" id="inp-room-name" type="text" placeholder="e.g. Friday Night Movies" maxlength="40" autocomplete="off" />
    </div>
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
    const { id } = await api('/rooms', { method: 'POST', body: { name } });
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
function renderRoom() {
  return `
  <div id="view-room">
    <header class="room-header" id="room-header">
      <div class="room-header-left">
        <button class="btn-icon" id="btn-back" title="Back to home">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div class="logo-icon" style="width:28px;height:28px;font-size:14px;border-radius:6px">🎬</div>
        <span class="room-header-title" id="room-title">Connecting…</span>
        <span class="badge badge-cyan" id="room-user-count" style="display:none">
          <span class="dot"></span> <span id="user-count-num">0</span> watching
        </span>
      </div>
      <div class="room-header-right">
        <button class="btn btn-ghost btn-sm" id="btn-copy-link">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span class="hide-xs">Invite</span>
        </button>
        <button class="btn-icon" id="btn-toggle-chat" title="Toggle chat">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </button>
        <button class="btn-icon" id="btn-fullscreen" title="Fullscreen">
          <svg id="fs-icon-enter" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          <svg id="fs-icon-exit" class="hidden" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
        </button>
      </div>
    </header>

    <div class="room-body">
      <div class="hb-container" id="hb-container">
        <div class="hb-loading" id="hb-loading">
          <div class="spinner"></div>
          <p class="text-muted text-sm">Loading virtual browser…</p>
        </div>
        <iframe class="hb-iframe hidden" id="hb-iframe"
          allow="autoplay; clipboard-write; clipboard-read; fullscreen; microphone; camera"
          allowfullscreen></iframe>

        <!-- Quick fullscreen button on player -->
        <button class="player-fs-btn" id="player-fs-btn" title="Toggle Fullscreen">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          <span class="fs-btn-text">Fullscreen</span>
        </button>

        <!-- Overlay controls shown in fullscreen on hover -->
        <div class="fs-corner-controls" id="fs-corner-controls">
          <button class="fs-corner-btn" id="fs-chat-toggle-btn">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span id="fs-chat-btn-label">Show Chat</span>
          </button>
          <button class="fs-corner-btn" id="fs-exit-btn">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
            Exit
          </button>
        </div>
      </div>

      <div class="chat-sidebar" id="chat-sidebar">
        <div class="chat-header">
          <div class="flex items-center gap-2">
            <span>Live Chat</span>
            <div class="online-indicator" id="online-indicator">
              <span class="dot dot-pulse" style="color:var(--green)"></span>
              <span id="chat-user-count">0 watching</span>
            </div>
          </div>
          <button class="btn-icon btn-sm" id="btn-close-chat" title="Hide chat">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-input-area">
          <textarea class="chat-textarea" id="chat-input" placeholder="Say something…" rows="1" maxlength="500"></textarea>
          <button class="chat-send-btn" id="chat-send">➤</button>
        </div>
      </div>
    </div>

    <!-- FAB: shown on mobile always, and in fullscreen on desktop -->
    <button class="chat-toggle-fab" id="chat-fab">
      💬
      <span class="badge-count hidden" id="unread-badge">0</span>
    </button>
    <!-- Dim overlay behind chat panel -->
    <div class="chat-dim-overlay" id="chat-dim-overlay"></div>
  </div>`;
}

async function initRoom(roomId) {
  unreadCount = 0;
  chatOpen = true;
  let fsActive = false;
  let fsChatOpen = false;

  const view     = document.getElementById('view-room');
  const sidebar  = document.getElementById('chat-sidebar');
  const fab      = document.getElementById('chat-fab');
  const dimOverlay = document.getElementById('chat-dim-overlay');

  function cleanupRoomListeners() {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
  }

  // ── Back button ──
  document.getElementById('btn-back').addEventListener('click', () => {
    cleanupRoomListeners();
    exitFs();
    if (roomSocket) { roomSocket.disconnect(); roomSocket = null; }
    navigate('home');
  });

  // ── Invite copy ──
  document.getElementById('btn-copy-link').addEventListener('click', async () => {
    const url = getRoomUrl(roomId);
    const ok = await copyToClipboard(url);
    if (ok) toast('Invite link copied!', 'success');
    else showInviteModal(url);
  });

  // ── Desktop: toggle chat sidebar ──
  document.getElementById('btn-toggle-chat').addEventListener('click', () => {
    if (fsActive) {
      toggleFsChat();
    } else {
      sidebar.classList.toggle('collapsed');
      chatOpen = !sidebar.classList.contains('collapsed');
      updateFabVisibility();
    }
  });

  // ── Close chat button (in chat header) ──
  document.getElementById('btn-close-chat')?.addEventListener('click', () => {
    if (fsActive) {
      closeFsChat();
    } else {
      closeMobileChat();
      sidebar.classList.add('collapsed');
      chatOpen = false;
      updateFabVisibility();
    }
  });

  // ── Fullscreen button (header) & Player Fullscreen button ──
  document.getElementById('btn-fullscreen').addEventListener('click', toggleFs);
  document.getElementById('player-fs-btn')?.addEventListener('click', toggleFs);

  // ── Fullscreen corner controls ──
  document.getElementById('fs-exit-btn').addEventListener('click', exitFs);
  document.getElementById('fs-chat-toggle-btn').addEventListener('click', toggleFsChat);

  // ── FAB (mobile + fullscreen) ──
  fab.addEventListener('click', () => {
    if (fsActive) {
      toggleFsChat();
    } else {
      toggleMobileChat();
    }
  });

  // ── Dim overlay closes chat ──
  dimOverlay.addEventListener('click', () => {
    if (fsActive) closeFsChat();
    else closeMobileChat();
  });

  // ── Escape key exits fullscreen ──
  document.addEventListener('keydown', onKeyDown);
  function onKeyDown(e) {
    if (e.key === 'Escape' && fsActive) exitFs();
  }

  // ── Native fullscreenchange event sync ──
  document.addEventListener('fullscreenchange', onFullscreenChange);
  function onFullscreenChange() {
    if (!document.fullscreenElement && fsActive) {
      exitFs();
    }
  }

  function updateFabVisibility() {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (fsActive) {
      fab.style.display = 'flex';
    } else if (isMobile) {
      // On mobile, show FAB only when chat is collapsed so user can reopen it
      fab.style.display = sidebar.classList.contains('collapsed') ? 'flex' : 'none';
    } else {
      fab.style.display = 'none';
    }
  }

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

  // ── Fullscreen helpers (close over local state) ──

  function toggleFs() {
    if (fsActive) exitFs(); else enterFs();
  }

  async function enterFs() {
    fsActive = true;
    view.classList.add('fs-active');

    try {
      if (!document.fullscreenElement && view.requestFullscreen) {
        await view.requestFullscreen();
      }
    } catch (_) {}

    updateFabVisibility();
    // Swap header icon
    document.getElementById('fs-icon-enter')?.classList.add('hidden');
    document.getElementById('fs-icon-exit')?.classList.remove('hidden');

    // In fullscreen, start with chat overlay closed or open based on preference
    // Let's close overlay by default in fullscreen for clean full view, user taps Chat to show
    closeFsChat();
  }

  async function exitFs() {
    if (!fsActive) return;
    fsActive = false;
    view.classList.remove('fs-active');

    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (_) {}

    updateFabVisibility();
    // Swap icon back
    document.getElementById('fs-icon-enter')?.classList.remove('hidden');
    document.getElementById('fs-icon-exit')?.classList.add('hidden');
    // Close fs chat overlay
    closeFsChat();
    // Restore sidebar normal state
    sidebar.classList.remove('collapsed');
    chatOpen = true;
  }

  function toggleFsChat() {
    if (fsChatOpen) closeFsChat(); else openFsChat();
  }

  function openFsChat() {
    fsChatOpen = true;
    chatOpen = true;
    sidebar.classList.add('fs-chat-open');
    dimOverlay.classList.add('active');
    unreadCount = 0;
    document.getElementById('unread-badge')?.classList.add('hidden');
    const label = document.getElementById('fs-chat-btn-label');
    if (label) label.textContent = 'Hide Chat';
    const msgs = document.getElementById('chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  function closeFsChat() {
    fsChatOpen = false;
    chatOpen = false;
    sidebar.classList.remove('fs-chat-open');
    dimOverlay.classList.remove('active');
    const label = document.getElementById('fs-chat-btn-label');
    if (label) label.textContent = 'Show Chat';
  }

  // Load room data & connect
  try {
    const room = await api(`/rooms/${roomId}`);
    currentRoom = room;

    document.getElementById('room-title').textContent = room.name;
    document.title = `${room.name} — WatchBeam`;

    // Load HyperBeam iframe
    const iframe = document.getElementById('hb-iframe');
    iframe.src = room.embedUrl;
    iframe.addEventListener('load', () => {
      document.getElementById('hb-loading').classList.add('hidden');
      iframe.classList.remove('hidden');
    });
    // Fallback: show after 5s
    setTimeout(() => {
      document.getElementById('hb-loading')?.classList.add('hidden');
      iframe.classList.remove('hidden');
    }, 5000);

    // Chat history
    if (room.messages?.length) {
      room.messages.forEach(addChatMessage);
    }

    // Connect WebSocket
    connectSocket(roomId);

  } catch (err) {
    toast(err.message, 'error');
    setTimeout(() => navigate('home'), 2000);
  }
}

function connectSocket(roomId) {
  const username = getUsername();

  roomSocket = new RoomSocket({
    history: (msg) => { /* already loaded via REST */ },
    chat: (msg) => {
      addChatMessage(msg);
      if (!chatOpen) {
        unreadCount++;
        const badge = document.getElementById('unread-badge');
        if (badge) {
          badge.textContent = unreadCount;
          badge.classList.remove('hidden');
        }
      }
    },
    user_joined: (msg) => {
      addSystemMessage(`${msg.username} joined the party 🎉`);
      updateUserCount(msg.userCount);
    },
    user_left: (msg) => {
      addSystemMessage(`${msg.username} left`);
      updateUserCount(msg.userCount);
    },
    room_closed: (msg) => {
      toast(msg.message, 'info');
      setTimeout(() => navigate('home'), 2500);
    },
    error: (msg) => toast(msg.message, 'error'),
    disconnected: () => {
      addSystemMessage('⚡ Disconnected from server. Try refreshing.');
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
  input.focus();
}

function addChatMessage(msg) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const me = getUsername();
  const isSelf = msg.username === me;

  const el = document.createElement('div');
  el.className = `msg msg-chat${isSelf ? ' self' : ''}`;
  el.innerHTML = `
    <div class="msg-username">${escHtml(msg.username)}</div>
    <div class="msg-text">${escHtml(msg.text)}</div>
    <div class="msg-time">${formatTime(msg.ts)}</div>
  `;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function addSystemMessage(text) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'msg msg-system';
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function updateUserCount(count) {
  const badge = document.getElementById('room-user-count');
  const num = document.getElementById('user-count-num');
  const chatNum = document.getElementById('chat-user-count');
  if (badge) badge.style.display = 'inline-flex';
  if (num) num.textContent = count;
  if (chatNum) chatNum.textContent = `${count} watching`;
}

function openMobileChat() {
  const sidebar = document.getElementById('chat-sidebar');
  const dim = document.getElementById('chat-dim-overlay');
  const fab = document.getElementById('chat-fab');
  sidebar?.classList.remove('collapsed');
  dim?.classList.add('active');
  if (fab) fab.style.display = 'none';
  chatOpen = true;
  unreadCount = 0;
  const badge = document.getElementById('unread-badge');
  if (badge) badge.classList.add('hidden');
  const msgs = document.getElementById('chat-messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function closeMobileChat() {
  const sidebar = document.getElementById('chat-sidebar');
  const dim = document.getElementById('chat-dim-overlay');
  const fab = document.getElementById('chat-fab');
  sidebar?.classList.add('collapsed');
  dim?.classList.remove('active');
  if (fab) fab.style.display = 'flex';
  chatOpen = false;
}

function toggleMobileChat() {
  const sidebar = document.getElementById('chat-sidebar');
  if (sidebar?.classList.contains('collapsed')) openMobileChat();
  else closeMobileChat();
}

function showInviteModal(url) {
  const backdrop = showModal(`
    <div class="modal-title">🔗 Invite Link</div>
    <div class="modal-desc">Share this link with friends to join your watch party.</div>
    <div class="copy-row">
      <input class="copy-input" id="inv-url" readonly value="${escHtml(url)}" />
      <button class="btn btn-primary btn-sm" id="inv-copy">Copy</button>
    </div>
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn btn-ghost" id="modal-close">Close</button>
    </div>
  `);
  backdrop.querySelector('#inv-url').select();
  backdrop.querySelector('#modal-close').onclick = () => backdrop.remove();
  backdrop.querySelector('#inv-copy').addEventListener('click', async () => {
    const ok = await copyToClipboard(url);
    toast(ok ? 'Copied!' : 'Please copy manually.', ok ? 'success' : 'info');
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
(function boot() {
  const roomId = getUrlRoom();
  if (roomId) {
    // Deep link: check username first
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
