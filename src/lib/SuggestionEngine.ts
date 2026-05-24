import { SessionStore } from "./SessionStore";
import type { Pattern } from "./observe-types";
import type { UsageCollector } from "./UsageCollector";

const ANALYSIS_THRESHOLD = 20; // new events before an analysis fires
const DEBOUNCE_MS = 15_000; // at most one analysis every 15s
const CONFIDENCE_FLOOR = 0.7;

export class SuggestionEngine {
  private busy = false;
  private lastAnalysisAt = 0;
  private dismissedIds = new Set<string>();
  private appliedIds = new Set<string>();

  onSuggestion?: (patterns: Pattern[]) => void;
  getCurrentCode?: () => Promise<Record<string, string>>;

  constructor(private collector: UsageCollector) {}

  // Called by UsageCollector after every batch. Decides whether to fire.
  async maybeAnalyse(): Promise<void> {
    if (this.busy) return;
    if (this.collector.getNewEventCount() < ANALYSIS_THRESHOLD) return;
    if (Date.now() - this.lastAnalysisAt < DEBOUNCE_MS) return;
    if (!this.getCurrentCode) return;

    this.busy = true;
    this.lastAnalysisAt = Date.now();
    this.collector.resetCounter();

    try {
      const [events, code] = await Promise.all([
        SessionStore.getRecentEvents(100),
        this.getCurrentCode(),
      ]);
      const excludeIds = [...this.dismissedIds, ...this.appliedIds];

      const res = await fetch("/api/observe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events, currentCode: code, excludeIds }),
      });
      if (!res.ok) {
        console.warn("[SuggestionEngine] /api/observe", res.status);
        return;
      }
      const data = (await res.json()) as { patterns?: Pattern[] };
      const incoming = Array.isArray(data.patterns) ? data.patterns : [];

      const fresh = incoming.filter(
        (p) =>
          !this.dismissedIds.has(p.id) &&
          !this.appliedIds.has(p.id) &&
          p.confidence >= CONFIDENCE_FLOOR,
      );

      if (fresh.length > 0) this.onSuggestion?.(fresh);
    } catch (e) {
      console.warn("[SuggestionEngine] analyse failed", e);
    } finally {
      this.busy = false;
    }
  }

  dismiss(id: string): void {
    this.dismissedIds.add(id);
  }

  markApplied(id: string): void {
    this.appliedIds.add(id);
  }

  // For console-debug introspection.
  getState() {
    return {
      busy: this.busy,
      dismissedCount: this.dismissedIds.size,
      appliedCount: this.appliedIds.size,
      lastAnalysisAt: this.lastAnalysisAt,
    };
  }
}
