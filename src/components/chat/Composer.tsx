"use client";

import { ArrowUp, Square } from "lucide-react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";

export type ComposerHandle = { focus: () => void; setValue: (v: string) => void };

type Props = { onSend: (text: string) => void; onStop: () => void; streaming: boolean; disabled?: boolean; disabledReason?: string };

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ onSend, onStop, streaming, disabled, disabledReason }, ref) {
  const [value, setValue] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus(), setValue }), []);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const submit = () => {
    if (!value.trim() || streaming || disabled) return;
    onSend(value);
    setValue("");
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-6 sm:pb-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface p-2 pl-4 shadow-[0_2px_10px_rgba(20,53,40,0.06)] focus-within:border-forest-600/60"
      >
        <label htmlFor="zw-input" className="sr-only">
          Ask ZecWise
        </label>
        <textarea
          id="zw-input"
          ref={area}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={disabled ? disabledReason : "Ask anything about Zcash..."}
          disabled={disabled}
          maxLength={8000}
          className="max-h-[220px] min-h-[24px] flex-1 resize-none bg-transparent py-2 text-[0.95rem] leading-6 text-ink placeholder:text-subtle focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed"
        />
        {streaming ? (
          <button type="button" onClick={onStop} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-charcoal text-white transition hover:bg-ink" aria-label="Stop generating">
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim() || disabled}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-forest-700 text-white transition hover:bg-forest-800 disabled:bg-line-strong disabled:text-white"
            aria-label="Send message"
          >
            <ArrowUp className="h-4.5 w-4.5" />
          </button>
        )}
      </form>
      <p className="mt-2 px-1 text-center text-[11px] leading-relaxed text-subtle">
        ZecWise can make mistakes. Check important details against the linked sources. Never share your seed phrase or private keys with anyone.
      </p>
    </div>
  );
});
