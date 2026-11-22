// ─── Discord-Style Slash Commands & Free AI Room Assistant ───────────────────
// Zero-cost, runs on Node server with YouTube search, playback controls & conversational AI.

import { searchYouTube, fetchVideoTitle } from './ytSearch.js';

export function extractYouTubeId(urlOrId = '') {
  if (!urlOrId) return null;
  const str = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  const match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/i);
  return match ? match[1] : null;
}

export function isCommandOrAiTrigger(text = '') {
  const t = text.trim();
  if (t.startsWith('/')) return true;
  const lower = t.toLowerCase();
  return lower.includes('@ai') || lower.includes('@bot');
}

/**
 * Processes a Discord-style slash command or conversational @ai message
 */
export async function handleAiCommand({ room, client, rawText, userMsgId, broadcastToRoom }) {
  const trimmed = rawText.trim();

  // Helper to send bot reply in chat
  function sendBotReply(replyText) {
    const botMsg = {
      id: Math.random().toString(36).slice(2, 10),
      type: 'chat',
      username: 'WatchBot',
      role: 'ai',
      text: replyText,
      replyTo: {
        id: userMsgId,
        username: client.username,
        text: rawText.slice(0, 100),
      },
      ts: Date.now(),
    };
    room.messages.push(botMsg);
    if (room.messages.length > 200) room.messages.shift();
    broadcastToRoom(room.id, botMsg);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // A. Discord-Style Slash Commands (/play, /pause, /resume, /skip, /queue, /clear, /help)
  // ─────────────────────────────────────────────────────────────────────────────
  if (trimmed.startsWith('/')) {
    const parts = trimmed.slice(1).trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim();

    // 1. /play [query or url]
    if (command === 'play') {
      if (!args) {
        // If no argument: resume playback if paused in YouTube mode
        if (room.source === 'youtube' && room.ytState) {
          if (!room.ytState.isPlaying) {
            room.ytState.isPlaying = true;
            room.ytState.lastUpdate = Date.now();
            broadcastToRoom(room.id, {
              type: 'yt_sync',
              action: 'play',
              time: room.ytState.time || 0,
              username: 'WatchBot',
            });
            sendBotReply('Resumed playback ▶️');
          } else {
            sendBotReply('Playback is already running! Use `/play <song or link>` to change video.');
          }
          return;
        } else if (room.queue && room.queue.length > 0) {
          // Play first item from queue if stopped
          const nextItem = room.queue.shift();
          room.source = 'youtube';
          room.ytState = { videoId: nextItem.videoId, time: 0, isPlaying: true, lastUpdate: Date.now() };
          broadcastToRoom(room.id, { type: 'mode_changed', source: 'youtube', username: 'WatchBot' });
          broadcastToRoom(room.id, { type: 'yt_sync', action: 'change_video', videoId: nextItem.videoId, username: 'WatchBot' });
          broadcastToRoom(room.id, { type: 'yt_queue_update', queue: room.queue, username: 'WatchBot' });
          sendBotReply(`Playing next from queue: **${nextItem.title || nextItem.videoId}** 🎬`);
          return;
        } else {
          sendBotReply('What should I play? Try `/play <song or link>` (e.g. `/play lofi girl` or `/play sunflower`) 🎶');
          return;
        }
      }

      // Check if direct link or video ID
      const directId = extractYouTubeId(args);
      let targetId = directId;
      let targetTitle = args;

      if (directId) {
        const resolved = await fetchVideoTitle(directId);
        if (resolved) targetTitle = resolved;
      } else {
        try {
          const results = await searchYouTube(args, 1);
          if (!results.length) {
            sendBotReply(`Couldn't find any YouTube videos matching "${args}". Try a different title! 🔍`);
            return;
          }
          targetId = results[0].id;
          targetTitle = results[0].title + (results[0].duration ? ` (${results[0].duration})` : '');
        } catch (err) {
          console.error('[AI] Search failed in /play:', err.message);
          sendBotReply('Had trouble searching YouTube. Please try again or paste a direct video link.');
          return;
        }
      }

      const stageChanged = room.source !== 'youtube';
      room.source = 'youtube';
      if (!room.ytState) {
        room.ytState = { videoId: targetId, time: 0, isPlaying: true, lastUpdate: Date.now() };
      } else {
        room.ytState.videoId = targetId;
        room.ytState.time = 0;
        room.ytState.isPlaying = true;
        room.ytState.lastUpdate = Date.now();
      }

      if (stageChanged) {
        broadcastToRoom(room.id, {
          type: 'mode_changed',
          source: 'youtube',
          username: 'WatchBot',
        });
      }

      broadcastToRoom(room.id, {
        type: 'yt_sync',
        action: 'change_video',
        videoId: targetId,
        username: 'WatchBot',
      });

      sendBotReply(`Now playing: **${targetTitle}** for @${client.username}! 🎬`);
      return;
    }

    // 2. /pause
    if (command === 'pause') {
      if (room.source === 'youtube' && room.ytState) {
        let currentTime = room.ytState.time || 0;
        if (room.ytState.isPlaying) {
          currentTime += (Date.now() - (room.ytState.lastUpdate || Date.now())) / 1000;
        }
        room.ytState.time = Math.max(0, currentTime);
        room.ytState.isPlaying = false;
        room.ytState.lastUpdate = Date.now();
        broadcastToRoom(room.id, {
          type: 'yt_sync',
          action: 'pause',
          time: room.ytState.time,
          username: 'WatchBot',
        });
        sendBotReply('Paused playback ⏸️');
      } else {
        sendBotReply('Nothing is currently playing in YouTube mode!');
      }
      return;
    }

    // 3. /resume or /unpause
    if (command === 'resume' || command === 'unpause') {
      if (room.source === 'youtube' && room.ytState) {
        let currentTime = room.ytState.time || 0;
        if (room.ytState.isPlaying) {
          currentTime += (Date.now() - (room.ytState.lastUpdate || Date.now())) / 1000;
        }
        room.ytState.time = Math.max(0, currentTime);
        room.ytState.isPlaying = true;
        room.ytState.lastUpdate = Date.now();
        broadcastToRoom(room.id, {
          type: 'yt_sync',
          action: 'play',
          time: room.ytState.time,
          username: 'WatchBot',
        });
        sendBotReply('Resumed playback ▶️');
      } else {
        sendBotReply('Nothing to resume right now!');
      }
      return;
    }

    // 4. /skip or /next
    if (command === 'skip' || command === 'next') {
      if (room.queue && room.queue.length > 0) {
        const nextItem = room.queue.shift();
        if (!room.ytState) room.ytState = {};
        room.ytState.videoId = nextItem.videoId;
        room.ytState.time = 0;
        room.ytState.isPlaying = true;
        room.ytState.lastUpdate = Date.now();

        broadcastToRoom(room.id, {
          type: 'yt_sync',
          action: 'change_video',
          videoId: nextItem.videoId,
          username: 'WatchBot',
        });
        broadcastToRoom(room.id, {
          type: 'yt_queue_update',
          queue: room.queue,
          username: 'WatchBot',
        });
        sendBotReply(`Skipped! Now playing: **${nextItem.title || nextItem.videoId}** ⏭️`);
      } else {
        sendBotReply('The queue is empty! Add more with `/queue <song or link>` 🎶');
      }
      return;
    }

    // 5. /queue <query or url> or /add <query or url>
    if (command === 'queue' || command === 'add') {
      if (!args) {
        sendBotReply('Please specify a video or song to add: `/queue <title or link>` 📋');
        return;
      }

      const directId = extractYouTubeId(args);
      let targetId = directId;
      let targetTitle = args;

      if (directId) {
        const resolved = await fetchVideoTitle(directId);
        if (resolved) targetTitle = resolved;
      } else {
        try {
          const results = await searchYouTube(args, 1);
          if (!results.length) {
            sendBotReply(`No YouTube videos found matching "${args}".`);
            return;
          }
          targetId = results[0].id;
          targetTitle = results[0].title;
        } catch (err) {
          console.error('[AI] Search failed in /queue:', err.message);
          sendBotReply('Failed to search YouTube. Please try again.');
          return;
        }
      }

      if (!room.queue) room.queue = [];
      const item = {
        id: Math.random().toString(36).slice(2, 10),
        videoId: targetId,
        title: targetTitle,
        addedBy: client.username,
        addedAt: Date.now(),
      };
      room.queue.push(item);

      broadcastToRoom(room.id, {
        type: 'yt_queue_update',
        queue: room.queue,
        username: 'WatchBot',
      });

      sendBotReply(`Added **${targetTitle}** to the queue! 📋 (Position #${room.queue.length})`);
      return;
    }

    // 6. /clear
    if (command === 'clear') {
      const hadItems = room.queue && room.queue.length > 0;
      room.queue = [];
      broadcastToRoom(room.id, {
        type: 'yt_queue_update',
        queue: room.queue,
        username: 'WatchBot',
      });
      sendBotReply(hadItems ? 'Cleared all videos from the queue! 🗑️' : 'Queue is already empty.');
      return;
    }

    // 7. /help
    if (command === 'help') {
      sendBotReply(
        `🎮 **Bot & Playback Commands:**\n` +
        `• \`/play [query or url]\` — Play a video or resume playback\n` +
        `• \`/pause\` — Pause playback\n` +
        `• \`/resume\` — Resume playback\n` +
        `• \`/skip\` — Play next video in queue\n` +
        `• \`/queue <query or url>\` — Add video to queue\n` +
        `• \`/clear\` — Clear all queued videos\n` +
        `• \`/help\` — Show command list\n\n` +
        `🤖 **AI Assistant:**\n` +
        `• Mention \`@ai <question>\` to ask questions or get movie & music recommendations!`
      );
      return;
    }

    // Fallback for unknown slash command
    sendBotReply(`Unknown command \`/${command}\`. Type \`/help\` to see available commands! 💡`);
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // B. Conversational AI Assistant (@ai / @bot)
  // ─────────────────────────────────────────────────────────────────────────────
  const prompt = rawText
    .replace(/@ai\b/gi, '')
    .replace(/@bot\b/gi, '')
    .trim();
  const lower = prompt.toLowerCase();

  // If user used @ai play ... redirect them or execute it
  if (lower.startsWith('play ') || lower === 'play') {
    const query = prompt.slice(5).trim();
    if (!query) {
      sendBotReply('What would you like to watch? Try `/play sunflower` or `@ai recommend a movie` 🍿');
      return;
    }
    try {
      const results = await searchYouTube(query, 1);
      if (!results.length) {
        sendBotReply(`Couldn't find any YouTube videos matching "${query}". Try another title! 🔍`);
        return;
      }
      const top = results[0];
      const stageChanged = room.source !== 'youtube';
      room.source = 'youtube';
      if (!room.ytState) {
        room.ytState = { videoId: top.id, time: 0, isPlaying: true, lastUpdate: Date.now() };
      } else {
        room.ytState.videoId = top.id;
        room.ytState.time = 0;
        room.ytState.isPlaying = true;
        room.ytState.lastUpdate = Date.now();
      }

      if (stageChanged) {
        broadcastToRoom(room.id, { type: 'mode_changed', source: 'youtube', username: 'WatchBot' });
      }
      broadcastToRoom(room.id, { type: 'yt_sync', action: 'change_video', videoId: top.id, username: 'WatchBot' });
      sendBotReply(`Playing **${top.title}** (${top.duration}) for @${client.username}! 🎬 *(Tip: You can also use \`/play ${query}\`)*`);
    } catch (err) {
      sendBotReply('Had trouble searching for that video. Try using `/play <song>` directly!');
    }
    return;
  }

  // AI Help
  if (lower === 'help' || lower.includes('commands') || lower === '') {
    sendBotReply(
      `🤖 **WatchBot AI Assistant at your service!**\n` +
      `• Ask me for recommendations: \`@ai recommend a sci-fi movie\`\n` +
      `• Ask what to watch: \`@ai what should we watch tonight?\`\n` +
      `• Chat with me about movies, music, or trivia!\n\n` +
      `💡 *For instant video controls, use slash commands:* \`/play\`, \`/pause\`, \`/skip\`, \`/queue\`, \`/help\``
    );
    return;
  }

  // Greetings
  const greetings = ['hey', 'hi', 'hello', 'sup', 'yo', 'hola', 'wassup'];
  if (greetings.some(g => lower.startsWith(g))) {
    sendBotReply(`Hey @${client.username}! Ready to watch together? Ask me for recommendations or type \`/play <song>\` to start streaming! 🍿`);
    return;
  }

  // Recommendations
  if (lower.includes('recommend') || lower.includes('suggest') || lower.includes('what should we watch') || lower.includes('what to watch')) {
    const movieRecs = [
      { title: 'Interstellar Soundtrack Suite', desc: 'Epic space soundscape by Hans Zimmer', query: 'interstellar soundtrack hans zimmer' },
      { title: 'Lofi Hip Hop Radio - Beats to relax/study to', desc: 'Chill beats perfect for hanging out', query: 'lofi hip hop radio beats to relax' },
      { title: 'Synthwave Radio - Chill synth / retro beats', desc: 'Relaxing 80s neon synthwave vibes', query: 'synthwave radio lofi girl' },
      { title: 'Spider-Man: Into the Spider-Verse - Sunflower', desc: 'Post Malone & Swae Lee animated classic', query: 'post malone sunflower' },
      { title: 'MrBeast 50 YouTubers Fight For $1,000,000', desc: 'Action-packed entertainment extravaganza', query: 'mrbeast 50 youtubers fight' },
      { title: 'Cyberpunk 2077 - I Really Want to Stay At Your House', desc: 'Emotional synth banger from Edgerunners', query: 'i really want to stay at your house' },
    ];
    const pick = movieRecs[Math.floor(Math.random() * movieRecs.length)];
    sendBotReply(
      `🍿 **Here is a recommendation for you!**\n` +
      `**${pick.title}** — *${pick.desc}*\n` +
      `Want to play it right now? Just type \`/play ${pick.query}\`! 🚀`
    );
    return;
  }

  // General questions or conversation
  if (lower.includes('who are you') || lower.includes('what are you')) {
    sendBotReply(`I'm **WatchBot**, your intelligent co-watching AI companion! I help you find videos, manage the queue, and discover great things to watch together. 🤖✨`);
    return;
  }

  if (lower.includes('joke')) {
    const jokes = [
      'Why did the movie star go to jail? Because she was framed! 🎬',
      'Why did the director bring a ladder? To reach the high notes in the soundtrack! 🎵',
      'What is an astronaut’s favorite key on the keyboard? The space bar! 🚀',
    ];
    sendBotReply(jokes[Math.floor(Math.random() * jokes.length)]);
    return;
  }

  // Conversational response
  sendBotReply(`I hear you, @${client.username}! Feel free to ask me for recommendations or use \`/play <title>\` to load up any video! 🎬`);
}
