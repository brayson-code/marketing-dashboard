// ============================================================
// CONFIG — Non-secret defaults only
// ============================================================
//
// SECURITY: This file NEVER holds API keys.
//   - Deepgram: the extension fetches a SHORT-LIVED Deepgram token
//     from the Command Center backend (POST /api/salesops/deepgram-token,
//     authenticated with your per-tenant SalesOps token). The raw
//     Deepgram key stays on the server — it is minted from your
//     workspace Connections (BYO key) and never reaches the browser.
//   - Claude: runs entirely server-side via the Command Center using
//     your workspace's BYO Anthropic key.
//
// CONNECTION (token + apiUrl) lives in chrome.storage.local, set by:
//   - one-click "Connect" from the SalesOps page in the Command Center, OR
//   - the paste-token fallback in the extension Options page.
//
// API_BASE_URL below is only the DEFAULT used until a connection is made;
// the live value comes from the connect handshake / options.
// ============================================================

const CONFIG = {
  // Default Command Center URL. Overridden by the connect handshake / options.
  API_BASE_URL: "https://command.keyplayershq.com",

  // How often (in ms) to check for new transcript and send to the AI.
  SUGGESTION_INTERVAL: 15000,

  // How many recent transcript words to include in each request.
  TRANSCRIPT_WINDOW: 500,

  // ── Buyer Persona ──────────────────────────────────────────
  // Default persona. The canonical config lives server-side and is
  // hydrated on connect (GET /api/salesops/config); this is a fallback.
  BUYER_PERSONA: `
    Target buyer: Small to mid-size business owners and decision makers
    Industries: [your target industries]
    Role/Title: [e.g. Owner, VP of Sales, Operations Manager]
    Company size: [e.g. 10-100 employees]
    Main pain points: [e.g. manual processes, scaling challenges, high overhead]
    Goals: [e.g. increase revenue, save time, reduce costs]
    Common objections: price too high, already have a solution, need to think about it, bad timing
    Decision style: ROI-focused, needs social proof and case studies
    Avg deal size: [your deal size]
    Sales cycle: [e.g. 1-4 weeks]
  `.trim(),

  // ── Objection Keywords ─────────────────────────────────────
  // When any of these phrases appear in the transcript, fire a
  // suggestion immediately (bypassing the normal interval).
  OBJECTION_KEYWORDS: [
    "too expensive", "not in budget", "can't afford", "no budget", "costs too much", "too much money",
    "already have", "using something else", "happy with what we have", "already using", "don't need",
    "need to think", "not sure", "need to talk to", "check with my", "run it by",
    "not right now", "bad timing", "too busy", "not a priority", "maybe later",
    "need to discuss", "get back to you", "think about it", "circle back",
    "not interested", "just looking", "send me information", "send me an email"
  ],
};

// Make it available to other extension scripts
if (typeof globalThis !== "undefined") {
  globalThis.YURP_CONFIG = CONFIG;
}
