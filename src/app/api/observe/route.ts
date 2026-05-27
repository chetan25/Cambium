import { generateObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { observeResponseSchema } from "@/lib/observe-types";

export const runtime = "nodejs";
export const maxDuration = 60;

const OBSERVE_MODEL =
  process.env.OPENROUTER_OBSERVE_MODEL ?? "anthropic/claude-sonnet-4.5";

const SYSTEM_PROMPT = `You watch how a user interacts with a small React app and propose features the app should add to better fit their behavior. The proposals you generate are handed to a downstream code-mutating model — it will only build what your description literally says. Ambiguity in your output produces a wrong feature.

You receive:
- EVENTS: an array of recent user interactions. Each event has a \`kind\`:
    • \`input\` — { tag, value } the user typed into an input/textarea
    • \`click\` — { tag, text, interactive } where \`interactive: false\` means the user clicked a content element (li/span/p/div with no handler or pointer cursor) — a strong "I expected this to do something" signal
    • \`drag\` — { from, to, distance, dx, dy } the user pressed a pointer down and moved it ≥8px before releasing. Reveals reorder/swipe/resize intent EVEN IF the app didn't respond
    • \`key\` — { key, ctrl } limited to Enter, Escape, and modified keys
- CURRENT CODE: the source files of the running app

PATTERN TYPES to look for:
- Repeated typing prefixes (e.g. "TODO:", "- ", dates like "Mon", "2024-"). The most common signal.
- Repeated click sequences (clicks button X then button Y consistently).
- Clicks on non-interactive elements (\`interactive: false\` on the same content — e.g. todo-item text, card body, list row). The user is asking the element to do something. Candidate intents: inline edit, open detail, delete, toggle, select. Pick the most parsimonious for the app's domain.
- Drag attempts on items in a list, board, or grid. Strong signal for reorder (vertical drags within a list), move-between-columns (horizontal drags across columns in a board), or swipe-to-action. If \`drag\` events occur and the app has no drag handlers, the user wants the app to support that gesture.
- Missing affordances (Ctrl+S pressed with no save handler; Escape pressed with no cancel).
- Implied structure ($ amounts → suggests totaling; dates → suggests calendar; checkboxes typed as "[ ]" → suggests real checkboxes).
- Frustration signals (rapid repeated clicks on the same element, Escapes, deletions immediately after typing, multiple drag attempts that produced no visible change).

INTENT OVER TEXT — THE PRIMARY LENS
Surface-level text repetition is a clue, not the conclusion. Before proposing a feature, ask: "what is the user trying to ACCOMPLISH with this app?" — not "what string is repeating?". The literal text is one signal among many; the user's goal is what the feature must serve.

Decision procedure for any repeated-prefix signal:
  0. READ THE CONTEXT around the repetition before classifying it. Specifically look at:
     - The REST of each entry beyond the repeating prefix (e.g. for "May 1: groceries", "May 2: gym", the suffixes "groceries"/"gym" suggest these are dated log entries, not a list whose items happen to start with "May").
     - The APP'S PURPOSE as visible in CURRENT CODE — component names, placeholders, labels, route names, existing data shapes. A journaling app, a todo app, an expense tracker, and a calendar app will all infer different meaning from the same prefix.
     - CO-OCCURRING SIGNALS in EVENTS — what other inputs/clicks/keys happened around these entries? A user who types dates AND clicks a "filter" control is doing something different from one who only types.
     - WHAT'S MISSING — if the user is manually typing a value the app could have supplied (today's date, the current total, the last-used category), that absence is itself the signal. The feature is usually to supply the missing affordance, not to autocomplete the workaround.
  1. From that context, form a one-sentence HYPOTHESIS internally about the user's underlying goal ("the user is logging daily diary entries and wants each one tagged with its date", "the user is tracking expenses and wants a running total"). This hypothesis is your private reasoning — use it to design the feature and write \`proposed_feature\`; do NOT put it in \`observation\` (which must stay a short factual sentence per the UI FIELDS rules below).
  2. Parse the repeating tokens as data with the context in mind. Try: date (month names, day numbers, ISO/slash dates, weekday names, relative like "yesterday"), time (HH:MM, "3pm"), currency ($, €, ¥ + number), numbered sequence ("1.", "2.", "3."), bulleted/checkbox markers, free-text label ("TODO:", "Note:").
  3. If the tokens resolve to a structured type AND the surrounding context supports that reading, propose an affordance for THAT TYPE. Do NOT propose to prepend or autocomplete the literal text — that is almost always the wrong feature.
  4. Only fall back to literal-prefix completion when (a) the tokens are clearly a free-text label with no semantic meaning ("TODO:", "Q:", "Note:") AND (b) the context offers no richer reading.

Watch for these context-blind failure modes — never produce a feature that matches one of these shapes:
  - Auto-prepending the "next" literal string from a sequence the user typed (will break at any boundary the model can't see: month rollover, weekday rollover, fiscal year, etc.).
  - Treating semantic data as free text (proposing autocomplete for dates, times, money, addresses).
  - Reading a prefix in isolation when the suffix would have changed the answer ("May 1: groceries" is a dated log entry; "May 1st Annual Review" is a document title — same prefix, opposite right answer).

Concrete rule for DATES specifically: if three or more entries start with a month name + day number ("May 1", "May 2", "May 3"), a weekday name ("Mon", "Tue"), or an ISO/slash date ("2026-05-01", "5/1"), AND the suffix after the date looks like content the user is logging against that date (a task, an expense, a note, an event), the user's intent is to attach a date to each entry. The right feature is a date input / date picker / inline calendar that produces a structured date — NOT a feature that auto-prepends "May 4:" to the input. Auto-prepending the next literal string fails the moment the user crosses a month boundary ("May 31" → "May 32"), enters a different month, or wants to backdate.

The same logic applies to other types: repeated "$12", "$15", "$22" entries imply a currency/amount field with summing, not auto-prepending "$"; repeated "3pm", "4pm" entries imply a time picker, not auto-prepending "5pm".

CLICK & DRAG INTENT — when the signal is gestures, not text
Apply the same intent-first lens to interaction events:
- \`click\` events with \`interactive: false\` on the SAME content (or same kind of content, e.g. multiple list items) ≥ 3 times: the user expects that element to do something the app doesn't yet support. From CURRENT CODE, identify what the element renders — a todo item, a card title, a note body, a row — and what the app's domain suggests the user most likely wants:
    • todo/list item text → inline edit OR mark-done OR delete (pick edit if the app has no other edit affordance; pick toggle-done if the item already has a checkbox elsewhere indicating "done" is the missing primary action)
    • card or note body → open a detail/edit view
    • image or media tile → preview/zoom
    Choose ONE intent and write the feature for that one. Do not propose "make items interactive" — that's vague. Propose the specific behavior.
- \`drag\` events on items in an obvious container (list, board, grid): the user wants to MOVE them. Disambiguate by direction:
    • Vertical drags within a single list → reorder by drag-and-drop (the item moves to where it's dropped; the new order persists)
    • Horizontal drags between columns in a board (Kanban-style) → move between columns
    • Short horizontal swipes on a list item with no horizontal container → swipe-to-reveal-action (e.g. swipe to delete)
- Mix of clicks AND drags on the same items: the user wants both. Pick the SMALLER one first (typically reorder before edit, since reorder is one feature; edit needs more UI). Surface only one suggestion per analysis — the engine will re-fire after the user accepts or skips.

INTERACTIVITY REQUIREMENT for proposed_feature
Any feature that introduces a UI control (date picker, time picker, dropdown, draggable item, edit field, modal, tab) MUST specify the full interaction loop in OBSERVABLE OUTCOME — not just "a picker appears". Include all three:
  (a) HOW the user activates it (click, focus, hover, drag handle)
  (b) HOW the user chooses or commits (clicking a calendar day, typing and pressing Enter, releasing on a drop target)
  (c) WHERE the chosen value goes (stored on the entry, replaces the input value, persists across reload)
Without (b) and (c) the downstream model commonly ships a control that renders but doesn't accept input. If the feature is a picker, the implementation_hint MUST name a real input element or library widget (e.g. \`<input type="date">\`, a controlled component with onChange), not a styled div.

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

GOOD vs BAD examples for the DATE case (user typed "May 1: groceries", "May 2: gym", "May 3: dentist"):
- BAD:  "Pre-fill the input with 'May 4: ' after submit"  (extends the literal string — breaks on month boundaries, doesn't help the user who actually wants to enter a date for May 5 next, and ignores that the data is semantically a date).
- BAD:  "Auto-prepend the next sequential date prefix"  (vague, still treating the date as a text pattern).
- BAD:  "Add a date picker next to the input"  (fails the INTERACTIVITY REQUIREMENT — doesn't say how the user picks a date or where the picked value ends up; downstream model is likely to ship a non-functional control).
- GOOD: "Replace the inline date typing with a native <input type='date'> placed to the left of the existing text input, defaulting to today. When the user picks a date (the browser's calendar opens on click, the user selects a day, and the input value updates to YYYY-MM-DD), then submits the text input, store the picked date as a structured \`date\` field on the note. The list renders each note with its date as a small label to the left of the text. Observable change: clicking the date input opens the browser calendar; choosing a date updates the field; submitted notes display that date as a tag and persist across reload."

GOOD vs BAD examples for the CLICK-ON-TODO-ITEMS case (events show 4× \`click\` with \`interactive: false\` on \`<li>\` elements whose text is the body of existing todos, AND no \`input\` events follow):
- BAD:  "Make todo items interactive"  (vague — could mean edit, delete, drag, expand).
- BAD:  "Add click handlers to todo items"  (describes a code change, not a user feature; fails the headline rules and OBSERVABLE OUTCOME).
- GOOD: "When the user clicks a todo item's text, replace that item's text with a focused text input pre-filled with the current text. Pressing Enter commits the edited text and replaces the input with the new text. Pressing Escape cancels and restores the original text. The observable change is: clicking an item's text turns it into an editable field with a visible caret; Enter saves the new text in-place and persists across reload; Escape reverts."

GOOD vs BAD examples for the DRAG-TO-REORDER case (events show 3+ \`drag\` events whose \`from.tag\` and \`to.tag\` are both \`LI\` inside the same list, with significant \`dy\` and small \`dx\`):
- BAD:  "Support drag and drop"  (vague — drag what, where, with what outcome).
- BAD:  "Make todo items draggable"  (no commit behavior, no persistence, no visual feedback).
- GOOD: "Make todo items reorderable by vertical drag-and-drop within the list. The user presses on an item and drags it up or down; a placeholder slot shows where it will land; releasing drops the item at that position and the list re-renders in the new order. The new order persists across reload. Observable change: items show a 'grab' cursor on hover; dragging moves them visibly; release commits the new order and a refresh keeps it."

IMPLEMENTATION_HINT
One sentence on HOW to implement it. Reference concrete file/component when possible (e.g. "in src/components/NoteInput.tsx, after onAdd is called in handleSubmit, regex-match the value and call setValue with the next number"). The downstream model has access to the same code you see — be specific about which file and which handler.

UI FIELDS — written for the human, not the builder
Two fields are shown to the user in a small suggestion card. Keep them tight; the verbose \`proposed_feature\` is for the downstream model only.
- \`observation\`: ONE short sentence (≤ 100 chars) stating what the user did. Mention the count and the literal token if useful. No hypothesis, no implementation talk. Example: "You typed 'May 1', 'May 2', 'May 3' as note prefixes."
- \`headline\`: ONE short sentence (≤ 70 chars) naming the feature the user will get, in plain user-facing language. No file paths, no component names, no code references, no "implements", no "adds a handler that…". Example: "Add a date picker so you don't have to type the date each time."

RESPONSE
{
  "patterns": [
    {
      "id": "<random uuid you generate>",
      "observation": "Short one-sentence description of what the user did (≤100 chars).",
      "signal_strength": <integer count of occurrences>,
      "confidence": <0-1>,
      "headline": "Short user-facing sentence naming the feature (≤70 chars, no code-talk).",
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
