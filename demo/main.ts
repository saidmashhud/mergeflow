import { SyncClient, WebSocketTransport } from "collabtext";

const WS_URL = "ws://localhost:8080";

// diff текстарии: общий префикс/суффикс, середину считаем delete + insert.
function reconcile(client: SyncClient, prev: string, next: string): void {
  if (prev === next) return;
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (
    endPrev > start &&
    endNext > start &&
    prev[endPrev - 1] === next[endNext - 1]
  ) {
    endPrev--;
    endNext--;
  }
  const removeCount = endPrev - start;
  const insertText = next.slice(start, endNext);
  if (removeCount > 0) client.delete(start, removeCount);
  if (insertText.length > 0) client.insert(start, insertText);
}

function wireReplica(id: "A" | "B"): SyncClient {
  const transport = new WebSocketTransport({ url: WS_URL, initialBackoffMs: 300 });
  const client = new SyncClient({ replicaId: id, transport });

  const editor = document.getElementById(`editor-${id}`) as HTMLTextAreaElement;
  const status = document.getElementById(`status-${id}`) as HTMLSpanElement;
  const toggle = document.getElementById(`toggle-${id}`) as HTMLButtonElement;

  let lastValue = "";

  const render = (): void => {
    const text = client.text;
    if (editor.value !== text) {
      const caret = editor.selectionStart;
      editor.value = text;
      editor.setSelectionRange(caret, caret);
    }
    lastValue = text;
  };

  client.onChange(render);

  editor.addEventListener("input", () => {
    reconcile(client, lastValue, editor.value);
    lastValue = editor.value;
    updateConvergence();
  });

  transport.onOpen(() => {
    status.textContent = "online";
    status.className = "status online";
  });
  transport.onClose(() => {
    status.textContent = "offline";
    status.className = "status offline";
  });

  let connected = true;
  toggle.addEventListener("click", () => {
    connected = !connected;
    if (connected) transport.connect();
    else transport.close();
  });

  client.start();
  return client;
}

const convergedEl = document.getElementById("converged") as HTMLElement;
let clientA: SyncClient;
let clientB: SyncClient;

function updateConvergence(): void {
  if (!clientA || !clientB) return;
  const same = clientA.text === clientB.text;
  convergedEl.textContent = same ? "converged ✓" : "diverging…";
  convergedEl.className = same ? "converged" : "diverged";
}

clientA = wireReplica("A");
clientB = wireReplica("B");
clientA.onChange(updateConvergence);
clientB.onChange(updateConvergence);
updateConvergence();
