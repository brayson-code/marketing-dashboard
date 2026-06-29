'use client';

import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { MicButton } from './mic-button';

// A Claude-composer-style prompt surface: a rounded card wrapping an
// auto-growing <textarea> with a paper-plane send button.
//   - Enter sends, Shift+Enter inserts a newline.
//   - Purely presentational: it owns its own draft text and calls onSend(text);
//     it does no fetching, so it stays reusable across every chat surface.
//   - When `busy` the send button shows a spinner; when `disabled` the whole
//     surface is inert.
//   - `accentVar` (a CSS color var like "var(--dept-marketing)") tints the
//     send button + focus ring so it can match a section's color.

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  busy?: boolean;
  placeholder?: string;
  /** CSS color value (e.g. "var(--dept-marketing)") used to accent the send button + focus ring. */
  accentVar?: string;
}

const MAX_TEXTAREA_PX = 160;

export function ChatComposer({ onSend, disabled, busy, placeholder, accentVar }: Props) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Dictation: `dictBase` is the draft text BEFORE the live interim chunk, and
  // `dictInterim` is the interim chunk currently appended to it. We rebuild the
  // textarea value as base + interim so interim re-emits replace cleanly and a
  // final segment folds into the base without duplicating.
  const dictBaseRef = useRef('');
  const dictInterimRef = useRef('');
  // Wraps the MicButton; the focused-composer hotkey clicks it so the hotkey and
  // the visible button share one dictation instance.
  const micWrapRef = useRef<HTMLSpanElement>(null);

  const accent = accentVar ?? 'var(--primary)';
  const canSend = !disabled && !busy && text.trim().length > 0;

  const joinDraft = (base: string, chunk: string) =>
    base && chunk && !/\s$/.test(base) ? `${base} ${chunk}` : `${base}${chunk}`;

  const handleTranscript = (chunk: string, isFinal: boolean) => {
    if (!chunk) return;
    const next = joinDraft(dictBaseRef.current, chunk);
    if (isFinal) {
      dictBaseRef.current = next;
      dictInterimRef.current = '';
    } else {
      dictInterimRef.current = chunk;
    }
    setText(next);
    requestAnimationFrame(resize);
  };

  // Keep the dictation base in sync with manual edits so the next chunk appends
  // to whatever the user has actually typed (not a stale snapshot).
  const handleTextChange = (value: string) => {
    dictBaseRef.current = value;
    dictInterimRef.current = '';
    setText(value);
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      // stopPropagation so MicButton's own window-level hotkey doesn't also fire
      // (which would toggle twice and cancel out). The button click drives the
      // single shared dictation instance.
      e.stopPropagation();
      micWrapRef.current?.querySelector('button')?.click();
      return;
    }
    handleKeyDown(e);
  };

  // Auto-grow: reset to auto so it can shrink, then clamp to the cap.
  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  };

  useEffect(() => {
    resize();
  }, [text]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || busy) return;
    onSend(trimmed);
    setText('');
    // Restore height after the value clears.
    requestAnimationFrame(resize);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="flex items-end gap-2 rounded-xl border bg-muted/30 px-2.5 py-2"
      style={{
        borderColor: focused
          ? `color-mix(in srgb, ${accent} 55%, transparent)`
          : 'var(--border)',
        boxShadow: focused ? `0 0 0 1px color-mix(in srgb, ${accent} 35%, transparent)` : 'none',
        transition: 'border-color var(--t-press) var(--ease-out), box-shadow var(--t-press) var(--ease-out)',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        onKeyDown={handleComposerKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={1}
        disabled={disabled}
        placeholder={placeholder ?? 'Message…'}
        className="flex-1 resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:cursor-not-allowed"
        style={{ maxHeight: `${MAX_TEXTAREA_PX}px` }}
      />
      <span ref={micWrapRef} className="inline-flex">
        <MicButton onTranscript={handleTranscript} accentVar={accent} disabled={disabled} />
      </span>
      <button
        type="button"
        onClick={submit}
        disabled={!canSend}
        aria-label="Send message"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white disabled:cursor-not-allowed disabled:opacity-30 active:scale-95"
        style={{
          backgroundColor: accent,
          transition:
            'background-color var(--t-press) var(--ease-out), opacity var(--t-press) var(--ease-out), transform var(--t-press) var(--ease-out)',
        }}
      >
        {busy ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : (
          <Send size={14} />
        )}
      </button>
    </div>
  );
}
