import { SessionStore } from "./SessionStore";
import type { Pattern } from "./observe-types";
import type { UsageCollector } from "./UsageCollector";

const ANALYSIS_THRESHOLD = 20; // new events before an analysis fires
const DEBOUNCE_MS = 15_000; // at most one analysis every 15s
const CONFIDENCE_FLOOR = 0.7;

export class SuggestionEngine {
  private busy = false;
  private lastAnalysisAt = 0;
  // Track by normalized feature text, not by pattern.id — the LLM generates
  // a fresh UUID for every analysis call, so id-based dedup lets the same
  // semantic suggestion re-appear after the user skipped or built it.
  private dismissedFeatures = new Set<string>();
  private appliedFeatures = new Set<string>();

  onSuggestion?: (patterns: Pattern[]) => void;
  getCurrentCode?: () => Promise<Record<string, string>>;
  // Returns the wall-clock timestamp of the most recent applied mutation,
  // or 0 if no mutation has been applied yet. Used to scope events to the
  // current "project epoch" so behavior from prior app versions can't
  // drive suggestions for the current one.
  getLastMutationAt?: () => number;

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

      // Scope to the current project epoch: drop events that predate the
      // most recent applied mutation. Events without a `ts` field are from
      // before this feature shipped — treat them as pre-epoch and exclude.
      const since = this.getLastMutationAt?.() ?? 0;
      const scoped =
        since > 0
          ? (events as Array<Record<string, unknown>>).filter((e) => {
              const ts = typeof e?.ts === "number" ? (e.ts as number) : null;
              return ts !== null && ts >= since;
            })
          : events;

      // Skip the LLM call entirely if there's nothing new to reason about —
      // saves the round-trip cost and avoids surfacing stale patterns.
      if (scoped.length === 0) return;

      // Pass the actual feature text (not UUIDs) so the LLM has something
      // semantic to compare against and can avoid re-proposing rephrasings
      // of features the user already skipped or built.
      const excludeFeatures = [
        ...this.dismissedFeatures,
        ...this.appliedFeatures,
      ];

      const res = await fetch("/api/observe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: scoped,
          currentCode: code,
          excludeFeatures,
        }),
      });
      if (!res.ok) {
        console.warn("[SuggestionEngine] /api/observe", res.status);
        return;
      }
      const data = (await res.json()) as { patterns?: Pattern[] };
      const incoming = Array.isArray(data.patterns) ? data.patterns : [];

      // Client-side backstop: even if the LLM ignores excludeFeatures, drop
      // any pattern whose normalized feature matches one the user already
      // dismissed or built.
      const fresh = incoming.filter(
        (p) =>
          !this.dismissedFeatures.has(normalizeFeature(p.proposed_feature)) &&
          !this.appliedFeatures.has(normalizeFeature(p.proposed_feature)) &&
          p.confidence >= CONFIDENCE_FLOOR,
      );

      if (fresh.length > 0) this.onSuggestion?.(fresh);
    } catch (e) {
      console.warn("[SuggestionEngine] analyse failed", e);
    } finally {
      this.busy = false;
    }
  }

  dismiss(pattern: Pattern): void {
    this.dismissedFeatures.add(normalizeFeature(pattern.proposed_feature));
  }

  markApplied(pattern: Pattern): void {
    this.appliedFeatures.add(normalizeFeature(pattern.proposed_feature));
  }

  // Called after the user applies a code mutation. The app's behavior is now
  // shaped by new code, so the next analysis should run against fresh events
  // — not the queue accumulated while the OLD code was running. Resets the
  // debounce window so analysis can fire as soon as the new threshold is hit,
  // and zeroes the new-event counter so post-mutation events drive the pass.
  resetForMutation(): void {
    this.lastAnalysisAt = 0;
    this.collector.resetCounter();
  }

  // For console-debug introspection.
  getState() {
    return {
      busy: this.busy,
      dismissedCount: this.dismissedFeatures.size,
      appliedCount: this.appliedFeatures.size,
      lastAnalysisAt: this.lastAnalysisAt,
    };
  }
}

// Whitespace and case shouldn't make "Add a dark mode toggle" and "add a
// dark mode toggle " look like different features. The LLM does this kind
// of cosmetic variation routinely.
function normalizeFeature(feature: string): string {
  return feature.trim().toLowerCase().replace(/\s+/g, " ");
}
