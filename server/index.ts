import { WebSocketServer, WebSocket } from "ws";
import { decode, encode, opsSince } from "../src/sync/protocol.js";
import type { Message } from "../src/sync/protocol.js";
import type { Op } from "../src/crdt/types.js";
import { idKey } from "../src/crdt/id.js";

export interface CollabtextServer {
  readonly port: number;
  readonly opCount: number;
  close(): Promise<void>;
}

export function startServer(port = 8080): Promise<CollabtextServer> {
  const wss = new WebSocketServer({ port });

  const log: Op[] = [];
  const seen = new Set<string>();

  const appendOps = (ops: readonly Op[]): Op[] => {
    const fresh: Op[] = [];
    for (const op of ops) {
      const key = `${op.type}:${idKey(op.id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      log.push(op);
      fresh.push(op);
    }
    return fresh;
  };

  const broadcast = (sender: WebSocket, msg: Message): void => {
    const frame = encode(msg);
    for (const client of wss.clients) {
      if (client !== sender && client.readyState === WebSocket.OPEN) {
        client.send(frame);
      }
    }
  };

  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      let msg: Message;
      try {
        msg = decode(raw.toString());
      } catch {
        return;
      }
      if (msg.t === "hello") {
        const missing = opsSince(log, msg.vv);
        socket.send(encode({ t: "sync", ops: missing }));
      } else if (msg.t === "ops") {
        const fresh = appendOps(msg.ops);
        if (fresh.length > 0) {
          broadcast(socket, { t: "ops", from: msg.from, ops: fresh });
        }
      }
    });
  });

  return new Promise((resolve) => {
    wss.on("listening", () => {
      const addr = wss.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      // eslint-disable-next-line no-console
      console.log(`collabtext relay listening on ws://localhost:${actualPort}`);
      resolve({
        port: actualPort,
        get opCount() {
          return log.length;
        },
        close: () =>
          new Promise<void>((res) => {
            for (const c of wss.clients) c.terminate();
            wss.close(() => res());
          }),
      });
    });
  });
}
