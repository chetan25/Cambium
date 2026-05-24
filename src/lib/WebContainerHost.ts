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
      const install = await this.container.spawn("npm", ["install"]);
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
}
