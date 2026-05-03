/**
 * Imperium Recorder — Background Service Worker
 *
 * Coordinates between side panel, content scripts, and extension lifecycle.
 * Manages flow storage, tab state, and agent command dispatch.
 */

// ── Side Panel ──────────────────────────────────────────────────────

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
    // Fallback: open side panel for current window
    chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT }).catch(() => {});
  });
});

// ── Tab state tracking ─────────────────────────────────────────────

const tabState = new Map(); // tabId -> { recording, actions, url }

// ── Message routing ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "CONTENT_READY":
      // Content script injected, update tab state
      if (sender.tab?.id) {
        const state = tabState.get(sender.tab.id) || {};
        state.url = msg.url;
        tabState.set(sender.tab.id, state);
      }
      sendResponse({ ok: true });
      break;

    case "ACTION_RECORDED":
      // Forward to side panel
      chrome.runtime.sendMessage({
        type: "ACTION_RECORDED",
        payload: msg.payload,
      }).catch(() => {});
      sendResponse({ ok: true });
      break;

    case "PAGE_UNLOADING":
      // Save actions before navigation
      if (sender.tab?.id) {
        const state = tabState.get(sender.tab.id) || {};
        state.pendingActions = msg.payload.actions;
        tabState.set(sender.tab.id, state);
      }
      sendResponse({ ok: true });
      break;

    case "GET_TAB_INFO":
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        sendResponse({
          id: tab?.id,
          url: tab?.url,
          title: tab?.title,
          state: tab?.id ? tabState.get(tab.id) : null,
        });
      });
      return true; // async

    case "START_RECORDING":
      injectContentScript(sender.tab?.id || msg.tabId).then(() => {
        if (msg.tabId) {
          const state = tabState.get(msg.tabId) || {};
          state.recording = true;
          state.actions = [];
          tabState.set(msg.tabId, state);
        }
        sendResponse({ ok: true });
      });
      return true; // async

    case "STOP_RECORDING":
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.id) {
          const state = tabState.get(tab.id) || {};
          state.recording = false;
          tabState.set(tab.id, state);
        }
        sendResponse({ ok: true });
      });
      return true;

    case "SCREENSHOT":
      chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
        sendResponse({ dataUrl });
      });
      return true; // async

    case "EXPORT_FLOW":
      saveFlow(msg.payload).then((result) => {
        sendResponse(result);
      }).catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case "LIST_FLOWS":
      listFlows().then(flows => sendResponse({ flows })).catch(() => sendResponse({ flows: [] }));
      return true;

    case "DELETE_FLOW":
      deleteFlow(msg.id).then(() => sendResponse({ ok: true })).catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case "EXECUTE_ACTIONS":
      executeActionsOnTab(msg.tabId, msg.actions).then(r => sendResponse(r)).catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
  }
});

// ── Content script injection ───────────────────────────────────────

async function injectContentScript(tabId) {
  if (!tabId) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tabs[0]?.id;
  }
  if (!tabId) return;

  try {
    // Send START_RECORDING to existing content script
    await chrome.tabs.sendMessage(tabId, { type: "START_RECORDING" });
  } catch {
    // Content script not injected yet — inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      // Wait a tick then send
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { type: "START_RECORDING" }).catch(() => {});
      }, 200);
    } catch (err) {
      console.error("[Imperium Recorder] Failed to inject content script:", err);
    }
  }
}

// ── Action execution on tab ────────────────────────────────────────

async function executeActionsOnTab(tabId, actions) {
  if (!tabId) return { ok: false, error: "No tab ID" };

  const results = [];
  for (const action of actions) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "EXECUTE_ACTION",
        payload: action,
      });
      results.push(result);
      if (!result.success) {
        return { ok: false, results, error: result.error };
      }
    } catch (err) {
      return { ok: false, results, error: err.message };
    }
  }
  return { ok: true, results };
}

// ── Flow storage ───────────────────────────────────────────────────

const FLOWS_KEY = "imperium_flows";

async function saveFlow(flow) {
  const { family, variant } = flow;
  if (!family || !variant) return { ok: false, error: "Flow requires family and variant" };

  const data = await chrome.storage.local.get(FLOWS_KEY);
  const flows = data[FLOWS_KEY] || {};

  const key = `${family}/${variant}`;
  flows[key] = {
    ...flow,
    saved_at: new Date().toISOString(),
  };

  await chrome.storage.local.set({ [FLOWS_KEY]: flows });
  return { ok: true, key };
}

async function listFlows() {
  const data = await chrome.storage.local.get(FLOWS_KEY);
  const flows = data[FLOWS_KEY] || {};
  return Object.entries(flows).map(([key, flow]) => ({
    key,
    family: flow.family,
    variant: flow.variant,
    description: flow.description,
    url: flow.url,
    stepCount: flow.steps?.length || 0,
    saved_at: flow.saved_at,
  }));
}

async function deleteFlow(key) {
  const data = await chrome.storage.local.get(FLOWS_KEY);
  const flows = data[FLOWS_KEY] || {};
  delete flows[key];
  await chrome.storage.local.set({ [FLOWS_KEY]: flows });
}

// ── Tab lifecycle ──────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    // Re-inject content script on navigation
    const state = tabState.get(tabId);
    if (state?.recording) {
      injectContentScript(tabId);
    }
    // Notify side panel
    chrome.runtime.sendMessage({
      type: "TAB_UPDATED",
      tabId,
      url: tab.url,
      title: tab.title,
    }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});
