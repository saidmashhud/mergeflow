import type { ElementId } from "./id.js";

export type Op = InsertOp | DeleteOp;

export interface InsertOp {
  readonly type: "insert";
  readonly id: ElementId;
  readonly origin: ElementId | null;
  readonly value: string;
}

export interface DeleteOp {
  readonly type: "delete";
  readonly id: ElementId;
}

export type VersionVector = Record<string, number>;
