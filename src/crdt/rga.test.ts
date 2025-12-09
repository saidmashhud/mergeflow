import { describe, it, expect } from "vitest";
import { RGA } from "./rga.js";
import { SeededRng } from "./prng.js";
import type { Op } from "./types.js";

function authorLocally(
  replicaId: string,
  edits: Array<
    | { kind: "insert"; index: number; value: string }
    | { kind: "delete"; index: number }
  >,
): { doc: RGA; ops: Op[] } {
  const doc = new RGA(replicaId);
  const ops: Op[] = [];
  for (const e of edits) {
    ops.push(
      e.kind === "insert" ? doc.insert(e.index, e.value) : doc.delete(e.index),
    );
  }
  return { doc, ops };
}

describe("RGA — basic local semantics", () => {
  it("inserts characters at positions", () => {
    const doc = new RGA("A");
    doc.insert(0, "h");
    doc.insert(1, "i");
    doc.insert(1, "e");
    expect(doc.toString()).toBe("hei");
    expect(doc.length).toBe(3);
  });

  it("deletes leave the visible string correct and keep tombstones", () => {
    const doc = new RGA("A");
    for (const [i, ch] of [..."hello"].entries()) doc.insert(i, ch);
    doc.delete(0);
    expect(doc.toString()).toBe("ello");
    expect(doc.length).toBe(4);
    expect(doc.nodeCount).toBe(5);
  });

  it("rejects out-of-range edits", () => {
    const doc = new RGA("A");
    expect(() => doc.insert(1, "x")).toThrow();
    expect(() => doc.delete(0)).toThrow();
  });
});

describe("RGA — idempotency", () => {
  it("applying the same insert op twice == once", () => {
    const { ops } = authorLocally("A", [
      { kind: "insert", index: 0, value: "a" },
      { kind: "insert", index: 1, value: "b" },
    ]);
    const r = new RGA("B");
    expect(r.applyRemote(ops[0]!)).toBe(true);
    expect(r.applyRemote(ops[0]!)).toBe(false);
    r.applyRemote(ops[1]!);
    r.applyRemote(ops[1]!);
    expect(r.toString()).toBe("ab");
    expect(r.nodeCount).toBe(2);
  });

  it("applying the same delete op twice == once", () => {
    const a = new RGA("A");
    const i0 = a.insert(0, "x");
    const d0 = a.delete(0);
    const r = new RGA("B");
    r.applyRemote(i0);
    expect(r.applyRemote(d0)).toBe(true);
    expect(r.applyRemote(d0)).toBe(false);
    expect(r.toString()).toBe("");
  });
});

describe("RGA — commutativity / associativity", () => {
  it("any permutation of a fixed op set yields the same string", () => {
    const { ops } = authorLocally("A", [
      { kind: "insert", index: 0, value: "h" },
      { kind: "insert", index: 1, value: "e" },
      { kind: "insert", index: 2, value: "l" },
      { kind: "insert", index: 3, value: "l" },
      { kind: "insert", index: 4, value: "o" },
      { kind: "delete", index: 1 },
    ]);
    const expected = "hllo";

    const rng = new SeededRng(123);
    for (let trial = 0; trial < 50; trial++) {
      const shuffled = rng.shuffle(ops);
      const r = new RGA("Z");
      for (const op of shuffled) r.applyRemote(op);
      expect(r.toString()).toBe(expected);
    }
  });
});

describe("RGA — concurrent insert at the same position (deterministic tie-break)", () => {
  it("two replicas inserting after the same origin converge identically", () => {
    const base = new RGA("seed");
    const baseOp = base.insert(0, "X");

    const a = new RGA("A");
    const b = new RGA("B");
    a.applyRemote(baseOp);
    b.applyRemote(baseOp);

    const aOp = a.insert(1, "a");
    const bOp = b.insert(1, "b");

    a.applyRemote(bOp);
    b.applyRemote(aOp);

    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).toBe("Xba");
  });

  it("three-way concurrent insert at the same spot is a stable total order", () => {
    const seedOp = new RGA("seed").insert(0, "_");
    const make = (id: string) => {
      const r = new RGA(id);
      r.applyRemote(seedOp);
      return r;
    };
    const a = make("A");
    const b = make("B");
    const c = make("C");
    const oa = a.insert(1, "a");
    const ob = b.insert(1, "b");
    const oc = c.insert(1, "c");
    for (const r of [a, b, c]) {
      for (const op of [oa, ob, oc]) r.applyRemote(op);
    }
    expect(a.toString()).toBe(b.toString());
    expect(b.toString()).toBe(c.toString());
  });
});

describe("RGA — concurrent insert vs delete", () => {
  it("insert positioned after a concurrently-deleted char is preserved", () => {
    const base = new RGA("seed");
    const opA = base.insert(0, "a");
    const opB = base.insert(1, "b");

    const r1 = new RGA("R1");
    const r2 = new RGA("R2");
    for (const r of [r1, r2]) {
      r.applyRemote(opA);
      r.applyRemote(opB);
    }

    const del = r1.delete(0);
    const ins = r2.insert(1, "Z");

    r1.applyRemote(ins);
    r2.applyRemote(del);

    expect(r1.toString()).toBe(r2.toString());
    expect(r1.toString()).toBe("Zb");
  });

  it("delete arriving before its target insert (out-of-order) converges", () => {
    const a = new RGA("A");
    const ins = a.insert(0, "q");
    const del = a.delete(0);

    const r = new RGA("R");
    r.applyRemote(del);
    r.applyRemote(ins);
    expect(r.toString()).toBe("");
    expect(r.nodeCount).toBe(1);
  });
});
