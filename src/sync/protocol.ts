import type { Op, VersionVector } from "../crdt/types.js";

export type Message = HelloMessage | OpsMessage | SyncMessage;

export interface HelloMessage {
  readonly t: "hello";
  readonly replicaId: string;
  readonly vv: VersionVector;
}

export interface OpsMessage {
  readonly t: "ops";
  readonly from: string;
  readonly ops: Op[];
}

export interface SyncMessage {
  readonly t: "sync";
  readonly ops: Op[];
}

export function encode(msg: Message): string {
  return JSON.stringify(msg);
}

export function decode(data: string): Message {
  const parsed = JSON.parse(data) as Message;
  if (parsed == null || typeof (parsed as { t?: unknown }).t !== "string") {
    throw new Error("malformed collabtext message");
  }
  return parsed;
}

export function opsSince(all: readonly Op[], vv: VersionVector): Op[] {
  return all.filter((op) => {
    if (op.type === "delete") return true;
    const seen = vv[op.id.replicaId] ?? 0;
    return op.id.counter > seen;
  });
}
