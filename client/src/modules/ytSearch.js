// ─── Inline YouTube Search & Discovery Engine (Queue Area) ───────────────────
// Zero-API-key scraper and public suggestions client embedded directly inside the Queue panel.

import { escHtml, toast } from '../utils.js';

let searchInputEl = null;
let searchBtnEl = null;
let normalViewEl = null;
let searchViewEl = null;
let chipsRowEl = null;
let resultsListEl = null;
let closeSearchBtnEl = null;

let currentOnPlay = null;
let currentOnQueue = null;
let debounceTimer = null;
let activeSearchQuery = '';

export function initQueueSearch({
  searchInput,
  searchBtn,
  normalView,
  searchView,
  chipsRow,
  resultsList,
  closeSearchBtn,
  onPlay,
  onQueue,
}) {
  searchInputEl = searchInput;
  searchBtnEl = searchBtn;
  normalViewEl = normalView;
  searchViewEl = searchView;
  chipsRowEl = chipsRow;
  resultsListEl = resultsList;
  closeSearchBtnEl = closeSearchBtn;
  currentOnPlay = onPlay;
  currentOnQueue = onQueue;

  // Prevent native spellcheck interference
  searchInputEl?.setAttribute('spellcheck', 'false');
  searchInputEl?.setAttribute('autocomplete', 'off');
  searchInputEl?.setAttribute('autocapitalize', 'off');

  closeSearchBtnEl?.addEventListener('click', () => {
    closeQueueSearch();
  });

  searchBtnEl?.addEventListener('click', () => {
    handleSearchSubmit();
  });

  searchInputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearchSubmit();
    } else if (e.key === 'Escape' && isQueueSearchActive()) {
      e.preventDefault();
      closeQueueSearch();
    }
  });

  searchInputEl?.addEventListener('input', () => {
    const val = (searchInputEl?.value || '').trim();
    if (!val) {
      if (chipsRowEl) chipsRowEl.classList.add('hidden');
      return;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      fetchSuggestions(val);
    }, 250);
  });
}

export function isQueueSearchActive() {
  return searchViewEl && !searchViewEl.classList.contains('hidden');
}

export function openQueueSearch(query = '') {
  if (normalViewEl) normalViewEl.classList.add('hidden');
  if (searchViewEl) searchViewEl.classList.remove('hidden');

  if (searchInputEl) {
    if (query) {
      searchInputEl.value = query;
    }
    searchInputEl.focus();
  }

  const q = (query || searchInputEl?.value || '').trim();
  if (q) {
    executeSearch(q);
  } else {
    renderPlaceholder();
  }
}

export function closeQueueSearch() {
  if (debounceTimer) clearTimeout(debounceTimer);
  activeSearchQuery = '';
  if (chipsRowEl) chipsRowEl.classList.add('hidden');
  if (searchViewEl) searchViewEl.classList.add('hidden');
  if (normalViewEl) normalViewEl.classList.remove('hidden');
  if (searchInputEl) searchInputEl.value = '';
}

function handleSearchSubmit() {
  const val = (searchInputEl?.value || '').trim();
  if (!val) return;

  // If YouTube link or video ID, let caller handle direct add/play if desired
  const directId = extractYouTubeId(val);
  if (directId) {
    if (currentOnQueue) {
      currentOnQueue(directId, 'YouTube Video');
    }
    if (searchInputEl) searchInputEl.value = '';
    closeQueueSearch();
    return;
  }

  openQueueSearch(val);
}

function extractYouTubeId(urlOrId) {
  if (!urlOrId) return null;
  const str = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  const match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/i);
  return match ? match[1] : null;
}

function renderPlaceholder() {
  if (!resultsListEl) return;
  resultsListEl.innerHTML = `
    <div class="queue-search-placeholder">
      <svg width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" class="queue-search-ghost-icon">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
      </svg>
      <p class="queue-search-placeholder-text">Search any video or song title to stream together</p>
    </div>
  `;
}

async function fetchSuggestions(prefix) {
  const q = prefix.trim();
  if (q.length < 2 || !chipsRowEl) {
    chipsRowEl?.classList.add('hidden');
    return;
  }

  try {
    const res = await fetch(`/api/yt/suggest?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    const { suggestions = [] } = await res.json();
    renderSuggestions(suggestions);
  } catch {}
}

function renderSuggestions(suggestions) {
  if (!chipsRowEl) return;
  if (!suggestions || suggestions.length === 0) {
    chipsRowEl.classList.add('hidden');
    return;
  }

  chipsRowEl.innerHTML = suggestions.slice(0, 6).map(s => `
    <button class="queue-suggest-chip" data-query="${escHtml(s)}">
      <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <span>${escHtml(s)}</span>
    </button>
  `).join('');

  chipsRowEl.classList.remove('hidden');

  chipsRowEl.querySelectorAll('.queue-suggest-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.query;
      if (searchInputEl) searchInputEl.value = q;
      chipsRowEl.classList.add('hidden');
      executeSearch(q);
    });
  });
}

export async function executeSearch(query) {
  const cleanQ = query.trim();
  if (!cleanQ || !resultsListEl) return;
  activeSearchQuery = cleanQ;

  resultsListEl.innerHTML = `
    <div class="queue-search-loading">
      <div class="spinner"></div>
      <p>Searching YouTube for "${escHtml(cleanQ)}"…</p>
    </div>
  `;

  try {
    const res = await fetch(`/api/yt/search?q=${encodeURIComponent(cleanQ)}`);
    if (!res.ok) throw new Error('Search failed');
    const { videos = [] } = await res.json();

    if (activeSearchQuery !== cleanQ) return; // Stale check

    if (!videos || videos.length === 0) {
      resultsListEl.innerHTML = `
        <div class="queue-search-empty">
          <p>No videos found for "${escHtml(cleanQ)}". Try another search term!</p>
        </div>
      `;
      return;
    }

    renderResults(videos);
  } catch (err) {
    if (activeSearchQuery !== cleanQ) return;
    resultsListEl.innerHTML = `
      <div class="queue-search-error">
        <p>Could not load results. Please check your connection and retry.</p>
      </div>
    `;
  }
}

function renderResults(videos) {
  if (!resultsListEl) return;

  resultsListEl.innerHTML = videos.map(v => `
    <div class="queue-result-card" data-vid="${v.id}" data-title="${escHtml(v.title)}">
      <div class="queue-result-thumb-wrap">
        <img class="queue-result-thumb" src="${v.thumbnail}" alt="${escHtml(v.title)}" loading="lazy" />
        <span class="queue-result-duration">${escHtml(v.duration || 'Video')}</span>
      </div>
      <div class="queue-result-info">
        <h4 class="queue-result-title" title="${escHtml(v.title)}">${escHtml(v.title)}</h4>
        <div class="queue-result-meta">
          <span class="queue-result-channel">${escHtml(v.channel)}</span>
          ${v.views ? `<span class="queue-result-views">• ${escHtml(v.views)}</span>` : ''}
        </div>
        <div class="queue-result-actions">
          <button class="queue-btn-play-now" data-vid="${v.id}" data-title="${escHtml(v.title)}" title="Play now">
            <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <span>Play</span>
          </button>
          <button class="queue-btn-add-queue" data-vid="${v.id}" data-title="${escHtml(v.title)}" title="Add to queue">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span>+ Queue</span>
          </button>
        </div>
      </div>
    </div>
  `).join('');

  // Wire buttons
  resultsListEl.querySelectorAll('.queue-btn-play-now').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const vid = btn.dataset.vid;
      const title = btn.dataset.title;
      if (vid && currentOnPlay) {
        currentOnPlay(vid, title);
        closeQueueSearch();
      }
    });
  });

  resultsListEl.querySelectorAll('.queue-btn-add-queue').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const vid = btn.dataset.vid;
      const title = btn.dataset.title;
      if (vid && currentOnQueue) {
        currentOnQueue(vid, title);
        btn.classList.add('added');
        btn.innerHTML = `<span>✓ Added</span>`;
        setTimeout(() => {
          btn.classList.remove('added');
          btn.innerHTML = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>+ Queue</span>`;
        }, 1500);
      }
    });
  });
}
