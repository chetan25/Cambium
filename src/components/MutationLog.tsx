"use client";

import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Warning } from "@phosphor-icons/react/dist/ssr/Warning";
import { useAppStore } from "@/store/appStore";

export function MutationLog() {
  const entries = useAppStore((s) => s.mutationLog);

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400">
        No mutations applied yet.
      </div>
    );
  }

  return (
    <ol className="divide-y divide-zinc-100">
      {entries
        .slice()
        .reverse()
        .map((entry) => {
          const failed = entry.failures > 0;
          return (
            <li
              key={entry.id}
              className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0"
            >
              <span
                className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ${
                  failed
                    ? "bg-amber-50 text-amber-600"
                    : "bg-emerald-50 text-emerald-600"
                }`}
                aria-hidden
              >
                {failed ? (
                  <Warning size={10} weight="bold" />
                ) : (
                  <Check size={10} weight="bold" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-zinc-800">
                  {entry.summary}
                </div>
                <div className="font-mono text-[10px] text-zinc-400">
                  {relativeTime(entry.appliedAt)}
                </div>
              </div>
            </li>
          );
        })}
    </ol>
  );
}

function relativeTime(t: number): string {
  const diff = Math.max(0, Date.now() - t);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(t).toLocaleString();
}
