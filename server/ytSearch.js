// ─── Free YouTube Video Search & Autocomplete Provider ─────────────────────
// Zero-API-key scraper and public suggestions client. Lightweight & Render-safe.

const searchCache = new Map();
const CACHE_MAX = 80;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCached(key) {
  const item = searchCache.get(key);
  if (!item) return null;
  if (Date.now() - item.ts > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data) {
  if (searchCache.size >= CACHE_MAX) {
    const oldestKey = searchCache.keys().next().value;
    searchCache.delete(oldestKey);
  }
  searchCache.set(key, { data, ts: Date.now() });
}

/**
 * Searches YouTube for videos matching query without API keys.
 * Returns array of { id, title, channel, duration, thumbnail, views }
 */
export async function searchYouTube(query, limit = 8) {
  const cleanQ = (query || '').trim();
  if (!cleanQ) return [];

  const cacheKey = `search:${cleanQ.toLowerCase()}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQ)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) {
    throw new Error(`YouTube search failed with status ${res.status}`);
  }

  const html = await res.text();
  const match = html.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
  if (!match) return [];

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch (err) {
    console.warn('[YTSearch] Failed to parse ytInitialData JSON:', err.message);
    return [];
  }

  const contents = parsed?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const itemSection = contents.find(c => c?.itemSectionRenderer)?.itemSectionRenderer;
  const rawItems = itemSection?.contents || [];

  const videos = [];
  for (const item of rawItems) {
    const v = item?.videoRenderer;
    if (!v || !v.videoId) continue;

    const id = v.videoId;
    const title = v.title?.runs?.[0]?.text || 'Untitled Video';
    const channel = v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || 'YouTube Creator';
    const duration = v.lengthText?.simpleText || 'Live';
    const thumbnail = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
    const views = v.viewCountText?.simpleText || '';

    videos.push({ id, title, channel, duration, thumbnail, views });
    if (videos.length >= limit) break;
  }

  setCache(cacheKey, videos);
  return videos;
}

/**
 * Fetches instant autocomplete suggestions for query
 */
export async function getSuggestions(prefix) {
  const q = (prefix || '').trim();
  if (!q) return [];

  const cacheKey = `suggest:${q.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    if (!res.ok) return [];

    const text = await res.text();
    // Format: window.google.ac.h(["query",[["suggestion 1",0,[...]], ...]])
    const jsonMatch = text.match(/\((.+)\)$/);
    if (!jsonMatch) return [];

    const data = JSON.parse(jsonMatch[1]);
    const suggestions = (data?.[1] || []).map(item => item[0]).filter(Boolean).slice(0, 6);

    setCache(cacheKey, suggestions);
    return suggestions;
  } catch (err) {
    return [];
  }
}

/**
 * Resolves a YouTube video ID to its real title using YouTube's public oEmbed API.
 * Free, zero-API-key, and lightweight.
 */
export async function fetchVideoTitle(videoId) {
  const cleanId = (videoId || '').trim();
  if (!cleanId) return null;

  const cacheKey = `title:${cleanId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(cleanId)}&format=json`;
    const res = await fetch(oembedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data && data.title) {
        setCache(cacheKey, data.title);
        return data.title;
      }
    }
  } catch (err) {
    // If oembed fails, try noembed fallback
  }

  try {
    const res2 = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${encodeURIComponent(cleanId)}`);
    if (res2.ok) {
      const data2 = await res2.json();
      if (data2 && data2.title) {
        setCache(cacheKey, data2.title);
        return data2.title;
      }
    }
  } catch {}

  return null;
}

