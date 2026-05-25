import { generateObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { observeResponseSchema } from "@/lib/observe-types";

export const runtime = "nodejs";
export const maxDuration = 60;

const OBSERVE_MODEL =
  process.env.OPENROUTER_OBSERVE_MODEL ?? "anthropic/claude-sonnet-4.5";

const SYSTEM_PROMPT = `You watch how a user interacts with a small React app and propose features the app should add to better fit their behavior.

You receive:
- EVENTS: an array of recent user interactions (input typing, clicks, keypresses)
- CURRENT CODE: the source files of the running app

PATTERN TYPES to look for:
- Repeated typing prefixes (e.g. "TODO:", "- ", dates like "Mon", "2024-"). The most common signal.
- Repeated click sequences (clicks button X then button Y consistently)
- Missing affordances (Ctrl+S pressed with no save handler; Escape pressed with no cancel)
- Implied structure ($ amounts → suggests totaling; dates → suggests calendar; checkboxes typed as "[ ]" → suggests real checkboxes)
- Frustration signals (rapid repeated clicks, Escapes, deletions immediately after typing)

REQUIREMENTS BEFORE SURFACING A PATTERN
- The behavior must appear 3+ times in the events
- Your confidence must be ≥ 0.70
- The proposed feature must be SMALL (one self-contained change, not a redesign)
- The proposed feature must NOT contradict the existing app's purpose

RESPONSE
{
  "patterns": [
    {
      "id": "<random uuid you generate>",
      "observation": "Concrete description of what the user did. Include counts.",
      "signal_strength": <integer count of occurrences>,
      "confidence": <0-1>,
      "proposed_feature": "One sentence describing the feature to add.",
      "complexity": "low" | "medium" | "high",
      "implementation_hint": "One sentence on how to implement it, referencing concrete file/component if useful."
    }
  ]
}

If no patterns meet the bar, return { "patterns": [] }. Never invent a pattern from thin air.
Return ONLY the JSON object. No prose, no markdown fences.`;

export async function POST(req: Request) {
  if (!process.env.OPEN_ROUTER_API_KEY) {
    return Response.json(
      { error: "OPEN_ROUTER_API_KEY is not set in .env.local" },
      { status: 500 },
    );
  }

  let body: {
    events: unknown[];
    currentCode: Record<string, string>;
    excludeIds?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { events, currentCode, excludeIds } = body;
  if (!Array.isArray(events)) {
    return Response.json({ error: "events must be an array" }, { status: 400 });
  }
  if (events.length === 0) {
    return Response.json({ patterns: [] });
  }
  if (!currentCode || typeof currentCode !== "object") {
    return Response.json(
      { error: "currentCode is required" },
      { status: 400 },
    );
  }

  const codeBlock = Object.entries(currentCode)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join("\n\n");

  const recentEvents = events.slice(-100);
  const excludeNote =
    excludeIds && excludeIds.length > 0
      ? `\n\nALREADY-PROPOSED feature ids (do NOT re-propose anything with the same intent): ${excludeIds.join(", ")}`
      : "";

  const openrouter = createOpenRouter({
    apiKey: process.env.OPEN_ROUTER_API_KEY,
  });

  try {
    const result = await generateObject({
      model: openrouter(OBSERVE_MODEL),
      schema: observeResponseSchema,
      schemaName: "ObservationResult",
      schemaDescription: "Patterns inferred from recent user events.",
      system: SYSTEM_PROMPT,
      // Cache breakpoint on the code block. The code is the largest stable
      // chunk between observe calls within a single mutation cycle.
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `CURRENT CODE:\n${codeBlock}`,
              providerOptions: {
                openrouter: { cacheControl: { type: "ephemeral" } },
              },
            },
            {
              type: "text",
              text: `EVENTS (most recent ${recentEvents.length}):\n${JSON.stringify(recentEvents, null, 2)}${excludeNote}`,
            },
          ],
        },
      ],
      providerOptions: {
        openrouter: {
          cache_control: { type: "ephemeral", ttl: "5m" },
        },
      },
    });

    console.log(
      "[/api/observe] usage:",
      JSON.stringify(result.usage),
    );

    return Response.json(result.object);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: message }, { status: 500 });
  }
}
