// ─── WhatsApp-Style Chat Replies, Swipe Gestures, & Mentions ───────────────
// Full quote previews, mobile swipe-to-reply gesture, click-to-scroll, and mention pings.

import { escHtml, getUsername, formatTime } from '../utils.js';

let activeReplyTarget = null;
let onReplyStateChange = null;

export function initChatReplies({ onStateChange }) {
  onReplyStateChange = onStateChange;

  const bar = document.getElementById('chat-active-reply-bar');
  if (bar) {
    document.getElementById('btn-close-reply-bar')?.addEventListener('click', clearReplyTarget);
  }

  // Escape key cancels reply
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeReplyTarget) {
      clearReplyTarget();
    }
  });
}

export function getReplyTarget() {
  return activeReplyTarget;
}

export function setReplyTarget(msg) {
  if (!msg || !msg.username) return;
  activeReplyTarget = {
    id: msg.id || '',
    username: msg.username,
    text: (msg.text || '').slice(0, 90),
  };

  const bar = document.getElementById('chat-active-reply-bar');
  const userEl = document.getElementById('reply-bar-user');
  const textEl = document.getElementById('reply-bar-text');

  if (bar && userEl && textEl) {
    userEl.textContent = activeReplyTarget.username;
    textEl.textContent = activeReplyTarget.text || 'Message';
    bar.classList.remove('hidden');
  }

  onReplyStateChange?.(activeReplyTarget);

  const input = document.getElementById('chat-input');
  if (input) {
    input.focus({ preventScroll: true });
  }
}

export function clearReplyTarget() {
  activeReplyTarget = null;
  const bar = document.getElementById('chat-active-reply-bar');
  if (bar) {
    bar.classList.add('hidden');
  }
  onReplyStateChange?.(null);
}

/**
 * Formats quote snippet preview with command and mention badges
 */
function formatQuoteSnippet(text) {
  let s = escHtml(text || 'Message');
  s = s.replace(/(^|\s)(\/(?:play|pause|resume|unpause|skip|next|queue|add|clear|help)\b[^\s<]*)/gi, '$1<span class="chat-cmd-pill">$2</span>');
  s = s.replace(/(^|\s)@([a-zA-Z0-9_-]+)/g, '$1<span class="chat-mention-pill chat-mention-user">@$2</span>');
  return s;
}

/**
 * Builds the HTML string for a quoted message inside a WhatsApp-style bubble
 */
export function renderQuoteHtml(replyTo) {
  if (!replyTo || !replyTo.username) return '';
  const snippet = formatQuoteSnippet(replyTo.text);
  const author = escHtml(replyTo.username);

  return `
    <div class="chat-reply-quote" data-target-id="${escHtml(replyTo.id || '')}" title="Click to view original message">
      <div class="reply-quote-bar"></div>
      <div class="reply-quote-content">
        <span class="reply-quote-author">${author}</span>
        <span class="reply-quote-snippet">${snippet}</span>
      </div>
    </div>
  `;
}

/**
 * Attaches click-to-scroll to quote cards
 */
export function wireQuoteClicks(container) {
  container.querySelectorAll('.chat-reply-quote').forEach(quote => {
    quote.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetId = quote.dataset.targetId;
      if (!targetId) return;

      const targetEl = document.getElementById(`msg-${targetId}`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetEl.classList.remove('reply-flash');
        // Trigger reflow to restart animation
        void targetEl.offsetWidth;
        targetEl.classList.add('reply-flash');
        setTimeout(() => targetEl.classList.remove('reply-flash'), 1800);
      }
    });
  });
}

/**
 * Attaches WhatsApp-style swipe-to-reply gesture on mobile touch screens
 * and desktop hover reply button
 */
export function attachMessageInteractions(row, msg) {
  const bubbleWrap = row.querySelector('.chat-bubble-wrap');
  if (!bubbleWrap) return;

  // Add swipe reply icon container (emerges from the left when swiping right)
  const swipeIcon = document.createElement('div');
  swipeIcon.className = 'swipe-reply-icon';
  swipeIcon.innerHTML = `
    <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
      <polyline points="9 17 4 12 9 7"/>
      <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
    </svg>
  `;
  row.insertBefore(swipeIcon, bubbleWrap);

  // Desktop hover reply button
  const hoverBtn = document.createElement('button');
  hoverBtn.className = 'chat-bubble-reply-btn';
  hoverBtn.title = 'Reply (or double-click)';
  hoverBtn.setAttribute('aria-label', 'Reply to message');
  hoverBtn.innerHTML = `
    <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
      <polyline points="9 17 4 12 9 7"/>
      <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
    </svg>
  `;
  hoverBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setReplyTarget(msg);
  });
  bubbleWrap.appendChild(hoverBtn);

  // Desktop double-click to reply directly on message
  bubbleWrap.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    setReplyTarget(msg);
  });

  // Touch handlers for mobile swipe-to-reply
  let startX = 0;
  let startY = 0;
  let isSwiping = false;
  let currentDeltaX = 0;
  const SWIPE_THRESHOLD = 38;

  row.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isSwiping = false;
    currentDeltaX = 0;
    bubbleWrap.style.transition = 'none';
    swipeIcon.style.transition = 'none';
  }, { passive: true });

  row.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    // Only activate if mostly horizontal swipe to the right
    if (!isSwiping) {
      if (dx > 8 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        isSwiping = true;
      } else {
        return;
      }
    }

    if (isSwiping && dx > 0) {
      // Resistance curve for realistic spring drag
      currentDeltaX = Math.min(dx * 0.45, 52);
      bubbleWrap.style.transform = `translateX(${currentDeltaX}px)`;

      const progress = Math.min(currentDeltaX / SWIPE_THRESHOLD, 1);
      swipeIcon.style.opacity = String(progress);
      swipeIcon.style.transform = `translateY(-50%) scale(${0.7 + progress * 0.35})`;

      if (currentDeltaX >= SWIPE_THRESHOLD) {
        swipeIcon.classList.add('active');
      } else {
        swipeIcon.classList.remove('active');
      }
    }
  }, { passive: true });

  row.addEventListener('touchend', () => {
    if (isSwiping) {
      if (currentDeltaX >= SWIPE_THRESHOLD) {
        try { navigator.vibrate?.(12); } catch {}
        setReplyTarget(msg);
      }
    }

    // Spring back
    bubbleWrap.style.transition = 'transform 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    swipeIcon.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    bubbleWrap.style.transform = 'translateX(0)';
    swipeIcon.style.opacity = '0';
    swipeIcon.style.transform = 'translateY(-50%) scale(0.6)';
    swipeIcon.classList.remove('active');
    isSwiping = false;
  }, { passive: true });
}

// ─── In-App Floating Autocomplete for @Mentions, @ai & /Slash Commands ─────────

const SLASH_COMMANDS = [
  { cmd: '/play', desc: 'Play video or resume playback', icon: '▶️', syntax: '/play [title or link]' },
  { cmd: '/pause', desc: 'Pause current playback', icon: '⏸️', syntax: '/pause' },
  { cmd: '/resume', desc: 'Resume playback', icon: '▶️', syntax: '/resume' },
  { cmd: '/skip', desc: 'Play next queued video', icon: '⏭️', syntax: '/skip' },
  { cmd: '/queue', desc: 'Add video to queue', icon: '📋', syntax: '/queue <title or link>' },
  { cmd: '/clear', desc: 'Clear all queued videos', icon: '🗑️', syntax: '/clear' },
  { cmd: '/help', desc: 'Show all bot commands', icon: '❓', syntax: '/help' },
];

const AI_SUGGESTIONS = [
  { text: '@ai recommend a movie', desc: 'Movie & video recommendations', icon: '🍿' },
  { text: '@ai what should we watch?', desc: 'Discover watch party ideas', icon: '🎬' },
  { text: '@ai joke', desc: 'Tell a funny movie joke', icon: '😄' },
  { text: '@ai help', desc: 'Explore all AI assistant capabilities', icon: '🤖' },
];

export function isAutocompleteOpen() {
  const el = document.getElementById('chat-autocomplete-dropdown');
  return el && !el.classList.contains('hidden');
}

export function initChatAutocomplete({ inputEl, getRoomUsers }) {
  if (!inputEl) return;

  // Prevent native spellcheck and OS tooltips from interfering
  inputEl.setAttribute('spellcheck', 'false');
  inputEl.setAttribute('autocomplete', 'off');
  inputEl.setAttribute('autocapitalize', 'off');
  inputEl.setAttribute('autocorrect', 'off');

  let dropdownEl = document.getElementById('chat-autocomplete-dropdown');
  if (!dropdownEl) {
    dropdownEl = document.createElement('div');
    dropdownEl.id = 'chat-autocomplete-dropdown';
    dropdownEl.className = 'chat-autocomplete-dropdown hidden';
    // Insert directly before or inside chat input area
    const inputArea = inputEl.closest('.chat-input-area') || inputEl.parentElement;
    inputArea.style.position = 'relative';
    inputArea.appendChild(dropdownEl);
  }

  let activeItems = [];
  let selectedIndex = 0;
  let activeTriggerType = null; // 'slash' | 'mention' | 'ai'
  let activeTokenMatch = null;

  function hideDropdown() {
    dropdownEl.classList.add('hidden');
    dropdownEl.innerHTML = '';
    activeItems = [];
    selectedIndex = 0;
    activeTriggerType = null;
    activeTokenMatch = null;
  }

  function renderDropdown() {
    if (!activeItems.length) {
      hideDropdown();
      return;
    }

    if (selectedIndex >= activeItems.length) selectedIndex = 0;
    if (selectedIndex < 0) selectedIndex = activeItems.length - 1;

    dropdownEl.innerHTML = activeItems.map((item, idx) => {
      const isSel = idx === selectedIndex;
      const title = escHtml(item.cmd || item.text || item.name);
      const desc = escHtml(item.desc || '');
      const badge = item.badge ? `<span class="autocomplete-badge">${escHtml(item.badge)}</span>` : '';
      const icon = item.icon || '💬';

      return `
        <div class="chat-autocomplete-item ${isSel ? 'selected' : ''}" data-index="${idx}">
          <span class="autocomplete-icon">${icon}</span>
          <div class="autocomplete-info">
            <div class="autocomplete-top-line">
              <span class="autocomplete-title">${title}</span>
              ${badge}
            </div>
            ${desc ? `<span class="autocomplete-desc">${desc}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    dropdownEl.classList.remove('hidden');

    // Wire clicks on items
    dropdownEl.querySelectorAll('.chat-autocomplete-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep focus on textarea
        const idx = parseInt(el.dataset.index, 10);
        selectItem(activeItems[idx]);
      });
    });

    // Ensure selected item is scrolled into view
    const selEl = dropdownEl.querySelector('.chat-autocomplete-item.selected');
    selEl?.scrollIntoView({ block: 'nearest' });
  }

  function selectItem(item) {
    if (!item) return;
    const val = inputEl.value;
    const cursor = inputEl.selectionStart;
    const beforeCursor = val.slice(0, cursor);
    const afterCursor = val.slice(cursor);

    let replacement = '';
    let startIdx = 0;

    if (activeTriggerType === 'slash') {
      startIdx = beforeCursor.lastIndexOf('/');
      replacement = (item.cmd || item.text) + ' ';
    } else if (activeTriggerType === 'mention' || activeTriggerType === 'ai') {
      startIdx = beforeCursor.lastIndexOf('@');
      replacement = (item.text || `@${item.name}`) + ' ';
    }

    if (startIdx >= 0) {
      const newVal = val.slice(0, startIdx) + replacement + afterCursor;
      inputEl.value = newVal;
      const newCursor = startIdx + replacement.length;
      inputEl.setSelectionRange(newCursor, newCursor);
    }

    hideDropdown();
    inputEl.focus({ preventScroll: true });
  }

  function checkTrigger() {
    const val = inputEl.value;
    const cursor = inputEl.selectionStart;
    const textBefore = val.slice(0, cursor);

    // 1. Check for slash commands: `/` at beginning or line start
    const slashMatch = textBefore.match(/(?:^|\n)\/([a-z0-9_-]*)$/i);
    if (slashMatch) {
      activeTriggerType = 'slash';
      activeTokenMatch = slashMatch;
      const prefix = slashMatch[1].toLowerCase();
      activeItems = SLASH_COMMANDS.filter(c => c.cmd.slice(1).toLowerCase().startsWith(prefix));
      selectedIndex = 0;
      renderDropdown();
      return;
    }

    // 2. Check for @ mentions: `@` at start or after whitespace
    const atMatch = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_-]*)$/);
    if (atMatch) {
      const prefix = atMatch[1].toLowerCase();
      activeTokenMatch = atMatch;

      // If user typed `@ai`
      if (prefix === 'ai') {
        activeTriggerType = 'ai';
        activeItems = AI_SUGGESTIONS;
        selectedIndex = 0;
        renderDropdown();
        return;
      }

      activeTriggerType = 'mention';
      const items = [];

      // Add WatchBot (@ai)
      if (!prefix || 'ai'.startsWith(prefix) || 'watchbot'.includes(prefix)) {
        items.push({
          name: 'ai',
          text: '@ai',
          desc: 'WatchBot Room Assistant & Playback Bot',
          badge: 'Bot',
          icon: '🤖',
        });
      }

      // Add active room users
      const me = getUsername() || '';
      const allUsers = (getRoomUsers?.() || []).filter(u => u && u !== me);
      for (const u of allUsers) {
        if (!prefix || u.toLowerCase().includes(prefix)) {
          items.push({
            name: u,
            text: `@${u}`,
            desc: 'Room Member',
            badge: 'User',
            icon: '👤',
          });
        }
      }

      activeItems = items;
      selectedIndex = 0;
      renderDropdown();
      return;
    }

    hideDropdown();
  }

  inputEl.addEventListener('input', checkTrigger);
  inputEl.addEventListener('click', checkTrigger);

  inputEl.addEventListener('keydown', (e) => {
    if (dropdownEl.classList.contains('hidden') || !activeItems.length) {
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      selectedIndex = (selectedIndex + 1) % activeItems.length;
      renderDropdown();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      selectedIndex = (selectedIndex - 1 + activeItems.length) % activeItems.length;
      renderDropdown();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      selectItem(activeItems[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      hideDropdown();
    }
  }, { capture: true });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!dropdownEl.contains(e.target) && e.target !== inputEl) {
      hideDropdown();
    }
  });
}

