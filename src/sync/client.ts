import { RGA } from "../crdt/rga.js";
import type { Op } from "../crdt/types.js";
import { OpQueue } from "./queue.js";
import {
  decode,
  encode,
  type HelloMessage,
  type Message,
  type OpsMessage,
} from "./protocol.js";
import type { Transport } from "./transport.js";

export interface SyncClientOptions {
  replicaId: string;
  transport: Transport;
  doc?: RGA;
}

export type ChangeListener = (doc: RGA) => void;

export class SyncClient {
  readonly doc: RGA;
  readonly replicaId: string;
  private readonly transport: Transport;
  private readonly queue = new OpQueue();
  private readonly changeListeners = new Set<ChangeListener>();
  private readonly unsubscribes: Array<() => void> = [];

  constructor(opts: SyncClientOptions) {
    this.replicaId = opts.replicaId;
    this.doc = opts.doc ?? new RGA(opts.replicaId);
    this.transport = opts.transport;

    this.unsubscribes.push(
      this.transport.onOpen(() => this.handleOpen()),
      this.transport.onMessage((data) => this.handleMessage(data)),
    );
  }

  start(): void {
    this.transport.connect();
  }

  stop(): void {
    for (const u of this.unsubscribes) u();
    this.unsubscribes.length = 0;
    this.transport.close();
  }

  onChange(listener: ChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  insert(index: number, value: string): void {
    for (let i = 0; i < value.length; i++) {
      const op = this.doc.insert(index + i, value[i]!);
      this.ship(op);
    }
    this.notify();
  }

  delete(index: number, count = 1): void {
    for (let i = 0; i < count; i++) {
      const op = this.doc.delete(index);
      this.ship(op);
    }
    this.notify();
  }

  get text(): string {
    return this.doc.toString();
  }

  private ship(op: Op): void {
    if (this.transport.state === "open") {
      this.send({ t: "ops", from: this.replicaId, ops: [op] });
    } else {
      this.queue.enqueue(op);
    }
  }

  private handleOpen(): void {
    const hello: HelloMessage = {
      t: "hello",
      replicaId: this.replicaId,
      vv: this.doc.getVersionVector(),
    };
    this.send(hello);
    if (!this.queue.isEmpty()) {
      const ops = this.queue.drain();
      this.send({ t: "ops", from: this.replicaId, ops });
    }
  }

  private handleMessage(data: string): void {
    let msg: Message;
    try {
      msg = decode(data);
    } catch {
      return;
    }
    if (msg.t === "ops") {
      this.applyOps(msg);
    } else if (msg.t === "sync") {
      this.applyIncoming(msg.ops);
    }
  }

  private applyOps(msg: OpsMessage): void {
    if (msg.from === this.replicaId) return;
    this.applyIncoming(msg.ops);
  }

  private applyIncoming(ops: readonly Op[]): void {
    let changed = false;
    for (const op of ops) {
      if (this.doc.applyRemote(op)) changed = true;
    }
    if (changed) this.notify();
  }

  private send(msg: Message): void {
    if (this.transport.state === "open") {
      this.transport.send(encode(msg));
    }
  }

  private notify(): void {
    for (const l of [...this.changeListeners]) l(this.doc);
  }
}
