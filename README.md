# Cambium

_Talk to your app. Watch it grow._

Cambium is a self-evolving frontend playground. You describe an app, it builds it. You use the app, it watches. It notices patterns in how you work and proposes features to match. You approve a change, and the running app rewrites itself — surgically, without a reload — while your existing state stays put.

The name comes from the cambium layer in trees: the thin band of cells where new growth actually happens. The whole app is that layer.

## Two ideas, one system

**Talk to a running app (Idea B).**
Most AI coding tools generate code into an editor. You then copy, paste, reload, and re-establish your state. Cambium keeps the app running. You type "make the sidebar collapsible." The model returns a surgical search/replace patch. Vite HMR fires. The sidebar collapses. Your notes are still there, your scroll position intact, the textarea you were typing into still focused.

**A self-observing app (Idea D).**
Every other AI tool is reactive — it waits for a prompt. Cambium is the opposite. While you use the app, a passive observer in the iframe records what you do (input, clicks, key presses). When enough new signal accumulates, the host asks the model: _given this code and these events, what feature should this app have that it doesn't?_ If the model finds a high-confidence pattern (≥0.70, ≥3 occurrences), a suggestion card slides into the control panel. You approve, the app rewrites itself the same way it would for a manual prompt.

## What it actually does

1. Boots an isolated Node runtime in the browser via WebContainers
2. Mounts a Vite + React + Tailwind seed inside it
3. Either starts from a welcome canvas or restores your last saved snapshot from IndexedDB
4. Streams structured search/replace mutations from Claude (via OpenRouter)
5. Previews the diff before applying
6. Applies via the WebContainer's filesystem API
7. Vite HMR propagates the change without a full reload
8. Persists the resulting file tree back to IndexedDB
9. App state (notes, todos, settings) lives in a separate IDB layer — survives mutations and refreshes
10. The iframe observer streams usage events to the host; the suggestion engine periodically asks the model to find behavioral patterns
11. Approved patterns route through the same mutation pipeline as manual chat

## Stack

| Layer            | Choice                                                  |
| ---------------- | ------------------------------------------------------- |
| Framework        | Next.js 16 (App Router, TS, Turbopack)                  |
| In-browser Node  | `@webcontainer/api`                                     |
| AI gateway       | OpenRouter                                              |
| LLM (mutate)     | `anthropic/claude-sonnet-4.5`                           |
| LLM (observe)    | `anthropic/claude-sonnet-4.5`                           |
| SDK              | Vercel AI SDK (`ai`) + `@openrouter/ai-sdk-provider`    |
| Schema           | Zod                                                     |
| State (host)     | Zustand                                                 |
| Persistence      | IndexedDB via `idb`                                     |
| Patch format     | Search/Replace blocks (Aider-style)                     |
| Terminal         | `@xterm/xterm` + `@xterm/addon-fit`                     |
| Icons            | `@phosphor-icons/react`                                 |
| Styling          | Tailwind v4 (host) + Tailwind v3 (WC seed)              |

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

Open <http://localhost:3000>. Click **Boot WebContainer** (first boot installs Vite + React + Tailwind inside the WC, ~30–90s). Click a quick-pick (Notes / Todo / Habit tracker / Pomodoro) or type a custom instruction.

Optional env overrides for the model slugs:

```bash
OPENROUTER_MUTATE_MODEL=anthropic/claude-sonnet-4.5
OPENROUTER_OBSERVE_MODEL=anthropic/claude-sonnet-4.5
```

## The canonical demo

1. Boot the container, click **Notes** quick-pick. The first mutation scaffolds a notes app from the welcome canvas
2. Add five notes prefixed with `TODO:` ("TODO: buy milk", "TODO: call mom", etc.)
3. After roughly 20 events, the suggestion engine analyses the stream. Within ~15s a card surfaces: _"User typed TODO: prefix 5+ times → Add checkbox toggle to TODO: lines"_
4. Click **Build it**. The streaming diff fills in. Click **Apply**
5. Checkboxes appear next to your TODO items. The notes are still there. The iframe never reloaded
6. Type a follow-up in chat: `"make the checked items strike through and fade"` → streams → apply
7. Refresh the page. The app reappears with everything intact

## How it works

```
+-----------------------------------------------------------------+
|                       NEXT.JS HOST                              |
|                                                                 |
|   ControlPanel              LiveApp                             |
|     ChatInput                 <iframe src={wcUrl}>              |
|     SuggestionCard            Vite dev server                   |
|     DiffPreview               WebContainer runtime              |
|     MutationLog               Observer baked into seed          |
|                                                                 |
|        \                /                                       |
|         \              /                                        |
|       MutationOrchestrator                                      |
|       SuggestionEngine                                          |
|       UsageCollector                                            |
|       FileSystemManager                                         |
|       WebContainerHost                                          |
|       HostMessageBridge                                         |
|       SessionStore (IDB)                                        |
|                                                                 |
|        +-- /api/mutate    (Sonnet 4.5, streamObject, Zod)       |
|        +-- /api/observe   (Sonnet 4.5, generateObject, Zod)     |
+-----------------------------------------------------------------+
```

### The mutation pipeline (Idea B)

1. User types an instruction
2. `FileSystemManager.getAppSnapshot()` walks `src/` and reads every file
3. `/api/mutate` is called with the instruction, snapshot, and a bounded conversation history (last 6 turns)
4. The route calls `streamObject` with a Zod schema. Claude returns a `mutations[]` array of search/replace blocks
5. The client parses partial JSON as the stream arrives — the diff preview fills in live
6. User clicks Apply. The orchestrator checkpoints the FS, runs each mutation, and either commits or rolls back on total failure
7. On commit, the new file tree is snapshotted to IndexedDB and the mutation is logged

### The observation pipeline (Idea D)

1. The seed's `observer.ts` listens to `input`, `click`, and `keydown` events
2. Events batch (20 events) or time out (10s) and post to the host via `postMessage`
3. `HostMessageBridge` origin-checks and forwards to `UsageCollector`
4. The collector persists events to IndexedDB
5. After every batch, `SuggestionEngine.maybeAnalyse()` checks: ≥20 new events, ≥15s since last run, not currently busy
6. If the gate opens, the engine sends the last 100 events + current code to `/api/observe`
7. The model returns patterns. Anything below 0.70 confidence is dropped
8. Surviving patterns appear as a suggestion card. Approval routes through the same mutation pipeline

### The two persistence layers

| Layer       | Where it lives                          | Survives                          |
| ----------- | --------------------------------------- | --------------------------------- |
| App code    | WC filesystem → snapshotted to IDB      | Refresh, multi-session            |
| App state   | Host IDB, synced via `useHostState`     | Code mutations + Fast Refresh     |
| Mutation log| Host IDB                                | Refresh                           |
| Events      | Host IDB (24h rolling purge)            | Refresh                           |

The seed exposes a `useHostState<T>(key, initial)` hook. Inside the WC, calling `setNotes([...])` triggers a `postMessage` to the host, which writes to IDB. When the iframe reloads (or a Fast Refresh remount), the hook fetches the saved value back. This means React state survives mutations that change hook order — a case where Fast Refresh would normally reset everything.

## Project layout

```
src/
  app/
    page.tsx                     Top-level layout
    layout.tsx                   Geist fonts + metadata
    globals.css                  Tailwind, transition baseline, keyframes
    api/
      mutate/route.ts            streamObject + search/replace schema
      observe/route.ts           generateObject + pattern schema
  components/
    ControlPanel.tsx             Left pane
    ChatInput.tsx                Textarea + quick-picks
    DiffPreview.tsx              Search/replace diff renderer
    MutationLog.tsx              divide-y mutation history
    SuggestionCard.tsx           AI-noticed card
    LiveApp.tsx                  Right pane (iframe + terminal drawer)
  lib/
    WebContainerHost.ts          Boot/install/run + snapshot-aware mount
    FileSystemManager.ts         snapshot/apply/checkpoint/restore
    MutationOrchestrator.ts      propose / apply / rollback
    SessionStore.ts              IDB facade
    HostMessageBridge.ts         STATE_GET/SET + USAGE_EVENTS dispatcher
    UsageCollector.ts            Persists events, drives engine
    SuggestionEngine.ts          Threshold + debounce + dedup
    SelfMutator.ts               Pattern -> instruction wrapper
    mutation-types.ts            Zod schemas for /api/mutate
    observe-types.ts             Zod schemas for /api/observe
    webcontainer/
      seed-files.ts              Vite + React + Tailwind + observer + useHostState
  store/
    appStore.ts                  Zustand
```

## Tuning knobs

Demo iteration is faster with lower thresholds. Edit `src/lib/SuggestionEngine.ts`:

```ts
const ANALYSIS_THRESHOLD = 20; // events before analysis fires
const DEBOUNCE_MS = 15_000;    // minimum gap between analyses
const CONFIDENCE_FLOOR = 0.7;  // patterns below this are dropped
```

For a 10-second demo loop: drop `ANALYSIS_THRESHOLD` to 5 and `DEBOUNCE_MS` to 2000.

## Cost

Sonnet 4.5 via OpenRouter, no prompt caching yet:

| Action                          | Approximate cost |
| ------------------------------- | ---------------- |
| First scaffold mutation         | ~$0.04           |
| Subsequent evolution mutations  | ~$0.02 each      |
| One observe analysis            | ~$0.04           |
| Heavy 10-minute session         | ~$0.30 – $0.60   |

Prompt caching on the system prompt and snapshot block would drop subsequent calls by 75–90%. It's the next thing on the list.

## Limitations and known caveats

- **Desktop only.** WebContainers need COOP/COEP cross-origin isolation. Works in modern Chromium and Firefox; mobile support is limited.
- **One container per tab.** WebContainers enforce a single instance per browser tab. Opening Cambium in a second tab errors clearly.
- **Block-match failures.** Search/replace requires character-exact matching. Claude occasionally generates a search block that misses by whitespace. The orchestrator surfaces these per-file and applies the rest of the mutation; if every block fails, it rolls back.
- **State survival is best-effort.** When a mutation adds a hook to an existing component, Fast Refresh remounts and React state resets. `useHostState` mitigates this for explicitly-persisted data but not for in-progress UI state. The system prompt steers Claude toward sibling additions rather than internal hook insertions.
- **No prompt caching yet.** Each mutation re-sends the full snapshot. Costs compound linearly.
- **One model, no fallback.** If OpenRouter is down or the model slug is unavailable, both endpoints fail. A multi-provider fallback would be a worthwhile robustness add.

## Inspiration

- WebContainers (StackBlitz) — without this, the whole concept is impossible
- Aider's search/replace block format — the highest-success patching strategy for LLMs
- Vercel AI SDK's `streamObject` — partial-JSON streaming that makes live diff previews feel instant
- Bolt.new and v0 — proved that in-browser code generation can feel native
- The Phosphor icon family — pixel-precise where it counts

## License

MIT. Build whatever you like with it.
