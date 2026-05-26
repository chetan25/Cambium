import type { WebContainer } from "@webcontainer/api";

const IGNORE_DIRS = new Set(["node_modules", "dist", ".vite", "build"]);

export interface ApplyBlocksResult {
  ok: boolean;
  failed: number[];
}

export interface SearchReplaceBlock {
  search: string;
  replace: string;
}

export class FileSystemManager {
  private checkpoints = new Map<string, Record<string, string>>();

  constructor(private container: WebContainer) {}

  async readFile(path: string): Promise<string> {
    return await this.container.fs.readFile(path, "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.container.fs.writeFile(path, content);
  }

  // Walks a directory tree, skipping noisy artifacts. Used by Claude before
  // every mutation: snapshot is the ground truth fed into the prompt.
  async getAppSnapshot(root = "src"): Promise<Record<string, string>> {
    const snapshot: Record<string, string> = {};

    const walk = async (dir: string) => {
      const entries = (await this.container.fs.readdir(dir, {
        withFileTypes: true,
      })) as Array<{ name: string; isDirectory: () => boolean }>;

      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        const fullPath = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          snapshot[fullPath] = await this.readFile(fullPath);
        }
      }
    };

    await walk(root);
    return snapshot;
  }

  async checkpoint(id: string): Promise<void> {
    this.checkpoints.set(id, await this.getAppSnapshot());
  }

  async restore(id: string): Promise<void> {
    const snapshot = this.checkpoints.get(id);
    if (!snapshot) throw new Error(`No checkpoint with id ${id}`);
    for (const [path, content] of Object.entries(snapshot)) {
      await this.container.fs.writeFile(path, content);
    }
  }

  clearCheckpoint(id: string): void {
    this.checkpoints.delete(id);
  }

  // Exact-string find-and-replace, per block, in a single file. Returns the
  // indices of any blocks whose SEARCH did not match. Per-file atomic: if
  // any block fails to match, we leave the file untouched so the next
  // propose sees a clean state rather than a partially-rewritten file.
  async applyBlocks(
    path: string,
    blocks: SearchReplaceBlock[],
  ): Promise<ApplyBlocksResult> {
    const original = await this.readFile(path);
    let content = original;
    const failed: number[] = [];

    blocks.forEach((block, index) => {
      if (content.includes(block.search)) {
        // String.prototype.replace interprets $$, $&, $`, $', and $N in the
        // replacement string as special tokens even when the pattern is a
        // plain string. The LLM doesn't know to escape these, so currency
        // (`$50`) and any regex-like text get silently corrupted. Escape
        // every $ in the replacement so the literal text is preserved.
        content = content.replace(block.search, escapeReplacement(block.replace));
      } else {
        failed.push(index);
      }
    });

    if (failed.length === 0) {
      await this.container.fs.writeFile(path, content);
    }
    return { ok: failed.length === 0, failed };
  }

  async createFile(path: string, content: string): Promise<void> {
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) {
      try {
        await this.container.fs.mkdir(dir, { recursive: true });
      } catch {
        // mkdir throws if the directory already exists; safe to ignore.
      }
    }
    await this.container.fs.writeFile(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    await this.container.fs.rm(path);
  }

  // Overwrites every file in `src/` with the given snapshot, then deletes
  // any files in the current tree that aren't in the snapshot. Used to
  // restore a historical version of the app.
  async overwriteSrc(files: Record<string, string>): Promise<void> {

    const current = await this.getAppSnapshot();
    const incoming = new Set(Object.keys(files));

    for (const [path, content] of Object.entries(files)) {
      await this.createFile(path, content);
    }

    for (const path of Object.keys(current)) {
      if (!incoming.has(path)) {
        try {
          await this.deleteFile(path);
        } catch {
          // best-effort cleanup
        }
      }
    }
  }
}

// Doubles every "$" in the replacement string. JS's String.prototype.replace
// interprets $$, $&, $`, $', and $N as special tokens — even when the search
// pattern is a plain string. Doubling each $ unescapes back to a single $
// after replace runs, so the literal text is preserved.
function escapeReplacement(replace: string): string {
  return replace.replace(/\$/g, "$$$$");
}
