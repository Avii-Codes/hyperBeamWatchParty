// WebSocket client wrapper with automatic heartbeat, visibility wakeup, and seamless auto-reconnect
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

export class RoomSocket {
  constructor(handlers) {
    this._handlers = handlers;
    this._ws = null;
    this._pingInterval = null;
    this._connected = false;
    this._roomId = null;
    this._username = null;
    this._shouldReconnect = false;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 6;

    this._onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && this._shouldReconnect) {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
          this._attemptReconnect(true);
        } else {
          // Send instant ping on tab refocus
          this.send({ type: 'ping' });
        }
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    window.addEventListener('focus', this._onVisibilityChange);
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }

      const ws = new WebSocket(WS_URL);
      this._ws = ws;

      ws.onopen = () => {
        this._connected = true;
        this._reconnectAttempts = 0;
        this._startPing();
        resolve();
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'pong') return;
          this._handlers[msg.type]?.(msg);
        } catch {}
      };

      ws.onclose = () => {
        this._connected = false;
        this._stopPing();

        if (this._shouldReconnect) {
          this._attemptReconnect();
        } else {
          this._handlers['disconnected']?.();
        }
      };

      ws.onerror = (err) => {
        this._connected = false;
        if (!this._connected && this._reconnectAttempts === 0) {
          reject(err);
        }
      };
    });
  }

  _attemptReconnect(immediate = false) {
    if (!this._shouldReconnect) return;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);

    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      this._handlers['disconnected']?.();
      return;
    }

    const delay = immediate ? 100 : Math.min(1000 * Math.pow(1.5, this._reconnectAttempts), 5000);
    this._reconnectAttempts++;

    this._reconnectTimer = setTimeout(() => {
      if (!this._shouldReconnect) return;
      this.connect()
        .then(() => {
          if (this._roomId && this._username) {
            this.join(this._roomId, this._username);
          }
        })
        .catch(() => {
          this._attemptReconnect();
        });
    }, delay);
  }

  send(obj) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  join(roomId, username) {
    this._roomId = roomId;
    this._username = username;
    this._shouldReconnect = true;
    this.send({ type: 'join', roomId, username });
  }

  chat(text, replyTo = null) {
    this.send({ type: 'chat', text, replyTo });
  }

  reaction(emoji) {
    this.send({ type: 'reaction', emoji });
  }

  ytAction(action, data = {}) {
    this.send({ type: 'yt_action', action, ...data });
  }

  disconnect() {
    this._shouldReconnect = false;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    window.removeEventListener('focus', this._onVisibilityChange);
    this._stopPing();
    this._ws?.close();
    this._ws = null;
  }

  _startPing() {
    this._stopPing();
    // 12-second heartbeat to stay well beneath Render/Cloudflare 30s/60s proxy idle limits
    this._pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 12000);
  }

  _stopPing() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }
}
