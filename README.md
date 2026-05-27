# Cambium

*Talk to your app. Watch it grow.*

Cambium is a self-evolving frontend playground. You describe an app, it builds it. You use the app, it watches. It notices patterns in how you work and proposes features that match. You approve a change, and the running app rewrites itself — surgically, without a reload — while your existing state stays put.

The name comes from the cambium layer in trees: the thin band of cells where new growth happens. The whole app is that layer.

## Quick start

Requirements:

- Node 20+
- A modern Chromium-based browser (WebContainers need COOP/COEP cross-origin isolation)
- An OpenRouter API key with credit

```bash
git clone <this repo>
cd self-evolving-app
npm install
echo "OPEN_ROUTER_API_KEY=sk-or-..." > .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Click **Boot WebContainer** (first boot installs Vite + React + Tailwind inside the WC, ~30–90s). Pick a quick-pick (Notes, Todo list, Habit tracker, Pomodoro, Expenses, Kanban, Markdown notes, Flashcards, Reading list, Mood journal) or type a custom instruction.

Optional env overrides:

```bash
OPENROUTER_MUTATE_MODEL=anthropic/claude-sonnet-4.5
OPENROUTER_OBSERVE_MODEL=anthropic/claude-sonnet-4.5
```

## Demo

1. Boot the container, click **Notes**. The first mutation scaffolds a notes app from the welcome canvas
2. Add five notes prefixed with `TODO:` ("TODO: buy milk", "TODO: call mom", ...)
3. After ~20 events, the suggestion engine fires. A short card slides in: **I noticed** *"You typed 'TODO:' as a prefix 5 times"* → **Add a checkbox toggle next to TODO items**
4. Click **Build it**. The streaming diff fills in. Click **Apply**
5. Checkboxes appear next to your TODO items. The notes are still there. The iframe never reloaded
6. Type in chat: `make the checked items strike through and fade` → streams → apply
7. Refresh the page. Everything reappears

The same flow works for richer intent: typing `May 1: ...`, `May 2: ...`, `May 3: ...` produces a date-picker suggestion (not a literal "prepend May 4:" feature). Dragging todo items vertically with no drag handler produces a reorder suggestion.

---

## Features

### Talk to a running app

- **Live mutation pipeline.** Type an instruction, get a streaming diff preview, apply with one click. Vite HMR propagates the change without a full reload — your scroll position, focus, and unsaved input stay put
- **Image input.** Paste from clipboard, drop a file, or click the paperclip. PNG / JPEG / WebP / GIF, ≤ 5 MB. The model sees the image and the current code and proposes mutations that match the design
- **Quick-picks.** 10 starter templates (Notes, Todo list, Habit tracker, Pomodoro, Expenses, Kanban, Markdown notes, Flashcards, Reading list, Mood journal) so you can skip the cold start
- **Mutation log + restore.** Every applied mutation snapshots the full WC file tree. Hover an entry, click **Restore**, and the code reverts to that point — your `useHostState` data survives the rollback

### Self-observing app

- **Passive observer in the iframe.** Captures `input`, `click`, `pointerdown` / `pointerup` (drag), and modified `keydown` events. Click events carry an `interactive: boolean` flag so the model can distinguish misclicks from intent
- **Drag-attempt detection.** Pointer-down + ≥8px move + pointer-up is captured even when the app has no drag handler — the gesture itself reveals reorder/swipe intent
- **Intent-first inference.** The observe model is told to parse repeating tokens as data first (date / time / money / sequence / label) and serve the inferred type, not the literal string. Typing dates produces a date picker, not an autocomplete that breaks at month boundaries
- **Click & drag intent.** Repeated clicks on non-interactive content elements → edit / open / toggle suggestion; drag gestures on list items → reorder; horizontal drags between board columns → move-between-columns
- **Short, plain-language cards.** Each suggestion shows a one-line "I noticed" observation and a ≤70-char headline naming the feature in user terms — no code references, no implementation chatter
- **No re-show after action.** Once you click Build it or Skip, the feature is excluded from future analyses (both server-side via excludeFeatures and client-side dedup) so it doesn't bounce back

### Robustness

- **Auto-install missing imports.** When Claude introduces an import not in the seed's `package.json`, the `RuntimeErrorWatcher` scans Vite's output for `Failed to resolve import "X"`, runs `npm install X` inside the WC, and nudges the importing file so Vite re-resolves
- **Two persistence layers.** App code lives in the WC filesystem (snapshotted to IDB); app state lives in host IDB via `useHostState`. State survives mutations that change hook order — a case where Fast Refresh would normally reset everything
- **Prompt caching.** System prompt and current-code snapshot are marked ephemeral with a 5-min TTL. Subsequent calls in a session drop ~92% of input cost
- **Bounded conversation history.** Mutate requests carry the last 6 turns so the model has context but the prompt doesn't grow unbounded

---

## Architecture

### Layered structure

```
Next.js host (this repo)
├── UI shells
│   ├── SplitShell  (ControlPanel + LiveApp) — pre-first-mutation
│   └── FullShell   (full iframe + FAB + drawer + suggestion toast) — post-mutation
├── Shared hook
│   └── useMutationFlow — propose / apply / restore / approveSuggestion / dismissSuggestion
├── Core engines
│   ├── MutationOrchestrator — propose / apply / rollback
│   ├── SuggestionEngine     — threshold + debounce + feature-text dedup
│   ├── UsageCollector       — persists iframe events to IDB
│   ├── FileSystemManager    — snapshot / apply / checkpoint / restore
│   ├── RuntimeErrorWatcher  — scans Vite log, triggers npm install
│   ├── WebContainerHost     — boot / install / installPackage / touchFile
│   ├── HostMessageBridge    — STATE_GET/SET + USAGE_EVENTS dispatcher
│   └── SessionStore (IDB)   — snapshots, app state, mutation log, events
├── Server routes
│   ├── /api/mutate   — streamObject + search/replace + image content + cache_control
│   └── /api/observe  — generateObject + pattern schema + intent-first prompt
└── WebContainer iframe
    └── Vite + React + Tailwind seed
        ├── App.tsx
        ├── hostState.ts  — useHostState<T>(key, initial)
        └── observer.ts   — input/click/drag/key → postMessage to host
```

### Mutation pipeline

1. User types an instruction (or approves a suggestion)
2. `FileSystemManager.getAppSnapshot()` walks `src/` and reads every file
3. `/api/mutate` is called with the instruction, snapshot, last-6 turns of chat history, and any attached image
4. The route calls `streamObject` with a Zod schema. Claude returns a `mutations[]` array of search/replace blocks
5. The client parses partial JSON as the stream arrives — the diff preview fills in live
6. User clicks Apply. `MutationOrchestrator` checkpoints the FS, runs each mutation, and either commits or rolls back on total failure
7. On commit, the new file tree is snapshotted to IndexedDB and the mutation is logged

### Observation pipeline

1. The seed's `observer.ts` listens for `input`, `click` (with `interactive` flag), `pointerdown`/`pointerup` (with ≥8px move → `drag` event), and modified `keydown`
2. Events batch (20 events) or time out (10s) and post to the host via `postMessage`
3. `HostMessageBridge` origin-checks and forwards to `UsageCollector`, which persists events to IndexedDB
4. After every batch, `SuggestionEngine.maybeAnalyse()` gates on: ≥20 new events, ≥15s since last run, not busy
5. If open, the engine sends the last 100 events + current code + already-shown features to `/api/observe`
6. The observe model reasons **intent-first** — parses repeating tokens as data (date / time / money / sequence / label), reads surrounding context and the app's purpose, then proposes a feature that serves the inferred goal. Drag and non-interactive-click events route to reorder / edit / swipe candidates
7. Each pattern carries a short `headline` (≤70 chars) for the card, a short `observation` (≤100 chars), and a verbose `proposed_feature` for the downstream builder
8. Below 0.70 confidence is dropped. Surviving patterns appear as a toast in the top-right; approval routes through the mutation pipeline

### Persistence layers


| Layer        | Where it lives                      | Survives                      |
| ------------ | ----------------------------------- | ----------------------------- |
| App code     | WC filesystem → snapshotted to IDB  | Refresh, multi-session        |
| App state    | Host IDB, synced via `useHostState` | Code mutations + Fast Refresh |
| Mutation log | Host IDB                            | Refresh                       |
| Events       | Host IDB (24h rolling purge)        | Refresh                       |


The seed exposes a `useHostState<T>(key, initial)` hook. Inside the WC, calling `setNotes([...])` triggers a `postMessage` to the host, which writes to IDB. When the iframe reloads (or Fast Refresh remounts), the hook fetches the saved value back — so React state survives mutations that change hook order.

---

## Limitations

- **Desktop only.** WebContainers need COOP/COEP cross-origin isolation. Works in modern Chromium and Firefox; mobile support is limited
- **One container per tab.** WebContainers enforce a single instance per browser tab. A second tab errors clearly
- **Block-match failures.** Search/replace requires character-exact matching. Claude occasionally generates a search block that misses by whitespace. The orchestrator surfaces these per-file and applies the rest of the mutation; if every block fails, it rolls back
- **State survival is best-effort.** When a mutation adds a hook to an existing component, Fast Refresh remounts and React state resets. `useHostState` mitigates this for explicitly-persisted data but not for in-progress UI state
- **Auto-install is missing-import only.** Type errors, syntax errors, and runtime exceptions still need a manual follow-up prompt
- **Restore is destructive.** Restoring a historical snapshot replaces the current code and truncates the mutation log — no branching
- **One model, no fallback.** Both routes use Sonnet via OpenRouter. An outage on either layer fails the request

## Coming soon

- **Visible terminal pane.** WC stdout is captured (`appendTerminal`) but not rendered. An xterm.js drawer in split view would expose npm install / Vite output for boot debugging
- **Auto-fix runtime errors.** Extend `RuntimeErrorWatcher` beyond missing-import to feed type errors, syntax errors, and runtime exceptions back through `/api/mutate` as a self-healing loop
- **Multi-provider fallback.** A second provider (direct Anthropic, or a different model) would survive OpenRouter / model outages
- **Branching / forking the mutation log.** Today restore is destructive. Branching would let you fork off a historical snapshot, try a variation, and keep the original
- **Better drag disambiguation.** Reorder vs. swipe-to-delete vs. cross-container-move are inferred from direction alone. Adding pointer-trail samples (not just from/to) would improve the model's read

---

## Stack


| Layer           | Choice                                               |
| --------------- | ---------------------------------------------------- |
| Framework       | Next.js 16 (App Router, TS, Turbopack)               |
| In-browser Node | `@webcontainer/api`                                  |
| AI gateway      | OpenRouter                                           |
| LLM (mutate)    | `anthropic/claude-sonnet-4.5`                        |
| LLM (observe)   | `anthropic/claude-sonnet-4.5`                        |
| SDK             | Vercel AI SDK (`ai`) + `@openrouter/ai-sdk-provider` |
| Schema          | Zod                                                  |
| State (host)    | Zustand                                              |
| Persistence     | IndexedDB via `idb`                                  |
| Patch format    | Search/Replace blocks (Aider-style)                  |
| Icons           | `@phosphor-icons/react`                              |
| Styling         | Tailwind v4 (host) + Tailwind v3 (WC seed)           |


## Project layout

```
src/
  app/
    page.tsx                     Picks SplitShell or FullShell, owns boot lifecycle
    layout.tsx                   Geist fonts + metadata
    globals.css                  Tailwind, transition baseline, keyframes
    api/
      mutate/route.ts            streamObject + search/replace + image content + cache_control
      observe/route.ts           generateObject + pattern schema + intent-first reasoning
  components/
    ControlPanel.tsx             Split-mode shell (sidebar + iframe)
    FullShell.tsx                Full-screen shell (iframe + FAB + drawer + suggestion toast)
    ChatInput.tsx                Textarea + quick-picks + image (paste/drop/paperclip)
    DiffPreview.tsx              Search/replace diff renderer
    MutationLog.tsx              History with hover-to-restore
    SuggestionCard.tsx           Short "I noticed" + headline card
    LiveApp.tsx                  Right pane in split mode (iframe + boot progress)
    ConfirmDialog.tsx            Destructive-action confirmation
  hooks/
    useMutationFlow.ts           Shared propose/apply/restore/approve/dismiss handlers
  lib/
    WebContainerHost.ts          Boot/install/run + snapshot-aware mount + installPackage
    FileSystemManager.ts         snapshot/apply/checkpoint/restore/overwriteSrc
    MutationOrchestrator.ts      propose (image support) / apply / rollback
    SessionStore.ts              IDB facade (snapshots, state, log, events, restore)
    HostMessageBridge.ts         STATE_GET/SET + USAGE_EVENTS dispatcher
    UsageCollector.ts            Persists events, drives engine
    SuggestionEngine.ts          Threshold + debounce + feature-text dedup
    SelfMutator.ts               Pattern → instruction wrapper
    RuntimeErrorWatcher.ts       Vite log scanner → auto npm install
    mutation-types.ts            Zod schemas for /api/mutate
    observe-types.ts             Zod schemas for /api/observe (headline + proposed_feature)
    webcontainer/
      seed-files.ts              Vite + React + Tailwind + observer (input/click/drag) + useHostState
  store/
    appStore.ts                  Zustand: WC state, mutations, suggestions, view mode, banners
```

## Tuning

Demo iteration is faster with lower thresholds. Edit `src/lib/SuggestionEngine.ts`:

```ts
const ANALYSIS_THRESHOLD = 20; // events before analysis fires
const DEBOUNCE_MS = 15_000;    // minimum gap between analyses
const CONFIDENCE_FLOOR = 0.7;  // patterns below this are dropped
```

For a 10-second demo loop: drop `ANALYSIS_THRESHOLD` to 5 and `DEBOUNCE_MS` to 2000.

## License

MIT.