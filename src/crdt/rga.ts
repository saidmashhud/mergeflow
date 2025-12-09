import {
  compareIds,
  idEquals,
  idKey,
  LamportClock,
  type ElementId,
  type ElementIdKey,
  type ReplicaId,
} from "./id.js";
import type { DeleteOp, InsertOp, Op, VersionVector } from "./types.js";

interface Node {
  readonly id: ElementId;
  readonly origin: ElementId | null;
  readonly value: string;
  deleted: boolean;
}

export class RGA {
  readonly replicaId: ReplicaId;
  private readonly clock: LamportClock;

  private readonly nodes = new Map<ElementIdKey, Node>();
  private readonly childrenByOrigin = new Map<ElementIdKey, ElementId[]>();
  private readonly versionVector = new Map<ReplicaId, number>();
  private readonly pendingDeletes = new Set<ElementIdKey>();

  private static readonly HEAD: ElementIdKey = " HEAD";

  constructor(replicaId: ReplicaId) {
    if (!replicaId) throw new Error("RGA requires a non-empty replicaId");
    this.replicaId = replicaId;
    this.clock = new LamportClock();
  }

  insert(index: number, value: string): InsertOp {
    if (value.length === 0) throw new Error("insert requires a non-empty value");
    const visible = this.visibleNodes();
    if (index < 0 || index > visible.length) {
      throw new Error(`insert index ${index} out of range [0, ${visible.length}]`);
    }
    const origin = index === 0 ? null : visible[index - 1]!.id;
    const op: InsertOp = {
      type: "insert",
      id: { replicaId: this.replicaId, counter: this.clock.tick() },
      origin,
      value,
    };
    this.integrateInsert(op);
    this.recordVersion(op.id);
    return op;
  }

  delete(index: number): DeleteOp {
    const visible = this.visibleNodes();
    if (index < 0 || index >= visible.length) {
      throw new Error(`delete index ${index} out of range [0, ${visible.length})`);
    }
    const target = visible[index]!;
    this.clock.tick();
    const op: DeleteOp = { type: "delete", id: target.id };
    this.integrateDelete(op);
    return op;
  }

  applyRemote(op: Op): boolean {
    this.clock.witness(op.id.counter);
    if (op.type === "insert") {
      const changed = this.integrateInsert(op);
      this.recordVersion(op.id);
      return changed;
    }
    return this.integrateDelete(op);
  }

  applyRemoteBatch(ops: Iterable<Op>): void {
    for (const op of ops) this.applyRemote(op);
  }

  private integrateInsert(op: InsertOp): boolean {
    const key = idKey(op.id);
    if (this.nodes.has(key)) return false;

    const bornDeleted = this.pendingDeletes.delete(key);
    const node: Node = {
      id: op.id,
      origin: op.origin,
      value: op.value,
      deleted: bornDeleted,
    };
    this.nodes.set(key, node);

    const originKey = op.origin === null ? RGA.HEAD : idKey(op.origin);
    const siblings = this.childrenByOrigin.get(originKey) ?? [];
    let lo = 0;
    let hi = siblings.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compareIds(op.id, siblings[mid]!) > 0) hi = mid;
      else lo = mid + 1;
    }
    siblings.splice(lo, 0, op.id);
    this.childrenByOrigin.set(originKey, siblings);
    return true;
  }

  private integrateDelete(op: DeleteOp): boolean {
    const node = this.nodes.get(idKey(op.id));
    if (node === undefined) {
      this.pendingDeletes.add(idKey(op.id));
      return true;
    }
    if (node.deleted) return false;
    node.deleted = true;
    return true;
  }

  private recordVersion(id: ElementId): void {
    const prev = this.versionVector.get(id.replicaId) ?? 0;
    if (id.counter > prev) this.versionVector.set(id.replicaId, id.counter);
  }

  getVersionVector(): VersionVector {
    return Object.fromEntries(this.versionVector);
  }

  toString(): string {
    let out = "";
    for (const node of this.walk()) if (!node.deleted) out += node.value;
    return out;
  }

  get length(): number {
    let n = 0;
    for (const node of this.walk()) if (!node.deleted) n += 1;
    return n;
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  exportOps(): Op[] {
    const ops: Op[] = [];
    for (const node of this.walk()) {
      ops.push({
        type: "insert",
        id: node.id,
        origin: node.origin,
        value: node.value,
      });
      if (node.deleted) ops.push({ type: "delete", id: node.id });
    }
    return ops;
  }

  private visibleNodes(): Node[] {
    const out: Node[] = [];
    for (const node of this.walk()) if (!node.deleted) out.push(node);
    return out;
  }

  private *walk(): Generator<Node> {
    const rootChildren = this.childrenByOrigin.get(RGA.HEAD) ?? [];
    const stack: { ids: ElementId[]; idx: number }[] = [
      { ids: rootChildren, idx: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      if (frame.idx >= frame.ids.length) {
        stack.pop();
        continue;
      }
      const id = frame.ids[frame.idx]!;
      frame.idx += 1;
      const node = this.nodes.get(idKey(id))!;
      yield node;
      const children = this.childrenByOrigin.get(idKey(id));
      if (children && children.length > 0) {
        stack.push({ ids: children, idx: 0 });
      }
    }
  }

  has(id: ElementId): boolean {
    return this.nodes.has(idKey(id));
  }

  isVisible(id: ElementId): boolean {
    const node = this.nodes.get(idKey(id));
    return node !== undefined && !node.deleted;
  }
}

export { compareIds, idEquals };
