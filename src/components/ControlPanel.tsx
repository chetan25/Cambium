"use client";

import { useEffect, useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/ssr/ArrowsClockwise";
import { useAppStore } from "@/store/appStore";
import { SessionStore } from "@/lib/SessionStore";
import type { MutationOrchestrator } from "@/lib/MutationOrchestrator";
import type { SelfMutator } from "@/lib/SelfMutator";
import type { SuggestionEngine } from "@/lib/SuggestionEngine";
import type { Pattern } from "@/lib/observe-types";
import { ChatInput } from "./ChatInput";
import { DiffPreview } from "./DiffPreview";
import { MutationLog } from "./MutationLog";
import { SuggestionCard } from "./SuggestionCard";

interface Props {
  orchestrator: MutationOrchestrator | null;
  selfMutator: SelfMutator | null;
  suggestionEngine: SuggestionEngine | null;
  onBoot: () => void;
  onReset: () => void;
}

export function ControlPanel({
  orchestrator,
  selfMutator,
  suggestionEngine,
  onBoot,
  onReset,
}: Props) {
  const wcStatus = useAppStore((s) => s.wcStatus);
  const bootError = useAppStore((s) => s.bootError);
  const resumed = useAppStore((s) => s.resumedFromSnapshot);
  const lastError = useAppStore((s) => s.lastError);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const pending = useAppStore((s) => s.pendingMutation);
  const suggestions = useAppStore((s) => s.suggestions);

  const [applying, setApplying] = useState(false);
  const [activePatternId, setActivePatternId] = useState<string | null>(null);

  useEffect(() => {
    SessionStore.getMutationLog().then((entries) => {
      useAppStore.getState().setMutationLog(entries);
    });
  }, []);

  const startProposal = async (
    instruction: string,
    selfMutated?: { pattern: Pattern },
  ) => {
    if (!orchestrator) return;
    const store = useAppStore.getState();
    store.setLastError(null);
    store.setPartial(null);
    store.setPending(null);
    store.setStreaming(true);
    setActivePatternId(selfMutated?.pattern.id ?? null);
    try {
      const onPartial = (partial: Parameters<typeof store.setPartial>[0]) =>
        useAppStore.getState().setPartial(partial);
      const pending =
        selfMutated && selfMutator
          ? await selfMutator.applyPattern(selfMutated.pattern, onPartial)
          : await orchestrator.propose(instruction, onPartial);
      useAppStore.getState().setPending(pending);
    } catch (e) {
      useAppStore.getState().setLastError((e as Error).message);
      useAppStore.getState().setPartial(null);
      setActivePatternId(null);
    } finally {
      useAppStore.getState().setStreaming(false);
    }
  };

  const submit = (instruction: string) => startProposal(instruction);

  const apply = async () => {
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

      if (activePatternId) {
        suggestionEngine?.markApplied(activePatternId);
        useAppStore.getState().removeSuggestion(activePatternId);
        setActivePatternId(null);
      }

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
    setActivePatternId(null);
  };

  const approveSuggestion = (pattern: Pattern) => {
    startProposal(pattern.proposed_feature, { pattern });
  };

  const dismissSuggestion = (pattern: Pattern) => {
    suggestionEngine?.dismiss(pattern.id);
    useAppStore.getState().removeSuggestion(pattern.id);
  };

  const currentSuggestion = suggestions[0] ?? null;
  const showSuggestion =
    currentSuggestion && !isStreaming && !pending && wcStatus === "ready";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden bg-white p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-[15px] font-semibold tracking-tight text-zinc-900">
              Cambium
            </h1>
            <span className="font-mono text-[10px] tracking-tight text-zinc-400">
              v0.1
            </span>
          </div>
          <p className="mt-0.5 text-[11.5px] leading-snug text-zinc-500">
            Talk to your app. Watch it grow.
          </p>
        </div>
        <StatusBadge status={wcStatus} />
      </header>

      {wcStatus === "idle" && (
        <button
          type="button"
          onClick={onBoot}
          data-tactile
          className="w-fit rounded-xl bg-zinc-950 px-3.5 py-2 text-[13px] font-medium tracking-tight text-white hover:bg-zinc-800 active:scale-[0.98]"
        >
          Boot WebContainer
        </button>
      )}

      {bootError && (
        <div className="rounded-xl border border-red-200 bg-red-50/60 px-3 py-2 text-[11.5px] leading-snug text-red-700">
          {bootError}
        </div>
      )}

      {resumed && wcStatus === "ready" && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-1.5 text-[11.5px] text-zinc-600">
          <span>Resumed from your last session.</span>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.97]"
          >
            <ArrowsClockwise size={11} weight="bold" />
            Reset
          </button>
        </div>
      )}

      <ChatInput onSubmit={submit} />

      {lastError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11.5px] leading-snug text-amber-800">
          {lastError}
        </div>
      )}

      {showSuggestion && currentSuggestion && (
        <SuggestionCard
          pattern={currentSuggestion}
          onApprove={approveSuggestion}
          onDismiss={dismissSuggestion}
          disabled={applying}
        />
      )}

      {(isStreaming || pending) && (
        <DiffPreview onApply={apply} onReject={reject} applying={applying} />
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
          <span>Mutation log</span>
          {suggestions.length > 1 && (
            <span className="font-mono normal-case tracking-tight text-emerald-600">
              +{suggestions.length - 1} more
            </span>
          )}
        </div>
        <div className="scrollbar-thin flex-1 overflow-auto pr-1">
          <MutationLog />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const STATES: Record<
    string,
    { tone: string; label: string; pulsing: boolean }
  > = {
    idle: { tone: "bg-zinc-300", label: "Idle", pulsing: false },
    booting: { tone: "bg-amber-500", label: "Booting", pulsing: true },
    mounting: { tone: "bg-amber-500", label: "Mounting", pulsing: true },
    installing: { tone: "bg-amber-500", label: "Installing", pulsing: true },
    starting: { tone: "bg-amber-500", label: "Starting", pulsing: true },
    ready: { tone: "bg-emerald-500", label: "Ready", pulsing: false },
    error: { tone: "bg-red-500", label: "Error", pulsing: false },
  };
  const s = STATES[status] ?? STATES.idle;
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/80 px-2 py-0.5 text-[10px] font-medium tracking-tight text-zinc-600">
      <span
        className={`size-1.5 rounded-full ${s.tone} ${
          s.pulsing ? "status-pulse" : ""
        }`}
        aria-hidden
      />
      {s.label}
    </div>
  );
}
