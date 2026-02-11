type MessageHandler = (data: unknown) => void;
type ConnectionHandler = () => void;

interface WSMessage {
  type: string;
  data: unknown;
}

export class WebSocketClient {
  private url: string;
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private connectHandlers: Set<ConnectionHandler> = new Set();
  private disconnectHandlers: Set<ConnectionHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private intentionalClose = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(url?: string) {
    this.url = url || process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws';
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.intentionalClose = false;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.startPing();
        this.connectHandlers.forEach((h) => h());
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          if (message.type === 'pong') return;

          const handlers = this.handlers.get(message.type);
          if (handlers) {
            handlers.forEach((h) => h(message.data));
          }

          const allHandlers = this.handlers.get('*');
          if (allHandlers) {
            allHandlers.forEach((h) => h(message));
          }
        } catch {
          // Ignore parse errors
        }
      };

      this.ws.onclose = () => {
        this.stopPing();
        this.disconnectHandlers.forEach((h) => h());

        if (!this.intentionalClose) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        // Error handler - close will follow
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
      this.connect();
    }, this.reconnectDelay);
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      this.send('ping', {});
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  send(type: string, data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  onConnect(handler: ConnectionHandler): () => void {
    this.connectHandlers.add(handler);
    return () => {
      this.connectHandlers.delete(handler);
    };
  }

  onDisconnect(handler: ConnectionHandler): () => void {
    this.disconnectHandlers.add(handler);
    return () => {
      this.disconnectHandlers.delete(handler);
    };
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  subscribe(channel: string): void {
    this.send('subscribe', { channel });
  }

  unsubscribe(channel: string): void {
    this.send('unsubscribe', { channel });
  }
}

let wsInstance: WebSocketClient | null = null;

export function getWSClient(): WebSocketClient {
  if (!wsInstance) {
    wsInstance = new WebSocketClient();
  }
  return wsInstance;
}

export default WebSocketClient;
