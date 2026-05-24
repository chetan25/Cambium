"use client";

import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import type { Pattern } from "@/lib/observe-types";

interface Props {
  pattern: Pattern;
  onApprove: (pattern: Pattern) => void;
  onDismiss: (pattern: Pattern) => void;
  disabled?: boolean;
}

export function SuggestionCard({
  pattern,
  onApprove,
  onDismiss,
  disabled,
}: Props) {
  return (
    <div className="fade-up relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_24px_48px_-24px_rgba(5,150,105,0.18)]">
      <div className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-emerald-400 via-emerald-500 to-emerald-400/40" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-700">
          <Sparkle size={11} weight="fill" />
          I noticed something
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-zinc-500">
            {Math.round(pattern.confidence * 100)}% sure
          </span>
          <button
            type="button"
            onClick={() => onDismiss(pattern)}
            disabled={disabled}
            aria-label="Dismiss"
            className="-mr-1 grid size-5 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 active:scale-[0.92] disabled:opacity-40"
          >
            <X size={12} weight="bold" />
          </button>
        </div>
      </div>

      <p className="mt-2.5 text-[13px] leading-snug text-zinc-600">
        {pattern.observation}
      </p>
      <p className="mt-2 text-[14px] font-medium leading-snug tracking-tight text-zinc-900">
        {pattern.proposed_feature}
      </p>

      <div className="mt-1.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-500">
        <span>{pattern.complexity} complexity</span>
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => onApprove(pattern)}
          disabled={disabled}
          data-tactile
          className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-950 px-3 py-2 text-[13px] font-medium tracking-tight text-white hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-50"
        >
          <Sparkle size={12} weight="fill" className="text-emerald-400" />
          Build it
        </button>
      </div>
    </div>
  );
}
