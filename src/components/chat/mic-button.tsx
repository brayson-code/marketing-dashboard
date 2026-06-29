'use client';

// MicButton — a small, reusable dictation toggle for any composer.
//
//   - Idle      → Mic icon.
//   - Recording → a pulsing red Square (stop) with a subtle live dot.
//   - Tooltip   → "Dictate (⌘/Ctrl+Shift+M)".
//   - On an unsupported browser / missing Deepgram key, it surfaces a graceful inline
//     hint (from useDictation's onError) instead of failing silently. The button itself
//     never throws; it just calls onTranscript(text, isFinal) as speech comes in.
//
// It owns NOTHING fragile — the parent passes onTranscript and gets a button back. The
// composer decides how to fold interim vs. final text into its draft.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { useDictation } from '@/hooks/use-dictation';

interface Props {
  /** Receives each transcript chunk. isFinal=false → interim, isFinal=true → committed. */
  onTranscript: (text: string, isFinal: boolean) => void;
  /** CSS color value used to tint the active (recording) state. Defaults to var(--primary). */
  accentVar?: string;
  disabled?: boolean;
  /** Overrides the default tooltip. */
  title?: string;
}

const DEFAULT_TITLE = 'Dictate (⌘/Ctrl+Shift+M)';

function hintFor(err: Error): string {
  switch (err.message) {
    case 'connect_deepgram':
      return 'Connect Deepgram in Connections to dictate.';
    case 'dictation_unsupported':
      return 'Dictation isn’t supported in this browser.';
    default:
      // Mic-permission and transient socket errors land here.
      return 'Couldn’t start dictation. Check mic access and try again.';
  }
}

export function MicButton({ onTranscript, accentVar, disabled, title }: Props) {
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHint = useCallback((msg: string) => {
    setHint(msg);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 4000);
  }, []);

  const handleError = useCallback(
    (e: Error) => {
      showHint(hintFor(e));
    },
    [showHint],
  );

  const { recording, supported, toggle } = useDictation({ onTranscript, onError: handleError });

  // ⌘/Ctrl+Shift+M keyboard shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        if (disabled || !supported) return;
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, disabled, supported]);

  useEffect(() => {
    return () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, []);

  const accent = accentVar ?? 'var(--primary)';
  const isDisabled = disabled || !supported;
  const label = recording ? 'Stop dictation' : 'Start dictation';

  const onClick = () => {
    if (isDisabled) return;
    setHint(null);
    toggle();
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        aria-label={label}
        aria-pressed={recording}
        title={!supported ? 'Dictation isn’t available in this browser' : (title ?? DEFAULT_TITLE)}
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 active:scale-95"
        style={{
          color: recording ? '#ef4444' : undefined,
          backgroundColor: recording
            ? 'color-mix(in srgb, #ef4444 14%, transparent)'
            : 'transparent',
          boxShadow: recording
            ? `0 0 0 1px color-mix(in srgb, ${accent} 45%, transparent)`
            : 'none',
          transition:
            'color var(--t-press) var(--ease-out), background-color var(--t-press) var(--ease-out), box-shadow var(--t-press) var(--ease-out), transform var(--t-press) var(--ease-out)',
        }}
      >
        {recording ? <Square size={13} fill="currentColor" /> : <Mic size={15} />}
        {recording && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full"
            style={{ backgroundColor: accent }}
          />
        )}
      </button>

      {hint && (
        <span
          role="status"
          className="absolute bottom-full right-0 z-50 mb-1.5 w-max max-w-[16rem] rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
          style={{
            borderColor: 'var(--border)',
            transition: 'opacity var(--t-popover) var(--ease-out)',
          }}
        >
          {hint}
        </span>
      )}
    </span>
  );
}
