import { parsePartialJson } from "ai";
import type { FileSystemManager } from "./FileSystemManager";
import type { ProposedMutations } from "./mutation-types";
import { SessionStore } from "./SessionStore";

const MAX_HISTORY_TURNS = 12; // 6 user + 6 assistant

export interface PendingMutation {
  id: string;
  instruction: string;
  parsed: ProposedMutations;
  snapshot: Record<string, string>;
}

export interface ApplyResult {
  ok: boolean;
  failures: { path: string; reason: string }[];
  appliedCount: number;
}

export type HistoryEntry = { role: "user" | "assistant"; content: string };

export class MutationOrchestrator {
  private history: HistoryEntry[] = [];

  constructor(private fs: FileSystemManager) {}

  // Streams a mutation plan from the API. Does NOT touch the filesystem.
  // onPartial fires whenever the accumulating buffer reaches a parseable
  // (possibly incomplete) JSON object — drives the live diff preview.
  async propose(
    instruction: string,
    onPartial?: (partial: Partial<ProposedMutations>) => void,
  ): Promise<PendingMutation> {
    const snapshot = await this.fs.getAppSnapshot();
    const id = crypto.randomUUID();

    const res = await fetch("/api/mutate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction, snapshot, history: this.history }),
    });

    if (!res.ok) {
      let message = `/api/mutate HTTP ${res.status}`;
      try {
        const err = (await res.json()) as { error?: string };
        if (err?.error) message = err.error;
      } catch {
        // body wasn't JSON; keep the status-only message
      }
      throw new Error(message);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("/api/mutate returned no body");
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (onPartial) {
        const result = parsePartialJson(buffer);
        if (
          result.state === "successful-parse" ||
          result.state === "repaired-parse"
        ) {
          onPartial(result.value as Partial<ProposedMutations>);
        }
      }
    }

    let parsed: ProposedMutations;
    try {
      parsed = JSON.parse(buffer) as ProposedMutations;
    } catch (e) {
      throw new Error(
        `Could not parse final mutation response: ${(e as Error).message}`,
      );
    }

    return { id, instruction, parsed, snapshot };
  }

  // Checkpoints the FS, applies every mutation, returns per-file failures.
  // If every mutation fails, rolls back. On any success, persists a new
  // snapshot to IndexedDB and logs the mutation.
  async apply(pending: PendingMutation): Promise<ApplyResult> {
    await this.fs.checkpoint(pending.id);
    const failures: ApplyResult["failures"] = [];
    let appliedCount = 0;

    for (const m of pending.parsed.mutations) {
      try {
        if (m.type === "edit") {
          if (!m.blocks?.length) {
            failures.push({ path: m.path, reason: "edit with no blocks" });
            continue;
          }
          const result = await this.fs.applyBlocks(m.path, m.blocks);
          if (result.ok) {
            appliedCount++;
          } else {
            failures.push({
              path: m.path,
              reason: `blocks did not match: [${result.failed.join(", ")}]`,
            });
          }
        } else if (m.type === "create") {
          if (m.content === undefined) {
            failures.push({ path: m.path, reason: "create with no content" });
            continue;
          }
          await this.fs.createFile(m.path, m.content);
          appliedCount++;
        } else if (m.type === "delete") {
          await this.fs.deleteFile(m.path);
          appliedCount++;
        }
      } catch (e) {
        failures.push({
          path: m.path,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (appliedCount === 0 && pending.parsed.mutations.length > 0) {
      await this.fs.restore(pending.id);
      return { ok: false, failures, appliedCount };
    }

    // Persist the new state so it survives a refresh.
    try {
      const files = await this.fs.getAppSnapshot();
      await SessionStore.saveSnapshot(files, pending.parsed.summary);
      await SessionStore.logMutation({
        id: pending.id,
        instruction: pending.instruction,
        summary: pending.parsed.summary,
        appliedAt: Date.now(),
        failures: failures.length,
      });
    } catch (e) {
      // Persistence failure should not block the UI mutation. Log only.
      console.warn("[Orchestrator] snapshot persistence failed:", e);
    }

    this.history.push(
      { role: "user", content: pending.instruction },
      { role: "assistant", content: pending.parsed.summary },
    );
    if (this.history.length > MAX_HISTORY_TURNS) {
      this.history = this.history.slice(-MAX_HISTORY_TURNS);
    }

    return { ok: failures.length === 0, failures, appliedCount };
  }

  async rollback(id: string): Promise<void> {
    await this.fs.restore(id);
  }

  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }
}
