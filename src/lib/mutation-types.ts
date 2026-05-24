import { z } from "zod";

export const blockSchema = z.object({
  search: z.string(),
  replace: z.string(),
});

export const mutationItemSchema = z.object({
  path: z.string(),
  type: z.enum(["edit", "create", "delete"]),
  blocks: z.array(blockSchema).optional(),
  content: z.string().optional(),
});

export const mutationSchema = z.object({
  mutations: z.array(mutationItemSchema),
  summary: z.string(),
  hotReloadable: z.boolean(),
});

export type Block = z.infer<typeof blockSchema>;
export type MutationItem = z.infer<typeof mutationItemSchema>;
export type ProposedMutations = z.infer<typeof mutationSchema>;
