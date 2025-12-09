export type ReplicaId = string;

export interface ElementId {
  readonly replicaId: ReplicaId;
  readonly counter: number;
}

export type ElementIdKey = string;

export function idKey(id: ElementId): ElementIdKey {
  return `${id.counter}@${id.replicaId}`;
}

export function idEquals(a: ElementId | null, b: ElementId | null): boolean {
  if (a === null || b === null) return a === b;
  return a.counter === b.counter && a.replicaId === b.replicaId;
}

// при равном counter (конкурентные операции) тай-брейк по replicaId,
// иначе реплики разойдутся.
export function compareIds(a: ElementId, b: ElementId): number {
  if (a.counter !== b.counter) return a.counter - b.counter;
  if (a.replicaId < b.replicaId) return -1;
  if (a.replicaId > b.replicaId) return 1;
  return 0;
}

export class LamportClock {
  private value: number;

  constructor(initial = 0) {
    this.value = initial;
  }

  get current(): number {
    return this.value;
  }

  tick(): number {
    this.value += 1;
    return this.value;
  }

  witness(remote: number): void {
    if (remote > this.value) this.value = remote;
  }
}
