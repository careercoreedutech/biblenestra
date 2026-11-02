// Real-time WebSocket connection client for BibleNestra.
// Uses short-lived ticket auth, automatic reconnect with backoff, and heartbeat ping.
import { Platform } from 'react-native';

export class RealtimeClient {
  constructor({ request, apiUrl }) {
    this.request = request;
    this.apiUrl = apiUrl;
    this.ws = null;
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.status = 'disconnected'; // 'connecting' | 'connected' | 'disconnected'
    this.closedExplicitly = false;
    this.backoffMs = 1000;
  }

  onEvent(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  onStatusChange(callback) {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    for (const fn of this.statusListeners) {
      try { fn(status); } catch (e) {}
    }
  }

  async connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closedExplicitly = false;
    this.setStatus('connecting');

    try {
      // 1. Fetch short-lived ticket
      const { ticket } = await this.request('POST', '/realtime/ticket');
      if (!ticket) throw new Error('No ticket returned');

      // 2. Build WebSocket URL
      const wsUrl = this.apiUrl.replace(/^http/, 'ws') + `/realtime?ticket=${encodeURIComponent(ticket)}`;

      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.onopen = () => {
        this.setStatus('connected');
        this.backoffMs = 1000;
        this.startPing();
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          for (const fn of this.listeners) {
            try { fn(data); } catch (err) { console.warn('[realtime] listener error:', err); }
          }
        } catch (e) {
          // ignore unparseable
        }
      };

      socket.onclose = () => {
        this.stopPing();
        this.setStatus('disconnected');
        if (!this.closedExplicitly) {
          this.scheduleReconnect();
        }
      };

      socket.onerror = () => {
        this.stopPing();
        this.setStatus('disconnected');
      };
    } catch (err) {
      this.setStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.closedExplicitly) return;
    const delay = Math.min(30000, this.backoffMs);
    this.backoffMs = Math.min(30000, this.backoffMs * 1.5);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try { this.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
      }
    }, 25000);
  }

  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  disconnect() {
    this.closedExplicitly = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.setStatus('disconnected');
  }
}
