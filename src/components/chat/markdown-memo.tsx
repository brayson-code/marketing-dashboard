// Shared "stable-prefix" memoization primitive for chat markdown rendering.
//
// WHY THIS EXISTS — how streaming actually arrives in this app (verified before
// writing this): there is no token-by-token SSE anywhere in the chat surfaces.
//   - /api/agent-chat and /api/boardroom/a2a return a reply as ONE complete JSON
//     payload — the assistant's text never grows in place.
//   - The Boardroom's agent-to-agent view (a2a-history.tsx) instead POLLS THE
//     ENTIRE conversation transcript on a `setInterval(load, 10_000)` and
//     replaces state wholesale. Every open thread's markdown gets re-parsed on
//     every tick even though almost all of that history is unchanged — the
//     "app re-renders full text every tick" case. That poll loop is the closest
//     thing this app has to "streaming," so it's the one place block-level
//     memoization pays for itself today.
//
// THE PATTERN (still applies even without literal token streaming): split a
// message's markdown into blocks, and memoize each block BY VALUE (not just by
// object identity) so a re-render only re-parses blocks whose actual text
// changed. Completed blocks are cheap to compare (a value-equality check) and
// skip the expensive part — inline-markdown parsing + JSX construction — when
// their text is unchanged. If/when a real token-by-token stream is wired in,
// the same shape supports treating every block but the last as a memoized,
// parsed-once "stable prefix" and leaving only the growing last block
// ("unstable tail") to re-render on every token — see a2a-history.tsx's
// CompactMarkdown for the concrete wiring.
//
// Kept deliberately tiny: this module owns only the reusable, non-JSX bit
// (a stable content key), not markdown syntax — each surface (message-bubble.tsx,
// a2a-history.tsx) keeps its own rendering rules so visual output never drifts
// just because the memoization plumbing is shared.

/** Small, fast, non-cryptographic string hash (djb2). Used to build a compact,
 *  content-derived React key for a memoized markdown block, so a block's key
 *  changes if (and only if) its text does — completed blocks keep a stable
 *  identity across re-renders instead of a position-only (index) key. */
export function hashBlock(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (h * 33) ^ text.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}
