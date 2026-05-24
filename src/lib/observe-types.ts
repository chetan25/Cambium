import { z } from "zod";

// Anthropic's structured output rejects min/max bounds on number types — the
// schema goes through the Vercel SDK to OpenRouter to Anthropic, and Anthropic
// emits: "output_config.format.schema: For 'integer' type, properties maximum,
// minimum are not supported". Bounds are described in the system prompt instead.
export const patternSchema = z.object({
  id: z.string(),
  observation: z.string(),
  signal_strength: z.number(),
  confidence: z.number(),
  proposed_feature: z.string(),
  complexity: z.enum(["low", "medium", "high"]),
  implementation_hint: z.string(),
});

export const observeResponseSchema = z.object({
  patterns: z.array(patternSchema),
});

export type Pattern = z.infer<typeof patternSchema>;
export type ObserveResponse = z.infer<typeof observeResponseSchema>;
