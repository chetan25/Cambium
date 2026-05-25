import { streamObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { mutationSchema } from "@/lib/mutation-types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MUTATE_MODEL =
  process.env.OPENROUTER_MUTATE_MODEL ?? "anthropic/claude-sonnet-4.5";

const SYSTEM_PROMPT = `You are a surgical code editor operating on a running React + TypeScript + Tailwind app inside a WebContainer.

INPUT
- CURRENT FILES: a flat map of the current source files in the WebContainer
- INSTRUCTION: a description of the change the user wants

CONTEXT
The app starts as a blank welcome canvas at src/App.tsx. The first instruction usually replaces that canvas with a real app (via search/replace on App.tsx). Subsequent instructions evolve the existing app.

The seed includes src/hostState.ts exporting useHostState(key, initial) — a persistent state hook backed by host IndexedDB. Use it INSTEAD of useState for any data that should survive across sessions (e.g. notes, todos, settings). Use plain useState only for ephemeral UI state (e.g. the text someone is currently typing in an input).

OUTPUT (validated against the AppMutation schema)
- mutations: array of edits to apply
- summary: short past-tense description of what changed
- hotReloadable: true unless your changes touch vite.config.ts, package.json, tsconfig.json, postcss.config.js, or tailwind.config.js

Each mutation is one of:
- type: "edit" with a "blocks" array of { search, replace }. Each "search" MUST match the file EXACTLY — character for character, including all whitespace, indentation, and newlines. If you cannot construct a tight exact-matching block, EXPAND the search to include more surrounding context. Never approximate. Never use ellipses or placeholders.
- type: "create" with a full "content" string for a new file
- type: "delete" for files to remove (use sparingly — only when explicitly requested)

RULES
1. Preserve all existing state, content, and behavior unless the instruction explicitly says otherwise.
2. Use "edit" with search/replace blocks for changes to existing files. For incremental changes, keep each block small — only the lines you need to change. Use multiple small blocks instead of one large block when changes are non-adjacent.
3. EXCEPTION: For the very first mutation (when src/App.tsx is the welcome canvas) OR any explicit "rewrite from scratch" instruction, use ONE edit block with the entire current file content as search and the entire new file content as replace. This is the canonical way to fully replace a file.
4. If you add an import, place it in its own small block at the top of the file.
5. Use Tailwind utility classes for styling — they are already configured in the WC seed.
6. For persistent app data (notes, todos, settings) use \`useHostState<T>(key, initial)\` imported from './hostState'. For ephemeral form state (e.g. the current input value), use plain useState.
7. summary: one short sentence, past tense. Example: "Added a dark mode toggle to the header."
8. DO NOT modify src/main.tsx, src/observer.ts, or src/hostState.ts. These are infrastructure files — main.tsx is the entrypoint, observer.ts feeds usage analytics to the host, and hostState.ts provides the persistent state hook. Changes there will break the system.
9. If an image is attached to the user's message, treat it as the visual target — match its layout, colors, typography, and component composition as closely as possible using Tailwind. The text instruction (if any) refines or constrains the intent; if no instruction is given, infer the design intent from the image alone.
10. Prefer the packages already in the seed (react, react-dom, plus the configured Vite/Tailwind toolchain). Build animations and UI primitives with CSS + Tailwind by default. You MAY introduce a new dependency (e.g. framer-motion, lucide-react) when it genuinely simplifies the request — the host auto-installs missing imports — but don't reach for one casually.`;

export async function POST(req: Request) {
  if (!process.env.OPEN_ROUTER_API_KEY) {
    return Response.json(
      { error: "OPEN_ROUTER_API_KEY is not set in .env.local" },
      { status: 500 },
    );
  }

  let body: {
    instruction: string;
    snapshot: Record<string, string>;
    history?: { role: "user" | "assistant"; content: string }[];
    image?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { instruction, snapshot, history, image } = body;
  if (!instruction || typeof instruction !== "string") {
    return Response.json(
      { error: "instruction is required" },
      { status: 400 },
    );
  }
  if (!snapshot || typeof snapshot !== "object") {
    return Response.json({ error: "snapshot is required" }, { status: 400 });
  }
  if (image !== undefined && typeof image !== "string") {
    return Response.json(
      { error: "image must be a base64 data URL string" },
      { status: 400 },
    );
  }

  const snapshotBlock = Object.entries(snapshot)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join("\n\n");

  const openrouter = createOpenRouter({
    apiKey: process.env.OPEN_ROUTER_API_KEY,
  });

  const result = streamObject({
    model: openrouter(MUTATE_MODEL),
    schema: mutationSchema,
    schemaName: "AppMutation",
    schemaDescription:
      "A set of search/replace mutations to apply to the WebContainer source files.",
    system: SYSTEM_PROMPT,
    // Cache breakpoint on the snapshot block: everything up to and including
    // this content (system prompt + history + snapshot) becomes a cacheable
    // prefix. The image and instruction come AFTER the marker so per-request
    // variability does not invalidate the cached prefix.
    messages: [
      ...(Array.isArray(history) ? history.slice(-6) : []),
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `CURRENT FILES:\n\n${snapshotBlock}`,
            providerOptions: {
              openrouter: { cacheControl: { type: "ephemeral" } },
            },
          },
          ...(image
            ? [
                {
                  type: "text" as const,
                  text: "VISUAL TARGET (attached image):",
                },
                { type: "image" as const, image },
              ]
            : []),
          {
            type: "text",
            text: `INSTRUCTION: ${instruction}`,
          },
        ],
      },
    ],
    providerOptions: {
      // Top-level auto-caching catches any other stable prefixes (e.g. the
      // system prompt by itself across calls where the snapshot changed).
      openrouter: {
        cache_control: { type: "ephemeral", ttl: "5m" },
      },
    },
    onFinish: ({ usage }) => {
      // Per-call cache visibility for cost tuning. usage shape varies across
      // SDK versions; logging the whole object so any cache_* fields surface.
      console.log("[/api/mutate] usage:", JSON.stringify(usage));
    },
    onError: ({ error }) => {
      console.error("[/api/mutate] streamObject error:", error);
    },
  });

  return result.toTextStreamResponse();
}
