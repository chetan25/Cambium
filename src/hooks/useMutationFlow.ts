"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { SessionStore } from "@/lib/SessionStore";
import type {
  MutationOrchestrator,
  PendingMutation,
} from "@/lib/MutationOrchestrator";
import type { SelfMutator } from "@/lib/SelfMutator";
import type { SuggestionEngine } from "@/lib/SuggestionEngine";
import type { FileSystemManager } from "@/lib/FileSystemManager";
import type { Pattern } from "@/lib/observe-types";
import type { MutationLogEntry } from "@/lib/SessionStore";

interface Deps {
  orchestrator: MutationOrchestrator | null;
  selfMutator: SelfMutator | null;
  suggestionEngine: SuggestionEngine | null;
  fs: FileSystemManager | null;
}

// Centralises the mutation pipeline UI handlers so both SplitShell and
// FullShell can drive the same flow without duplicating state.
export function useMutationFlow({
  orchestrator,
  selfMutator,
  suggestionEngine,
  fs,
}: Deps) {
  const [applying, setApplying] = useState(false);
  // Track the full pattern object (not just its id) so apply can mark the
  // semantic feature as "built" — pattern.id is a one-shot UUID and won't
  // survive into the next analysis pass.
  const [activePattern, setActivePattern] = useState<Pattern | null>(null);

  useEffect(() => {
    SessionStore.getMutationLog().then((entries) => {
      useAppStore.getState().setMutationLog(entries);
    });
  }, []);

  const startProposal = async (
    instruction: string,
    options?: { pattern?: Pattern; image?: string | null },
  ) => {
    if (!orchestrator) return;
    const store = useAppStore.getState();
    store.setLastError(null);
    store.setPartial(null);
    store.setPending(null);
    store.setStreaming(true);
    setActivePattern(options?.pattern ?? null);
    try {
      const onPartial = (partial: Parameters<typeof store.setPartial>[0]) =>
        useAppStore.getState().setPartial(partial);
      const result: PendingMutation =
        options?.pattern && selfMutator
          ? await selfMutator.applyPattern(options.pattern, onPartial)
          : await orchestrator.propose(instruction, onPartial, options?.image);
      useAppStore.getState().setPending(result);
    } catch (e) {
      useAppStore.getState().setLastError((e as Error).message);
      useAppStore.getState().setPartial(null);
      setActivePattern(null);
    } finally {
      useAppStore.getState().setStreaming(false);
    }
  };

  const submit = (instruction: string, image?: string | null) =>
    startProposal(instruction, { image });

  const apply = async () => {
    const { pendingMutation: pending } = useAppStore.getState();
    if (!orchestrator || !pending || applying) return;
    setApplying(true);
    try {
      const result = await orchestrator.apply(pending);
      if (!result.ok && result.appliedCount === 0) {
        useAppStore
          .getState()
          .setLastError(
            `All mutations failed: ${result.failures
              .map((f) => `${f.path} (${f.reason})`)
              .join("; ")}`,
          );
        return;
      }

      const log = await SessionStore.getMutationLog();
      useAppStore.getState().setMutationLog(log);
      useAppStore.getState().setPending(null);
      useAppStore.getState().setPartial(null);

      // Surface the LLM-provided verification so the user knows exactly
      // how to confirm the change worked. Falls back to the summary if
      // the model omitted verification (older responses won't have it).
      const verification =
        (pending.parsed as { verification?: string }).verification?.trim() ||
        pending.parsed.summary;
      if (verification) {
        useAppStore.getState().setSuccessNotice(verification);
      }

      if (activePattern) {
        suggestionEngine?.markApplied(activePattern);
        setActivePattern(null);
      }

      // Suggestions are tied to the app's state at the time they were
      // inferred. Once a mutation changes the code, prior suggestions and
      // the events that produced them describe a different project. Clear
      // them and reset the analysis cycle so the next batch of events
      // drives fresh inference against the new code.
      useAppStore.getState().clearSuggestions();
      suggestionEngine?.resetForMutation();

      if (result.failures.length > 0) {
        useAppStore
          .getState()
          .setLastError(
            `Partial apply: ${result.failures
              .map((f) => f.path)
              .join(", ")} failed to match`,
          );
      }
    } catch (e) {
      useAppStore.getState().setLastError((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  const reject = () => {
    useAppStore.getState().setPending(null);
    useAppStore.getState().setPartial(null);
    setActivePattern(null);
  };

  const approveSuggestion = (pattern: Pattern) => {
    startProposal(pattern.proposed_feature, { pattern });
  };

  const dismissSuggestion = (pattern: Pattern) => {
    suggestionEngine?.dismiss(pattern);
    useAppStore.getState().removeSuggestion(pattern.id);
  };

  const restoreMutation = async (entry: MutationLogEntry) => {
    if (!entry.snapshotId || !fs) return;
    const ok = window.confirm(
      `Restore the app to "${entry.summary}"?\n\nAll mutations applied after this point will be discarded.`,
    );
    if (!ok) return;
    try {
      const snap = await SessionStore.restoreSnapshot(entry.snapshotId);
      if (!snap) {
        useAppStore.getState().setLastError("Snapshot not found.");
        return;
      }
      await fs.overwriteSrc(snap.files);
      const log = await SessionStore.getMutationLog();
      useAppStore.getState().setMutationLog(log);
    } catch (e) {
      useAppStore.getState().setLastError((e as Error).message);
    }
  };

  return {
    applying,
    submit,
    apply,
    reject,
    approveSuggestion,
    dismissSuggestion,
    restoreMutation,
  };
}
