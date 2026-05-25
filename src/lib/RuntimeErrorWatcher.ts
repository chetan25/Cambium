// Vite emits errors like:
//   [plugin:vite:import-analysis] Failed to resolve import "framer-motion" from "src/App.tsx"
//   Pre-transform error: Failed to resolve import "lucide-react" from "src/...
// We scan the dev-server output stream for these and emit one event per
// distinct missing package so the host can auto-install it.
const MISSING_IMPORT_RE = /Failed to resolve import ["']([^"']+)["']/g;

export interface MissingPackageEvent {
  packageName: string;
  rawImport: string;
}

export class RuntimeErrorWatcher {
  private buffer = "";
  private seen = new Set<string>();

  onMissingPackage?: (event: MissingPackageEvent) => void;

  feed(chunk: string): void {
    // Keep the buffer bounded so we don't accumulate megabytes of logs.
    this.buffer = (this.buffer + chunk).slice(-16_000);
    for (const match of this.buffer.matchAll(MISSING_IMPORT_RE)) {
      const rawImport = match[1];
      // Relative or absolute paths are file-not-found errors, not missing
      // packages. Those require a code mutation, not an npm install.
      if (rawImport.startsWith(".") || rawImport.startsWith("/")) continue;
      const packageName = this.parsePackageName(rawImport);
      if (!packageName) continue;
      if (this.seen.has(packageName)) continue;
      this.seen.add(packageName);
      this.onMissingPackage?.({ packageName, rawImport });
    }
  }

  // "lodash/debounce" -> "lodash"
  // "@radix-ui/react-dialog" -> "@radix-ui/react-dialog"
  // "@scope/pkg/deep/path" -> "@scope/pkg"
  private parsePackageName(spec: string): string | null {
    const parts = spec.split("/");
    if (spec.startsWith("@")) {
      if (parts.length < 2) return null;
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0] || null;
  }

  reset(): void {
    this.buffer = "";
    this.seen.clear();
  }

  // For console-debug introspection.
  getSeen(): string[] {
    return [...this.seen];
  }
}
