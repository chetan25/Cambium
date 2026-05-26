"use client";

import { useEffect } from "react";

interface Props {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      onClick={onCancel}
      className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/40 px-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="fade-up w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_30px_60px_-15px_rgba(24,24,27,0.40)]"
      >
        <div
          id="confirm-dialog-title"
          className="text-[14px] font-semibold tracking-tight text-zinc-900"
        >
          {title}
        </div>
        <p
          id="confirm-dialog-description"
          className="mt-1.5 text-[12px] leading-relaxed text-zinc-600"
        >
          {description}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-3.5 py-1.5 text-[12.5px] font-medium tracking-tight text-zinc-700 hover:bg-zinc-100 active:scale-[0.98]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`rounded-xl px-3.5 py-1.5 text-[12.5px] font-medium tracking-tight text-white active:scale-[0.98] ${
              destructive
                ? "bg-red-600 hover:bg-red-700"
                : "bg-zinc-950 hover:bg-zinc-800"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
