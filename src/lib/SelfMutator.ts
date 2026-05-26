import type {
  MutationOrchestrator,
  PendingMutation,
} from "./MutationOrchestrator";
import type { ProposedMutations } from "./mutation-types";
import type { Pattern } from "./observe-types";

// Translates a detected pattern into a mutation instruction and routes it
// through the same MutationOrchestrator as manual chat. Idea D is just
// Idea B with an automated trigger.
export class SelfMutator {
  constructor(private orchestrator: MutationOrchestrator) {}

  async applyPattern(
    pattern: Pattern,
    onPartial?: (partial: Partial<ProposedMutations>) => void,
  ): Promise<PendingMutation> {
    const instruction = [
      `Add this feature: ${pattern.proposed_feature}`,
      "",
      `Observed behavior that triggered the suggestion: ${pattern.observation}`,
      `Implementation hint: ${pattern.implementation_hint}`,
      "",
      "Requirements:",
      "- The feature MUST be fully wired and functional end-to-end. A user must be able to trigger it through the existing UI without further mutations.",
      "- Do NOT stop at scaffolding (e.g. adding a helper function without calling it, or a piece of state that nothing reads). If a handler is needed, wire it. If a piece of state changes how rendering works, render it.",
      "- Preserve ALL existing data and behavior unless the feature directly contradicts it.",
      "- Keep the change scoped — touch the smallest set of files that delivers a working feature. Add new components/hooks only when the feature genuinely needs them (per the structure rules in the system prompt).",
      "- If you cannot fully wire the feature given the current code (e.g. the relevant component does not exist, or the implementation hint is incoherent), return an empty mutations array with a summary explaining why instead of proposing a half-working change.",
    ].join("\n");

    return this.orchestrator.propose(instruction, onPartial);
  }
}
