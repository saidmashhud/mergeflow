import {
  Emitter,
  type ConnectionState,
  type Transport,
} from "./transport.js";

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener?(type: string, listener: (ev: unknown) => void): void;
  on?(type: string, listener: (...args: unknown[]) => void): void;
  readyState: number;
}

export interface WebSocketCtor {
  new (url: string): WebSocketLike;
  readonly OPEN: number;
}

export interface WebSocketTransportOptions {
  url: string;
  WebSocketImpl?: WebSocketCtor;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  jitter?: number;
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
  random?: () => number;
}

export class WebSocketTransport implements Transport {
  private readonly opts: Required<
    Omit<WebSocketTransportOptions, "WebSocketImpl">
  > & { WebSocketImpl: WebSocketCtor };

  private socket: WebSocketLike | null = null;
  private _state: ConnectionState = "closed";
  private attempt = 0;
  private reconnectHandle: unknown = null;
  private manuallyClosed = false;

  private readonly messageEmitter = new Emitter<(data: string) => void>();
  private readonly openEmitter = new Emitter<() => void>();
  private readonly closeEmitter = new Emitter<() => void>();

  constructor(options: WebSocketTransportOptions) {
    const Impl =
      options.WebSocketImpl ??
      (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!Impl) {
      throw new Error(
        "No WebSocket implementation available; pass options.WebSocketImpl (e.g. from the `ws` package in Node).",
      );
    }
    this.opts = {
      url: options.url,
      WebSocketImpl: Impl,
      initialBackoffMs: options.initialBackoffMs ?? 250,
      maxBackoffMs: options.maxBackoffMs ?? 10_000,
      jitter: options.jitter ?? 0.2,
      setTimeoutImpl:
        options.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms) as unknown),
      clearTimeoutImpl:
        options.clearTimeoutImpl ??
        ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
      random: options.random ?? Math.random,
    };
  }

  get state(): ConnectionState {
    return this._state;
  }

  connect(): void {
    if (this._state === "open" || this._state === "connecting") return;
    this.manuallyClosed = false;
    this.openSocket();
  }

  private openSocket(): void {
    this._state = "connecting";
    const socket = new this.opts.WebSocketImpl(this.opts.url);
    this.socket = socket;

    const bind = (type: string, listener: (ev?: unknown) => void): void => {
      if (typeof socket.addEventListener === "function") {
        socket.addEventListener(type, listener);
      } else if (typeof socket.on === "function") {
        socket.on(type, listener as (...args: unknown[]) => void);
      }
    };

    bind("open", () => {
      this._state = "open";
      this.attempt = 0;
      this.openEmitter.emit();
    });

    bind("message", (ev: unknown) => {
      const data =
        ev && typeof ev === "object" && "data" in ev
          ? (ev as { data: unknown }).data
          : ev;
      this.messageEmitter.emit(String(data));
    });

    const onDown = (): void => {
      const wasUp = this._state === "open" || this._state === "connecting";
      this._state = "closed";
      this.socket = null;
      if (wasUp) this.closeEmitter.emit();
      if (!this.manuallyClosed) this.scheduleReconnect();
    };

    bind("close", onDown);
    bind("error", () => {
      try {
        socket.close();
      } catch {
        onDown();
      }
    });
  }

  private scheduleReconnect(): void {
    const base = Math.min(
      this.opts.maxBackoffMs,
      this.opts.initialBackoffMs * 2 ** this.attempt,
    );
    const delay = base + base * this.opts.jitter * this.opts.random();
    this.attempt += 1;
    this.reconnectHandle = this.opts.setTimeoutImpl(() => {
      if (!this.manuallyClosed) this.openSocket();
    }, delay);
  }

  close(): void {
    this.manuallyClosed = true;
    if (this.reconnectHandle != null) {
      this.opts.clearTimeoutImpl(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
    this._state = "closed";
  }

  send(data: string): void {
    if (this._state !== "open" || !this.socket) {
      throw new Error("WebSocketTransport.send called while not open");
    }
    this.socket.send(data);
  }

  onMessage(handler: (data: string) => void): () => void {
    return this.messageEmitter.on(handler);
  }
  onOpen(handler: () => void): () => void {
    return this.openEmitter.on(handler);
  }
  onClose(handler: () => void): () => void {
    return this.closeEmitter.on(handler);
  }
}
