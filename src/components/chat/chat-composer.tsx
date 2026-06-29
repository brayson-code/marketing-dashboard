'use client';

import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';

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

  const accent = accentVar ?? 'var(--primary)';
  const canSend = !disabled && !busy && text.trim().length > 0;

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
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={1}
        disabled={disabled}
        placeholder={placeholder ?? 'Message…'}
        className="flex-1 resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:cursor-not-allowed"
        style={{ maxHeight: `${MAX_TEXTAREA_PX}px` }}
      />
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
