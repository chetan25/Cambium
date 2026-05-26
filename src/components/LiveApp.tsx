"use client";

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

  const isProgressing =
    status !== "idle" && status !== "ready" && status !== "error";

  return (
    <div className="grid h-full grid-rows-[1fr] border-l border-zinc-200 bg-zinc-50">
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
                  WebContainer failed to start. Check the browser console for details.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
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
