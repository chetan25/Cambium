import type { FileSystemTree } from "@webcontainer/api";

const PACKAGE_JSON = `{
  "name": "living-seed",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2",
    "vite": "^5.4.11"
  }
}
`;

const VITE_CONFIG = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// HMR inside a WebContainer iframe served at *.webcontainer-api.io
// MUST use clientPort 443 + wss, or the HMR socket falls back to full reload.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3111,
    strictPort: true,
    hmr: {
      clientPort: 443,
      protocol: 'wss',
    },
  },
})
`;

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
`;

const TAILWIND_CONFIG = `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
`;

const POSTCSS_CONFIG = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Living App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const MAIN_TSX = `import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import './observer'

createRoot(document.getElementById('root')!).render(<App />)
`;

// Welcome canvas. The first /api/mutate call replaces this with the actual app.
// Uses an inline 4-point SVG sparkle instead of an emoji.
const APP_TSX = `export default function App() {
  return (
    <div className="min-h-[100dvh] grid place-items-center p-8 bg-gradient-to-br from-zinc-50 to-white">
      <div className="max-w-sm text-center space-y-5">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="mx-auto h-9 w-9 text-emerald-500"
        >
          <path
            d="M12 2.5 L13.2 10.8 L21.5 12 L13.2 13.2 L12 21.5 L10.8 13.2 L2.5 12 L10.8 10.8 Z"
            fill="currentColor"
          />
        </svg>
        <div className="space-y-2">
          <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900">
            A blank canvas
          </h1>
          <p className="text-[13px] leading-relaxed text-zinc-500">
            Tell me what you'd like to build in the chat on the left,
            or pick a quick-start to get going fast.
          </p>
        </div>
      </div>
    </div>
  )
}
`;

// Host-state bridge. Components use useHostState instead of useState for any
// data that should survive code mutations and refreshes. Persists via
// postMessage to the host, which stores in IndexedDB.
const HOST_STATE_TS = `import { useEffect, useRef, useState } from 'react'

const pending = new Map<string, (value: unknown) => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'STATE_RESULT') return
    const resolve = pending.get(e.data.key)
    if (resolve) {
      resolve(e.data.value)
      pending.delete(e.data.key)
    }
  })
}

// Pre-load writes are accepted in local state but not persisted until the
// initial load resolves. This window is typically ~10ms (local IDB read).
export function useHostState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial)
  const loaded = useRef(false)
  const dirty = useRef(false)

  useEffect(() => {
    pending.set(key, (v) => {
      loaded.current = true
      if (!dirty.current && v !== undefined && v !== null) {
        setValue(v as T)
      }
    })
    window.parent.postMessage({ type: 'STATE_GET', key }, '*')
  }, [key])

  const set = (v: T) => {
    dirty.current = true
    setValue(v)
    if (loaded.current) {
      window.parent.postMessage({ type: 'STATE_SET', key, value: v }, '*')
    }
  }

  return [value, set]
}
`;

// Passive observer. Listens to input/click/keydown, batches events, and
// flushes to the host iframe via postMessage. Event-count threshold drives
// flushes (not pure time) so demo cadence is reliable; a 10s backstop catches
// trickling sessions. All handlers are try-wrapped so a buggy listener can
// never break the user's app.
const OBSERVER_TS = `type Event = Record<string, unknown> & { t: number; ts: number }

const events: Event[] = []
const SESSION_START = Date.now()
const FLUSH_THRESHOLD = 20
const FLUSH_BACKSTOP_MS = 10_000

const flush = () => {
  if (events.length === 0) return
  try {
    window.parent.postMessage(
      { type: 'USAGE_EVENTS', events: [...events] },
      '*',
    )
  } catch {}
  events.length = 0
}

const push = (e: Record<string, unknown>) => {
  const now = Date.now()
  // t: session-relative for chronological ordering inside an analysis batch.
  // ts: absolute wall clock so the host can scope events to project epochs
  // (e.g. "only events newer than the most recent applied mutation").
  events.push({ ...e, t: now - SESSION_START, ts: now })
  if (events.length >= FLUSH_THRESHOLD) flush()
}

document.addEventListener('input', (e) => {
  try {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement | null
    if (!target || !('value' in target)) return
    push({
      kind: 'input',
      tag: target.tagName,
      value: String(target.value ?? '').slice(0, 200),
    })
  } catch {}
})

const isInteractive = (el: HTMLElement): boolean => {
  if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'].includes(el.tagName)) return true
  if (el.hasAttribute('onclick')) return true
  const role = el.getAttribute('role')
  if (role === 'button' || role === 'link' || role === 'checkbox' || role === 'menuitem' || role === 'option' || role === 'tab') return true
  try {
    if (window.getComputedStyle(el).cursor === 'pointer') return true
  } catch {}
  return false
}

document.addEventListener('click', (e) => {
  try {
    const target = e.target as HTMLElement | null
    if (!target) return
    push({
      kind: 'click',
      tag: target.tagName,
      text: (target.textContent ?? '').slice(0, 50),
      // false when the user clicked a content element (li/span/div/p) that has
      // no handler or pointer cursor — a strong signal they expected something
      // to happen and the app didn't respond.
      interactive: isInteractive(target),
    })
  } catch {}
})

// Drag attempts — pointerdown + significant move + pointerup. Captures BOTH
// successful drags (the app responded) AND attempted ones (the app didn't),
// because the gesture itself reveals user intent regardless of outcome.
let dragOrigin: { x: number; y: number; tag: string; text: string } | null = null

document.addEventListener('pointerdown', (e) => {
  try {
    const target = e.target as HTMLElement | null
    if (!target) return
    dragOrigin = {
      x: e.clientX,
      y: e.clientY,
      tag: target.tagName,
      text: (target.textContent ?? '').slice(0, 50),
    }
  } catch {}
})

document.addEventListener('pointerup', (e) => {
  try {
    if (!dragOrigin) return
    const dx = e.clientX - dragOrigin.x
    const dy = e.clientY - dragOrigin.y
    const distance = Math.round(Math.sqrt(dx * dx + dy * dy))
    // 8px threshold filters out micro-jitter from imprecise clicks.
    if (distance >= 8) {
      const target = e.target as HTMLElement | null
      push({
        kind: 'drag',
        from: { tag: dragOrigin.tag, text: dragOrigin.text },
        to: target
          ? { tag: target.tagName, text: (target.textContent ?? '').slice(0, 50) }
          : null,
        distance,
        dx: Math.round(dx),
        dy: Math.round(dy),
      })
    }
    dragOrigin = null
  } catch {
    dragOrigin = null
  }
})

document.addEventListener('keydown', (e) => {
  try {
    if (e.key === 'Enter' || e.key === 'Escape' || e.ctrlKey || e.metaKey) {
      push({ kind: 'key', key: e.key, ctrl: e.ctrlKey || e.metaKey })
    }
  } catch {}
})

setInterval(flush, FLUSH_BACKSTOP_MS)

export {}
`;

const INDEX_CSS = `@tailwind base;
@tailwind components;
@tailwind utilities;
`;

export const seedFiles: FileSystemTree = {
  "package.json": { file: { contents: PACKAGE_JSON } },
  "vite.config.ts": { file: { contents: VITE_CONFIG } },
  "tsconfig.json": { file: { contents: TSCONFIG } },
  "tailwind.config.js": { file: { contents: TAILWIND_CONFIG } },
  "postcss.config.js": { file: { contents: POSTCSS_CONFIG } },
  "index.html": { file: { contents: INDEX_HTML } },
  src: {
    directory: {
      "main.tsx": { file: { contents: MAIN_TSX } },
      "App.tsx": { file: { contents: APP_TSX } },
      "hostState.ts": { file: { contents: HOST_STATE_TS } },
      "observer.ts": { file: { contents: OBSERVER_TS } },
      "index.css": { file: { contents: INDEX_CSS } },
    },
  },
};

// Snapshot-aware mounting: reconstruct a FileSystemTree from a flat
// { path -> content } map. Used by WebContainerHost on resume.
export function snapshotToFileTree(
  files: Record<string, string>,
): FileSystemTree {
  const tree: FileSystemTree = {};

  for (const [path, contents] of Object.entries(files)) {
    const parts = path.split("/");
    let cursor: FileSystemTree = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      const existing = cursor[segment];
      if (!existing || !("directory" in existing)) {
        cursor[segment] = { directory: {} };
      }
      cursor = (cursor[segment] as { directory: FileSystemTree }).directory;
    }
    cursor[parts[parts.length - 1]] = { file: { contents } };
  }

  // Always merge the non-src config files from the seed (they're not part of
  // the snapshot which only walks src/).
  for (const [name, node] of Object.entries(seedFiles)) {
    if (name !== "src" && !(name in tree)) {
      tree[name] = node;
    }
  }

  return tree;
}
