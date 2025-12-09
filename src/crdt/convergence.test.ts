import { describe, it, expect } from "vitest";
import { RGA } from "./rga.js";
import { SeededRng } from "./prng.js";
import type { Op } from "./types.js";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

function runConvergenceIteration(seed: number, replicaCount: number): void {
  const rng = new SeededRng(seed);
  const replicas = Array.from(
    { length: replicaCount },
    (_, i) => new RGA(`R${i}`),
  );

  const allOps: Op[] = [];

  const rounds = rng.int(4, 9);
  for (let round = 0; round < rounds; round++) {
    for (const replica of replicas) {
      const edits = rng.int(1, 5);
      for (let e = 0; e < edits; e++) {
        const len = replica.length;
        const doDelete = len > 0 && rng.next() < 0.3;
        if (doDelete) {
          allOps.push(replica.delete(rng.int(0, len)));
        } else {
          const ch = ALPHABET[rng.int(0, ALPHABET.length)]!;
          allOps.push(replica.insert(rng.int(0, len + 1), ch));
        }
      }
    }

    for (const replica of replicas) {
      for (const op of allOps) {
        if (rng.next() < 0.5) replica.applyRemote(op);
      }
    }
  }

  const reference = (() => {
    const r = new RGA("REF");
    for (const op of allOps) r.applyRemote(op);
    return r.toString();
  })();

  for (const replica of replicas) {
    const delivery = rng.shuffle(allOps);
    const withDupes: Op[] = [];
    for (const op of delivery) {
      withDupes.push(op);
      if (rng.next() < 0.15) withDupes.push(op);
    }
    const order = rng.shuffle(withDupes);
    for (const op of order) replica.applyRemote(op);
  }

  const results = replicas.map((r) => r.toString());
  for (let i = 1; i < results.length; i++) {
    expect(
      results[i],
      `replica ${i} diverged (seed=${seed}). ` +
        `got=${JSON.stringify(results[i])} expected=${JSON.stringify(results[0])}`,
    ).toBe(results[0]);
  }
  expect(results[0]).toBe(reference);
}

describe("RGA — strong eventual consistency (randomized convergence)", () => {
  const ITERATIONS = 300;

  it(`converges across ${ITERATIONS} randomized iterations (3 replicas)`, () => {
    for (let i = 0; i < ITERATIONS; i++) {
      runConvergenceIteration(0x1000 + i, 3);
    }
  });

  it(`converges across ${ITERATIONS} randomized iterations (5 replicas)`, () => {
    for (let i = 0; i < ITERATIONS; i++) {
      runConvergenceIteration(0x9000 + i, 5);
    }
  });

  it("is reproducible: a fixed seed yields a fixed string", () => {
    const build = () => {
      const r = new RGA("X");
      const rng = new SeededRng(42);
      for (let i = 0; i < 200; i++) {
        const len = r.length;
        if (len > 0 && rng.next() < 0.3) r.delete(rng.int(0, len));
        else r.insert(rng.int(0, len + 1), ALPHABET[rng.int(0, 26)]!);
      }
      return r.toString();
    };
    expect(build()).toBe(build());
  });
});
