"use client";

import { useEffect, useRef, useState } from "react";
import { ChatCircle } from "@phosphor-icons/react/dist/ssr/ChatCircle";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { ColumnsPlusLeft } from "@phosphor-icons/react/dist/ssr/ColumnsPlusLeft";
import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
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

const TOAST_DURATION_MS = 60_000;

const FULL_SHELL_STATUS_MESSAGE: Record<string, string> = {
  idle: "WebContainer not booted yet.",
  booting: "Booting WebContainer runtime…",
  mounting: "Mounting source files…",
  installing: "Installing dependencies inside the WebContainer…",
  starting: "Starting dev server…",
  error: "WebContainer failed to start. Check the terminal in split view.",
};

interface Props {
  orchestrator: MutationOrchestrator | null;
  selfMutator: SelfMutator | null;
  suggestionEngine: SuggestionEngine | null;
  fs: FileSystemManager | null;
  onReset: () => void;
}

export function FullShell({
  orchestrator,
  selfMutator,
  suggestionEngine,
  fs,
  onReset,
}: Props) {
  const wcUrl = useAppStore((s) => s.wcUrl);
  const wcStatus = useAppStore((s) => s.wcStatus);
  const pending = useAppStore((s) => s.pendingMutation);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const lastError = useAppStore((s) => s.lastError);
  const suggestions = useAppStore((s) => s.suggestions);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const autoFixNotice = useAppStore((s) => s.autoFixNotice);
  const successNotice = useAppStore((s) => s.successNotice);
  const setSuccessNotice = useAppStore((s) => s.setSuccessNotice);

  const {
    applying,
    submit,
    apply,
    reject,
    approveSuggestion,
    dismissSuggestion,
    restoreMutation,
  } = useMutationFlow({ orchestrator, selfMutator, suggestionEngine, fs });

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Suggestions that have already been "seen" (toast cycle finished).
  // They stay in the store but appear as a FAB badge instead of a toast.
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());

  // Auto-dismiss the success notice after 12s so it doesn't pile up
  // across multiple mutations. The user can also close it manually.
  useEffect(() => {
    if (!successNotice) return;
    const id = setTimeout(() => setSuccessNotice(null), 12_000);
    return () => clearTimeout(id);
  }, [successNotice, setSuccessNotice]);

  // Open drawer automatically when a new pending mutation appears.
  useEffect(() => {
    if (pending || isStreaming) setDrawerOpen(true);
  }, [pending, isStreaming]);

  // Auto-collapse new suggestions into the badge after 60s.
  const toastSuggestion = suggestions.find((p) => !seenIds.has(p.id)) ?? null;
  const toastSuggestionId = toastSuggestion?.id ?? null;
  const expireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!toastSuggestionId) return;
    expireTimerRef.current = setTimeout(() => {
      setSeenIds((prev) => new Set(prev).add(toastSuggestionId));
    }, TOAST_DURATION_MS);
    return () => {
      if (expireTimerRef.current) clearTimeout(expireTimerRef.current);
    };
  }, [toastSuggestionId]);

  const badgeCount = suggestions.filter(
    (p) => seenIds.has(p.id) && p.id !== toastSuggestionId,
  ).length;

  const openDrawer = () => setDrawerOpen(true);
  const closeDrawer = () => setDrawerOpen(false);

  // Approving a suggestion opens the drawer so the streaming diff is visible.
  const handleApprove = (pattern: typeof suggestions[number]) => {
    openDrawer();
    approveSuggestion(pattern);
  };

  return (
    <main className="relative h-[100dvh] overflow-hidden bg-zinc-50">
      <div className="absolute inset-0">
        {wcUrl ? (
          <iframe
            src={wcUrl}
            className="h-full w-full border-0 bg-white"
            allow="cross-origin-isolated"
            title="Cambium preview"
          />
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="space-y-3 text-sm text-zinc-500">
              <div>{FULL_SHELL_STATUS_MESSAGE[wcStatus] ?? FULL_SHELL_STATUS_MESSAGE.idle}</div>
              {wcStatus === "idle" && (
                <button
                  type="button"
                  onClick={() => setViewMode("split", true)}
                  className="rounded-xl bg-zinc-950 px-3.5 py-2 text-[13px] font-medium tracking-tight text-white hover:bg-zinc-800 active:scale-[0.98]"
                >
                  Switch to split view to boot
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {autoFixNotice && (
        <div className="fade-up absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-emerald-200 bg-white/95 px-3 py-1.5 text-[11px] font-medium text-emerald-800 shadow-[0_8px_30px_-10px_rgba(5,150,105,0.30)]">
          <span className="mr-1.5 inline-block size-1.5 -translate-y-0.5 animate-pulse rounded-full bg-emerald-500 align-middle" />
          <span className="font-mono">{autoFixNotice}</span>
        </div>
      )}

      {successNotice && (
        <div className="fade-up absolute left-1/2 top-4 z-20 flex max-w-[560px] -translate-x-1/2 items-start gap-3 rounded-2xl border border-emerald-200 bg-white/95 px-4 py-3 text-[12.5px] leading-relaxed text-emerald-900 shadow-[0_12px_40px_-12px_rgba(5,150,105,0.35)]">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
            <Check size={12} weight="bold" />
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
            className="grid size-6 shrink-0 place-items-center rounded-md text-emerald-700 hover:bg-emerald-50 active:scale-[0.94]"
          >
            <X size={12} weight="bold" />
          </button>
        </div>
      )}

      {!drawerOpen && toastSuggestion && (
        <div className="fade-up pointer-events-auto absolute right-4 top-4 z-20 w-[340px]">
          <SuggestionCard
            pattern={toastSuggestion}
            onApprove={handleApprove}
            onDismiss={dismissSuggestion}
            disabled={applying}
          />
        </div>
      )}

      {!drawerOpen && (
        <button
          type="button"
          onClick={openDrawer}
          aria-label="Open chat"
          className="absolute bottom-5 right-5 z-20 grid size-12 place-items-center rounded-full bg-zinc-950 text-white shadow-[0_20px_40px_-15px_rgba(24,24,27,0.45)] hover:bg-zinc-800 active:scale-[0.95]"
        >
          <ChatCircle size={20} weight="regular" />
          {badgeCount > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold text-white">
              {badgeCount}
            </span>
          )}
        </button>
      )}

      <aside
        aria-hidden={!drawerOpen}
        className={`absolute inset-y-0 right-0 z-30 flex w-full max-w-[440px] flex-col border-l border-zinc-200 bg-white shadow-[0_-30px_60px_-30px_rgba(24,24,27,0.30)] transition-transform duration-300 ease-out ${
          drawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <div>
            <div className="flex items-baseline gap-2">
              <h2 className="text-[14px] font-semibold tracking-tight text-zinc-900">
                Cambium
              </h2>
              <span className="font-mono text-[10px] tracking-tight text-zinc-400">
                v0.1
              </span>
            </div>
            <p className="text-[11px] leading-snug text-zinc-500">
              Talk to your app. Watch it grow.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewMode("split", true)}
              aria-label="Switch to split view"
              title="Switch to split view"
              className="grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 active:scale-[0.92]"
            >
              <ColumnsPlusLeft size={14} weight="regular" />
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
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="Close"
              className="grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 active:scale-[0.92]"
            >
              <X size={14} weight="bold" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          <ChatInput onSubmit={submit} />

          {autoFixNotice && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[11.5px] text-emerald-800">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              <span className="font-mono">{autoFixNotice}</span>
            </div>
          )}

          {lastError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11.5px] leading-snug text-amber-800">
              {lastError}
            </div>
          )}

          {suggestions
            .filter((p) => seenIds.has(p.id))
            .slice(0, 1)
            .map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-[11.5px] text-emerald-800"
              >
                <Sparkle size={12} weight="fill" />
                <span className="truncate flex-1">{p.headline}</span>
                <button
                  type="button"
                  onClick={() => handleApprove(p)}
                  className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white hover:bg-emerald-700 active:scale-[0.96]"
                >
                  Build it
                </button>
                <button
                  type="button"
                  onClick={() => dismissSuggestion(p)}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100"
                >
                  Skip
                </button>
              </div>
            ))}

          {(isStreaming || pending) && (
            <DiffPreview onApply={apply} onReject={reject} applying={applying} />
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
              History
            </div>
            <div className="scrollbar-thin flex-1 overflow-auto pr-1">
              <MutationLog onRestore={restoreMutation} />
            </div>
          </div>
        </div>
      </aside>
    </main>
  );
}
