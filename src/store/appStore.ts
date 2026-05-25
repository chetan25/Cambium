import { create } from "zustand";
import type { WCStatus } from "@/lib/WebContainerHost";
import type { PendingMutation } from "@/lib/MutationOrchestrator";
import type { ProposedMutations } from "@/lib/mutation-types";
import type { MutationLogEntry } from "@/lib/SessionStore";
import type { Pattern } from "@/lib/observe-types";

interface AppState {
  // WebContainer lifecycle
  wcStatus: WCStatus;
  wcUrl: string | null;
  bootError: string | null;
  terminalLog: string;
  resumedFromSnapshot: boolean;

  // Mutation pipeline
  isStreaming: boolean;
  partialMutation: Partial<ProposedMutations> | null;
  pendingMutation: PendingMutation | null;
  lastError: string | null;

  // History
  mutationLog: MutationLogEntry[];

  // Phase 2 — proactive suggestions
  suggestions: Pattern[];

  // Layout mode
  viewMode: "split" | "full";
  manualViewOverride: boolean;

  // Runtime auto-resolve banner ("Installing framer-motion…")
  autoFixNotice: string | null;

  // Actions — WC
  setWcStatus: (s: WCStatus) => void;
  setWcUrl: (u: string | null) => void;
  setBootError: (e: string | null) => void;
  appendTerminal: (chunk: string) => void;
  setResumedFromSnapshot: (b: boolean) => void;

  // Actions — Mutation
  setStreaming: (s: boolean) => void;
  setPartial: (p: Partial<ProposedMutations> | null) => void;
  setPending: (m: PendingMutation | null) => void;
  setLastError: (e: string | null) => void;

  // Actions — History
  setMutationLog: (entries: MutationLogEntry[]) => void;
  pushLogEntry: (entry: MutationLogEntry) => void;

  // Actions — Suggestions
  addSuggestions: (patterns: Pattern[]) => void;
  removeSuggestion: (id: string) => void;
  clearSuggestions: () => void;

  // Actions — View mode
  setViewMode: (mode: "split" | "full", isManual?: boolean) => void;

  // Actions — Runtime auto-resolve
  setAutoFixNotice: (notice: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  wcStatus: "idle",
  wcUrl: null,
  bootError: null,
  terminalLog: "",
  resumedFromSnapshot: false,

  isStreaming: false,
  partialMutation: null,
  pendingMutation: null,
  lastError: null,

  mutationLog: [],
  suggestions: [],

  viewMode: "split",
  manualViewOverride: false,
  autoFixNotice: null,

  setWcStatus: (s) => set({ wcStatus: s }),
  setWcUrl: (u) => set({ wcUrl: u }),
  setBootError: (e) => set({ bootError: e }),
  appendTerminal: (chunk) =>
    set((state) => ({
      terminalLog: (state.terminalLog + chunk).slice(-32_000),
    })),
  setResumedFromSnapshot: (b) => set({ resumedFromSnapshot: b }),

  setStreaming: (s) => set({ isStreaming: s }),
  setPartial: (p) => set({ partialMutation: p }),
  setPending: (m) => set({ pendingMutation: m }),
  setLastError: (e) => set({ lastError: e }),

  setMutationLog: (entries) => set({ mutationLog: entries }),
  pushLogEntry: (entry) =>
    set((state) => ({ mutationLog: [...state.mutationLog, entry] })),

  addSuggestions: (patterns) =>
    set((state) => {
      const existing = new Set(state.suggestions.map((s) => s.id));
      const fresh = patterns.filter((p) => !existing.has(p.id));
      return { suggestions: [...state.suggestions, ...fresh] };
    }),
  removeSuggestion: (id) =>
    set((state) => ({
      suggestions: state.suggestions.filter((p) => p.id !== id),
    })),
  clearSuggestions: () => set({ suggestions: [] }),

  setViewMode: (mode, isManual = false) =>
    set((state) => ({
      viewMode: mode,
      manualViewOverride: isManual || state.manualViewOverride,
    })),

  setAutoFixNotice: (notice) => set({ autoFixNotice: notice }),
}));
