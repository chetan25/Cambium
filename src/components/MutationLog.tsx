"use client";

import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Warning } from "@phosphor-icons/react/dist/ssr/Warning";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/ssr/ClockCounterClockwise";
import { useAppStore } from "@/store/appStore";
import type { MutationLogEntry } from "@/lib/SessionStore";

interface Props {
  onRestore?: (entry: MutationLogEntry) => void;
}

export function MutationLog({ onRestore }: Props) {
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
        .map((entry, idx) => {
          const failed = entry.failures > 0;
          const restorable = !!entry.snapshotId && !!onRestore;
          const isLatest = idx === 0; // already reversed
          return (
            <li
              key={entry.id}
              className="group flex items-start gap-2.5 py-2 first:pt-0 last:pb-0"
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
                <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-400">
                  <span>{relativeTime(entry.appliedAt)}</span>
                  {isLatest && (
                    <span className="rounded-sm bg-zinc-100 px-1 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                      current
                    </span>
                  )}
                </div>
              </div>
              {restorable && !isLatest && (
                <button
                  type="button"
                  onClick={() => onRestore!(entry)}
                  aria-label={`Restore version "${entry.summary}"`}
                  className="invisible inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.97] group-hover:visible"
                >
                  <ClockCounterClockwise size={11} weight="bold" />
                  Restore
                </button>
              )}
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
