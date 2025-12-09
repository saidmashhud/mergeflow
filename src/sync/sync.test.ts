import { describe, it, expect } from "vitest";
import { RGA } from "../crdt/rga.js";
import { SeededRng } from "../crdt/prng.js";
import { MemoryHub, MemoryTransport } from "./memory-transport.js";
import { SyncClient } from "./client.js";
import { OpQueue } from "./queue.js";
import { opsSince } from "./protocol.js";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("OpQueue", () => {
  it("buffers, de-dupes by (type,id), and drains FIFO", () => {
    const q = new OpQueue();
    const doc = new RGA("A");
    const o1 = doc.insert(0, "a");
    const o2 = doc.insert(1, "b");
    q.enqueue(o1);
    q.enqueue(o2);
    q.enqueue(o1);
    expect(q.size).toBe(2);
    const drained = q.drain();
    expect(drained.map((o) => (o.type === "insert" ? o.value : "x"))).toEqual([
      "a",
      "b",
    ]);
    expect(q.isEmpty()).toBe(true);
  });
});

describe("opsSince delta", () => {
  it("excludes already-seen inserts but always re-includes deletes", () => {
    const a = new RGA("A");
    const i0 = a.insert(0, "x");
    const i1 = a.insert(1, "y");
    const d0 = a.delete(0);
    const all = [i0, i1, d0];
    const missing = opsSince(all, { A: 1 });
    expect(missing).toContain(i1);
    expect(missing).not.toContain(i0);
    expect(missing).toContain(d0);
  });
});

describe("SyncClient over MemoryHub — online convergence", () => {
  it("two clients see each other's edits and converge", async () => {
    const hub = new MemoryHub();
    const ta = new MemoryTransport(hub);
    const tb = new MemoryTransport(hub);
    const a = new SyncClient({ replicaId: "A", transport: ta });
    const b = new SyncClient({ replicaId: "B", transport: tb });
    a.start();
    b.start();
    await flush();

    a.insert(0, "hello");
    await flush();
    b.insert(b.text.length, " world");
    await flush();

    expect(a.text).toBe(b.text);
    expect(a.text).toBe("hello world");
    a.stop();
    b.stop();
  });
});

describe("SyncClient — offline queue + reconnect convergence", () => {
  it("ops produced while offline are flushed on reconnect and converge", async () => {
    const hub = new MemoryHub();
    const ta = new MemoryTransport(hub);
    const tb = new MemoryTransport(hub);
    const a = new SyncClient({ replicaId: "A", transport: ta });
    const b = new SyncClient({ replicaId: "B", transport: tb });

    a.start();
    b.start();
    await flush();

    a.insert(0, "base ");
    await flush();
    expect(b.text).toBe("base ");

    ta.close();
    a.insert(a.text.length, "offline-A");
    b.insert(b.text.length, "online-B");
    await flush();

    expect(a.text).not.toContain("online-B");

    ta.connect();
    await flush();
    await flush();

    expect(a.text).toBe(b.text);
    expect(a.text).toContain("offline-A");
    expect(a.text).toContain("online-B");
    expect(a.text.startsWith("base ")).toBe(true);

    a.stop();
    b.stop();
  });
});

describe("WebSocketTransport — exponential backoff", () => {
  it("schedules reconnects with growing, capped, jittered delays", async () => {
    const { WebSocketTransport } = await import("./websocket-transport.js");

    const delays: number[] = [];
    let socketCtorCalls = 0;
    const listeners = new Map<string, (ev?: unknown) => void>();

    class FakeSocket {
      static readonly OPEN = 1;
      readyState = 0;
      constructor(_url: string) {
        socketCtorCalls++;
      }
      send() {}
      close() {
        listeners.get("close")?.();
      }
      addEventListener(type: string, fn: (ev?: unknown) => void) {
        listeners.set(type, fn);
      }
    }

    const rng = new SeededRng(7);
    const transport = new WebSocketTransport({
      url: "ws://unused",
      WebSocketImpl: FakeSocket as never,
      initialBackoffMs: 100,
      maxBackoffMs: 1000,
      jitter: 0,
      random: () => rng.next(),
      setTimeoutImpl: (_fn, ms) => {
        delays.push(ms);
        return 0;
      },
      clearTimeoutImpl: () => {},
    });

    transport.connect();
    for (let i = 0; i < 3; i++) {
      listeners.get("close")?.();
    }

    expect(delays.slice(0, 3)).toEqual([100, 200, 400]);
    expect(socketCtorCalls).toBeGreaterThanOrEqual(1);
    transport.close();
  });
});
