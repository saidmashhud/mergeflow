import {
  Emitter,
  type ConnectionState,
  type Transport,
} from "./transport.js";
import { decode, encode, opsSince } from "./protocol.js";
import type { Message } from "./protocol.js";
import type { Op } from "../crdt/types.js";
import { idKey } from "../crdt/id.js";

export class MemoryHub {
  private readonly members = new Set<MemoryTransport>();
  private readonly log: Op[] = [];
  private readonly seen = new Set<string>();

  attach(t: MemoryTransport): void {
    this.members.add(t);
  }
  detach(t: MemoryTransport): void {
    this.members.delete(t);
  }

  get opCount(): number {
    return this.log.length;
  }

  ingest(sender: MemoryTransport, data: string): void {
    let msg: Message;
    try {
      msg = decode(data);
    } catch {
      return;
    }
    if (msg.t === "hello") {
      const missing = opsSince(this.log, msg.vv);
      sender.deliver(encode({ t: "sync", ops: missing }));
      return;
    }
    if (msg.t === "ops") {
      const fresh: Op[] = [];
      for (const op of msg.ops) {
        const key = `${op.type}:${idKey(op.id)}`;
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        this.log.push(op);
        fresh.push(op);
      }
      if (fresh.length === 0) return;
      const frame = encode({ t: "ops", from: msg.from, ops: fresh });
      for (const m of this.members) {
        if (m !== sender && m.state === "open") m.deliver(frame);
      }
    }
  }
}

export class MemoryTransport implements Transport {
  private _state: ConnectionState = "closed";
  private readonly messageEmitter = new Emitter<(data: string) => void>();
  private readonly openEmitter = new Emitter<() => void>();
  private readonly closeEmitter = new Emitter<() => void>();

  constructor(private readonly hub: MemoryHub) {}

  get state(): ConnectionState {
    return this._state;
  }

  connect(): void {
    if (this._state === "open") return;
    this._state = "open";
    this.hub.attach(this);
    queueMicrotask(() => {
      if (this._state === "open") this.openEmitter.emit();
    });
  }

  close(): void {
    if (this._state === "closed") return;
    this._state = "closed";
    this.hub.detach(this);
    this.closeEmitter.emit();
  }

  send(data: string): void {
    if (this._state !== "open") {
      throw new Error("MemoryTransport.send while not open");
    }
    this.hub.ingest(this, data);
  }

  deliver(data: string): void {
    this.messageEmitter.emit(data);
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
