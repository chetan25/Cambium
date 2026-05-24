"use client";

import { PencilSimpleLine } from "@phosphor-icons/react/dist/ssr/PencilSimpleLine";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { useAppStore } from "@/store/appStore";
import type { MutationItem } from "@/lib/mutation-types";

interface Props {
  onApply: () => void;
  onReject: () => void;
  applying: boolean;
}

export function DiffPreview({ onApply, onReject, applying }: Props) {
  const partial = useAppStore((s) => s.partialMutation);
  const pending = useAppStore((s) => s.pendingMutation);
  const isStreaming = useAppStore((s) => s.isStreaming);

  const source = pending?.parsed ?? partial;
  if (!source) return null;

  const mutations = (source.mutations ?? []) as Partial<MutationItem>[];

  return (
    <div className="fade-up space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_24px_48px_-24px_rgba(24,24,27,0.10)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
            {isStreaming ? (
              <>
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                Generating
              </>
            ) : (
              "Proposed change"
            )}
          </div>
          {source.summary && (
            <div className="mt-1 truncate text-[13.5px] font-medium tracking-tight text-zinc-900">
              {source.summary}
            </div>
          )}
        </div>
        {source.hotReloadable === false && (
          <div className="shrink-0 rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700">
            full reload
          </div>
        )}
      </div>

      <div className="scrollbar-thin max-h-72 space-y-2 overflow-auto">
        {mutations.map((m, idx) => {
          if (!m?.path) return null;
          return (
            <div
              key={idx}
              className="overflow-hidden rounded-lg border border-zinc-100"
            >
              <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/60 px-2.5 py-1.5">
                <TypeBadge type={m.type} />
                <span className="truncate font-mono text-[11px] text-zinc-600">
                  {m.path}
                </span>
              </div>
              {m.type === "edit" && Array.isArray(m.blocks) && (
                <div className="space-y-1.5 p-2">
                  {m.blocks.map((b, i) => (
                    <div
                      key={i}
                      className="space-y-1 font-mono text-[10.5px] leading-snug"
                    >
                      {b?.search && (
                        <pre className="scrollbar-thin max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md border-l-2 border-red-300 bg-red-50/70 px-2.5 py-1.5 text-red-900">
                          {b.search}
                        </pre>
                      )}
                      {b?.replace && (
                        <pre className="scrollbar-thin max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border-l-2 border-emerald-400 bg-emerald-50/70 px-2.5 py-1.5 text-emerald-900">
                          {b.replace}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {m.type === "create" && m.content && (
                <pre className="scrollbar-thin m-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border-l-2 border-emerald-400 bg-emerald-50/70 px-2.5 py-1.5 font-mono text-[10.5px] leading-snug text-emerald-900">
                  {m.content}
                </pre>
              )}
              {m.type === "delete" && (
                <div className="m-2 rounded-md bg-red-50/70 px-2.5 py-1.5 font-mono text-[10.5px] text-red-900">
                  file will be removed
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pending && !isStreaming && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onApply}
            disabled={applying}
            data-tactile
            className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-[13px] font-medium tracking-tight text-white hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50"
          >
            {applying ? "Applying" : "Apply"}
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={applying}
            data-tactile
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type?: string }) {
  const map = {
    edit: {
      Icon: PencilSimpleLine,
      tone: "text-blue-700 bg-blue-50",
      label: "edit",
    },
    create: {
      Icon: Plus,
      tone: "text-emerald-700 bg-emerald-50",
      label: "create",
    },
    delete: {
      Icon: Trash,
      tone: "text-red-700 bg-red-50",
      label: "delete",
    },
  } as const;

  const entry = type && type in map ? map[type as keyof typeof map] : null;
  if (!entry) {
    return (
      <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
        pending
      </span>
    );
  }
  const { Icon, tone, label } = entry;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${tone}`}
    >
      <Icon size={10} weight="bold" />
      {label}
    </span>
  );
}
