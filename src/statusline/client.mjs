const CONVERSATION_RE = /\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Set();
    this.connected = false;
  }

  onEvent(listener) {
    if (typeof listener === 'function') this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('CDP WebSocket connect timeout'));
      }, 4000);

      ws.addEventListener('open', () => {
        clearTimeout(timer);
        this.connected = true;
        resolve();
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve: res, reject: rej } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) rej(new Error(msg.error.message || 'CDP error'));
            else res(msg.result);
          } else if (msg.method) {
            for (const fn of this.eventListeners) {
              try { fn(msg); } catch { /* ignore listener errors */ }
            }
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.addEventListener('close', () => {
        this.connected = false;
        for (const { reject: rej } of this.pending.values()) {
          rej(new Error('CDP WebSocket closed'));
        }
        this.pending.clear();
      });

      ws.addEventListener('error', (err) => {
        clearTimeout(timer);
        this.connected = false;
        reject(err);
      });
    });
  }

  call(method, params = {}) {
    if (!this.connected || !this.ws) {
      return Promise.reject(new Error('CDP not connected'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP call timeout'));
      }, 4000);
      this.pending.set(id, {
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  evalJs(expression) {
    return this.call('Runtime.evaluate', { expression, returnByValue: true });
  }

  close() {
    this.connected = false;
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}

export function extractConversationId(url) {
  const m = String(url || '').match(CONVERSATION_RE);
  return m ? m[1] : '';
}

export function filterAntigravityPages(targets) {
  if (!Array.isArray(targets)) return [];
  return targets.filter((t) =>
    t.type === 'page' &&
    t.webSocketDebuggerUrl &&
    /^https?:\/\/(127\.0\.0\.1|localhost):/i.test(String(t.url || '')) &&
    String(t.title || '').includes('Antigravity'),
  );
}

export async function discoverMainTargets(ports) {
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) continue;
      const pages = filterAntigravityPages(await res.json());
      if (pages.length > 0) return pages;
    } catch {
      // try next port
    }
  }
  return [];
}
