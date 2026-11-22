// Local storage helpers
const LS_USERNAME = 'wb_username';

export function getUsername() {
  return localStorage.getItem(LS_USERNAME) || '';
}

export function setUsername(name) {
  localStorage.setItem(LS_USERNAME, name.trim().slice(0, 30));
}

// Time formatting (WhatsApp style: 3:48 pm without leading zeros on hour)
export function formatTime(ts) {
  const d = new Date(ts);
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes} ${ampm}`;
}

// Generate a shareable room URL
export function getRoomUrl(roomId) {
  return `${location.origin}${location.pathname}?room=${roomId}`;
}

// Escape HTML
export function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Extract YouTube video ID from various link formats (short, long, embed, or ID)
export function extractYouTubeId(urlOrId) {
  if (!urlOrId) return null;
  const str = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  const match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
  return match ? match[1] : null;
}

// Copy text to clipboard
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Toast system
let _toastContainer = null;
function getToastContainer() {
  if (!_toastContainer) {
    _toastContainer = document.createElement('div');
    _toastContainer.id = 'toast-container';
    document.body.appendChild(_toastContainer);
  }
  return _toastContainer;
}

export function toast(message, type = 'info', duration = 3500) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type]}</span> <span>${escHtml(message)}</span>`;
  const container = getToastContainer();
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, duration);
}
