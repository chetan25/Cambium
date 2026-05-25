# Cambium — Implementation Plan

> Internal codename during the plan: "The Living App". Public name is **Cambium** — the cell layer in trees where new growth happens. See README.md for the elevator pitch.

## Ideas B + D

> **B** → An app you talk to (state preserved)
> **D** → An app that watches you and grows

**Stack:** Next.js · WebContainers · Claude API · Vite HMR · IndexedDB · search/replace patching

---

## North Star Demo

> You open a blank notes app. You use it naturally for 3 minutes. It watches you. It suggests a feature. You approve. It updates itself live — your existing content untouched. Then you say _"make the sidebar collapsible."_ It does. Without reloading. Without losing state.

---

## Tech Stack

| Layer        | Choice                                             | Why                                                                       |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------------------- |
| Framework    | Next.js 16 (App Router, TS, Turbopack)             | SSR + API routes in one place                                             |
| WebContainer | `@webcontainer/api`                                | Battle-tested in-browser Node runtime                                     |
| AI gateway   | OpenRouter                                         | One key, many models, future-proofs the model choice                      |
| LLM (mutate) | `anthropic/claude-sonnet-4.5` via OpenRouter       | Best speed/quality for surgical edits (overridable via env)               |
| LLM (observe)| `anthropic/claude-sonnet-4.5` via OpenRouter       | Same model — Sonnet handles pattern reasoning well; Opus was overkill     |
| SDK          | Vercel AI SDK (`ai`) + `@openrouter/ai-sdk-provider` | `streamObject` gives partial-JSON streaming → diff preview as it arrives |
| Schema       | Zod                                                | Type-safe structured outputs from `streamObject`                          |
| Terminal     | `@xterm/xterm` + `@xterm/addon-fit`                | Debug pane for WC output                                                  |
| State        | Zustand                                            | Lightweight, fits the host's needs                                        |
| Patch format | **Search/Replace blocks** (Aider-style)            | Highest LLM success rate; trivial to parse; failures are recoverable      |
| Pattern DB   | IndexedDB via `idb`                                | Client-side, persistent across reloads                                    |
| WC seed CSS  | Tailwind 3                                         | Matches host vocabulary; v3 keeps WC seed config simple                   |

---

## Technical Decisions (locked-in)

These are load-bearing. Changing them mid-build will cost a day each.

### 1. Patching strategy — Search/Replace blocks

Claude returns mutations as JSON containing one or more `search`/`replace` pairs per file. Each block is an **exact-string find + replace** in the current file content. No diff parsing, no unified-diff format, no Google diff-match-patch.

```
<<<<<<< SEARCH
const [notes, setNotes] = useState<string[]>([])
=======
const [notes, setNotes] = useState<Note[]>([])
const [filter, setFilter] = useState('all')
>>>>>>> REPLACE
```

Each block scoped to a path; multiple blocks per file allowed. A block fails when SEARCH does not exact-match — apply the rest, return partial success, surface failed blocks to the user. This is the format Aider/Cline use and the highest LLM success rate of any patching approach.

### 2. HMR over the WebContainer URL

WebContainers serve the dev server at `*.local-credentialless.webcontainer-api.io`. Vite's HMR WebSocket client must be told to connect back to that URL or it falls back to a full page reload silently. The seed `vite.config.ts` MUST configure `server.hmr.clientPort` and `server.hmr.host` to match the WC-issued URL. Set on Day 1, verify HMR fires before writing FileSystemManager.

### 3. Cross-origin isolation via `credentialless`

WebContainers require a cross-origin-isolated host. Use `Cross-Origin-Embedder-Policy: credentialless` (not `require-corp`) — it allows the WC iframe to load resources from anywhere without requiring every asset to send CORP headers. Plus `Cross-Origin-Opener-Policy: same-origin`. Chromium/Firefox 110+ support credentialless; the fallback to `require-corp` is documented in Day 0 if you need older browser support.

### 4. Prompt caching is mandatory

Every mutation call marks the system prompt + the snapshot block as cacheable. OpenRouter passes through Anthropic's cache_control marker — we set it via the Vercel SDK's `providerOptions.openrouter`. Without this, cost compounds linearly. With it, a 10-minute session runs ~$0.20–0.35 on Sonnet 4.5.

**Implementation note from shipping:** the explicit per-block marker (`providerOptions.openrouter.cacheControl: { type: 'ephemeral' }`) goes on the snapshot text block; the image and instruction blocks come AFTER the marker so they don't invalidate the cached prefix. Verified by measurement: input tokens drop ~92% on warm cache hits.

**Anthropic schema quirk to remember:** the JSON schema validator (routed via OpenRouter to Anthropic) **rejects `min`/`max` on numbers and rejects `{type: "integer"}` outright**. Use plain `z.number()` in all Zod schemas and describe bounds in the system prompt instead. This bit us on Day 6's `signal_strength: z.number().int().min(1)`.

### 5. Structured output via `streamObject`, not raw SSE

We use Vercel AI SDK's `streamObject({ schema })` with a Zod schema for the mutation shape. The endpoint returns a `partialObjectStream` — the client receives the mutations array filling in element-by-element as the model emits it. This is what enables the diff preview to render WHILE the model is still streaming, not after. Raw SSE relays force a "wait for complete JSON → parse → render" sequence; `streamObject` removes that gate.

### 6. State preservation is best-effort, not guaranteed

Vite's React Fast Refresh preserves state when a component's hook order does not change. When Claude adds a new `useState` to an existing component, Fast Refresh remounts and that component's state resets. The North Star demo works because mutations typically add new components or modify siblings, not because state is magically immortal. Verify this honestly on Day 4.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    NEXT.JS HOST APP                     │
│                                                         │
│  ┌─────────────────┐      ┌──────────────────────────┐  │
│  │  CONTROL PANEL  │      │      LIVE APP IFRAME     │  │
│  │                 │      │                          │  │
│  │  Chat input     │      │  WebContainer runtime    │  │
│  │  Diff preview   │      │  Vite + React, HMR on    │  │
│  │  Approval gate  │      │  Observer injected       │  │
│  │  Suggestion feed│      │  postMessage → host      │  │
│  │  Mutation log   │      │                          │  │
│  └────────┬────────┘      └──────────┬───────────────┘  │
│           │                          │                  │
│           └──────────┬───────────────┘                  │
│                      │                                  │
│              ┌───────┴────────┐                         │
│              │  ORCHESTRATOR  │                         │
│              │                │                         │
│              │ WebContainerHost│                        │
│              │ FileSystemMgr  │                         │
│              │ MutationOrch.  │                         │
│              │ UsageCollector │                         │
│              │ SuggestionEng. │                         │
│              └───────┬────────┘                         │
└──────────────────────┼──────────────────────────────────┘
                       │
              ┌────────┴────────┐
              ↓                 ↓
         /api/mutate       /api/observe
         (Phase 1)         (Phase 2)
```

---

# PHASE 1 — Idea B: Talk to Your Running App

**Days 0–4**

**Goal:** User talks to a running app. App mutates surgically. State preserved across mutations (within the Fast Refresh boundary).

---

## Day 0 — Bootstrap

The plan starts here. Skip this and Day 1 has nowhere to land.

```bash
npx create-next-app@latest living-app \
  --typescript --tailwind --app --src-dir --import-alias "@/*" --no-eslint --no-git
cd living-app

# Runtime
npm i @webcontainer/api @xterm/xterm @xterm/addon-fit @anthropic-ai/sdk zustand idb

# Optional dev convenience
npm i -D @types/node
```

`next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
export default {
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        { key: 'Cross-Origin-Opener-Policy',   value: 'same-origin' },
      ],
    }]
  },
}
```

`.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

**Done when:** `npm run dev` boots, the empty page loads, and `crossOriginIsolated === true` in the browser console.

---

## Day 1 — WebContainerHost + FileSystemManager

> ⚠️ **Most critical day.** These two classes are the foundation. Test them in isolation before touching the orchestrator. Everything depends on this.

### `WebContainerHost` — owns boot/install/run lifecycle

Plan-of-record sequence: `boot → mount(seedFiles) → spawn npm install → spawn npm run dev → listen for server-ready → expose URL to iframe`.

```typescript
// src/lib/WebContainerHost.ts

import { WebContainer } from '@webcontainer/api'
import { seedFiles } from './webcontainer/seed-files'

export class WebContainerHost {
  private static instance: WebContainer | null = null
  url: string | null = null
  onUrlReady?: (url: string) => void

  async start(terminalWriter: (chunk: string) => void): Promise<WebContainer> {
    if (WebContainerHost.instance) {
      throw new Error('WebContainer already booted in this tab. Reload to start fresh.')
    }
    const container = await WebContainer.boot({ coep: 'credentialless' })
    WebContainerHost.instance = container

    await container.mount(seedFiles)

    const install = await container.spawn('npm', ['install'])
    install.output.pipeTo(new WritableStream({ write: terminalWriter }))
    const code = await install.exit
    if (code !== 0) throw new Error(`npm install failed (exit ${code})`)

    const dev = await container.spawn('npm', ['run', 'dev'])
    dev.output.pipeTo(new WritableStream({ write: terminalWriter }))

    container.on('server-ready', (_port, url) => {
      this.url = url
      this.onUrlReady?.(url)
    })

    return container
  }
}
```

### `FileSystemManager` — read/snapshot/patch/checkpoint

```typescript
// src/lib/FileSystemManager.ts

import { WebContainer } from '@webcontainer/api'

const IGNORE = new Set(['node_modules', 'dist', '.vite', 'build'])

export class FileSystemManager {
  private checkpoints = new Map<string, Record<string, string>>()
  constructor(private container: WebContainer) {}

  async readFile(path: string): Promise<string> {
    return await this.container.fs.readFile(path, 'utf-8')
  }

  // Dynamic walk — no hardcoded paths
  async getAppSnapshot(root = 'src'): Promise<Record<string, string>> {
    const snapshot: Record<string, string> = {}
    const walk = async (dir: string) => {
      const entries = await this.container.fs.readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        if (IGNORE.has(e.name)) continue
        const p = `${dir}/${e.name}`
        if (e.isDirectory()) await walk(p)
        else snapshot[p] = await this.readFile(p)
      }
    }
    await walk(root)
    return snapshot
  }

  // Checkpoint before mutation — enables rollback
  async checkpoint(id: string): Promise<void> {
    this.checkpoints.set(id, await this.getAppSnapshot())
  }

  async restore(id: string): Promise<void> {
    const snap = this.checkpoints.get(id)
    if (!snap) throw new Error(`No checkpoint ${id}`)
    for (const [path, content] of Object.entries(snap)) {
      await this.container.fs.writeFile(path, content)
    }
  }

  // Search/replace block apply — returns per-block results
  async applyBlocks(
    path: string,
    blocks: { search: string; replace: string }[],
  ): Promise<{ ok: boolean; failed: number[] }> {
    let content = await this.readFile(path)
    const failed: number[] = []
    blocks.forEach((b, i) => {
      if (content.includes(b.search)) {
        content = content.replace(b.search, b.replace)
      } else {
        failed.push(i)
      }
    })
    await this.container.fs.writeFile(path, content)
    return { ok: failed.length === 0, failed }
  }

  async createFile(path: string, content: string): Promise<void> {
    // ensure parent dir
    const dir = path.split('/').slice(0, -1).join('/')
    if (dir) await this.container.fs.mkdir(dir, { recursive: true })
    await this.container.fs.writeFile(path, content)
  }

  async deleteFile(path: string): Promise<void> {
    await this.container.fs.rm(path)
  }
}
```

**Done when:** unit-grade smoke test passes — boot WC with seed, snapshot returns >0 files, write a known block, HMR fires in the iframe (verify via DevTools network tab: no full document reload).

---

## Day 2 — `/api/mutate` + MutationOrchestrator (propose / apply split)

### The API route — `streamObject` over OpenRouter

```typescript
// src/app/api/mutate/route.ts

import { streamObject } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { z } from 'zod'

const openrouter = createOpenRouter({ apiKey: process.env.OPEN_ROUTER_API_KEY! })

const mutationSchema = z.object({
  mutations: z.array(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('edit'),
        path: z.string(),
        blocks: z.array(z.object({ search: z.string(), replace: z.string() })),
      }),
      z.object({ type: z.literal('create'), path: z.string(), content: z.string() }),
      z.object({ type: z.literal('delete'), path: z.string() }),
    ]),
  ),
  summary: z.string(),
  hotReloadable: z.boolean(),
})

const MUTATION_SYSTEM_PROMPT = `
You are a surgical code editor. You modify a running React app via search/replace blocks.

Rules:
- Preserve all existing state, logic, and content.
- Use "edit" with search/replace blocks for changes to existing files — never rewrite entire files.
- Each "search" must match the current file EXACTLY (including whitespace, including newlines).
- Keep blocks tight — only the lines you need to change.
- "create" only when adding a genuinely new file. "delete" only when explicitly asked.
- Set hotReloadable=false ONLY if your changes touch files Vite cannot HMR (e.g. vite.config.ts, package.json).
`

export async function POST(req: Request) {
  const { instruction, snapshot, history } = await req.json()

  const snapshotBlock = Object.entries(snapshot)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join('\n\n')

  const result = streamObject({
    model: openrouter('anthropic/claude-sonnet-4.6'),
    schema: mutationSchema,
    system: MUTATION_SYSTEM_PROMPT,
    messages: [
      ...history.slice(-6),
      {
        role: 'user',
        content: `CURRENT FILES:\n${snapshotBlock}\n\nINSTRUCTION: ${instruction}`,
      },
    ],
    providerOptions: {
      openrouter: {
        // OpenRouter passes Anthropic cache_control through to the upstream call.
        // Mark the system + snapshot prefix as cacheable; budget is shared across the session.
        cacheControl: { type: 'ephemeral' },
      },
    },
  })

  return result.toTextStreamResponse()
}
```

### The orchestrator — propose / apply split

The Day 3 UI needs an approval gate. The orchestrator must NOT apply mutations as a side effect of generating them. Streaming uses Vercel SDK's `experimental_useObject` from React, or the lower-level `readStreamableValue` pattern for non-React consumers.

```typescript
// src/lib/MutationOrchestrator.ts

import { z } from 'zod'
import type { mutationSchema } from '@/app/api/mutate/route'

export type Mutation = z.infer<typeof mutationSchema>['mutations'][number]
export type ProposedMutations = z.infer<typeof mutationSchema>

export interface PendingMutation {
  id: string
  instruction: string
  parsed: ProposedMutations
  snapshot: Record<string, string>
}

export class MutationOrchestrator {
  private history: { role: 'user' | 'assistant'; content: string }[] = []

  constructor(private fs: FileSystemManager) {}

  async propose(
    instruction: string,
    onPartial: (partial: Partial<ProposedMutations>) => void,
  ): Promise<PendingMutation> {
    const snapshot = await this.fs.getAppSnapshot()
    const id = crypto.randomUUID()

    const res = await fetch('/api/mutate', {
      method: 'POST',
      body: JSON.stringify({ instruction, snapshot, history: this.history }),
    })

    // Vercel SDK streams partial JSON over text/plain; parse-on-the-fly with a
    // streaming JSON parser. SDK ships a helper for this; for the non-React path
    // we consume `result.toTextStreamResponse()` and parse client-side.
    let partial: Partial<ProposedMutations> = {}
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      partial = tryParsePartialJson(buffer)
      onPartial(partial)
    }
    return { id, instruction, parsed: partial as ProposedMutations, snapshot }
  }

  async apply(pending: PendingMutation): Promise<{ ok: boolean; failures: string[] }> {
    await this.fs.checkpoint(pending.id)
    const failures: string[] = []

    for (const m of pending.parsed.mutations) {
      try {
        if (m.type === 'edit') {
          const r = await this.fs.applyBlocks(m.path, m.blocks)
          if (!r.ok) failures.push(`${m.path} (blocks ${r.failed.join(', ')})`)
        } else if (m.type === 'create') {
          await this.fs.createFile(m.path, m.content)
        } else if (m.type === 'delete') {
          await this.fs.deleteFile(m.path)
        }
      } catch (e) {
        failures.push(`${m.path} (${(e as Error).message})`)
      }
    }

    if (failures.length === pending.parsed.mutations.length) {
      // total failure — roll back
      await this.fs.restore(pending.id)
      return { ok: false, failures }
    }

    this.history.push(
      { role: 'user', content: pending.instruction },
      { role: 'assistant', content: pending.parsed.summary },
    )
    // bounded history — keep last 6 turns of intent only (snapshot is ground truth)
    if (this.history.length > 12) this.history = this.history.slice(-12)

    return { ok: failures.length === 0, failures }
  }

  async rollback(id: string): Promise<void> {
    await this.fs.restore(id)
  }
}
```

**Done when:** A pending mutation can be inspected, applied, and rolled back from a console REPL with HMR firing on apply and state surviving.

---

## Day 3 — Split-panel UI + diff preview + approval gate

```
┌──────────────────────┬──────────────────────────────┐
│   CONTROL PANEL      │      LIVE APP                │
│                      │                              │
│  Chat history        │   <iframe src={wcUrl}>       │
│                      │   WebContainer               │
│  "Talk to your app"  │   Vite HMR                   │
│  [input box]         │                              │
│                      │   ← never full reloads       │
│  Diff preview        │     unless we Reject + reset │
│  [Accept] [Reject]   │                              │
│                      │                              │
│  File tree           │                              │
│  ✓ src/App.tsx       │                              │
│                      │                              │
│  Mutation log        │                              │
│  ✓ Added dark mode   │                              │
│  ✓ Resized sidebar   │                              │
└──────────────────────┴──────────────────────────────┘
```

Implementation notes:
- Diff preview renders the search/replace blocks side-by-side (red SEARCH / green REPLACE), per file.
- Accept calls `orchestrator.apply(pending)`. Reject discards the pending object (no FS writes happened yet, so nothing to roll back).
- On apply failure (any block failed to find its SEARCH), surface the failed blocks inline with a "regenerate that one" affordance.
- Mutation log entries link back to their checkpoint id — clicking restores.

---

## Day 4 — Seed app + HMR verification

> ⚠️ **Critical:** verify HMR fires end-to-end here. If it doesn't, the entire Idea B premise breaks silently.

### Vite config inside the WC seed

```typescript
// vite.config.ts in seed files
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3111,
    hmr: {
      // Vite reads these to build the HMR WS URL — must match the WC-issued URL
      clientPort: 443,
      protocol: 'wss',
    },
  },
})
```

### Seed `src/App.tsx`

```tsx
import { useState } from 'react'
import './observer'  // baked-in observer, always present

export default function App() {
  const [notes, setNotes] = useState<string[]>([])
  const [input, setInput] = useState('')

  return (
    <div className="p-6 max-w-xl mx-auto font-sans">
      <h1 className="text-2xl mb-4">Notes</h1>
      <input
        className="border rounded px-2 py-1 w-full"
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="Type a note..."
      />
      <button
        className="mt-2 px-3 py-1 bg-black text-white rounded"
        onClick={() => { setNotes(n => [...n, input]); setInput('') }}
      >
        Add
      </button>
      <ul className="mt-4 space-y-1">
        {notes.map((n, i) => <li key={i}>{n}</li>)}
      </ul>
    </div>
  )
}
```

### State preservation honesty check

Run three mutations and observe:

| Mutation                                          | State outcome                            |
| ------------------------------------------------- | ---------------------------------------- |
| Add a new sibling component (Header)              | Notes preserved ✓                        |
| Restyle the existing button                       | Notes preserved ✓                        |
| Add a `useState` inside `App.tsx`                 | Notes reset ✗ (Fast Refresh limitation)  |

If the demo path keeps mutations in the first two categories, the wow moment holds. Plan your suggestions accordingly.

**Done when:** 10 sibling/styling mutations in a row preserve the notes array. The DevTools network tab shows HMR `.js` updates and zero document loads.

---

## Day 4.5 — Persistence Layer

**Goal:** Mutations survive refresh. User-level state survives Fast Refresh remounts and Claude-induced re-renders.

Two layers, separately persisted:

| Layer | Lives in | Survives across | Updated by |
| --- | --- | --- | --- |
| App **code** | WC FS, snapshotted to host IDB | Refresh, multi-session | Claude mutations |
| App **state** | Host IDB, synced via postMessage | Code mutations + refresh + remounts | The seed app itself |
| Mutation log | Host IDB | Refresh | Orchestrator |

### `SessionStore` — host-side IDB facade

```typescript
// src/lib/SessionStore.ts
import { openDB } from 'idb'

export const dbPromise = openDB('living-app', 1, {
  upgrade(db) {
    db.createObjectStore('code_snapshots', { keyPath: 'id' })
    db.createObjectStore('app_state')                            // key/value
    const log = db.createObjectStore('mutation_log', { keyPath: 'id' })
    log.createIndex('by_applied_at', 'appliedAt')
    // Phase 2 reuses the same DB:
    const events = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true })
    events.createIndex('by_t', 't')
    db.createObjectStore('patterns', { keyPath: 'id' })
  },
})

export const SessionStore = {
  async loadLatestSnapshot() {
    return (await dbPromise).get('code_snapshots', 'current')
  },
  async saveSnapshot(files: Record<string, string>, summary: string) {
    const db = await dbPromise
    const now = Date.now()
    await db.put('code_snapshots', { id: 'current', files, summary, createdAt: now })
    await db.put('code_snapshots', { id: `snap_${now}`, files, summary, createdAt: now })
  },
  async clearSnapshot() {
    const db = await dbPromise
    await db.delete('code_snapshots', 'current')
  },
  async getState<T>(key: string): Promise<T | undefined> {
    return (await dbPromise).get('app_state', key) as Promise<T | undefined>
  },
  async setState(key: string, value: unknown) {
    await (await dbPromise).put('app_state', value, key)
  },
  async logMutation(entry: { id: string; instruction: string; summary: string; appliedAt: number }) {
    await (await dbPromise).put('mutation_log', entry)
  },
}
```

### `WebContainerHost.start()` — snapshot-aware boot

```typescript
const saved = await SessionStore.loadLatestSnapshot()
const tree = saved ? snapshotToFileTree(saved.files) : seedFiles
await this.container.mount(tree)
```

`snapshotToFileTree(files)` rebuilds a `FileSystemTree` from a flat `{ path → content }` map. Tiny helper. The seed is only used on first-ever boot or after explicit reset.

### `MutationOrchestrator.apply()` — snapshot after apply

```typescript
const files = await this.fs.getAppSnapshot()
await SessionStore.saveSnapshot(files, pending.parsed.summary)
await SessionStore.logMutation({
  id: pending.id,
  instruction: pending.instruction,
  summary: pending.parsed.summary,
  appliedAt: Date.now(),
})
```

### `useHostState` — seed-side hook (replaces `useState` for persistent data)

```typescript
// src/hostState.ts inside the seed
import { useEffect, useRef, useState } from 'react'

const pending = new Map<string, (v: unknown) => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.data?.type !== 'STATE_RESULT') return
    const resolve = pending.get(e.data.key)
    if (resolve) { resolve(e.data.value); pending.delete(e.data.key) }
  })
}

export function useHostState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial)
  const loaded = useRef(false)

  useEffect(() => {
    pending.set(key, (v) => {
      if (v !== undefined) setValue(v as T)
      loaded.current = true
    })
    window.parent.postMessage({ type: 'STATE_GET', key }, '*')
  }, [key])

  const set = (v: T) => {
    setValue(v)
    if (loaded.current) {
      window.parent.postMessage({ type: 'STATE_SET', key, value: v }, '*')
    }
  }

  return [value, set]
}
```

The seed `App.tsx` now uses `useHostState('notes', [])` instead of `useState([])`. When Claude mutates the file and adds a `useState('filter')`, the notes survive the remount — they re-hydrate from IDB.

### Host message bridge — extends UsageCollector

```typescript
window.addEventListener('message', async (e) => {
  if (!isFromWC(e.origin)) return
  const msg = e.data
  if (msg.type === 'STATE_GET') {
    const value = await SessionStore.getState(msg.key)
    e.source?.postMessage({ type: 'STATE_RESULT', key: msg.key, value }, '*')
  } else if (msg.type === 'STATE_SET') {
    await SessionStore.setState(msg.key, msg.value)
  } else if (msg.type === 'USAGE_EVENTS') {
    /* Day 5 handles this */
  }
})
```

### Schema migration honesty note

If Claude refactors `notes: string[]` → `notes: Note[]`, old IDB data won't match the new shape. The seed should treat hydration as "best effort": fall back to `initial` if the stored value fails a type guard. For the demo this is acceptable; a production version would version the schema.

**Done when:** Add 3 notes, refresh the page, notes are still there. Apply a mutation that adds a sibling component, refresh, the mutation and the notes both persist.

---

# PHASE 2 — Idea D: The Self-Building App

**Days 5–9 · Prerequisite: Phase 1 complete**

**Goal:** App watches how you use it. Recognises patterns. Proposes features proactively. Builds them on approval.

---

## The Core Insight

Every AI coding tool today is reactive — it waits for you to ask. Even the most sophisticated agents wait for a prompt.

> **Idea D flips this entirely. The software is the agent. You are the signal.**

---

## Day 5 — UsageCollector + observer-in-seed + IndexedDB

### The observer is baked into the seed

Not appended later, not maintained by Claude across mutations — present from boot. `src/observer.ts` in the seed:

```typescript
// src/observer.ts — seed file, imported by App.tsx
const events: any[] = []
const SESSION_START = Date.now()
const FLUSH_THRESHOLD = 20  // event-count triggered, NOT time
const FLUSH_BACKSTOP_MS = 10_000

const flush = () => {
  if (!events.length) return
  window.parent.postMessage({ type: 'USAGE_EVENTS', events: [...events] }, '*')
  events.length = 0
}

const push = (e: any) => {
  events.push({ ...e, t: Date.now() - SESSION_START })
  if (events.length >= FLUSH_THRESHOLD) flush()
}

document.addEventListener('input', e => {
  const t = e.target as HTMLInputElement
  push({ kind: 'input', tag: t.tagName, value: t.value?.slice(0, 200) })
})

document.addEventListener('click', e => {
  const t = e.target as HTMLElement
  push({ kind: 'click', tag: t.tagName, text: t.textContent?.slice(0, 50) })
})

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === 'Escape' || e.ctrlKey || e.metaKey) {
    push({ kind: 'key', key: e.key, ctrl: e.ctrlKey || e.metaKey })
  }
})

setInterval(flush, FLUSH_BACKSTOP_MS)  // backstop, not primary trigger
```

Event-count triggering means a 5-repeat pattern surfaces within ~30 events of usage, not the next 30-second boundary. Demo cadence works reliably.

### IndexedDB schema (via `idb`)

```typescript
// src/lib/db.ts
import { openDB } from 'idb'

export const db = openDB('living-app', 1, {
  upgrade(db) {
    const events = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true })
    events.createIndex('by_t', 't')
    const patterns = db.createObjectStore('patterns', { keyPath: 'id' })
    patterns.createIndex('by_seen', 'lastSeenAt')
    db.createObjectStore('mutations', { keyPath: 'id' })
  },
})

// Rolling 24h purge — call on host load
export async function purgeOldEvents() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const tx = (await db).transaction('events', 'readwrite')
  const idx = tx.store.index('by_t')
  let cursor = await idx.openCursor(IDBKeyRange.upperBound(cutoff))
  while (cursor) { await cursor.delete(); cursor = await cursor.continue() }
}
```

### UsageCollector with origin check

```typescript
// src/lib/UsageCollector.ts
export class UsageCollector {
  constructor(private wcUrl: string, private onBatch: () => void) {}

  start() {
    window.addEventListener('message', async (e) => {
      // Origin check — postMessage from anywhere else is dropped
      if (!this.wcUrl || !e.origin || !this.wcUrl.startsWith(e.origin.replace(/\/$/, ''))) {
        if (e.data?.type === 'USAGE_EVENTS') return  // wrong origin, ignore silently
      }
      if (e.data?.type !== 'USAGE_EVENTS') return
      const tx = (await db).transaction('events', 'readwrite')
      for (const ev of e.data.events) await tx.store.add(ev)
      this.onBatch()
    })
  }
}
```

**Done when:** Events appear in IndexedDB. Purge runs without errors. Origin check rejects synthetic test messages from `null` origin.

---

## Day 6 — `/api/observe` pattern analyser

```typescript
const OBSERVER_SYSTEM_PROMPT = `
You watch how a user interacts with a React app and propose features.

Pattern types:
- Repeated typing prefixes  (e.g. "TODO:", "- ", dates)
- Repeated click sequences  (X then Y, 3+ times)
- Missing affordances       (Ctrl+S with no save handler)
- Implied structure         ($ amounts → totals; dates → calendar)
- Frustration signals       (rapid clicks, Escapes, deletions)

Surface a pattern only when:
- It repeats 3+ times AND
- Your confidence ≥ 0.70

Response format (JSON only):
{
  "patterns": [{
    "id": "<uuid>",
    "observation": "User typed 'TODO:' prefix 7 times",
    "signal_strength": 7,
    "confidence": 0.89,
    "proposed_feature": "Add checkbox toggle to TODO: lines",
    "complexity": "low",
    "implementation_hint": "Detect TODO: prefix on render, render as checkbox"
  }]
}
`

// model: 'claude-opus-4-7'
// cache_control on system prompt
// Opus is overkill for volume but called rarely — quality > speed here
```

`/api/suggest` from the original diagram is **removed** — the observe endpoint already returns proposed features. One endpoint, one responsibility.

---

## Day 7 — SuggestionEngine + card UI

```typescript
// src/lib/SuggestionEngine.ts
export class SuggestionEngine {
  private dismissed = new Set<string>()
  private applied = new Set<string>()
  private busy = false

  constructor(private onSuggestion: (p: Pattern[]) => void) {}

  // Triggered by UsageCollector after each batch, not on a timer
  async maybeAnalyse() {
    if (this.busy) return
    const newEventCount = await this.eventsSinceLastAnalysis()
    if (newEventCount < 20) return  // not enough new signal

    this.busy = true
    try {
      const events = await this.recentEvents()
      const code = await this.fs.getAppSnapshot()
      const { patterns } = await fetch('/api/observe', {
        method: 'POST',
        body: JSON.stringify({ events, currentCode: code }),
      }).then(r => r.json())

      const fresh = patterns.filter((p: Pattern) =>
        !this.dismissed.has(p.id) && !this.applied.has(p.id) && p.confidence >= 0.70,
      )
      if (fresh.length) this.onSuggestion(fresh)
    } finally {
      this.busy = false
    }
  }
}
```

```tsx
// SuggestionCard.tsx — slides in, not an alarm
export function SuggestionCard({ pattern, onApprove, onDismiss }: Props) {
  return (
    <div className="rounded-xl border border-neutral-200 p-4 shadow-sm animate-in slide-in-from-right">
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <span>✦</span>
        <span>I noticed something</span>
        <span className="ml-auto">{Math.round(pattern.confidence * 100)}% sure</span>
      </div>
      <p className="mt-2 text-sm">{pattern.observation}</p>
      <div className="mt-2 text-sm">→ <strong>{pattern.proposed_feature}</strong></div>
      <div className="mt-1 text-xs text-neutral-500">Complexity: {pattern.complexity}</div>
      <div className="mt-3 flex gap-2">
        <button onClick={() => onApprove(pattern)} className="px-3 py-1 bg-black text-white rounded text-sm">
          Add this feature
        </button>
        <button onClick={() => onDismiss(pattern.id)} className="px-3 py-1 border rounded text-sm">
          Not now
        </button>
      </div>
    </div>
  )
}
```

---

## Day 8 — SelfMutator wiring

Approval routes through the **same orchestrator** as Idea B. Idea D is Idea B with an automated trigger.

```typescript
// src/lib/SelfMutator.ts
export class SelfMutator {
  constructor(private orchestrator: MutationOrchestrator) {}

  async applyPattern(pattern: Pattern) {
    const instruction = `
${pattern.proposed_feature}

Implementation hint: ${pattern.implementation_hint}

Constraints:
- Preserve ALL existing data and state.
- Add minimally — do not redesign the app.
- The user did not ask explicitly — be conservative.
`
    const pending = await this.orchestrator.propose(instruction, () => {})
    return pending  // surface in the same diff-preview/approval UI as manual mutations
  }
}
```

Note: even auto-proposed mutations go through the human approval gate. No silent self-mutation.

---

# PHASE 3 — Polish & Power Features

**Days 10–13 · After Phase 2 shipped, the canonical demo flow worked end-to-end. These are the features that turn it from "demo" into "actually usable".**

---

## Day 10 — Image input

**Goal:** accept a pasted/dropped screenshot as the mutation target.

The seed builds whatever Claude proposes — but users often want to point at a specific design ("build this"). Sonnet 4.5 is multimodal; OpenRouter passes images through transparently; the Vercel SDK supports `image` content blocks. The whole feature is one new content type in the request.

### ChatInput additions

```typescript
// Paste handler
onPaste={(e) => {
  for (const item of e.clipboardData?.items ?? []) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      ingestFile(item.getAsFile())
      return
    }
  }
}}

// Drag-drop wrapper
onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
onDrop={(e) => { e.preventDefault(); ingestFile(e.dataTransfer.files?.[0]) }}

// Paperclip → hidden <input type="file" accept="image/*">

// Validation
const ACCEPTED = ['image/png','image/jpeg','image/webp','image/gif']
const MAX_BYTES = 5 * 1024 * 1024
```

Encode as a base64 data URL with `FileReader.readAsDataURL`, store in local component state, render thumbnail with a remove button.

### `/api/mutate` content shape

```typescript
content: [
  {
    type: 'text',
    text: `CURRENT FILES:\n\n${snapshotBlock}`,
    providerOptions: { openrouter: { cacheControl: { type: 'ephemeral' } } },
  },
  ...(image ? [
    { type: 'text', text: 'VISUAL TARGET (attached image):' },
    { type: 'image', image },  // image AFTER cache marker so it doesn't invalidate
  ] : []),
  { type: 'text', text: `INSTRUCTION: ${instruction}` },
]
```

### System prompt addition

> 9. If an image is attached to the user's message, treat it as the visual target — match its layout, colors, typography, and component composition as closely as possible using Tailwind. The text instruction (if any) refines or constrains the intent; if no instruction is given, infer the design intent from the image alone.

**Constraints:** PNG/JPEG/WebP/GIF, ≤5 MB (Anthropic's per-image cap), adds ~1500–2000 input tokens per image.

**Done when:** drop a Figma export, hit send, get matching code.

---

## Day 11 — Restore from mutation log

**Goal:** click any past mutation to revert to that version of the app.

Snapshots already exist (Day 4.5 saved every applied mutation as `snap_<timestamp>` alongside `current`). All that's missing is the click affordance and the restore path.

### Schema changes

```typescript
interface MutationLogEntry {
  id: string
  instruction: string
  summary: string
  appliedAt: number
  failures: number
  snapshotId?: string  // ← NEW: which historical snap this mutation produced
}

// SessionStore.saveSnapshot now returns the snapshot id
async saveSnapshot(files, summary): Promise<string> {
  const id = `snap_${Date.now()}`
  await db.put('code_snapshots', { id: 'current', files, summary, createdAt: now })
  await db.put('code_snapshots', { ...current, id })
  return id  // ← orchestrator stores this on the mutation log entry
}
```

### Restore semantics — destructive, with confirmation

```typescript
async restoreSnapshot(snapshotId): Promise<CodeSnapshot | undefined> {
  const snap = await db.get('code_snapshots', snapshotId)
  if (!snap) return
  await db.put('code_snapshots', { ...snap, id: 'current' })
  // Truncate log: drop any entry with appliedAt > snap.createdAt
  const tx = db.transaction('mutation_log', 'readwrite')
  for (const entry of await db.getAll('mutation_log')) {
    if (entry.snapshotId && entry.appliedAt > snap.createdAt) {
      await tx.store.delete(entry.id)
    }
  }
  return snap
}

// FileSystemManager.overwriteSrc(files) — writes every file, deletes any
// current src/ file that isn't in the snapshot. Vite HMR picks up the changes.
```

User state (notes, todos) survives the restore because it's in host IDB via `useHostState`, not in the WC files. Worth flagging this in the UI — it's a nice property.

> ⚠️ **Restore is destructive.** Newer mutations are discarded with no undo. No branching/forking — that's a future-work item.

**Done when:** hover any log entry → "Restore" button appears → click → confirm → app reverts → Vite HMR fires.

---

## Day 12 — Full-screen layout + floating chat

**Goal:** after the app exists, the running app gets center stage. Chat collapses to a floating affordance.

The split-panel control panel is the right layout for **building** an app. Once the app is alive, the user is mostly _using_ it, and chat should step back. This mirrors how productivity tools work (Linear's Cmd+K, Notion's AI button, Intercom's chat bubble).

### Layout switch

```typescript
// Zustand
viewMode: 'split' | 'full'
manualViewOverride: boolean
setViewMode: (mode, isManual = false) => void

// page.tsx auto-flip
useEffect(() => {
  if (manualOverride) return
  if (mutationLogCount > 0 || resumedFromSnapshot) setViewMode('full')
}, [mutationLogCount, resumedFromSnapshot])
```

Auto-flip on first applied mutation OR resume-from-snapshot. The user can manually toggle back to split via a button in the drawer; doing so sets `manualViewOverride = true`, locking the choice for the rest of the session.

### `FullShell` composition

```
Layer 0:  Full-screen iframe (z-0)
Layer 1:  FAB bottom-right (z-20) — chat icon, opens drawer
Layer 2:  Toast top-right (z-20) — new suggestion, 60s
Layer 3:  Auto-fix banner top-center (z-20) — "Installing X…"
Layer 4:  Drawer right (z-30) — ChatInput + DiffPreview + log + suggestions

Inside drawer header: split-view toggle + close (X)
```

Both shells share the same handler state via a new `useMutationFlow` hook — so `submit / apply / reject / approveSuggestion / restoreMutation` logic exists once.

### Suggestion lifecycle in full mode

```typescript
// Each suggestion starts as a toast top-right.
// After 60s it auto-collapses into a green count badge on the FAB.
const [seenIds, setSeenIds] = useState(new Set<string>())
const toastSuggestion = suggestions.find((p) => !seenIds.has(p.id))
const badgeCount = suggestions.filter((p) => seenIds.has(p.id) && p.id !== toastSuggestion?.id).length

// 60s timer
setTimeout(() => setSeenIds((prev) => new Set(prev).add(toastSuggestion.id)), 60_000)
```

Clicking the FAB opens the drawer; the drawer surfaces any seen suggestions inline so the user can act on them.

**Done when:** build a notes app via quick-pick → after Apply, layout flips to full-screen → FAB appears bottom-right → drawer toggles cleanly.

---

## Day 13 — Auto-resolve missing imports

**Goal:** when Claude introduces an import that isn't in the seed's package.json, install it automatically instead of failing.

This is mainly defensive. The system prompt steers Claude toward in-seed packages, but it occasionally reaches for `framer-motion`, `lucide-react`, `date-fns`, etc. — especially when given an image with motion. Vite's error path is verbose but predictable: `[plugin:vite:import-analysis] Failed to resolve import "X" from "src/..."`.

### RuntimeErrorWatcher

```typescript
const MISSING_IMPORT_RE = /Failed to resolve import ["']([^"']+)["']/g

class RuntimeErrorWatcher {
  buffer = ''
  seen = new Set<string>()
  onMissingPackage?: (e: { packageName: string }) => void

  feed(chunk: string) {
    this.buffer = (this.buffer + chunk).slice(-16_000)
    for (const m of this.buffer.matchAll(MISSING_IMPORT_RE)) {
      const rawImport = m[1]
      if (rawImport.startsWith('.') || rawImport.startsWith('/')) continue
      const pkg = this.parsePackageName(rawImport)
      if (!pkg || this.seen.has(pkg)) continue
      this.seen.add(pkg)
      this.onMissingPackage?.({ packageName: pkg })
    }
  }

  // 'lodash/debounce' → 'lodash'
  // '@radix-ui/react-dialog' → '@radix-ui/react-dialog'
  // '@scope/pkg/sub' → '@scope/pkg'
}
```

### WebContainerHost.installPackage

```typescript
async installPackage(pkg: string) {
  const proc = await this.container.spawn('npm', ['install', pkg])
  proc.output.pipeTo(this.writer())
  const code = await proc.exit
  if (code !== 0) throw new Error(`npm install ${pkg} exited ${code}`)
}
```

### Wiring in page.tsx

The dev server log already streams through `host.onLog`. Tap that stream:

```typescript
host.onLog = (chunk) => {
  store.appendTerminal(chunk)
  watcher.feed(chunk)
}

watcher.onMissingPackage = async ({ packageName }) => {
  store.setAutoFixNotice(`Installing ${packageName}…`)
  try {
    await host.installPackage(packageName)
  } catch (e) {
    store.setLastError(`Could not auto-install ${packageName}: ${e.message}`)
  } finally {
    store.setAutoFixNotice(null)
  }
}
```

Serialise concurrent installs with a chained promise — two errors in quick succession shouldn't fight each other.

### System prompt update

> 10. Prefer the packages already in the seed (react, react-dom, plus the configured Vite/Tailwind toolchain). Build animations and UI primitives with CSS + Tailwind by default. You MAY introduce a new dependency (e.g. framer-motion, lucide-react) when it genuinely simplifies the request — the host auto-installs missing imports — but don't reach for one casually.

This both reduces unnecessary new deps AND signals to Claude that adding one is a real option when it helps.

**Failure modes the watcher handles cleanly:**
- Typo'd package name (`reactt`) → `npm install` fails with "404 not found" → surfaced as `lastError`
- Relative import (`./missing.ts`) → ignored (it's a file-not-found, not a missing package, needs a code mutation instead)
- Same package referenced multiple times across files → deduped via `seen` set

**Future extension:** generic runtime errors (type errors, undefined references) could trigger an automatic mutation cycle with the error message as the instruction — "self-healing code". Not built yet.

**Done when:** ask for an animation, Claude writes `import { motion } from 'framer-motion'`, Vite errors, watcher catches it, npm install completes, Vite recompiles, the animation works.

---

## Day 9 — Polish + demo recording

The scripted 60-second demo:

| Time   | Action                                  | What Viewer Sees                                           |
| ------ | --------------------------------------- | ---------------------------------------------------------- |
| T+0:00 | Open app                                | Blank notes — just textarea and add button                 |
| T+0:30 | Type notes with "TODO:" prefix 5 times  | Normal usage                                               |
| T+2:00 | Keep using, add more notes              | App being used as a real tool                              |
| T+3:00 | Suggestion card slides in               | "✦ I noticed: You typed TODO: 5 times → Add checkboxes?"   |
| T+3:05 | Click "Add this feature"                | Diff preview flashes in control panel                      |
| T+3:08 | Click Accept                            | Patch applied via HMR — TODO items now have checkboxes     |
| T+3:10 | Click a checkbox                        | Works. All previous notes still there.                     |
| T+3:20 | Type: "make checkboxes green when done" | Manual instruction via Idea B chat                         |
| T+3:23 | Green checkboxes appear                 | No reload. State intact. Conversation continues.           |

---

# Project File Structure

```
cambium/
├── src/
│   ├── app/
│   │   ├── page.tsx                  ← Picks SplitShell or FullShell, owns boot
│   │   ├── layout.tsx                ← Geist fonts + metadata
│   │   ├── globals.css               ← Tailwind, transition baseline, keyframes
│   │   └── api/
│   │       ├── mutate/route.ts        ← Phase 1 + image input + cache_control
│   │       └── observe/route.ts       ← Phase 2 + cache_control
│   ├── components/
│   │   ├── ControlPanel.tsx          ← split-mode shell
│   │   ├── FullShell.tsx             ← Phase 3 — full-screen + FAB + drawer + toast
│   │   ├── LiveApp.tsx               ← iframe + terminal drawer (split mode)
│   │   ├── ChatInput.tsx             ← text + quick-picks + image (paste/drop/paperclip)
│   │   ├── DiffPreview.tsx           ← search/replace block rendering
│   │   ├── MutationLog.tsx           ← divide-y, hover-to-restore
│   │   └── SuggestionCard.tsx        ← AI-noticed card (emerald)
│   ├── hooks/
│   │   └── useMutationFlow.ts        ← Phase 3 — shared propose/apply/restore handlers
│   ├── lib/
│   │   ├── WebContainerHost.ts       ← boot/install/run + snapshot mount + installPackage
│   │   ├── FileSystemManager.ts      ← snapshot/apply/checkpoint/overwriteSrc
│   │   ├── MutationOrchestrator.ts   ← propose (image arg) / apply / rollback
│   │   ├── SessionStore.ts           ← IDB facade with restore + snapshot history
│   │   ├── HostMessageBridge.ts      ← STATE_GET/SET + USAGE_EVENTS dispatcher
│   │   ├── UsageCollector.ts         ← events handler (wires into bridge)
│   │   ├── SuggestionEngine.ts
│   │   ├── SelfMutator.ts
│   │   ├── RuntimeErrorWatcher.ts    ← Phase 3 — Vite log → auto npm install
│   │   ├── mutation-types.ts
│   │   ├── observe-types.ts
│   │   └── webcontainer/
│   │       └── seed-files.ts         ← Vite + React + Tailwind + observer + useHostState inline
│   └── store/
│       └── appStore.ts               ← Zustand: WC + mutation + suggestions + viewMode + autoFixNotice
├── package.json
├── next.config.ts                    ← COOP/COEP credentialless
└── .env.local                        ← OPEN_ROUTER_API_KEY
```

## Zustand store shape (as shipped)

```typescript
interface AppState {
  // WebContainer lifecycle
  wcStatus: WCStatus  // idle | booting | mounting | installing | starting | ready | error
  wcUrl: string | null
  bootError: string | null
  terminalLog: string
  resumedFromSnapshot: boolean

  // Mutation pipeline
  isStreaming: boolean
  partialMutation: Partial<ProposedMutations> | null  // streaming preview
  pendingMutation: PendingMutation | null              // awaiting Apply/Reject
  lastError: string | null

  // History
  mutationLog: MutationLogEntry[]

  // Phase 2 — proactive suggestions
  suggestions: Pattern[]

  // Phase 3 — layout mode
  viewMode: 'split' | 'full'
  manualViewOverride: boolean  // locks the user's split-view choice for the session

  // Phase 3 — auto-resolve banner ("Installing framer-motion…")
  autoFixNotice: string | null

  // ...accompanying setters for each slice
}
```

Dismissed pattern ids are kept in-memory on `SuggestionEngine` (not Zustand) because they don't need to drive renders directly — the engine filters before adding to `suggestions[]`.

---

# Risk Register

| Risk                              | Likelihood | Impact | Mitigation                                                     |
| --------------------------------- | ---------- | ------ | -------------------------------------------------------------- |
| Search block doesn't match        | Medium     | Medium | Per-block failure surfacing + targeted regenerate              |
| Total mutation failure            | Low        | High   | Auto-rollback via `fs.restore(checkpointId)`                   |
| HMR doesn't fire after patch      | Medium     | High   | Verify Day 1; fallback iframe.contentWindow.location.reload()  |
| Fast Refresh resets state         | Medium     | Medium | Honest about boundary; structure suggestions to avoid it       |
| Observer breaks the app           | Low        | High   | Try/catch around handlers; observer baked in seed, not mutated |
| False positive suggestions        | High       | Medium | Min 3 occurrences + confidence ≥ 0.70 + 20-event analysis gate |
| Claude returns invalid JSON       | Medium     | Low    | One retry with `Repair the JSON` system prompt; show raw on 2nd fail |
| WebContainer already booted (tab) | Low        | Low    | Clear "reload to start fresh" UX, not a crash                  |
| IndexedDB fills up                | Low        | Low    | 24hr rolling purge on host load                                |
| Session token cost                | Medium     | Medium | Prompt caching on system + snapshot; bounded history           |
| Generated code is malicious       | Low        | Medium | Operator-approval gate on every mutation; no silent apply      |
| Claude imports unavailable pkg    | Medium     | Low    | RuntimeErrorWatcher auto-runs `npm install` (Phase 3)          |
| Restore destroys newer work       | Medium     | Low    | Confirm dialog explicitly warns; future-work: branching/forking |
| Image too large / wrong type      | Low        | Low    | Client-side 5MB cap + type filter; clear error in UI           |

---

# Success Metrics

| Metric                               | Target            | How to verify                                                  |
| ------------------------------------ | ----------------- | -------------------------------------------------------------- |
| App boots in WebContainer            | Under 15 seconds  | Timer from page load to first iframe load                      |
| Mutation applies without full reload | HMR fires only    | DevTools network tab — zero document loads                     |
| State survives sibling mutations     | 10 consecutive    | Add notes before, verify intact after each                     |
| Block-level apply success rate       | ≥ 85%             | 10-mutation smoke test on fixed seed; count per-block failures |
| Pattern detected                     | Within 3 min      | Use app with TODO: pattern 5 times                             |
| Suggestion → applied                 | Under 10 seconds  | Timer from card appear to iframe HMR                           |
| Session cost (10-min)                | Under $0.50       | Anthropic console usage report                                 |
| Full demo recordable                 | Under 60 seconds  | Screen record the Day 9 script                                 |

---

# Build Order

| Day | Task                                          | Depends On | Done When                                                |
| --- | --------------------------------------------- | ---------- | -------------------------------------------------------- |
| 0   | Bootstrap: Next.js, COOP/COEP, env, deps      | —          | `crossOriginIsolated === true`                           |
| 1   | WebContainerHost + FileSystemManager          | Day 0      | Boot, snapshot, write a block, HMR fires                 |
| 2   | `/api/mutate` + MutationOrchestrator (split)  | Day 1      | Propose → preview → apply works end-to-end               |
| 3   | Split-panel UI + diff preview + approval      | Day 2      | Diff visible before apply; reject discards               |
| 4   | Seed + HMR verification + state honesty       | Day 3      | 10 sibling mutations preserve notes; state-loss case documented |
| 4.5 | Persistence layer (SessionStore + useHostState)| Day 4     | Refresh preserves notes AND applied mutations            |
| 5   | UsageCollector + observer in seed             | Day 4.5    | Events in IDB; origin check works; purge runs            |
| 6   | `/api/observe` pattern analyser               | Day 5      | Real usage produces ≥1 valid pattern                     |
| 7   | SuggestionEngine + card UI                    | Day 6      | Card slides in after threshold reached                   |
| 8   | SelfMutator wiring                            | Days 2 + 7 | Approve suggestion → diff preview → apply → HMR          |
| 9   | Polish + demo recording                       | Day 8      | 60-second demo recorded                                  |
| 10  | Image input (paste/drop/paperclip → /api/mutate) | Day 2   | Drop a UI screenshot, get matching code                  |
| 11  | Restore from mutation log                     | Days 4.5 + 7 | Click old entry → confirm → app reverts via HMR       |
| 12  | Full-screen layout + floating chat            | Day 4.5    | Auto-flip on first apply; toggle back works; toast→badge |
| 13  | Auto-resolve missing imports                  | Day 1      | Claude imports `framer-motion` → auto installed → works  |

> ⚠️ **Day 1 has two classes, not one.** WebContainerHost owns the runtime; FileSystemManager owns the files. Don't conflate them.
>
> **Phase 1 (Days 0–4.5)** ships the talk-to-app loop. **Phase 2 (Days 5–9)** ships the watch-and-grow loop. **Phase 3 (Days 10–13)** are independent power features built once the core works.

---

# Cost Notes (measured, as shipped)

Via OpenRouter (~5% markup over Anthropic direct pricing) with prompt caching ON, bounded 6-turn history, Sonnet 4.5 for both routes:

| Action                                | Approximate cost |
| ------------------------------------- | ---------------- |
| First mutation in a session (cold)    | ~$0.025          |
| Subsequent mutations (warm cache)     | ~$0.015 each — input cost drops ~92% |
| Image-attached mutation               | +~$0.01 (image tokens) |
| One observe analysis                  | ~$0.04           |
| Auto npm install                      | $0 (no LLM call) |
| Heavy 10-minute session               | ~$0.20 – $0.35   |

**Cache wins are dominated by input-token savings (~92%)** but output tokens still bill at full rate, so total session reduction is closer to 30–50%. Bigger codebases see bigger gains. Each call logs detailed cost breakdown via `[/api/mutate] usage:` in the dev console (visible because we set `onFinish` on `streamObject`).

OpenRouter notes:
- Set `OPEN_ROUTER_API_KEY` in `.env.local` (note the underscore)
- Caching passes through Anthropic transparently; the `cacheControl` field on `providerOptions.openrouter` per-content-block is what triggers it; the top-level `cache_control` on `providerOptions` enables Anthropic's automatic prefix caching
- Without caching or with unbounded history: 5–10x the cost. Don't ship without caching

---

_The Living App — B + D Implementation Plan_
_Next.js · WebContainers · Claude API · Vite HMR · IndexedDB · Search/Replace patching_
