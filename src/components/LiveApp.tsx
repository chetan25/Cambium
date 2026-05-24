"use client";

import { Terminal as TerminalIcon } from "@phosphor-icons/react/dist/ssr/Terminal";
import { useAppStore } from "@/store/appStore";

const PROGRESS_MESSAGE: Record<string, string> = {
  idle: "Click Boot to start the WebContainer.",
  booting: "Booting WebContainer runtime",
  mounting: "Mounting source files",
  installing: "Installing dependencies inside the WebContainer",
  starting: "Starting Vite dev server",
  error: "WebContainer failed to start.",
};

export function LiveApp() {
  const url = useAppStore((s) => s.wcUrl);
  const status = useAppStore((s) => s.wcStatus);
  const log = useAppStore((s) => s.terminalLog);

  const isProgressing =
    status !== "idle" && status !== "ready" && status !== "error";

  return (
    <div className="grid h-full grid-rows-[1fr_auto] border-l border-zinc-200 bg-zinc-50">
      <div className="relative overflow-hidden bg-white">
        {url ? (
          <iframe
            src={url}
            className="h-full w-full border-0"
            allow="cross-origin-isolated"
            title="Living App preview"
          />
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="space-y-3">
              <div className="text-[13px] font-medium tracking-tight text-zinc-700">
                {PROGRESS_MESSAGE[status] ?? PROGRESS_MESSAGE.idle}
              </div>
              {isProgressing && (
                <>
                  <ProgressTrack />
                  <div className="font-mono text-[10.5px] tracking-tight text-zinc-400">
                    First boot takes 30–90s — npm install runs inside the WC
                  </div>
                </>
              )}
              {status === "error" && (
                <div className="text-[11.5px] text-red-600">
                  Check the terminal drawer below for details.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <details className="border-t border-zinc-200 bg-zinc-950 text-zinc-100">
        <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-[11px] text-zinc-400 hover:text-zinc-200">
          <TerminalIcon size={12} weight="regular" />
          <span className="font-medium tracking-tight">Terminal</span>
          {log.length > 0 && (
            <span className="font-mono text-[10px] text-zinc-500">
              {log.length.toLocaleString()} chars
            </span>
          )}
        </summary>
        <pre className="scrollbar-thin max-h-48 overflow-auto whitespace-pre-wrap break-all px-3 pb-2 font-mono text-[11px] leading-relaxed">
          {log || (
            <span className="text-zinc-500">waiting for output</span>
          )}
        </pre>
      </details>
    </div>
  );
}

// Skeletal progress indicator with a shimmer — replaces a generic spinner.
function ProgressTrack() {
  return (
    <div className="mx-auto h-1 w-40 overflow-hidden rounded-full bg-zinc-100">
      <div className="shimmer h-full w-full bg-zinc-200" />
    </div>
  );
}
