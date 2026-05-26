import { WebContainer } from "@webcontainer/api";
import { seedFiles, snapshotToFileTree } from "./webcontainer/seed-files";
import { SessionStore } from "./SessionStore";

export type WCStatus =
  | "idle"
  | "booting"
  | "mounting"
  | "installing"
  | "starting"
  | "ready"
  | "error";

export class WebContainerHost {
  // WebContainer enforces one instance per browser tab. Module-level flag
  // surfaces the constraint as a clear error instead of an opaque API failure.
  private static booted = false;

  container: WebContainer | null = null;
  status: WCStatus = "idle";
  url: string | null = null;
  resumedFromSnapshot = false;

  onStatus?: (status: WCStatus) => void;
  onUrl?: (url: string) => void;
  onLog?: (chunk: string) => void;

  private setStatus(status: WCStatus) {
    this.status = status;
    this.onStatus?.(status);
  }

  private writer() {
    return new WritableStream<string>({
      write: (chunk) => this.onLog?.(chunk),
    });
  }

  async start(): Promise<WebContainer> {
    if (WebContainerHost.booted) {
      throw new Error(
        "WebContainer already booted in this tab. Reload to start fresh.",
      );
    }
    WebContainerHost.booted = true;

    try {
      this.setStatus("booting");
      this.container = await WebContainer.boot({ coep: "credentialless" });

      this.container.on("server-ready", (_port, url) => {
        this.url = url;
        this.setStatus("ready");
        this.onUrl?.(url);
      });

      this.setStatus("mounting");
      // Resume from a saved snapshot if one exists; otherwise mount the seed.
      const saved = await SessionStore.loadLatestSnapshot();
      if (saved) {
        await this.container.mount(snapshotToFileTree(saved.files));
        this.resumedFromSnapshot = true;
      } else {
        await this.container.mount(seedFiles);
      }

      this.setStatus("installing");
      // Preflight: a resumed snapshot may import packages the seed's
      // package.json doesn't know about (e.g. framer-motion added in a
      // prior session). Detect and include them in the first install so
      // Vite never sees a missing-import error.
      const missingDeps = await this.detectMissingDeps();
      const installArgs =
        missingDeps.length > 0 ? ["install", ...missingDeps] : ["install"];
      const install = await this.container.spawn("npm", installArgs);
      install.output.pipeTo(this.writer());
      const code = await install.exit;
      if (code !== 0) {
        throw new Error(`npm install failed (exit ${code})`);
      }

      this.setStatus("starting");
      const dev = await this.container.spawn("npm", ["run", "dev"]);
      dev.output.pipeTo(this.writer());
      // Status flips to 'ready' from the server-ready event above.

      return this.container;
    } catch (error) {
      this.setStatus("error");
      // Allow a fresh boot attempt after explicit failure (e.g. retry button).
      WebContainerHost.booted = false;
      throw error;
    }
  }

  async resetToSeed(): Promise<void> {
    await SessionStore.clearSnapshot();
  }

  // Runs `npm install <package>` inside the WebContainer. Output streams to
  // the same log sink as boot-time install. Used by the RuntimeErrorWatcher
  // to auto-resolve missing-import errors.
  async installPackage(packageName: string): Promise<void> {
    if (!this.container) throw new Error("WebContainer not booted");
    const proc = await this.container.spawn("npm", ["install", packageName]);
    proc.output.pipeTo(this.writer());
    const code = await proc.exit;
    if (code !== 0) {
      throw new Error(`npm install ${packageName} failed (exit ${code})`);
    }
  }

  // Re-writes a file with its current contents to nudge Vite's file watcher.
  // Needed after auto-install: WC's in-memory fs doesn't emit watcher events
  // for node_modules changes, so Vite keeps the cached failed-resolution
  // until the importing file itself changes.
  async touchFile(path: string): Promise<void> {
    if (!this.container) throw new Error("WebContainer not booted");
    const content = await this.container.fs.readFile(path, "utf-8");
    await this.container.fs.writeFile(path, content);
  }

  // Scans src/ for bare imports/requires that aren't declared in the
  // mounted package.json. Returns the package names so the caller can
  // include them in the boot-time install and avoid Vite's missing-import
  // error overlay.
  private async detectMissingDeps(): Promise<string[]> {
    if (!this.container) return [];

    let pkgRaw: string;
    try {
      pkgRaw = await this.container.fs.readFile("package.json", "utf-8");
    } catch {
      return [];
    }

    let known: Set<string>;
    try {
      const pkg = JSON.parse(pkgRaw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      known = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
      ]);
    } catch {
      return [];
    }

    const SOURCE_EXT = /\.(?:t|j)sx?$/;
    const IGNORE = new Set(["node_modules", "dist", ".vite", "build"]);
    const IMPORT_RE =
      /(?:import\s+(?:[\w*${}\s,]+\s+from\s+)?|require\s*\(\s*)["']([^"']+)["']/g;

    const found = new Set<string>();
    const walk = async (dir: string) => {
      let entries: Array<{ name: string; isDirectory: () => boolean }>;
      try {
        entries = (await this.container!.fs.readdir(dir, {
          withFileTypes: true,
        })) as typeof entries;
      } catch {
        return;
      }
      for (const e of entries) {
        if (IGNORE.has(e.name)) continue;
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          await walk(p);
        } else if (SOURCE_EXT.test(e.name)) {
          let content: string;
          try {
            content = await this.container!.fs.readFile(p, "utf-8");
          } catch {
            continue;
          }
          for (const m of content.matchAll(IMPORT_RE)) {
            const spec = m[1];
            if (spec.startsWith(".") || spec.startsWith("/")) continue;
            const pkg = parsePackageName(spec);
            if (pkg && !known.has(pkg)) found.add(pkg);
          }
        }
      }
    };

    await walk("src");
    return [...found];
  }
}

// "lodash/debounce" -> "lodash"
// "@radix-ui/react-dialog" -> "@radix-ui/react-dialog"
// "@scope/pkg/sub" -> "@scope/pkg"
function parsePackageName(spec: string): string | null {
  const parts = spec.split("/");
  if (spec.startsWith("@")) {
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0] || null;
}
