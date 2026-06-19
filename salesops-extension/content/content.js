// ============================================================
// CONTENT.JS — Overlay rendered on the call page
// ============================================================

function createOverlay() {
  if (document.getElementById("yurp-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "yurp-overlay";
  overlay.innerHTML = `
    <div id="yurp-header">
      <div id="yurp-title">
        <span id="yurp-logo">PIF.EXE</span>
        <span id="yurp-status-dot"></span>
      </div>
      <div id="yurp-controls">
        <button id="yurp-minimize" title="Minimize">_</button>
        <button id="yurp-close" title="Hide">X</button>
      </div>
    </div>

    <div id="yurp-objection-banner" style="display:none">
      !! OBJECTION DETECTED — rebuttal incoming
    </div>

    <div id="yurp-body">
      <div id="yurp-suggestion-area">
        <div id="yurp-suggestion-label">AI SUGGESTION</div>
        <div id="yurp-suggestion-text">// waiting for conversation...</div>
      </div>

      <div id="yurp-questions-area" style="display:none">
        <div id="yurp-questions-label">QUESTIONS TO ASK</div>
        <div id="yurp-questions-list"></div>
      </div>

      <div id="yurp-stats-row">
        <div id="yurp-talktime-area">
          <div class="yurp-stat-label">PROSPECT WORDS</div>
          <div id="yurp-prospect-words">0</div>
        </div>
      </div>

      <div id="yurp-transcript-area">
        <div id="yurp-transcript-label">LIVE TRANSCRIPT</div>
        <div id="yurp-transcript-text"></div>
      </div>

      <div id="yurp-summary-panel" style="display:none">
        <div id="yurp-summary-label">POST-CALL SUMMARY</div>
        <div id="yurp-summary-text"></div>
        <div id="yurp-summary-actions">
          <button id="yurp-summary-copy">[ COPY ]</button>
          <button id="yurp-summary-dismiss">[ DISMISS ]</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  makeDraggable(overlay);

  document.getElementById("yurp-minimize").addEventListener("click", () => {
    const body = document.getElementById("yurp-body");
    body.style.display = body.style.display === "none" ? "block" : "none";
  });

  document.getElementById("yurp-close").addEventListener("click", () => {
    overlay.style.display = "none";
  });

  document.getElementById("yurp-summary-copy").addEventListener("click", () => {
    const text = document.getElementById("yurp-summary-text").innerText;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById("yurp-summary-copy");
      btn.textContent = "COPIED!";
      setTimeout(() => { btn.textContent = "COPY"; }, 2000);
    });
  });

  document.getElementById("yurp-summary-dismiss").addEventListener("click", () => {
    document.getElementById("yurp-summary-panel").style.display = "none";
  });
}

function makeDraggable(element) {
  const header = element.querySelector("#yurp-header");
  let isDragging = false;
  let offsetX, offsetY;

  header.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    isDragging = true;
    offsetX = e.clientX - element.getBoundingClientRect().left;
    offsetY = e.clientY - element.getBoundingClientRect().top;
    header.style.cursor = "grabbing";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    element.style.left = e.clientX - offsetX + "px";
    element.style.top = e.clientY - offsetY + "px";
    element.style.right = "auto";
    element.style.bottom = "auto";
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
    header.style.cursor = "grab";
  });
}

// ── Message handler ──
chrome.runtime.onMessage.addListener((msg) => {
  createOverlay();

  if (msg.type === "transcript") updateTranscript(msg.text);
  if (msg.type === "suggestion" && !msg.isPartial) updateSuggestion(msg.text, msg.isObjection);
  if (msg.type === "objectionDetected") showObjectionBanner();
  if (msg.type === "talkTime") updateTalkTime(msg.prospectWords);
  if (msg.type === "callSummary") showSummary(msg.text);
});

// ── Update transcript ──
function updateTranscript(newText) {
  const area = document.getElementById("yurp-transcript-text");
  if (!area) return;
  const span = document.createElement("span");
  span.textContent = newText + " ";
  area.appendChild(span);
  area.scrollTop = area.scrollHeight;
}

// ── Update suggestion — parse SAY / TONE / FOLLOW-UP / QUESTIONS ──
function updateSuggestion(text, isObjection) {
  const area = document.getElementById("yurp-suggestion-text");
  if (!area) return;

  const sayMatch = text.match(/SAY:\s*"([^"]+)"/);
  const toneMatch = text.match(/TONE:\s*([^\n]+)/);
  const followMatch = text.match(/FOLLOW-UP:\s*"([^"]+)"/);
  const questionsMatch = text.match(/QUESTIONS:\s*([\s\S]+?)(?:\n\n|$)/);

  if (sayMatch || toneMatch || followMatch) {
    area.innerHTML = [
      sayMatch
        ? `<div class="yurp-row"><span class="yurp-pill yurp-pill-say">SAY</span><span>${sayMatch[1]}</span></div>`
        : "",
      toneMatch
        ? `<div class="yurp-row"><span class="yurp-pill yurp-pill-tone">TONE</span><span>${toneMatch[1].trim()}</span></div>`
        : "",
      followMatch
        ? `<div class="yurp-row"><span class="yurp-pill yurp-pill-follow">FOLLOW-UP</span><span>${followMatch[1]}</span></div>`
        : "",
    ].join("");
  } else {
    area.textContent = text;
  }

  // Render questions section
  const questionsArea = document.getElementById("yurp-questions-area");
  const questionsList = document.getElementById("yurp-questions-list");
  if (questionsMatch && questionsList) {
    const questions = questionsMatch[1]
      .split("\n")
      .map((q) => q.replace(/^[•\-\*\d.]\s*/, "").trim())
      .filter((q) => q.length > 0);

    if (questions.length > 0) {
      questionsList.innerHTML = questions
        .map((q) => `<div class="yurp-question">• ${q}</div>`)
        .join("");
      questionsArea.style.display = "block";
    }
  }

  // Flash — red border if objection, green otherwise
  area.classList.remove("yurp-flash", "yurp-flash-objection");
  area.classList.add(isObjection ? "yurp-flash-objection" : "yurp-flash");
  setTimeout(() => area.classList.remove("yurp-flash", "yurp-flash-objection"), 800);
}

// ── Objection banner ──
function showObjectionBanner() {
  const banner = document.getElementById("yurp-objection-banner");
  if (!banner) return;
  banner.style.display = "block";
  setTimeout(() => (banner.style.display = "none"), 4000);
}

// ── Talk time ──
function updateTalkTime(prospectWords) {
  const el = document.getElementById("yurp-prospect-words");
  if (el) el.textContent = prospectWords.toLocaleString();
}

// ── Post-call summary ──
function showSummary(text) {
  const panel = document.getElementById("yurp-summary-panel");
  const textEl = document.getElementById("yurp-summary-text");
  if (!panel || !textEl) return;

  // Parse DEAL_TEMP line for color coding
  const dealTempMatch = text.match(/DEAL_TEMP:\s*(HOT|WARM|COLD)/i);
  let dealClass = "";
  if (dealTempMatch) {
    const temp = dealTempMatch[1].toUpperCase();
    dealClass = temp === "HOT" ? "deal-hot" : temp === "WARM" ? "deal-warm" : "deal-cold";
  }

  // Format each line — bold the section headers
  const formatted = text
    .replace(/^(DEAL_TEMP|OBJECTIONS|PAIN_POINTS|NEXT_STEPS|ACTION_ITEMS):/gm, "<strong>$1:</strong>")
    .replace(/\n/g, "<br>");

  textEl.innerHTML = formatted;
  if (dealClass) textEl.className = dealClass;
  panel.style.display = "block";

  // Scroll summary into view
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

createOverlay();
