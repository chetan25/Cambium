import { SessionStore } from "./SessionStore";
import type { HostMessageBridge } from "./HostMessageBridge";

// Receives USAGE_EVENTS from the HostMessageBridge, persists to IDB, and
// exposes a counter of "new events since last analysis" for the engine.
export class UsageCollector {
  private newEventsSinceAnalysis = 0;
  private unsubscribe: (() => void) | null = null;

  onBatch?: () => void;

  start(bridge: HostMessageBridge): void {
    if (this.unsubscribe) return;
    this.unsubscribe = bridge.on(async ({ type, payload }) => {
      if (type !== "USAGE_EVENTS") return;
      const data = payload as { events?: unknown[] };
      const events = Array.isArray(data.events) ? data.events : [];
      if (events.length === 0) return;
      try {
        await SessionStore.appendEvents(events);
        this.newEventsSinceAnalysis += events.length;
        this.onBatch?.();
      } catch (e) {
        console.warn("[UsageCollector] persist failed", e);
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getNewEventCount(): number {
    return this.newEventsSinceAnalysis;
  }

  resetCounter(): void {
    this.newEventsSinceAnalysis = 0;
  }
}
