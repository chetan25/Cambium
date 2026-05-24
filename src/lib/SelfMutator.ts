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
      `Implementation hint: ${pattern.implementation_hint}`,
      "",
      "Constraints:",
      "- The user did NOT ask for this explicitly — be conservative.",
      "- Preserve ALL existing data and behavior.",
      "- Add minimally. Do not redesign the app or change existing styling.",
    ].join("\n");

    return this.orchestrator.propose(instruction, onPartial);
  }
}
