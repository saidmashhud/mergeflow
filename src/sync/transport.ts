export type ConnectionState = "connecting" | "open" | "closed";

export interface Transport {
  connect(): void;
  close(): void;
  send(data: string): void;
  onMessage(handler: (data: string) => void): () => void;
  onOpen(handler: () => void): () => void;
  onClose(handler: () => void): () => void;
  readonly state: ConnectionState;
}

export class Emitter<T extends (...args: never[]) => void> {
  private readonly handlers = new Set<T>();
  on(handler: T): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  emit(...args: Parameters<T>): void {
    for (const h of [...this.handlers]) h(...args);
  }
  clear(): void {
    this.handlers.clear();
  }
}
