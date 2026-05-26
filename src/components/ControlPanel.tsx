"use client";

import { useEffect } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/ssr/ArrowsClockwise";
import { ChatCircle } from "@phosphor-icons/react/dist/ssr/ChatCircle";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useAppStore } from "@/store/appStore";
import type { MutationOrchestrator } from "@/lib/MutationOrchestrator";
import type { SelfMutator } from "@/lib/SelfMutator";
import type { SuggestionEngine } from "@/lib/SuggestionEngine";
import type { FileSystemManager } from "@/lib/FileSystemManager";
import { useMutationFlow } from "@/hooks/useMutationFlow";
import { ChatInput } from "./ChatInput";
import { DiffPreview } from "./DiffPreview";
import { MutationLog } from "./MutationLog";
import { SuggestionCard } from "./SuggestionCard";

interface Props {
  orchestrator: MutationOrchestrator | null;
  selfMutator: SelfMutator | null;
  suggestionEngine: SuggestionEngine | null;
  fs: FileSystemManager | null;
  onBoot: () => void;
  onReset: () => void;
}

export function ControlPanel({
  orchestrator,
  selfMutator,
  suggestionEngine,
  fs,
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
  const autoFixNotice = useAppStore((s) => s.autoFixNotice);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const successNotice = useAppStore((s) => s.successNotice);
  const setSuccessNotice = useAppStore((s) => s.setSuccessNotice);

  useEffect(() => {
    if (!successNotice) return;
    const id = setTimeout(() => setSuccessNotice(null), 12_000);
    return () => clearTimeout(id);
  }, [successNotice, setSuccessNotice]);

  const {
    applying,
    submit,
    apply,
    reject,
    approveSuggestion,
    dismissSuggestion,
    restoreMutation,
  } = useMutationFlow({ orchestrator, selfMutator, suggestionEngine, fs });

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
        <div className="flex items-center gap-1.5">
          <StatusBadge status={wcStatus} />
          <button
            type="button"
            onClick={() => setViewMode("full", true)}
            aria-label="Switch to bubble view"
            title="Switch to bubble view"
            className="grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 active:scale-[0.92]"
          >
            <ChatCircle size={14} weight="regular" />
          </button>
          <button
            type="button"
            onClick={onReset}
            aria-label="Clear all session data"
            title="Clear all session data"
            className="grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-red-50 hover:text-red-600 active:scale-[0.92]"
          >
            <Trash size={14} weight="regular" />
          </button>
        </div>
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

      {autoFixNotice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[11.5px] text-emerald-800">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
          <span className="font-mono">{autoFixNotice}</span>
        </div>
      )}

      {successNotice && (
        <div className="fade-up flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 text-[12px] leading-relaxed text-emerald-900">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
            <Check size={11} weight="bold" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-700">
              Change applied — verify it
            </div>
            <div className="mt-0.5 break-words text-zinc-800">
              {successNotice}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSuccessNotice(null)}
            aria-label="Dismiss"
            className="grid size-5 shrink-0 place-items-center rounded text-emerald-700 hover:bg-emerald-100 active:scale-[0.94]"
          >
            <X size={10} weight="bold" />
          </button>
        </div>
      )}

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
          <MutationLog onRestore={restoreMutation} />
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
