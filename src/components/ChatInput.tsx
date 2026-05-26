"use client";

import { useRef, useState } from "react";
import { ArrowUp } from "@phosphor-icons/react/dist/ssr/ArrowUp";
import { Paperclip } from "@phosphor-icons/react/dist/ssr/Paperclip";
import { X } from "@phosphor-icons/react/dist/ssr/X";
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
  {
    label: "Expenses",
    prompt:
      "An expense tracker: a number input for amount, a text input for description, and an Add button. Show a list of entries with amount and description, and a running total at the bottom. Persist entries.",
  },
  {
    label: "Kanban",
    prompt:
      "A small kanban board with three columns — Todo, Doing, Done. Each column has an Add input to create a card and shows its cards. Each card has Left and Right buttons to move it between adjacent columns. Persist cards and which column they are in.",
  },
  {
    label: "Markdown notes",
    prompt:
      "A markdown editor: a textarea on the left and a live preview on the right that renders bold, italics, headings, links, and bullet lists. A list of saved notes at the top by title; clicking one loads it into the editor. Persist notes.",
  },
  {
    label: "Flashcards",
    prompt:
      "A flashcards study app: front and back text inputs with an Add Card button, plus a study view that shows one card at a time. Click the card to flip it. Buttons for 'Got it' and 'Again' move to the next card. Persist the deck.",
  },
  {
    label: "Reading list",
    prompt:
      "A reading list: input for title and URL, an Add button, and a list of saved items. Each item has a checkbox to mark as read and shows the title as a clickable link. Persist items.",
  },
  {
    label: "Mood journal",
    prompt:
      "A daily mood journal: pick a mood from a small set of emoji buttons, optionally add a one-line note, and save the entry with today's date. Show a list of past entries grouped by date. Persist entries.",
  },
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — matches Anthropic's per-image cap
const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

interface Props {
  onSubmit: (instruction: string, image?: string | null) => void;
}

export function ChatInput({ onSubmit }: Props) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const wcStatus = useAppStore((s) => s.wcStatus);
  const isStreaming = useAppStore((s) => s.isStreaming);

  const ready = wcStatus === "ready" && !isStreaming;
  // An image alone is enough to submit (the model can infer intent from the visual).
  const submitDisabled = !ready || (!text.trim() && !image);

  const ingestFile = (file: File | null) => {
    setFileError(null);
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setFileError(`Unsupported type. Use PNG, JPEG, WebP, or GIF.`);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setFileError(`Image must be under 5MB (this is ${(file.size / 1024 / 1024).toFixed(1)}MB).`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(reader.result as string);
      setImageName(file.name || "pasted-image");
    };
    reader.onerror = () => setFileError("Couldn't read that file.");
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImage(null);
    setImageName(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed && !image) return;
    onSubmit(trimmed || "Build a UI that matches this image.", image);
    setText("");
    clearImage();
  };

  const placeholder = image
    ? "Optional — describe how to use this image, or just send"
    : wcStatus === "ready"
      ? "Describe what to build or change"
      : "WebContainer is booting";

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

      {image && (
        <div className="fade-up flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt="attached"
            className="size-12 shrink-0 rounded-md border border-zinc-200 object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-zinc-800">
              {imageName}
            </div>
            <div className="font-mono text-[10px] text-zinc-500">
              attached as visual reference
            </div>
          </div>
          <button
            type="button"
            onClick={clearImage}
            aria-label="Remove image"
            className="grid size-6 place-items-center rounded-md text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 active:scale-[0.92]"
          >
            <X size={12} weight="bold" />
          </button>
        </div>
      )}

      <div
        className={`relative rounded-2xl border bg-white ${
          dragOver
            ? "border-emerald-400 ring-2 ring-emerald-200"
            : "border-zinc-200"
        }`}
        onDragEnter={(e) => {
          if (!ready) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          if (!ready) return;
          e.preventDefault();
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!ready) return;
          const file = e.dataTransfer.files?.[0];
          if (file) ingestFile(file);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
              if (item.type.startsWith("image/")) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) ingestFile(file);
                return;
              }
            }
          }}
          placeholder={placeholder}
          disabled={!ready}
          rows={3}
          className="w-full resize-none rounded-2xl bg-transparent px-3.5 py-3 pb-10 pr-12 text-sm leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:outline-none disabled:opacity-60"
        />

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            ingestFile(file);
          }}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!ready}
          aria-label="Attach image"
          className="absolute bottom-2.5 left-2.5 grid size-7 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 active:scale-[0.92] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Paperclip size={14} weight="regular" />
        </button>

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

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-2xl bg-emerald-50/60 text-[12px] font-medium text-emerald-700">
            Drop image to attach
          </div>
        )}
      </div>

      {fileError && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-[11px] text-amber-800">
          {fileError}
        </div>
      )}
    </div>
  );
}
