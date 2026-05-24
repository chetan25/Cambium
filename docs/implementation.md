# The Living App — Implementation Plan

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
| Framework    | Next.js 14 (App Router, TS)                        | SSR + API routes in one place                                             |
| WebContainer | `@webcontainer/api`                                | Battle-tested in-browser Node runtime                                     |
| LLM (mutate) | `claude-sonnet-4-6`                                | Best speed/quality for surgical edits                                     |
| LLM (observe)| `claude-opus-4-7`                                  | Sharper pattern reasoning, low call volume                                |
| SDK          | `@anthropic-ai/sdk` + prompt caching               | Cuts session token cost 75–90%                                            |
| Terminal     | `@xterm/xterm` + `@xterm/addon-fit`                | Debug pane for WC output                                                  |
| State        | Zustand                                            | Lightweight, fits the host's needs                                        |
| Streaming    | Server-Sent Events                                 | Simpler than WebSocket, fine for one-way streams                          |
| Patch format | **Search/Replace blocks** (Aider-style)            | Highest LLM success rate; trivial to parse; failures are recoverable      |
| Pattern DB   | IndexedDB via `idb`                                | Client-side, persistent across reloads                                    |
| WC seed CSS  | Tailwind                                           | Matches host styling; lets Claude reuse class vocabulary                  |

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

Every mutation call marks the system prompt + the snapshot block with `cache_control: { type: "ephemeral" }`. Without this, cost compounds linearly. With it, a 10-minute session runs ~$0.30 on Sonnet 4.6; without it, ~$3–5.

### 5. State preservation is best-effort, not guaranteed

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

### The API route

```typescript
// src/app/api/mutate/route.ts

import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic()

const MUTATION_SYSTEM_PROMPT = `
You are a surgical code editor. You modify a running React app via search/replace blocks.

You receive:
1. The CURRENT files of the running app
2. A user instruction

Rules:
- Preserve all existing state, logic, and content.
- Use search/replace blocks for edits — never rewrite entire files.
- Each "search" must match the current file EXACTLY (including whitespace).
- Keep blocks tight — only the lines you need to change.
- "create" only when adding a genuinely new file. "delete" only when explicitly asked.

Response format (JSON only, no prose, no markdown fences):
{
  "mutations": [
    {
      "path": "src/App.tsx",
      "type": "edit",
      "blocks": [
        { "search": "<exact lines>", "replace": "<new lines>" }
      ]
    },
    { "path": "src/components/Toggle.tsx", "type": "create", "content": "<full file>" },
    { "path": "src/old.tsx", "type": "delete" }
  ],
  "summary": "Added dark mode toggle to header",
  "hotReloadable": true
}
`

export async function POST(req: Request) {
  const { instruction, snapshot, history } = await req.json()

  const snapshotBlock = Object.entries(snapshot)
    .map(([p, c]) => `--- ${p} ---\n${c}`)
    .join('\n\n')

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: [
      { type: 'text', text: MUTATION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      ...history.slice(-6),
      {
        role: 'user',
        content: [
          { type: 'text', text: `CURRENT FILES:\n${snapshotBlock}`, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `INSTRUCTION: ${instruction}` },
        ],
      },
    ],
  })

  // SSE relay
  const encoder = new TextEncoder()
  const sse = new ReadableStream({
    async start(controller) {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: event.delta.text })}\n\n`))
        }
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
      controller.close()
    },
  })

  return new Response(sse, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  })
}
```

### The orchestrator — propose / apply split

The Day 3 UI needs an approval gate. The orchestrator must NOT apply mutations as a side effect of generating them.

```typescript
// src/lib/MutationOrchestrator.ts

export interface PendingMutation {
  id: string
  instruction: string
  rawResponse: string
  parsed: { mutations: Mutation[]; summary: string; hotReloadable: boolean }
  snapshot: Record<string, string>  // for rollback preview
}

export class MutationOrchestrator {
  private history: { role: 'user' | 'assistant'; content: string }[] = []

  constructor(private fs: FileSystemManager) {}

  async propose(
    instruction: string,
    onDelta: (text: string) => void,
  ): Promise<PendingMutation> {
    const snapshot = await this.fs.getAppSnapshot()
    const id = crypto.randomUUID()

    const res = await fetch('/api/mutate', {
      method: 'POST',
      body: JSON.stringify({ instruction, snapshot, history: this.history }),
    })

    let raw = ''
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of decoder.decode(value).split('\n')) {
        if (!line.startsWith('data: ')) continue
        const payload = JSON.parse(line.slice(6))
        if (payload.delta) { raw += payload.delta; onDelta(payload.delta) }
      }
    }

    const parsed = JSON.parse(raw)
    return { id, instruction, rawResponse: raw, parsed, snapshot }
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
living-app/
├── src/
│   ├── app/
│   │   ├── page.tsx                  ← Main layout
│   │   ├── globals.css
│   │   └── api/
│   │       ├── mutate/route.ts        ← Phase 1
│   │       └── observe/route.ts       ← Phase 2
│   ├── components/
│   │   ├── ControlPanel.tsx
│   │   ├── LiveApp.tsx               ← iframe wrapper
│   │   ├── ChatInput.tsx
│   │   ├── DiffPreview.tsx           ← search/replace block rendering
│   │   ├── MutationLog.tsx
│   │   ├── SuggestionCard.tsx
│   │   └── FileTree.tsx
│   ├── lib/
│   │   ├── WebContainerHost.ts       ← boot/install/run
│   │   ├── FileSystemManager.ts      ← snapshot/apply/checkpoint
│   │   ├── MutationOrchestrator.ts   ← propose/apply split
│   │   ├── UsageCollector.ts         ← postMessage receiver
│   │   ├── SuggestionEngine.ts
│   │   ├── SelfMutator.ts
│   │   ├── db.ts                     ← idb schema
│   │   └── webcontainer/
│   │       ├── seed-files.ts         ← Vite + React + Tailwind seed
│   │       └── seed/                 ← source for the seed (App.tsx, observer.ts, vite.config.ts, etc.)
│   └── store/
│       └── appStore.ts               ← Zustand
├── package.json
├── next.config.mjs                   ← COOP/COEP credentialless
└── .env.local                        ← ANTHROPIC_API_KEY
```

## Zustand store shape

```typescript
interface AppState {
  wcUrl: string | null
  booted: boolean

  conversationHistory: { role: 'user' | 'assistant'; content: string }[]
  pendingMutation: PendingMutation | null
  appliedMutations: { id: string; summary: string; at: number }[]

  suggestions: Pattern[]
  dismissedPatternIds: Set<string>

  // actions
  setPending: (m: PendingMutation | null) => void
  logApplied: (id: string, summary: string) => void
  dismiss: (id: string) => void
}
```

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

# 10-Day Build Order

| Day | Task                                          | Depends On | Done When                                                |
| --- | --------------------------------------------- | ---------- | -------------------------------------------------------- |
| 0   | Bootstrap: Next.js, COOP/COEP, env, deps      | —          | `crossOriginIsolated === true`                           |
| 1   | WebContainerHost + FileSystemManager          | Day 0      | Boot, snapshot, write a block, HMR fires                 |
| 2   | `/api/mutate` + MutationOrchestrator (split)  | Day 1      | Propose → preview → apply works end-to-end               |
| 3   | Split-panel UI + diff preview + approval      | Day 2      | Diff visible before apply; reject discards               |
| 4   | Seed + HMR verification + state honesty       | Day 3      | 10 sibling mutations preserve notes; state-loss case documented |
| 5   | UsageCollector + IndexedDB + observer in seed | Day 4      | Events in IDB; origin check works; purge runs            |
| 6   | `/api/observe` pattern analyser               | Day 5      | Real usage produces ≥1 valid pattern                     |
| 7   | SuggestionEngine + card UI                    | Day 6      | Card slides in after threshold reached                   |
| 8   | SelfMutator wiring                            | Days 2 + 7 | Approve suggestion → diff preview → apply → HMR          |
| 9   | Polish + demo recording                       | Day 8      | 60-second demo recorded                                  |

> ⚠️ **Day 1 has two classes, not one.** WebContainerHost owns the runtime; FileSystemManager owns the files. Don't conflate them.

---

# Cost Notes

With prompt caching ON, bounded history (last 6 turns), and Sonnet 4.6 for `/api/mutate`:
- First mutation in a session: ~$0.05 (cache miss on system + snapshot)
- Subsequent mutations: ~$0.01–0.02 each (cache hits)
- Observe call (Opus 4.7, called every ~20 events): ~$0.04
- **10-minute heavy session: ~$0.30**

Without caching or with unbounded history: 10–15x that. Don't ship without caching.

---

_The Living App — B + D Implementation Plan_
_Next.js · WebContainers · Claude API · Vite HMR · IndexedDB · Search/Replace patching_
