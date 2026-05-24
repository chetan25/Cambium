import { SessionStore } from "./SessionStore";

type Listener = (event: { type: string; payload: unknown }) => void;

// Listens for messages from the WebContainer iframe. Handles state get/set
// directly; forwards everything else (USAGE_EVENTS, etc.) to subscribers.
export class HostMessageBridge {
  private listeners = new Set<Listener>();
  private wcOrigin: string | null = null;
  private boundHandler: ((e: MessageEvent) => void) | null = null;

  setWcOrigin(url: string | null) {
    if (!url) {
      this.wcOrigin = null;
      return;
    }
    try {
      this.wcOrigin = new URL(url).origin;
    } catch {
      this.wcOrigin = null;
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start() {
    if (this.boundHandler) return;
    this.boundHandler = this.handle.bind(this);
    window.addEventListener("message", this.boundHandler);
  }

  stop() {
    if (this.boundHandler) {
      window.removeEventListener("message", this.boundHandler);
      this.boundHandler = null;
    }
  }

  private async handle(event: MessageEvent) {
    // Origin check — only accept messages from the WC iframe.
    if (!this.wcOrigin || event.origin !== this.wcOrigin) return;

    const msg = event.data as { type?: string; key?: string; value?: unknown } | null;
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "STATE_GET" && typeof msg.key === "string") {
      const value = await SessionStore.getState(msg.key);
      // Reply back to the iframe with the stored value.
      (event.source as Window | null)?.postMessage(
        { type: "STATE_RESULT", key: msg.key, value },
        { targetOrigin: event.origin },
      );
      return;
    }

    if (msg.type === "STATE_SET" && typeof msg.key === "string") {
      await SessionStore.setState(msg.key, msg.value);
      return;
    }

    // Pass everything else to subscribers (Day 5 wires USAGE_EVENTS).
    for (const listener of this.listeners) {
      listener({ type: msg.type, payload: msg });
    }
  }
}
