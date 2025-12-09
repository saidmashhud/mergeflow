import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { startServer, type CollabtextServer } from "../../server/index.js";
import { WebSocketTransport } from "./websocket-transport.js";
import { SyncClient } from "./client.js";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function until(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("until() timed out");
    await wait(15);
  }
}

describe("integration — real ws relay server", () => {
  let server: CollabtextServer;
  let url: string;

  beforeAll(async () => {
    server = await startServer(0);
    url = `ws://localhost:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  function makeClient(id: string): SyncClient {
    const transport = new WebSocketTransport({
      url,
      WebSocketImpl: WebSocket as never,
      initialBackoffMs: 50,
    });
    return new SyncClient({ replicaId: id, transport });
  }

  it("two live clients converge, and a late joiner catches up via hello/sync", async () => {
    const a = makeClient("A");
    const b = makeClient("B");
    a.start();
    b.start();
    await until(() => a.doc !== undefined && b.doc !== undefined);
    await wait(100);

    a.insert(0, "Lorem ");
    b.insert(0, "ipsum");

    await until(() => a.text === b.text && a.text.length >= 11);
    expect(a.text).toBe(b.text);
    expect(a.text).toContain("Lorem ");
    expect(a.text).toContain("ipsum");
    const converged = a.text;

    const c = makeClient("C");
    c.start();
    await until(() => c.text === converged);
    expect(c.text).toBe(converged);

    a.stop();
    b.stop();
    c.stop();
  });
});
