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
import { useAppStore } from "@/store/appStore";
import { ControlPanel } from "@/components/ControlPanel";
import { LiveApp } from "@/components/LiveApp";

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

  const hostRef = useRef<WebContainerHost | null>(null);
  const bridgeRef = useRef<HostMessageBridge | null>(null);
  const collectorRef = useRef<UsageCollector | null>(null);

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

  // Periodic IDB hygiene — drop events older than 24h. Cheap and quiet.
  useEffect(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    SessionStore.purgeEventsOlderThan(cutoff).catch(() => {});
  }, []);

  const boot = async () => {
    if (hostRef.current) return;
    const store = useAppStore.getState();
    store.setBootError(null);

    const host = new WebContainerHost();
    host.onStatus = store.setWcStatus;
    host.onUrl = (url) => {
      store.setWcUrl(url);
      bridgeRef.current?.setWcOrigin(url);
    };
    host.onLog = store.appendTerminal;
    hostRef.current = host;

    try {
      const container = await host.start();
      const fs = new FileSystemManager(container);
      const orch = new MutationOrchestrator(fs);
      const collector = new UsageCollector();
      const engine = new SuggestionEngine(collector);
      const mutator = new SelfMutator(orch);

      // Engine pulls current code when it analyses, and surfaces patterns
      // back into Zustand for the UI.
      engine.getCurrentCode = () => fs.getAppSnapshot();
      engine.onSuggestion = (patterns) => {
        useAppStore.getState().addSuggestions(patterns);
      };

      // Every batch from the iframe ticks the engine; the engine decides
      // whether thresholds + debounce permit an analysis.
      collector.onBatch = () => {
        engine.maybeAnalyse().catch(() => {});
      };

      if (bridgeRef.current) {
        collector.start(bridgeRef.current);
      }
      collectorRef.current = collector;

      setOrchestrator(orch);
      setSelfMutator(mutator);
      setSuggestionEngine(engine);
      useAppStore.getState().setResumedFromSnapshot(host.resumedFromSnapshot);

      // Console-debug handles.
      const w = window as unknown as WindowGlobals;
      w.__wc = host;
      w.__fs = fs;
      w.__orch = orch;
      w.__collector = collector;
      w.__engine = engine;
      w.__mutator = mutator;
    } catch (e) {
      store.setBootError((e as Error).message);
    }
  };

  const reset = async () => {
    const ok = window.confirm(
      "Reset to the welcome canvas? Saved code snapshot, app data, events, and mutation log will be cleared.",
    );
    if (!ok) return;
    await SessionStore.clearAll();
    window.location.reload();
  };

  return (
    <main className="grid h-[100dvh] grid-cols-[minmax(380px,38%)_1fr]">
      <ControlPanel
        orchestrator={orchestrator}
        selfMutator={selfMutator}
        suggestionEngine={suggestionEngine}
        onBoot={boot}
        onReset={reset}
      />
      <LiveApp />
    </main>
  );
}
