// ─── Integrated Expandable Emoji Drawer & Custom Quick Reactions ──────────────
// Embedded directly inside the chat panel. Fast, animated Noto emojis with customizable quick reactions.

import { escHtml, toast } from '../utils.js';

export const EMOJI_CATEGORIES = [
  {
    title: 'Popular Reactions',
    emojis: [
      { emoji: '🔥', hex: '1f525', name: 'Fire' },
      { emoji: '😂', hex: '1f602', name: 'Joy' },
      { emoji: '🤣', hex: '1f923', name: 'ROFL' },
      { emoji: '❤️', hex: '2764_fe0f', name: 'Heart' },
      { emoji: '💖', hex: '1f496', name: 'Sparkling Heart' },
      { emoji: '😍', hex: '1f60d', name: 'Heart Eyes' },
      { emoji: '🤩', hex: '1f929', name: 'Star-Struck' },
      { emoji: '🥳', hex: '1f973', name: 'Party Face' },
      { emoji: '😱', hex: '1f631', name: 'Scream' },
      { emoji: '😭', hex: '1f62d', name: 'Sob' },
      { emoji: '💀', hex: '1f480', name: 'Skull' },
      { emoji: '👏', hex: '1f44f', name: 'Clap' },
      { emoji: '🗿', hex: '1f5ff', name: 'Moai' },
    ],
  },
  {
    title: 'Vibes & Expressions',
    emojis: [
      { emoji: '😎', hex: '1f60e', name: 'Cool' },
      { emoji: '🥺', hex: '1f97a', name: 'Pleading' },
      { emoji: '🤬', hex: '1f92c', name: 'Cursing' },
      { emoji: '🥵', hex: '1f975', name: 'Hot Face' },
      { emoji: '😈', hex: '1f608', name: 'Imp Smile' },
      { emoji: '😹', hex: '1f639', name: 'Joy Cat' },
      { emoji: '🌚', hex: '1f31a', name: 'New Moon Face' },
      { emoji: '🤯', hex: '1f92f', name: 'Mind Blown' },
      { emoji: '🤤', hex: '1f924', name: 'Drool' },
      { emoji: '🤫', hex: '1f92b', name: 'Shh' },
      { emoji: '🫡', hex: '1fae1', name: 'Salute' },
      { emoji: '💩', hex: '1f4a9', name: 'Poop' },
      { emoji: '👻', hex: '1f47b', name: 'Ghost' },
      { emoji: '🤖', hex: '1f916', name: 'Robot' },
    ],
  },
  {
    title: 'Party, Actions & Media',
    emojis: [
      { emoji: '🎉', hex: '1f389', name: 'Party Popper' },
      { emoji: '✨', hex: '2728', name: 'Sparkles' },
      { emoji: '🚀', hex: '1f680', name: 'Rocket' },
      { emoji: '📈', hex: '1f4c8', name: 'Chart Increasing' },
      { emoji: '📉', hex: '1f4c9', name: 'Chart Decreasing' },
      { emoji: '🥀', hex: '1f940', name: 'Wilted Flower' },
      { emoji: '🍿', hex: '1f37f', name: 'Popcorn' },
      { emoji: '🍕', hex: '1f355', name: 'Pizza' },
      { emoji: '🎶', hex: '1f3b6', name: 'Notes' },
      { emoji: '💯', hex: '1f4af', name: 'Hundred' },
      { emoji: '👀', hex: '1f440', name: 'Eyes' },
      { emoji: '⚡', hex: '26a1', name: 'Zap' },
      { emoji: '💥', hex: '1f4a5', name: 'Boom' },
      { emoji: '🎯', hex: '1f3af', name: 'Target' },
      { emoji: '🎮', hex: '1f3ae', name: 'Game' },
      { emoji: '🎬', hex: '1f3ac', name: 'Clapper' },
      { emoji: '💤', hex: '1f4a4', name: 'Sleep' },
      { emoji: '👍', hex: '1f44d', name: 'Thumbs Up' },
      { emoji: '👋', hex: '1f44b', name: 'Wave' },
      { emoji: '🤝', hex: '1f91d', name: 'Handshake' },
      { emoji: '🙌', hex: '1f64c', name: 'Raised Hands' },
    ],
  },
];

// Flat lookup of emoji to Noto Animated WebP hex
export const ANIMATED_EMOJI_WHITELIST = {};
EMOJI_CATEGORIES.forEach(cat => {
  cat.emojis.forEach(item => {
    ANIMATED_EMOJI_WHITELIST[item.emoji] = item.hex;
  });
});
ANIMATED_EMOJI_WHITELIST['❤'] = '2764_fe0f';

export const DEFAULT_QUICK_REACTIONS = ['🔥', '😂', '❤️', '😱', '👏', '🎉', '😭', '💀'];
const STORAGE_KEY = 'wb_custom_quick_emojis';

export function getCustomQuickEmojis() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter(e => ANIMATED_EMOJI_WHITELIST[e]);
      }
    }
  } catch {}
  return [...DEFAULT_QUICK_REACTIONS];
}

export function saveCustomQuickEmojis(list) {
  try {
    const clean = (list || []).filter(e => ANIMATED_EMOJI_WHITELIST[e]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {}
}

let drawerContainerEl = null;
let isEditMode = false;
let sendEmojiCallback = null;
let quickEmojisChangedCallback = null;

export function initEmojiDrawer({ drawerEl, onSendEmoji, onQuickEmojisChanged }) {
  drawerContainerEl = drawerEl;
  sendEmojiCallback = onSendEmoji;
  quickEmojisChangedCallback = onQuickEmojisChanged;

  if (!drawerContainerEl) return;

  drawerContainerEl.innerHTML = `
    <div class="emoji-drawer-header">
      <div class="drawer-header-left">
        <span class="drawer-header-title">Quick Reactions</span>
        <span class="drawer-count-badge" id="drawer-count-badge">8/16</span>
      </div>
      <div class="drawer-header-actions">
        <button class="btn btn-ghost btn-sm drawer-reset-btn hidden" id="btn-drawer-reset" title="Reset to defaults">↺ Reset</button>
        <button class="btn btn-secondary btn-sm drawer-edit-btn" id="btn-drawer-toggle-edit">
          <span id="drawer-edit-btn-text">✏️ Edit</span>
        </button>
        <button class="btn-icon btn-sm drawer-close-btn" id="btn-drawer-close" title="Close drawer" aria-label="Close emoji drawer">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Unified Scrollable Body: Quick Emojis + All Library Categories scroll together -->
    <div class="drawer-scroll-body" id="drawer-scroll-body">
      <div class="drawer-edit-hint hidden" id="drawer-edit-hint">
        <span>Tap <strong>✕</strong> to remove, or click any emoji below to add</span>
      </div>

      <!-- Quick Emojis Row -->
      <div class="drawer-quick-row" id="drawer-quick-row"></div>

      <!-- Section Label for Library -->
      <div class="drawer-all-label">More Animated Emojis</div>

      <!-- Categorized Animated Emoji Grid -->
      <div class="drawer-library-scroll" id="drawer-library-scroll"></div>
    </div>
  `;

  // Event wiring
  document.getElementById('btn-drawer-close')?.addEventListener('click', () => {
    closeEmojiDrawer();
  });

  document.getElementById('btn-drawer-toggle-edit')?.addEventListener('click', () => {
    isEditMode = !isEditMode;
    renderDrawerQuickRow();
    renderDrawerLibrary();
  });

  document.getElementById('btn-drawer-reset')?.addEventListener('click', () => {
    saveCustomQuickEmojis(DEFAULT_QUICK_REACTIONS);
    quickEmojisChangedCallback?.(DEFAULT_QUICK_REACTIONS);
    renderDrawerQuickRow();
    renderDrawerLibrary();
    toast('Quick reactions reset to default', 'info');
  });

  renderDrawerQuickRow();
  renderDrawerLibrary();
}

export function isEmojiDrawerOpen() {
  return drawerContainerEl && drawerContainerEl.classList.contains('open');
}

export function toggleEmojiDrawer(forceState) {
  if (!drawerContainerEl) return;
  const shouldOpen = typeof forceState === 'boolean' ? forceState : !drawerContainerEl.classList.contains('open');

  if (shouldOpen) {
    isEditMode = false;
    renderDrawerQuickRow();
    renderDrawerLibrary();
    drawerContainerEl.classList.add('open');
    document.getElementById('btn-quick-reaction-more')?.classList.add('active');
  } else {
    isEditMode = false;
    drawerContainerEl.classList.remove('open');
    document.getElementById('btn-quick-reaction-more')?.classList.remove('active');
  }
}

export function closeEmojiDrawer() {
  toggleEmojiDrawer(false);
}

function renderDrawerQuickRow() {
  const container = document.getElementById('drawer-quick-row');
  const countBadge = document.getElementById('drawer-count-badge');
  const editText = document.getElementById('drawer-edit-btn-text');
  const resetBtn = document.getElementById('btn-drawer-reset');
  const hintEl = document.getElementById('drawer-edit-hint');

  if (!container) return;

  const quickList = getCustomQuickEmojis();
  if (countBadge) countBadge.textContent = `${quickList.length}/16`;
  if (editText) editText.textContent = isEditMode ? '✓ Done' : '✏️ Edit';
  if (resetBtn) resetBtn.classList.toggle('hidden', !isEditMode);
  if (hintEl) hintEl.classList.toggle('hidden', !isEditMode);

  container.className = `drawer-quick-row ${isEditMode ? 'in-edit-mode' : ''}`;
  container.innerHTML = quickList.map((emoji, index) => {
    const hex = ANIMATED_EMOJI_WHITELIST[emoji] || '1f525';
    return `
      <div class="drawer-slot" data-index="${index}" data-emoji="${escHtml(emoji)}">
        <button class="drawer-slot-btn" title="${isEditMode ? 'Remove emoji' : `Send ${emoji}`}">
          <img src="https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/512.webp" alt="${emoji}" class="drawer-slot-img" width="25" height="25" loading="lazy" onerror="this.replaceWith('${emoji}')" />
        </button>
        ${isEditMode ? `<button class="drawer-slot-remove" data-index="${index}" title="Remove">✕</button>` : ''}
      </div>
    `;
  }).join('');

  if (isEditMode && quickList.length < 16) {
    const addSlot = document.createElement('div');
    addSlot.className = 'drawer-slot-empty';
    addSlot.innerHTML = `<span class="slot-plus">+</span><span>Add</span>`;
    container.appendChild(addSlot);
  }

  // Wire actions
  container.querySelectorAll('.drawer-slot').forEach(slot => {
    const emoji = slot.dataset.emoji;
    const index = parseInt(slot.dataset.index, 10);
    const btn = slot.querySelector('.drawer-slot-btn');
    const removeBadge = slot.querySelector('.drawer-slot-remove');

    btn?.addEventListener('click', () => {
      if (isEditMode) {
        removeEmojiFromQuick(index);
      } else {
        sendEmojiCallback?.(emoji);
        closeEmojiDrawer();
      }
    });

    removeBadge?.addEventListener('click', (e) => {
      e.stopPropagation();
      removeEmojiFromQuick(index);
    });
  });
}

function removeEmojiFromQuick(index) {
  const list = getCustomQuickEmojis();
  if (list.length <= 1) {
    toast('Keep at least 1 quick reaction', 'warning');
    return;
  }
  list.splice(index, 1);
  saveCustomQuickEmojis(list);
  quickEmojisChangedCallback?.(list);
  renderDrawerQuickRow();
  renderDrawerLibrary();
}

function addEmojiToQuick(emoji) {
  const list = getCustomQuickEmojis();
  if (list.includes(emoji)) {
    toast('Already in your quick reactions', 'info');
    return;
  }
  if (list.length >= 16) {
    toast('Maximum 16 quick reactions reached', 'warning');
    return;
  }
  list.push(emoji);
  saveCustomQuickEmojis(list);
  quickEmojisChangedCallback?.(list);
  renderDrawerQuickRow();
  renderDrawerLibrary();
  toast(`Added ${emoji} to quick bar!`, 'success');
}

function renderDrawerLibrary() {
  const container = document.getElementById('drawer-library-scroll');
  if (!container) return;

  const currentQuick = getCustomQuickEmojis();

  container.innerHTML = EMOJI_CATEGORIES.map(cat => `
    <div class="drawer-cat-block">
      <div class="drawer-cat-title">${escHtml(cat.title)}</div>
      <div class="drawer-cat-grid">
        ${cat.emojis.map(item => {
          const inQuick = currentQuick.includes(item.emoji);
          return `
            <button class="drawer-emoji-item ${inQuick && isEditMode ? 'in-quick-active' : ''}" data-emoji="${escHtml(item.emoji)}" title="${escHtml(item.name)} (${item.emoji})">
              <img src="https://fonts.gstatic.com/s/e/notoemoji/latest/${item.hex}/512.webp" alt="${item.emoji}" class="drawer-emoji-img" width="25" height="25" loading="lazy" onerror="this.replaceWith('${item.emoji}')" />
              ${inQuick && isEditMode ? '<span class="drawer-in-quick-check">✓</span>' : ''}
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');

  // Wire library items
  container.querySelectorAll('.drawer-emoji-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.emoji;
      if (isEditMode) {
        addEmojiToQuick(emoji);
      } else {
        sendEmojiCallback?.(emoji);
        closeEmojiDrawer();
      }
    });
  });
}
