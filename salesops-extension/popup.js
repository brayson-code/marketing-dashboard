// ============================================================
// POPUP.JS — The logic behind the start/stop button
// ============================================================
// 
// This file runs when you click the extension icon.
// It talks to the "background service worker" (the behind-the-scenes brain)
// using chrome.runtime.sendMessage (like passing notes in class).
//
// Think of it like a TV remote — this is the remote, 
// background.js is the TV doing the actual work.
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("mainBtn").addEventListener("click", toggleListening);
  document.getElementById("openSettings").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
  });
});

let isListening = false;
let startTime = null;
let timerInterval = null;

// ── Load saved state when popup opens ──
// (so if you close and reopen the popup, it remembers if you're mid-call)
chrome.storage.local.get(["isListening", "startTime", "suggestionCount"], (data) => {
  if (data.isListening) {
    isListening = true;
    startTime = data.startTime;
    updateUI();
    startTimer();
    if (data.suggestionCount) {
      document.getElementById("suggestions").textContent = data.suggestionCount;
    }
  }
});

// ── Main toggle function — start or stop listening ──
async function toggleListening() {
  const btn = document.getElementById("mainBtn");
  btn.disabled = true; // prevent double-clicks

  if (!isListening) {
    // ─── START LISTENING ───
    // Tell the background worker to start capturing audio
    chrome.runtime.sendMessage({ action: "startCapture", config: YURP_CONFIG }, (response) => {
      if (response?.success) {
        isListening = true;
        startTime = Date.now();
        chrome.storage.local.set({
          isListening: true,
          startTime: startTime,
          suggestionCount: 0,
        });
        updateUI();
        startTimer();
      } else {
        // Something went wrong
        const dot = document.getElementById("statusDot");
        const text = document.getElementById("statusText");
        dot.className = "status-dot error";
        text.textContent = response?.error || "Failed to start";
      }
      btn.disabled = false;
    });
  } else {
    // ─── STOP LISTENING ───
    chrome.runtime.sendMessage({ action: "stopCapture" }, () => {
      isListening = false;
      startTime = null;
      chrome.storage.local.set({ isListening: false, startTime: null });
      clearInterval(timerInterval);
      updateUI();
      btn.disabled = false;
    });
  }
}

// ── Update the UI based on current state ──
function updateUI() {
  const btn = document.getElementById("mainBtn");
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  const stats = document.getElementById("stats");

  if (isListening) {
    btn.textContent = "[ Stop Listening ]";
    btn.className = "btn btn-stop";
    dot.className = "status-dot active";
    text.textContent = "Listening to call...";
    text.className = "active";
    stats.style.display = "grid";
  } else {
    btn.textContent = "[ Start Listening ]";
    btn.className = "btn btn-start";
    dot.className = "status-dot";
    text.textContent = "Not listening";
    text.className = "";
    stats.style.display = "none";
  }
}

// ── Timer that shows call duration ──
function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!startTime) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    document.getElementById("duration").textContent =
      `${mins}:${secs.toString().padStart(2, "0")}`;
  }, 1000);
}

// ── Listen for suggestion count updates from background ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "suggestionCount") {
    document.getElementById("suggestions").textContent = msg.count;
    chrome.storage.local.set({ suggestionCount: msg.count });
  }
});
