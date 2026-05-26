import { generateObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { observeResponseSchema } from "@/lib/observe-types";

export const runtime = "nodejs";
export const maxDuration = 60;

const OBSERVE_MODEL =
  process.env.OPENROUTER_OBSERVE_MODEL ?? "anthropic/claude-sonnet-4.5";

const SYSTEM_PROMPT = `You watch how a user interacts with a small React app and propose features the app should add to better fit their behavior. The proposals you generate are handed to a downstream code-mutating model — it will only build what your description literally says. Ambiguity in your output produces a wrong feature.

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
- The proposed feature must have EXACTLY ONE reasonable interpretation. If a human reading your proposed_feature could plausibly build two materially different versions of it, REWRITE the description until they cannot — or drop the pattern.

PROPOSED_FEATURE WRITING RULES
Every proposed_feature MUST specify all three:
  1. TRIGGER — the exact user action or app state that activates the feature ("when the user submits a note that…", "when the user opens the app", "after the user pauses for >5s").
  2. BEHAVIOR — what the app does in response, in concrete, testable terms ("pre-fill the input with '(N+1). '", "show a banner with text X", "convert the typed string '[ ]' into a checkbox element"). Avoid vague verbs like "support", "handle", "improve".
  3. OBSERVABLE OUTCOME — what the user will SEE change so they can verify it works ("the input value displays 'N+1. ' immediately after submit", "a new <header> element appears at the top").

If the signal you observed admits multiple readings, pick the LEAST INVASIVE one (the one that adds the smallest visible change) and write the proposed_feature for THAT reading specifically. Never describe a feature in language that could be read as "extend the pattern" OR "automate the pattern" OR "augment with related feature" — pick one explicitly.

GOOD vs BAD proposed_feature examples (for a TODO list app where user typed "TODO:" 5 times):
- BAD:  "Add TODO support to the input"  (vague; could mean autocomplete, conversion, filtering, badges, etc.)
- BAD:  "Convert TODO: prefixes to checkboxes"  (trigger and behavior are clear but observable outcome is missing — does it happen on submit? on type? for existing notes too?)
- GOOD: "When the user submits a note that starts with 'TODO:', strip the 'TODO:' prefix and render that note with a checkbox to its left that toggles a 'done' style on the note text. Newly typed 'TODO:' notes get this treatment on submit; existing non-TODO notes are unchanged."

GOOD vs BAD examples for the numbered-list case (user typed "1. foo", "2. bar", "3. baz"):
- BAD:  "Auto-increment numbered list items"  (does it pre-fill the next input? auto-prefix unrelated notes? convert old notes to numbered? all three?)
- GOOD: "When the user submits a note whose text starts with the pattern '<digit>+. ' (e.g. '1. ', '12. '), parse the leading number N and pre-fill the input field with '(N+1). ' so the user can keep typing the next item without re-typing the number. The observable change is the input value showing '(N+1). ' immediately after submit; nothing else about the app changes."

IMPLEMENTATION_HINT
One sentence on HOW to implement it. Reference concrete file/component when possible (e.g. "in src/components/NoteInput.tsx, after onAdd is called in handleSubmit, regex-match the value and call setValue with the next number"). The downstream model has access to the same code you see — be specific about which file and which handler.

RESPONSE
{
  "patterns": [
    {
      "id": "<random uuid you generate>",
      "observation": "Concrete description of what the user did. Include counts and the exact strings/values where relevant.",
      "signal_strength": <integer count of occurrences>,
      "confidence": <0-1>,
      "proposed_feature": "One paragraph with TRIGGER + BEHAVIOR + OBSERVABLE OUTCOME per the rules above.",
      "complexity": "low" | "medium" | "high",
      "implementation_hint": "One sentence referencing the concrete file/handler to modify."
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
    excludeFeatures?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { events, currentCode, excludeFeatures } = body;
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
    excludeFeatures && excludeFeatures.length > 0
      ? `\n\nALREADY-SHOWN features (user already saw and either skipped or built these — do NOT re-propose anything with the same intent, even if rephrased):\n${excludeFeatures.map((f) => `- ${f}`).join("\n")}`
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
