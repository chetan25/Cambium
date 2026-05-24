import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "living-app";
const DB_VERSION = 1;

export interface CodeSnapshot {
  id: string;
  files: Record<string, string>;
  summary: string;
  createdAt: number;
}

export interface MutationLogEntry {
  id: string;
  instruction: string;
  summary: string;
  appliedAt: number;
  failures: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("code_snapshots", { keyPath: "id" });
        db.createObjectStore("app_state");
        const log = db.createObjectStore("mutation_log", { keyPath: "id" });
        log.createIndex("by_applied_at", "appliedAt");
        // Reserved for Phase 2.
        const events = db.createObjectStore("events", {
          keyPath: "id",
          autoIncrement: true,
        });
        events.createIndex("by_t", "t");
        db.createObjectStore("patterns", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

export const SessionStore = {
  async loadLatestSnapshot(): Promise<CodeSnapshot | undefined> {
    const db = await getDB();
    return (await db.get("code_snapshots", "current")) as
      | CodeSnapshot
      | undefined;
  },

  async saveSnapshot(
    files: Record<string, string>,
    summary: string,
  ): Promise<void> {
    const db = await getDB();
    const now = Date.now();
    const snapshot: CodeSnapshot = {
      id: "current",
      files,
      summary,
      createdAt: now,
    };
    await db.put("code_snapshots", snapshot);
    await db.put("code_snapshots", { ...snapshot, id: `snap_${now}` });
  },

  async clearSnapshot(): Promise<void> {
    const db = await getDB();
    await db.delete("code_snapshots", "current");
  },

  async listSnapshots(): Promise<CodeSnapshot[]> {
    const db = await getDB();
    const all = (await db.getAll("code_snapshots")) as CodeSnapshot[];
    return all
      .filter((s) => s.id !== "current")
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  async getState<T>(key: string): Promise<T | undefined> {
    const db = await getDB();
    return (await db.get("app_state", key)) as T | undefined;
  },

  async setState(key: string, value: unknown): Promise<void> {
    const db = await getDB();
    await db.put("app_state", value, key);
  },

  async logMutation(entry: MutationLogEntry): Promise<void> {
    const db = await getDB();
    await db.put("mutation_log", entry);
  },

  async getMutationLog(): Promise<MutationLogEntry[]> {
    const db = await getDB();
    const all = (await db.getAll("mutation_log")) as MutationLogEntry[];
    return all.sort((a, b) => a.appliedAt - b.appliedAt);
  },

  async clearAll(): Promise<void> {
    const db = await getDB();
    await db.clear("code_snapshots");
    await db.clear("app_state");
    await db.clear("mutation_log");
    await db.clear("events");
    await db.clear("patterns");
  },

  // --- Phase 2 helpers ---------------------------------------------------

  async appendEvents(events: unknown[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("events", "readwrite");
    for (const e of events) await tx.store.add(e);
    await tx.done;
  },

  async getRecentEvents(limit = 100): Promise<unknown[]> {
    const db = await getDB();
    const idx = db.transaction("events").store.index("by_t");
    const all: unknown[] = [];
    let cursor = await idx.openCursor(null, "prev");
    while (cursor && all.length < limit) {
      all.push(cursor.value);
      cursor = await cursor.continue();
    }
    return all.reverse();
  },

  async purgeEventsOlderThan(cutoffMs: number): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("events", "readwrite");
    const idx = tx.store.index("by_t");
    let cursor = await idx.openCursor(IDBKeyRange.upperBound(cutoffMs));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  },
};

