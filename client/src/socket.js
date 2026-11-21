// WebSocket client wrapper
// Connects to /ws path so Vite dev-server proxies it to localhost:3000
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

export class RoomSocket {
  constructor(handlers) {
    this._handlers = handlers;
    this._ws = null;
    this._pingInterval = null;
    this._connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      this._ws = ws;

      ws.onopen = () => {
        this._connected = true;
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
        this._handlers['disconnected']?.();
      };

      ws.onerror = (err) => {
        this._connected = false;
        reject(err);
      };
    });
  }

  send(obj) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  join(roomId, username) {
    this.send({ type: 'join', roomId, username });
  }

  chat(text) {
    this.send({ type: 'chat', text });
  }

  disconnect() {
    this._stopPing();
    this._ws?.close();
    this._ws = null;
  }

  _startPing() {
    this._pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 25000);
  }

  _stopPing() {
    clearInterval(this._pingInterval);
  }
}
