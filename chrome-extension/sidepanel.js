/**
 * Imperium Recorder — Side Panel Logic
 *
 * Manages recording state, action display, flow save/load, export,
 * and agent bridge. Communicates with content scripts via background worker.
 */

// ── State ──────────────────────────────────────────────────────────

let isRecording = false;
let actions = [];
let currentTabId = null;
let currentUrl = "";
let agentBridge = null; // WebSocket

// ── DOM refs ───────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  btnToggle: $("#btnToggleRecord"),
  btnToggleIcon: $("#btnToggleIcon"),
  btnToggleText: $("#btnToggleText"),
  btnClear: $("#btnClear"),
  btnExport: $("#btnExport"),
  actionList: $("#actionList"),
  actionCount: $("#actionCount"),
  tabUrl: $("#tabUrl"),
  tabActions: $("#tabActions"),
  tabStatus: $("#tabStatus"),
  flowList: $("#flowList"),
  modalSave: $("#modalSave"),
  inputFamily: $("#inputFamily"),
  inputVariant: $("#inputVariant"),
  inputDesc: $("#inputDesc"),
  toastContainer: $("#toastContainer"),
};

// ── Tab switching ──────────────────────────────────────────────────

document.querySelector(".tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;

  $$(".tab-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  const panel = btn.dataset.panel;
  $("#panelRecord").style.display = panel === "record" ? "" : "none";
  $("#panelFlows").style.display = panel === "flows" ? "" : "none";
  $("#panelAgent").style.display = panel === "agent" ? "" : "none";

  if (panel === "flows") loadFlows();
});

// ── Init ───────────────────────────────────────────────────────────

async function init() {
  // Get current tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    currentTabId = tabs[0].id;
    currentUrl = tabs[0].url || "about:blank";
    dom.tabUrl.textContent = currentUrl;
  }

  // Check if already recording
  try {
    const res = await chrome.runtime.sendMessage({ type: "GET_TAB_INFO" });
    if (res?.state?.recording) {
      isRecording = true;
      updateRecordUI();
    }
  } catch {}

  // Request current actions from content script
  refreshActions();
}

// ── Recording toggle ───────────────────────────────────────────────

dom.btnToggle.addEventListener("click", async () => {
  if (!currentTabId) {
    toast("No active tab", "error");
    return;
  }

  if (isRecording) {
    await stopRecording();
  } else {
    await startRecording();
  }
});

async function startRecording() {
  try {
    await chrome.runtime.sendMessage({ type: "START_RECORDING", tabId: currentTabId });
    isRecording = true;
    actions = [];
    renderActions();
    updateRecordUI();
    dom.tabStatus.textContent = "● recording";
    dom.tabStatus.style.color = "#e53935";
    dom.btnClear.disabled = false;
    dom.btnExport.disabled = false;
    toast("Recording started — perform actions on the page");
  } catch (err) {
    toast(`Failed to start: ${err.message}`, "error");
  }
}

async function stopRecording() {
  try {
    const res = await chrome.tabs.sendMessage(currentTabId, { type: "STOP_RECORDING" });
    if (res?.actions) {
      actions = [...res.actions];
      currentUrl = res.url || currentUrl;
      dom.tabUrl.textContent = currentUrl;
      renderActions();
    }
  } catch (err) {
    // Content script may have been unloaded — use cached actions
  }

  await chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
  isRecording = false;
  updateRecordUI();
  dom.tabStatus.textContent = "idle";
  dom.tabStatus.style.color = "#8b949e";
  dom.actionCount.textContent = actions.length;
  dom.tabActions.textContent = `${actions.length} actions`;
}

function updateRecordUI() {
  if (isRecording) {
    dom.btnToggle.classList.add("recording");
    dom.btnToggleIcon.textContent = "⏹";
    dom.btnToggleText.textContent = "Stop Recording";
    dom.btnToggle.style.background = "#e53935";
    dom.btnRecord.textContent = "⏹ Stop";
  } else {
    dom.btnToggle.classList.remove("recording");
    dom.btnToggleIcon.textContent = "⏺";
    dom.btnToggleText.textContent = "Start Recording";
    dom.btnToggle.style.background = "";
    dom.btnRecord.textContent = "⏺ Record";
  }
}

// ── Clear ──────────────────────────────────────────────────────────

dom.btnClear.addEventListener("click", () => {
  actions = [];
  renderActions();
  dom.actionCount.textContent = "0";
  dom.tabActions.textContent = "0 actions";
});

// ── Listen for real-time action updates ────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "ACTION_RECORDED":
      if (isRecording && msg.payload) {
        actions.push(msg.payload.action);
        renderActions();
        dom.actionCount.textContent = actions.length;
        dom.tabActions.textContent = `${actions.length} actions`;
      }
      break;

    case "TAB_UPDATED":
      if (msg.tabId === currentTabId) {
        currentUrl = msg.url || currentUrl;
        dom.tabUrl.textContent = currentUrl;
      }
      break;
  }
});

// ── Render actions ─────────────────────────────────────────────────

function renderActions() {
  if (actions.length === 0) {
    dom.actionList.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🎬</div>
        <div>${isRecording ? "Waiting for actions..." : "Click Record to start capturing actions"}</div>
        <div style="font-size:11px;margin-top:4px">Clicks, typing, scrolling — all saved as imperium-crawl flows</div>
      </div>`;
    return;
  }

  dom.actionList.innerHTML = actions.map((action, i) => {
    const a = action.action || action;
    const iconMap = {
      click: { emoji: "👆", cls: "ai-click" },
      type: { emoji: "⌨", cls: "ai-type" },
      select: { emoji: "📋", cls: "ai-type" },
      navigate: { emoji: "🔗", cls: "ai-nav" },
      scroll: { emoji: "↕", cls: "ai-scroll" },
      wait: { emoji: "⏳", cls: "ai-wait" },
      press: { emoji: "⌨", cls: "ai-type" },
      hover: { emoji: "🖱", cls: "ai-click" },
      evaluate: { emoji: "⚡", cls: "ai-other" },
      screenshot: { emoji: "📸", cls: "ai-other" },
      refresh: { emoji: "🔄", cls: "ai-nav" },
      auto_click: { emoji: "🎯", cls: "ai-click" },
      upload: { emoji: "📤", cls: "ai-type" },
    };
    const icon = iconMap[a.type] || { emoji: "•", cls: "ai-other" };

    let target = "";
    if (a.selector) target = a.selector.slice(0, 40);
    else if (a.text) target = `"${a.text.slice(0, 30)}"`;
    else if (a.url) target = a.url.slice(0, 40);
    else if (a.key) target = `Key: ${a.key}`;
    else if (a.type === "scroll") target = `${a.direction || "down"} ${a.amount || 500}px`;
    else if (a.type === "wait") target = `${a.duration || a.milliseconds || 1000}ms`;

    return `
      <div class="action-item">
        <div class="action-icon ${icon.cls}">${icon.emoji}</div>
        <div class="action-detail">
          <div class="action-type">${a.type}</div>
          <div class="action-target">${target || "—"}</div>
        </div>
        <div class="action-idx">#${i + 1}</div>
      </div>`;
  }).join("");

  // Scroll to bottom
  dom.actionList.scrollTop = dom.actionList.scrollHeight;
}

// ── Refresh actions (from content script) ──────────────────────────

async function refreshActions() {
  if (!currentTabId) return;
  try {
    const res = await chrome.tabs.sendMessage(currentTabId, { type: "GET_ACTIONS" });
    if (res?.actions) {
      actions = res.actions;
      if (res.url) currentUrl = res.url;
      if (res.recording !== undefined) isRecording = res.recording;
      dom.tabUrl.textContent = currentUrl;
      renderActions();
      dom.actionCount.textContent = actions.length;
      dom.tabActions.textContent = `${actions.length} actions`;
      updateRecordUI();
    }
  } catch {}
}

// ── Save flow ──────────────────────────────────────────────────────

dom.btnExport.addEventListener("click", () => {
  if (actions.length === 0) {
    toast("No actions recorded", "error");
    return;
  }
  // Pre-fill family from domain
  try {
    const host = new URL(currentUrl).hostname.replace("www.", "").split(".")[0];
    dom.inputFamily.value = host || "";
  } catch {
    dom.inputFamily.value = "";
  }
  dom.inputVariant.value = "default";
  dom.inputDesc.value = "";
  dom.modalSave.style.display = "flex";
});

$("#btnSaveCancel").addEventListener("click", () => {
  dom.modalSave.style.display = "none";
});

$("#btnSaveConfirm").addEventListener("click", async () => {
  const family = dom.inputFamily.value.trim();
  const variant = dom.inputVariant.value.trim();

  if (!family || !variant) {
    toast("Family and variant are required", "error");
    return;
  }

  // Build flow in imperium-crawl format
  const flow = {
    family,
    variant,
    description: dom.inputDesc.value.trim() || `Recorded flow for ${currentUrl}`,
    url: currentUrl,
    steps: actions.map((a, i) => {
      const action = a.action || a;
      return {
        id: `step_${i + 1}`,
        type: action.type,
        ...(action.selector && { selector: action.selector }),
        ...(action.text && { text: action.text }),
        ...(action.value && { value: action.value }),
        ...(action.url && { url: action.url }),
        ...(action.key && { key: action.key }),
        ...(action.direction && { direction: action.direction }),
        ...(action.amount && { amount: action.amount }),
        ...(action.duration && { duration: action.duration }),
        ...(action.code && { code: action.code }),
      };
    }),
    evidence: {
      screenshots: false,
      html: false,
      markdown: true,
      action_log: true,
    },
  };

  try {
    const result = await chrome.runtime.sendMessage({ type: "EXPORT_FLOW", payload: flow });
    if (result.ok) {
      dom.modalSave.style.display = "none";
      toast(`Flow saved: ${result.key}`);
      // Copy to clipboard
      copyToClipboard(JSON.stringify(flow, null, 2));
    } else {
      toast(result.error || "Save failed", "error");
    }
  } catch (err) {
    toast(`Save failed: ${err.message}`, "error");
  }
});

// ── Copy / Download buttons (inline) ───────────────────────────────

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    toast("📋 Copied to clipboard");
  }).catch(() => {});
}

// ── Flow list ──────────────────────────────────────────────────────

async function loadFlows() {
  try {
    const { flows } = await chrome.runtime.sendMessage({ type: "LIST_FLOWS" });
    if (flows && flows.length > 0) {
      dom.flowList.innerHTML = flows.map((f) => `
        <div class="flow-item" data-key="${f.key}">
          <div>
            <div class="flow-name">${f.key}</div>
            <div class="flow-meta">${f.stepCount} steps · ${f.saved_at?.split("T")[0] || ""}</div>
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm btn-ghost" data-action="run" data-key="${f.key}">▶</button>
            <button class="btn btn-sm btn-ghost" data-action="delete" data-key="${f.key}">🗑</button>
          </div>
        </div>
      `).join("");
    } else {
      dom.flowList.innerHTML = '<div class="empty-state"><div class="emoji">📭</div><div>No flows saved yet</div></div>';
    }
  } catch {
    dom.flowList.innerHTML = '<div class="empty-state"><div class="emoji">⚠</div><div>Could not load flows</div></div>';
  }
}

dom.flowList.addEventListener("click", async (e) => {
  const action = e.target.closest("[data-action]");
  if (!action) return;
  const key = action.dataset.key;

  if (action.dataset.action === "delete") {
    await chrome.runtime.sendMessage({ type: "DELETE_FLOW", id: key });
    loadFlows();
    toast(`Deleted: ${key}`);
  } else if (action.dataset.action === "run") {
    toast("Run flow via CLI: imperiumcrawl run-flow " + key);
  }
});

$("#btnRefreshFlows").addEventListener("click", loadFlows);
$("#btnExportAll").addEventListener("click", async () => {
  const { flows } = await chrome.runtime.sendMessage({ type: "LIST_FLOWS" });
  const json = JSON.stringify(flows || [], null, 2);
  copyToClipboard(json);
});

// ── Agent bridge ───────────────────────────────────────────────────

$("#btnAgentToggle").addEventListener("click", () => {
  if (agentBridge) {
    stopAgentBridge();
  } else {
    startAgentBridge();
  }
});

function startAgentBridge() {
  toast("Agent bridge not available in side panel mode. Use the imperium-crawl CLI instead.");
  // The bridge would be implemented as a WebSocket server in the background
  // worker — but Chrome MV3 doesn't support long-lived WebSocket servers
  // in service workers. This would need a Native Messaging host.
  //
  // Alternative: imperiumcrawl can connect via chrome.debugger API
  // or use the extension as a relay.
}

function stopAgentBridge() {
  if (agentBridge) {
    agentBridge.close();
    agentBridge = null;
  }
  $("#btnAgentToggle").textContent = "▶ Start Agent Bridge";
  $("#btnAgentToggle").classList.remove("recording");
}

// ── Toast ──────────────────────────────────────────────────────────

function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  dom.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.3s";
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

// ── Settings button ────────────────────────────────────────────────

$("#btnSettings").addEventListener("click", () => {
  toast("Settings coming soon");
});

// ── Keyboard shortcut ──────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  // Ctrl+Shift+R → toggle recording
  if (e.ctrlKey && e.shiftKey && e.key === "R") {
    e.preventDefault();
    dom.btnToggle.click();
  }
});

// ── Start ──────────────────────────────────────────────────────────

init();
