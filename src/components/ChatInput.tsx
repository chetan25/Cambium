"use client";

import { useState } from "react";
import { ArrowUp } from "@phosphor-icons/react/dist/ssr/ArrowUp";
import { useAppStore } from "@/store/appStore";

const QUICK_PICKS = [
  {
    label: "Notes",
    prompt:
      "A simple notes app: a text input, an Add button, and a list of saved notes. Persist the notes so they survive a refresh.",
  },
  {
    label: "Todo list",
    prompt:
      "A todo list where each item has a checkbox to mark done and a delete button. Persist the items.",
  },
  {
    label: "Habit tracker",
    prompt:
      "A daily habit tracker with a list of habits, daily checkmarks for today, and a streak counter for each habit. Persist habits and history.",
  },
  {
    label: "Pomodoro",
    prompt:
      "A pomodoro timer with a 25-minute focus and 5-minute break cycle, start/pause/reset controls, and a count of completed sessions. Persist the session count.",
  },
];

interface Props {
  onSubmit: (instruction: string) => void;
}

export function ChatInput({ onSubmit }: Props) {
  const [text, setText] = useState("");
  const wcStatus = useAppStore((s) => s.wcStatus);
  const isStreaming = useAppStore((s) => s.isStreaming);

  const ready = wcStatus === "ready" && !isStreaming;
  const submitDisabled = !ready || !text.trim();

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText("");
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {QUICK_PICKS.map((qp) => (
          <button
            key={qp.label}
            type="button"
            onClick={() => onSubmit(qp.prompt)}
            disabled={!ready}
            className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-medium tracking-tight text-zinc-700 hover:bg-zinc-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {qp.label}
          </button>
        ))}
      </div>
      <div className="relative">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            wcStatus === "ready"
              ? "Describe what to build or change"
              : "WebContainer is booting"
          }
          disabled={!ready}
          rows={3}
          className="w-full resize-none rounded-2xl border border-zinc-200 bg-white px-3.5 py-3 pr-12 text-sm leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none disabled:bg-zinc-50 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={submitDisabled}
          aria-label={isStreaming ? "Generating" : "Send"}
          className="absolute bottom-2.5 right-2.5 grid size-8 place-items-center rounded-xl bg-zinc-950 text-white hover:bg-zinc-800 active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-25"
        >
          {isStreaming ? (
            <span className="size-1.5 animate-pulse rounded-full bg-white" />
          ) : (
            <ArrowUp size={14} weight="bold" />
          )}
        </button>
      </div>
    </div>
  );
}
