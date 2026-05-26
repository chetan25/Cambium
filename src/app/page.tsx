"use client";

import { useEffect, useRef, useState } from "react";
import { WebContainerHost } from "@/lib/WebContainerHost";
import { FileSystemManager } from "@/lib/FileSystemManager";
import { MutationOrchestrator } from "@/lib/MutationOrchestrator";
import { HostMessageBridge } from "@/lib/HostMessageBridge";
import { UsageCollector } from "@/lib/UsageCollector";
import { SuggestionEngine } from "@/lib/SuggestionEngine";
import { SelfMutator } from "@/lib/SelfMutator";
import { SessionStore } from "@/lib/SessionStore";
import { RuntimeErrorWatcher } from "@/lib/RuntimeErrorWatcher";
import { useAppStore } from "@/store/appStore";
import { ControlPanel } from "@/components/ControlPanel";
import { LiveApp } from "@/components/LiveApp";
import { FullShell } from "@/components/FullShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type WindowGlobals = {
  __wc: WebContainerHost;
  __fs: FileSystemManager;
  __orch: MutationOrchestrator;
  __collector: UsageCollector;
  __engine: SuggestionEngine;
  __mutator: SelfMutator;
};

export default function Home() {
  const [orchestrator, setOrchestrator] =
    useState<MutationOrchestrator | null>(null);
  const [selfMutator, setSelfMutator] = useState<SelfMutator | null>(null);
  const [suggestionEngine, setSuggestionEngine] =
    useState<SuggestionEngine | null>(null);
  const [fs, setFs] = useState<FileSystemManager | null>(null);

  const hostRef = useRef<WebContainerHost | null>(null);
  const bridgeRef = useRef<HostMessageBridge | null>(null);
  const collectorRef = useRef<UsageCollector | null>(null);
  const watcherRef = useRef<RuntimeErrorWatcher | null>(null);
  const installInFlight = useRef<Promise<void> | null>(null);

  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const manualOverride = useAppStore((s) => s.manualViewOverride);
  const mutationLogCount = useAppStore((s) => s.mutationLog.length);
  const resumedFromSnapshot = useAppStore((s) => s.resumedFromSnapshot);
  const wcStatus = useAppStore((s) => s.wcStatus);

  // Auto-flip to full mode once the app exists. Gated on wcStatus === 'ready'
  // so a persisted mutation log loaded from IDB can't flip us away from the
  // ControlPanel (which owns the Boot button) before the user has booted.
  useEffect(() => {
    if (manualOverride) return;
    if (viewMode === "full") return;
    if (wcStatus !== "ready") return;
    if (mutationLogCount > 0 || resumedFromSnapshot) {
      setViewMode("full", false);
    }
  }, [
    mutationLogCount,
    resumedFromSnapshot,
    manualOverride,
    viewMode,
    setViewMode,
    wcStatus,
  ]);

  // Bridge persists for the page's lifetime. Handles STATE_GET/SET directly
  // and forwards USAGE_EVENTS to the UsageCollector once it subscribes.
  useEffect(() => {
    const bridge = new HostMessageBridge();
    bridgeRef.current = bridge;
    bridge.start();
    return () => {
      collectorRef.current?.stop();
      bridge.stop();
    };
  }, []);

  // 24h rolling event purge runs on page load.
  useEffect(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    SessionStore.purgeEventsOlderThan(cutoff).catch(() => {});
  }, []);

  // Restore the view mode the user was in last time so a refresh doesn't
  // dump them back on the ControlPanel. Persisted in localStorage so it's
  // synchronous and doesn't require a round-trip to IDB before first paint.
  useEffect(() => {
    try {
      const savedView = window.localStorage.getItem("cambium-view-mode");
      const savedOverride =
        window.localStorage.getItem("cambium-view-override") === "true";
      if (savedView === "full" || savedView === "split") {
        useAppStore.getState().setViewMode(savedView, savedOverride);
      }
    } catch {
      // localStorage can throw in private modes / quota-exceeded — ignore.
    }
    const unsubscribe = useAppStore.subscribe((state, prev) => {
      try {
        if (state.viewMode !== prev.viewMode) {
          window.localStorage.setItem("cambium-view-mode", state.viewMode);
        }
        if (state.manualViewOverride !== prev.manualViewOverride) {
          window.localStorage.setItem(
            "cambium-view-override",
            String(state.manualViewOverride),
          );
        }
      } catch {
        // ignore write failures
      }
    });
    return unsubscribe;
  }, []);

  const boot = async () => {
    if (hostRef.current) return;
    const store = useAppStore.getState();
    store.setBootError(null);

    const host = new WebContainerHost();
    const watcher = new RuntimeErrorWatcher();
    watcherRef.current = watcher;

    // Auto-install any missing npm package surfaced by Vite. The watcher
    // emits at most once per distinct package per session.
    watcher.onMissingPackage = async ({ packageName, sourcePath }) => {
      const s = useAppStore.getState();
      // Serialise installs so two errors in quick succession don't fight.
      const run = (async () => {
        s.setAutoFixNotice(`Installing ${packageName}…`);
        try {
          await host.installPackage(packageName);
          // Vite caches the failed resolution and won't retry on its own when
          // node_modules changes inside the WC. Touch the importing file so
          // its watcher fires and Vite re-runs import-analysis.
          if (sourcePath) {
            try {
              await host.touchFile(sourcePath);
            } catch {
              // Non-fatal — install still succeeded; user may need to nudge
              // the file themselves or reload the preview.
            }
          }
          s.setAutoFixNotice(null);
        } catch (e) {
          s.setAutoFixNotice(null);
          s.setLastError(
            `Could not auto-install ${packageName}: ${(e as Error).message}`,
          );
        }
      })();
      const prior = installInFlight.current ?? Promise.resolve();
      installInFlight.current = prior.then(() => run);
      await installInFlight.current;
    };

    host.onStatus = store.setWcStatus;
    host.onUrl = (url) => {
      store.setWcUrl(url);
      bridgeRef.current?.setWcOrigin(url);
    };
    host.onLog = (chunk) => {
      store.appendTerminal(chunk);
      watcher.feed(chunk);
    };
    hostRef.current = host;

    try {
      const container = await host.start();
      const fsInstance = new FileSystemManager(container);
      const orch = new MutationOrchestrator(fsInstance);
      const collector = new UsageCollector();
      const engine = new SuggestionEngine(collector);
      const mutator = new SelfMutator(orch);

      engine.getCurrentCode = () => fsInstance.getAppSnapshot();
      engine.getLastMutationAt = () => {
        const log = useAppStore.getState().mutationLog;
        if (log.length === 0) return 0;
        // mutationLog is sorted by appliedAt asc in SessionStore.getMutationLog,
        // so the tail is the most recent.
        return log[log.length - 1].appliedAt;
      };
      engine.onSuggestion = (patterns) => {
        useAppStore.getState().addSuggestions(patterns);
      };

      collector.onBatch = () => {
        engine.maybeAnalyse().catch(() => {});
      };

      if (bridgeRef.current) {
        collector.start(bridgeRef.current);
      }
      collectorRef.current = collector;

      setFs(fsInstance);
      setOrchestrator(orch);
      setSelfMutator(mutator);
      setSuggestionEngine(engine);
      useAppStore.getState().setResumedFromSnapshot(host.resumedFromSnapshot);

      const w = window as unknown as WindowGlobals;
      w.__wc = host;
      w.__fs = fsInstance;
      w.__orch = orch;
      w.__collector = collector;
      w.__engine = engine;
      w.__mutator = mutator;
    } catch (e) {
      store.setBootError((e as Error).message);
    }
  };

  // Auto-boot when there's a saved snapshot, so a refresh doesn't leave the
  // user staring at a "Click Boot" page. boot() is idempotent — early-returns
  // if already booted — so a second user-initiated click is also safe.
  const bootRef = useRef(boot);
  bootRef.current = boot;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await SessionStore.loadLatestSnapshot();
        if (!cancelled && snap) {
          bootRef.current();
        }
      } catch {
        // If snapshot loading fails, fall through to the manual Boot button.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [resetOpen, setResetOpen] = useState(false);
  const openReset = () => setResetOpen(true);
  const cancelReset = () => setResetOpen(false);
  const confirmReset = async () => {
    setResetOpen(false);
    await SessionStore.clearAll();
    // Also drop the persisted view mode so a fresh session lands on the
    // welcome ControlPanel rather than an empty FullShell.
    try {
      window.localStorage.removeItem("cambium-view-mode");
      window.localStorage.removeItem("cambium-view-override");
    } catch {
      // ignore
    }
    window.location.reload();
  };

  const resetDialog = (
    <ConfirmDialog
      open={resetOpen}
      title="Clear all session data?"
      description="The saved code snapshot, app state, recorded events, and mutation log will all be deleted. This cannot be undone."
      confirmLabel="Clear all data"
      cancelLabel="Cancel"
      destructive
      onConfirm={confirmReset}
      onCancel={cancelReset}
    />
  );

  if (viewMode === "full") {
    return (
      <>
        <FullShell
          orchestrator={orchestrator}
          selfMutator={selfMutator}
          suggestionEngine={suggestionEngine}
          fs={fs}
          onReset={openReset}
        />
        {resetDialog}
      </>
    );
  }

  return (
    <>
      <main className="grid h-[100dvh] grid-cols-[minmax(380px,38%)_1fr]">
        <ControlPanel
          orchestrator={orchestrator}
          selfMutator={selfMutator}
          suggestionEngine={suggestionEngine}
          fs={fs}
          onBoot={boot}
          onReset={openReset}
        />
        <LiveApp />
      </main>
      {resetDialog}
    </>
  );
}
