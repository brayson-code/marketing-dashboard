// ── Navigation ──────────────────────────────────────────────
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    item.classList.add("active");
    document.getElementById("page-" + item.dataset.page).classList.add("active");
  });
});

// ── Toggle (post-call summary enable) ───────────────────────
let summaryEnabled = false;

function setToggle(enabled) {
  summaryEnabled = enabled;
  const toggle = document.getElementById("summary-toggle");
  const status = document.getElementById("summary-toggle-status");
  if (enabled) {
    toggle.classList.add("on");
    status.textContent = "[ENABLED]";
    status.className = "toggle-status on";
  } else {
    toggle.classList.remove("on");
    status.textContent = "[DISABLED]";
    status.className = "toggle-status off";
  }
}

document.getElementById("summary-toggle").addEventListener("click", () => {
  setToggle(!summaryEnabled);
});

// ── Checkboxes ───────────────────────────────────────────────
function initCheckboxes() {
  document.querySelectorAll(".check-item").forEach((item) => {
    const input = item.querySelector("input[type='checkbox']");
    const box = item.querySelector(".check-box");

    function sync() {
      if (input.checked) {
        item.classList.add("checked");
        box.textContent = "X";
      } else {
        item.classList.remove("checked");
        box.textContent = " ";
      }
    }

    sync();

    item.addEventListener("click", (e) => {
      if (e.target !== input) input.checked = !input.checked;
      sync();
    });
  });
}

initCheckboxes();

function getCheckedFields() {
  return Array.from(document.querySelectorAll(".check-item input:checked")).map((i) => i.value);
}

function setCheckedFields(fields) {
  document.querySelectorAll(".check-item input").forEach((input) => {
    input.checked = fields.includes(input.value);
  });
  initCheckboxes();
}

// ── Connection status helper ─────────────────────────────────
function refreshConnStatus(hasToken) {
  const connected = !!hasToken;
  const label = connected ? "[CONNECTED]" : "[NOT CONNECTED]";
  const inline = document.getElementById("conn-status-inline");
  const sidebar = document.getElementById("conn-status");
  const titlebar = document.getElementById("conn-status-titlebar");
  if (inline) {
    inline.textContent = label;
    inline.className = connected ? "toggle-status on" : "toggle-status off";
  }
  if (sidebar) {
    sidebar.textContent = label;
    sidebar.className = connected ? "ok" : "warn";
  }
  if (titlebar) titlebar.textContent = connected ? "ONLINE" : "OFFLINE";
}

// ── Load saved settings ──────────────────────────────────────
chrome.storage.local.get([
  "pifPersona",
  "pifPlaybookObjections",
  "pifPlaybookClosing",
  "pifPlaybookValue",
  "pifObjectionKeywords",
  "pifInterval",
  "pifApiUrl",
  "pifCompanyName",
  "pifProductName",
  "pifPricing",
  "pifDifferentiators",
  "pifSummaryEnabled",
  "pifSummaryFields",
  "salesopsToken",
], (data) => {
  if (data.salesopsToken) document.getElementById("salesops-token").value = data.salesopsToken;
  refreshConnStatus(data.salesopsToken);
  const readout = document.getElementById("api-endpoint-readout");
  if (readout) readout.textContent = data.pifApiUrl || "https://command.keyplayershq.com";
  if (data.pifPersona)            document.getElementById("persona").value            = data.pifPersona;
  if (data.pifPlaybookObjections) document.getElementById("playbook-objections").value = data.pifPlaybookObjections;
  if (data.pifPlaybookClosing)    document.getElementById("playbook-closing").value    = data.pifPlaybookClosing;
  if (data.pifPlaybookValue)      document.getElementById("playbook-value").value      = data.pifPlaybookValue;
  if (data.pifCompanyName)        document.getElementById("company-name").value        = data.pifCompanyName;
  if (data.pifProductName)        document.getElementById("product-name").value        = data.pifProductName;
  if (data.pifPricing)            document.getElementById("pricing").value             = data.pifPricing;
  if (data.pifDifferentiators)    document.getElementById("differentiators").value     = data.pifDifferentiators;
  if (data.pifInterval)           document.getElementById("suggestion-interval").value = data.pifInterval / 1000;
  if (data.pifApiUrl)             document.getElementById("api-url").value             = data.pifApiUrl;

  if (data.pifObjectionKeywords) {
    document.getElementById("objection-keywords").value = data.pifObjectionKeywords.join("\n");
  }

  setToggle(!!data.pifSummaryEnabled);

  if (data.pifSummaryFields) {
    setCheckedFields(data.pifSummaryFields);
  }
});

// ── Save ─────────────────────────────────────────────────────
document.getElementById("saveBtn").addEventListener("click", () => {
  const status = document.getElementById("saveStatus");
  status.className = "save-status";

  const keywords = document.getElementById("objection-keywords").value
    .split("\n").map((k) => k.trim()).filter(Boolean);

  const intervalSecs = parseInt(document.getElementById("suggestion-interval").value, 10);

  const companyName     = document.getElementById("company-name").value.trim();
  const productName     = document.getElementById("product-name").value.trim();
  const pricing         = document.getElementById("pricing").value.trim();
  const differentiators = document.getElementById("differentiators").value.trim();

  // Build combined playbook for the API
  const playbookSections = [
    document.getElementById("playbook-objections").value.trim(),
    document.getElementById("playbook-closing").value.trim(),
    document.getElementById("playbook-value").value.trim(),
  ].filter(Boolean);

  const salesopsToken = document.getElementById("salesops-token").value.trim();
  const apiUrl = document.getElementById("api-url").value.trim().replace(/\/+$/, "");

  chrome.storage.local.set({
    pifPersona:            document.getElementById("persona").value.trim(),
    pifPlaybookObjections: document.getElementById("playbook-objections").value.trim(),
    pifPlaybookClosing:    document.getElementById("playbook-closing").value.trim(),
    pifPlaybookValue:      document.getElementById("playbook-value").value.trim(),
    pifPlaybook:           playbookSections.join("\n\n---\n\n"),
    pifObjectionKeywords:  keywords,
    pifInterval:           (isNaN(intervalSecs) ? 15 : intervalSecs) * 1000,
    pifApiUrl:             apiUrl,
    salesopsToken:         salesopsToken,
    pifCompanyName:        companyName,
    pifProductName:        productName,
    pifPricing:            pricing,
    pifDifferentiators:    differentiators,
    pifSummaryEnabled:     summaryEnabled,
    pifSummaryFields:      getCheckedFields(),
  }, () => {
    refreshConnStatus(salesopsToken);
    const readout = document.getElementById("api-endpoint-readout");
    if (readout) readout.textContent = apiUrl || "https://command.keyplayershq.com";
    status.textContent = "> SAVED [OK]";
    status.className = "save-status ok";
    setTimeout(() => { status.textContent = ""; status.className = "save-status"; }, 3000);
  });
});
