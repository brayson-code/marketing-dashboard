// ============================================================
// OFFSCREEN.JS — Audio processing, transcription, suggestions
// ============================================================

let mediaStream = null;
let mediaRecorder = null;
let deepgramSocket = null;
let config = null;

// Web Audio passthrough so the user STILL HEARS the call while we capture.
let audioCtx = null;
let monitorSource = null;

let fullTranscript = "";
let transcriptAtLastSuggestion = "";
let suggestionInterval = null;
let suggestionCount = 0;
let prospectWordCount = 0;

// ── Listen for commands from the service worker ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "startProcessing") {
    config = msg.config;
    startProcessing(msg.streamId);
  }
  if (msg.action === "stopProcessing") {
    stopProcessing();
  }
});

// ── Main function: start capturing and transcribing ──
async function startProcessing(streamId) {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });

    // ── AUDIO-CUTOUT FIX ──────────────────────────────────────
    // chrome.tabCapture mutes the captured tab's audio to the speakers,
    // so without this the user can no longer HEAR the call. Route the
    // captured stream through a Web Audio graph that ALSO connects to
    // ctx.destination, restoring speaker monitoring. The MediaRecorder
    // tap below reads the same stream independently for Deepgram.
    try {
      audioCtx = new AudioContext();
      monitorSource = audioCtx.createMediaStreamSource(mediaStream);
      monitorSource.connect(audioCtx.destination);
      if (audioCtx.state === "suspended") {
        // resume() is best-effort; offscreen docs are allowed to start audio.
        audioCtx.resume().catch(() => {});
      }
    } catch (e) {
      console.error("[PIF] Audio monitor passthrough failed:", e);
    }

    // ── Deepgram realtime token ───────────────────────────────
    // The raw Deepgram key NEVER reaches the extension. We mint a
    // short-lived token from the Command Center (tenant's BYO key) and
    // use THAT as the WebSocket access token.
    const dgToken = await fetchDeepgramToken();
    if (!dgToken) {
      console.error("[PIF] Could not obtain Deepgram token — aborting capture");
      chrome.runtime.sendMessage({
        type: "suggestion",
        text: "ERROR: Deepgram is not connected in your workspace. Open Connections in the Command Center to add a Deepgram key.",
        isPartial: false,
        isObjection: false,
      });
      stopProcessing();
      return;
    }

    const dgUrl =
      "wss://api.deepgram.com/v1/listen" +
      "?model=nova-2" +
      "&language=en" +
      "&smart_format=true" +
      "&interim_results=true" +
      "&utterance_end_ms=1000" +
      "&vad_events=true";

    deepgramSocket = new WebSocket(dgUrl, ["token", dgToken]);

    deepgramSocket.onopen = () => {
      console.log("[PIF] Connected to Deepgram");
      startRecording();
      startSuggestionLoop();
    };

    deepgramSocket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "Results") {
        const transcript = data.channel?.alternatives?.[0]?.transcript;

        if (transcript && data.is_final) {
          fullTranscript += " " + transcript;

          // Count words for talk time tracker
          const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
          prospectWordCount += wordCount;

          // Send transcript update
          chrome.runtime.sendMessage({
            type: "transcript",
            text: transcript,
            fullTranscript: fullTranscript.trim(),
          });

          // Send updated talk time
          chrome.runtime.sendMessage({
            type: "talkTime",
            prospectWords: prospectWordCount,
          });

          // Check for objection keywords — fire immediately if detected
          checkForObjection(transcript);
        }
      }
    };

    deepgramSocket.onerror = (error) => {
      console.error("[PIF] Deepgram error:", error);
    };

    deepgramSocket.onclose = () => {
      console.log("[PIF] Deepgram connection closed");
    };
  } catch (error) {
    console.error("[PIF] Failed to start processing:", error);
  }
}

// ── Mint a short-lived Deepgram token from the Command Center ──
async function fetchDeepgramToken() {
  try {
    const res = await fetch(`${config.API_BASE_URL}/api/salesops/deepgram-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.SALESOPS_TOKEN}`,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      console.error("[PIF] deepgram-token error:", res.status);
      return null;
    }
    const data = await res.json();
    return data.access_token || null;
  } catch (e) {
    console.error("[PIF] deepgram-token fetch failed:", e);
    return null;
  }
}

// ── Check transcript segment for objection keywords ──
function checkForObjection(newText) {
  const keywords = config.OBJECTION_KEYWORDS || [];
  const lower = newText.toLowerCase();
  const detected = keywords.some((kw) => lower.includes(kw.toLowerCase()));

  if (detected) {
    console.log("[PIF] Objection detected — firing immediate suggestion");
    // Notify overlay immediately so it can show the alert banner
    chrome.runtime.sendMessage({ type: "objectionDetected" });
    // Fire a suggestion right away (bypass the normal interval)
    clearInterval(suggestionInterval);
    fetchSuggestion(true).finally(() => {
      startSuggestionLoop(); // restart the normal loop after
    });
  }
}

// ── Normal suggestion loop ──
function startSuggestionLoop() {
  if (suggestionInterval) clearInterval(suggestionInterval);
  suggestionInterval = setInterval(
    () => fetchSuggestion(false),
    config.SUGGESTION_INTERVAL || 15000
  );
}

// ── Core suggestion fetch — called by interval OR objection trigger ──
async function fetchSuggestion(isObjection = false) {
  const currentTranscript = fullTranscript.trim();
  if (currentTranscript.length < 20) return;
  if (!isObjection && currentTranscript === transcriptAtLastSuggestion) return;

  const words = currentTranscript.split(/\s+/);
  const windowSize = config.TRANSCRIPT_WINDOW || 500;
  const recentTranscript = words.slice(-windowSize).join(" ");

  try {
    const response = await fetch(`${config.API_BASE_URL}/api/salesops/suggest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.SALESOPS_TOKEN}`,
      },
      body: JSON.stringify({
        callId: config.CALL_ID || null,
        platform: config.PLATFORM || null,
        transcript: recentTranscript,
        fullLength: words.length,
        isObjection: isObjection,
        buyerPersona: config.BUYER_PERSONA || "",
        playbook: config.PLAYBOOK || "",
        companyName: config.COMPANY_NAME || "",
        productName: config.PRODUCT_NAME || "",
        pricing: config.PRICING || "",
        differentiators: config.DIFFERENTIATORS || "",
      }),
    });

    if (!response.ok) {
      console.error("[PIF] API error:", response.status);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let suggestion = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      suggestion += decoder.decode(value, { stream: true });
    }

    // Lock transcript so we don't re-suggest for the same exchange
    transcriptAtLastSuggestion = currentTranscript;
    suggestionCount++;

    chrome.runtime.sendMessage({
      type: "suggestion",
      text: suggestion,
      isPartial: false,
      isObjection: isObjection,
    });

    chrome.runtime.sendMessage({
      type: "suggestionCount",
      count: suggestionCount,
    });
  } catch (error) {
    console.error("[PIF] Suggestion fetch failed:", error);
  }
}

// ── Record audio and stream to Deepgram ──
function startRecording() {
  mediaRecorder = new MediaRecorder(mediaStream, {
    mimeType: "audio/webm;codecs=opus",
  });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0 && deepgramSocket?.readyState === WebSocket.OPEN) {
      deepgramSocket.send(event.data);
    }
  };

  mediaRecorder.start(250);
}

// ── Clean up everything ──
async function stopProcessing() {
  // Generate summary before clearing transcript (if enabled and transcript exists)
  if (config?.SUMMARY_ENABLED && fullTranscript.trim().length > 50) {
    await generateSummary();
  }

  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  if (deepgramSocket) deepgramSocket.close();
  if (suggestionInterval) clearInterval(suggestionInterval);

  // Tear down the audio monitor passthrough.
  if (monitorSource) { try { monitorSource.disconnect(); } catch (_) {} }
  if (audioCtx) { try { audioCtx.close(); } catch (_) {} }
  monitorSource = null;
  audioCtx = null;

  mediaRecorder = null;
  mediaStream = null;
  deepgramSocket = null;
  fullTranscript = "";
  transcriptAtLastSuggestion = "";
  suggestionCount = 0;
  prospectWordCount = 0;
}

// ── Generate post-call summary via API ──
async function generateSummary() {
  try {
    const companyParts = [
      config.COMPANY_NAME      && `Company: ${config.COMPANY_NAME}`,
      config.PRODUCT_NAME      && `Product: ${config.PRODUCT_NAME}`,
      config.PRICING           && `Pricing: ${config.PRICING}`,
      config.DIFFERENTIATORS   && `Differentiators: ${config.DIFFERENTIATORS}`,
    ].filter(Boolean);

    const response = await fetch(`${config.API_BASE_URL}/api/salesops/summary`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.SALESOPS_TOKEN}`,
      },
      body: JSON.stringify({
        callId: config.CALL_ID || null,
        platform: config.PLATFORM || null,
        transcript: fullTranscript.trim(),
        companyInfo: companyParts.join("\n") || "",
        fields: config.SUMMARY_FIELDS,
      }),
    });

    if (!response.ok) {
      console.error("[PIF] Summary API error:", response.status);
      return;
    }

    const data = await response.json();
    if (data.summary) {
      chrome.runtime.sendMessage({ type: "callSummary", text: data.summary });
    }
  } catch (error) {
    console.error("[PIF] Summary generation failed:", error);
  }
}
