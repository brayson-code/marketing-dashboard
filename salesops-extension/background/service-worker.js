// ============================================================
// SERVICE-WORKER.JS — The behind-the-scenes brain
// ============================================================
//
// This runs in the background, even when the popup is closed.
// It does three jobs:
//   1. Captures audio from your browser tab
//   2. Creates an "offscreen document" to process that audio
//   3. Coordinates messages between popup ↔ offscreen ↔ content script
//
// WHY AN OFFSCREEN DOCUMENT?
//   Chrome's Manifest V3 doesn't let service workers use MediaRecorder
//   or WebSockets directly. So we create a hidden page (offscreen.html)
//   that CAN use those browser APIs. Think of it as a helper that does
//   the heavy lifting while this service worker manages traffic.
// ============================================================

let isCapturing = false;
let captureTabId = null;

// ── One-click connect from the SalesOps page (Command Center) ──
// The SalesOps page calls chrome.runtime.sendMessage(EXT_ID, {...}) to hand
// the extension a per-tenant SalesOps token + the Command Center API URL.
// Allowed senders are constrained by "externally_connectable" in manifest.json.
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "salesops_connect" && typeof msg.token === "string") {
    const apiUrl = (msg.apiUrl || "").replace(/\/+$/, "");
    chrome.storage.local.set(
      { salesopsToken: msg.token, ...(apiUrl && { pifApiUrl: apiUrl }) },
      () => {
        // Best-effort: pull the tenant's canonical SalesOps config so the
        // extension is configured without re-typing everything.
        hydrateConfigFromServer().finally(() => sendResponse({ ok: true }));
      }
    );
    return true; // async response
  }
  if (msg && msg.type === "salesops_ping") {
    chrome.storage.local.get(["salesopsToken"], (d) => {
      sendResponse({ ok: true, connected: !!d.salesopsToken });
    });
    return true;
  }
  sendResponse({ ok: false, error: "unknown message" });
});

// ── Fetch the tenant's canonical SalesOps config and cache it locally ──
async function hydrateConfigFromServer() {
  try {
    const { salesopsToken, pifApiUrl } = await chrome.storage.local.get([
      "salesopsToken", "pifApiUrl",
    ]);
    if (!salesopsToken || !pifApiUrl) return;

    const res = await fetch(`${pifApiUrl}/api/salesops/config`, {
      method: "GET",
      headers: { Authorization: `Bearer ${salesopsToken}` },
    });
    if (!res.ok) return;
    const cfg = await res.json();
    if (!cfg || typeof cfg !== "object") return;

    // Map server config → the pif* storage keys the rest of the extension reads.
    const toStore = {};
    if (cfg.persona)            toStore.pifPersona          = cfg.persona;
    if (cfg.playbook)           toStore.pifPlaybook         = cfg.playbook;
    if (cfg.company_name)       toStore.pifCompanyName      = cfg.company_name;
    if (cfg.product_name)       toStore.pifProductName      = cfg.product_name;
    if (cfg.pricing)            toStore.pifPricing          = cfg.pricing;
    if (cfg.differentiators)    toStore.pifDifferentiators  = cfg.differentiators;
    if (Array.isArray(cfg.objection_keywords) && cfg.objection_keywords.length)
      toStore.pifObjectionKeywords = cfg.objection_keywords;
    if (Number.isFinite(cfg.suggestion_interval_ms))
      toStore.pifInterval = cfg.suggestion_interval_ms;
    if (typeof cfg.summary_enabled === "boolean")
      toStore.pifSummaryEnabled = cfg.summary_enabled;
    if (Array.isArray(cfg.summary_fields) && cfg.summary_fields.length)
      toStore.pifSummaryFields = cfg.summary_fields;

    if (Object.keys(toStore).length) await chrome.storage.local.set(toStore);
  } catch (_) {
    // Non-fatal — the extension still works with local/default config.
  }
}

// ── Listen for messages from the popup ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "startCapture") {
    startCapture(sendResponse, msg.config);
    return true; // keeps the message channel open for async response
  }

  if (msg.action === "stopCapture") {
    stopCapture();
    sendResponse({ success: true });
  }

  // Forward suggestions from offscreen document to the content script
  if (msg.type === "suggestion") {
    forwardToContentScript(msg);
  }

  // Forward transcript updates to content script
  if (msg.type === "transcript") {
    forwardToContentScript(msg);
  }

  // Save suggestion count to storage so popup always shows the latest
  if (msg.type === "suggestionCount") {
    chrome.storage.local.set({ suggestionCount: msg.count });
  }

  // Forward objection alert to content script
  if (msg.type === "objectionDetected") {
    forwardToContentScript(msg);
  }

  // Forward post-call summary to content script
  if (msg.type === "callSummary") {
    forwardToContentScript(msg);
  }
});

// ── Start capturing audio from the active tab ──
async function startCapture(sendResponse, config) {
  try {
    // Step 1: Get the currently active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      sendResponse({ success: false, error: "No active tab found" });
      return;
    }

    // Step 2: Start capturing audio from that tab
    // This asks Chrome: "Give me a stream of audio from this tab"
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id,
    });

    // Step 3: Create the offscreen document (if it doesn't exist already)
    // This is the hidden helper page that will handle the WebSocket to Deepgram
    await ensureOffscreenDocument();

    // Step 4: Give the offscreen document a moment to finish loading
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Step 5: Merge any dashboard settings (from options page) into config,
    //         plus the SalesOps token + API URL needed to reach the backend.
    const stored = await chrome.storage.local.get([
      "pifPersona", "pifPlaybook", "pifObjectionKeywords", "pifInterval", "pifApiUrl",
      "pifCompanyName", "pifProductName", "pifPricing", "pifDifferentiators",
      "pifSummaryEnabled", "pifSummaryFields", "salesopsToken",
    ]);

    if (!stored.salesopsToken) {
      sendResponse({
        success: false,
        error: "Not connected — open the SalesOps page and click Connect (or paste a token in Settings)",
      });
      return;
    }

    // Unique id for this call so the backend can correlate suggest + summary.
    const callId = (self.crypto && self.crypto.randomUUID)
      ? self.crypto.randomUUID()
      : `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const platform = platformFromUrl(tab.url);

    const mergedConfig = {
      ...config,
      SALESOPS_TOKEN: stored.salesopsToken,
      CALL_ID: callId,
      PLATFORM: platform,
      ...(stored.pifPersona           && { BUYER_PERSONA: stored.pifPersona }),
      ...(stored.pifPlaybook           && { PLAYBOOK: stored.pifPlaybook }),
      ...(stored.pifObjectionKeywords  && { OBJECTION_KEYWORDS: stored.pifObjectionKeywords }),
      ...(stored.pifInterval           && { SUGGESTION_INTERVAL: stored.pifInterval }),
      ...(stored.pifApiUrl             && { API_BASE_URL: stored.pifApiUrl }),
      ...(stored.pifCompanyName        && { COMPANY_NAME: stored.pifCompanyName }),
      ...(stored.pifProductName        && { PRODUCT_NAME: stored.pifProductName }),
      ...(stored.pifPricing            && { PRICING: stored.pifPricing }),
      ...(stored.pifDifferentiators    && { DIFFERENTIATORS: stored.pifDifferentiators }),
      SUMMARY_ENABLED: stored.pifSummaryEnabled || false,
      SUMMARY_FIELDS:  stored.pifSummaryFields  || ["deal_temp", "objections", "pain_points", "next_steps", "action_items"],
    };

    // Step 6: Send the stream ID + merged config to the offscreen document
    chrome.runtime.sendMessage({
      action: "startProcessing",
      streamId: streamId,
      tabId: tab.id,
      config: mergedConfig,
    });

    isCapturing = true;
    captureTabId = tab.id;
    sendResponse({ success: true });
  } catch (error) {
    console.error("Capture failed:", error);
    sendResponse({ success: false, error: error.message });
  }
}

// ── Map the captured tab URL to a known meeting platform ──
function platformFromUrl(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (host.includes("meet.google.com")) return "meet";
    if (host.includes("zoom.us")) return "zoom";
    if (host.includes("teams.microsoft.com")) return "teams";
    if (host.includes("webex.com")) return "webex";
  } catch (_) {}
  return null;
}

// ── Stop capturing ──
function stopCapture() {
  chrome.runtime.sendMessage({ action: "stopProcessing" });
  isCapturing = false;
  captureTabId = null;
}

// ── Create the offscreen document if it doesn't exist ──
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });

  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: "background/offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Processing tab audio for real-time transcription",
    });
  }
}

// ── Forward a message to the content script on the captured tab ──
async function forwardToContentScript(msg) {
  if (!captureTabId) return;
  try {
    await chrome.tabs.sendMessage(captureTabId, msg);
  } catch (_) {
    // Tab may have navigated away — ignore
  }
}
