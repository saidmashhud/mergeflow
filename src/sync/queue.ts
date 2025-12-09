import type { Op } from "../crdt/types.js";
import { idKey } from "../crdt/id.js";

export class OpQueue {
  private readonly buffer: Op[] = [];
  private readonly seen = new Set<string>();

  enqueue(op: Op): void {
    const key = `${op.type}:${idKey(op.id)}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.buffer.push(op);
  }

  get size(): number {
    return this.buffer.length;
  }

  isEmpty(): boolean {
    return this.buffer.length === 0;
  }

  peek(): readonly Op[] {
    return this.buffer;
  }

  drain(): Op[] {
    const ops = this.buffer.splice(0, this.buffer.length);
    this.seen.clear();
    return ops;
  }
}
