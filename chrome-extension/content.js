/**
 * Imperium Recorder — Content Script
 *
 * Injected into every page. Captures user interactions (click, type, scroll,
 * navigate) and sends them to the side panel in real time.
 *
 * Format matches imperium-crawl's ActionInput — recorded flows can be used
 * directly with `imperiumcrawl run-flow` or `run-skill`.
 */

(() => {
  // ── State ─────────────────────────────────────────────────────────
  let recording = false;
  let actions = [];
  let observer = null;

  // ── DOM helpers ───────────────────────────────────────────────────

  function getSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return "body";

    // Try ref-based targeting from ARIA attributes
    const ariaRef = el.getAttribute("data-imperium-ref");
    if (ariaRef) return `@ref:${ariaRef}`;

    // Try ID
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
      // Check uniqueness
      if (document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
        return `#${CSS.escape(el.id)}`;
      }
    }

    // Try name attribute
    if (el.name) return `[name="${CSS.escape(el.name)}"]`;

    // Try aria-label
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.length < 100) {
      return `[aria-label="${CSS.escape(ariaLabel)}"]`;
    }

    // Try data-testid
    const testId = el.getAttribute("data-testid");
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

    // Try role + accessible name
    const role = el.getAttribute("role");
    if (role) {
      const name = el.textContent?.trim().slice(0, 30);
      if (name) return `[role="${CSS.escape(role)}"]:has-text("${CSS.escape(name)}")`;
    }

    // Build path with nth-child
    let path = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement && path.length < 6) {
      let segment = current.tagName.toLowerCase();
      if (current.id) { path.unshift(`#${CSS.escape(current.id)}`); break; }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          segment += `:nth-child(${idx})`;
        }
      }
      path.unshift(segment);
      current = current.parentElement;
    }
    return path.join(" > ");
  }

  function getClickXY(e) {
    return { x: Math.round(e.clientX), y: Math.round(e.clientY) };
  }

  // ── CSS.escape polyfill ───────────────────────────────────────────
  // (Chrome supports it natively, but just in case)
  const CSS = window.CSS || { escape: (s) => s.replace(/[!"#$%&'()*+,.\/:;<=>?@[\]^`{|}~]/g, "\\$&") };

  // ── Event recorder ────────────────────────────────────────────────

  function record(action) {
    if (!recording) return;
    const entry = {
      action,
      pageUrl: window.location.href,
      pageTitle: document.title,
      timestamp: Date.now(),
    };
    actions.push(entry);

    // Send to side panel in real time
    try {
      chrome.runtime.sendMessage({
        type: "ACTION_RECORDED",
        payload: entry,
      }).catch(() => {});
    } catch {}
  }

  // ── Click handler ─────────────────────────────────────────────────

  document.addEventListener("click", (e) => {
    if (!recording) return;
    const el = e.target.closest("a, button, input, select, textarea, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='option'], [onclick]");
    const target = el || e.target;
    const selector = getSelector(target);
    const { x, y } = getClickXY(e);

    record({
      type: "click",
      selector,
      ...(x !== undefined && { x, y }),
    });
  }, true);

  // ── Input handler ─────────────────────────────────────────────────

  document.addEventListener("change", (e) => {
    if (!recording) return;
    const el = e.target;
    if (!["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;

    const selector = getSelector(el);

    if (el.tagName === "SELECT") {
      record({
        type: "select",
        selector,
        value: el.value,
      });
    } else if (el.type === "file") {
      record({
        type: "upload",
        selector,
        value: el.files?.[0]?.name || "file",
      });
    } else {
      // For text inputs, debounce — record on blur instead of every keystroke
      // We record the FINAL value on blur
    }
  }, true);

  // Record final input value on blur
  document.addEventListener("blur", (e) => {
    if (!recording) return;
    const el = e.target;
    if (!["INPUT", "TEXTAREA"].includes(el.tagName)) return;
    if (el.type === "file" || el.type === "checkbox" || el.type === "radio") return;

    const selector = getSelector(el);
    const value = el.value;
    if (!value) return;

    record({ type: "type", selector, text: value });
  }, true);

  // ── Scroll handler ────────────────────────────────────────────────

  let scrollTimeout;
  let lastScrollY = window.scrollY;

  window.addEventListener("scroll", () => {
    if (!recording) return;
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      const currentY = window.scrollY;
      const diff = currentY - lastScrollY;
      if (Math.abs(diff) < 50) return; // ignore tiny scrolls

      record({
        type: "scroll",
        direction: diff > 0 ? "down" : "up",
        amount: Math.abs(diff),
      });
      lastScrollY = currentY;
    }, 500);
  }, { passive: true });

  // ── Keyboard handler ──────────────────────────────────────────────

  document.addEventListener("keydown", (e) => {
    if (!recording) return;

    // Only record Enter on focused inputs
    if (e.key === "Enter") {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA"].includes(el.tagName)) {
        record({ type: "press", key: "Enter" });
      }
    }

    // Escape key
    if (e.key === "Escape") {
      record({ type: "press", key: "Escape" });
    }
  }, true);

  // ── Navigate detection ────────────────────────────────────────────

  // Before the page unloads (navigation), save actions
  window.addEventListener("beforeunload", () => {
    if (recording && actions.length > 0) {
      try {
        chrome.runtime.sendMessage({
          type: "PAGE_UNLOADING",
          payload: {
            url: window.location.href,
            actions: [...actions],
          },
        }).catch(() => {});
      } catch {}
    }
  });

  // ── Message handler ───────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case "START_RECORDING":
        recording = true;
        actions = [];
        lastScrollY = window.scrollY;
        // Inject visual indicator
        injectRecordingIndicator();
        // Mark elements with refs for better selectors
        annotateElements();
        sendResponse({ ok: true });
        break;

      case "STOP_RECORDING":
        recording = false;
        removeRecordingIndicator();
        sendResponse({ ok: true, actions: [...actions], url: window.location.href });
        break;

      case "GET_ACTIONS":
        sendResponse({ actions: [...actions], url: window.location.href, recording });
        break;

      case "EXECUTE_ACTION":
        executeAction(msg.payload).then(r => sendResponse(r));
        return true; // async response

      case "GET_PAGE_STATE":
        sendResponse({
          url: window.location.href,
          title: document.title,
          readyState: document.readyState,
        });
        break;

      case "PING":
        sendResponse({ pong: true });
        break;
    }
  });

  // ── Visual indicator ──────────────────────────────────────────────

  function injectRecordingIndicator() {
    if (document.getElementById("__imperium_recorder_badge__")) return;
    const badge = document.createElement("div");
    badge.id = "__imperium_recorder_badge__";
    badge.innerHTML = `
      <div style="
        position: fixed; top: 12px; right: 12px; z-index: 2147483647;
        background: #e53935; color: #fff; font-family: system-ui, sans-serif;
        font-size: 12px; font-weight: 600; padding: 6px 12px;
        border-radius: 20px; display: flex; align-items: center; gap: 6px;
        box-shadow: 0 2px 12px rgba(229,57,53,0.4);
        pointer-events: none;
        animation: __imperium_pulse__ 1.5s ease-in-out infinite;
      ">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fff;"></span>
        REC ●
      </div>
      <style>
        @keyframes __imperium_pulse__ {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      </style>
    `;
    document.body.appendChild(badge);
  }

  function removeRecordingIndicator() {
    const badge = document.getElementById("__imperium_recorder_badge__");
    if (badge) badge.remove();
  }

  // ── Element annotation ────────────────────────────────────────────

  function annotateElements() {
    // Add data-imperium-ref to interactive elements for better targeting
    const interactive = document.querySelectorAll(
      'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"]'
    );
    interactive.forEach((el, i) => {
      if (i > 500) return; // cap
      if (!el.hasAttribute("data-imperium-ref")) {
        el.setAttribute("data-imperium-ref", `e${i + 1}`);
      }
    });
  }

  // ── Action executor (for agent control) ───────────────────────────

  async function executeAction(action) {
    try {
      switch (action.type) {
        case "navigate":
          window.location.href = action.url;
          return { success: true, url: action.url };

        case "click": {
          const el = findElement(action.selector);
          if (!el) return { success: false, error: `Element not found: ${action.selector}` };
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          await sleep(300);
          el.click();
          return { success: true, selector: action.selector };
        }

        case "type": {
          const el = findElement(action.selector);
          if (!el) return { success: false, error: `Element not found: ${action.selector}` };
          el.focus();
          el.value = "";
          // Simulate typing
          for (const char of action.text || "") {
            el.value += char;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            await sleep(30);
          }
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { success: true, selector: action.selector };
        }

        case "select": {
          const el = findElement(action.selector);
          if (!el || el.tagName !== "SELECT") {
            return { success: false, error: `Select not found: ${action.selector}` };
          }
          el.value = action.value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { success: true };
        }

        case "scroll":
          window.scrollBy({
            top: action.direction === "up" ? -(action.amount || 500) : (action.amount || 500),
            behavior: "smooth",
          });
          return { success: true };

        case "wait":
          await sleep(action.duration || action.milliseconds || 1000);
          return { success: true };

        case "evaluate": {
          const result = eval(action.code);
          return { success: true, result };
        }

        case "screenshot":
          // Screenshot via background -> chrome.tabs.captureVisibleTab
          return { success: true, note: "Screenshot handled by background worker" };

        case "press": {
          const el = document.activeElement || document.body;
          el.dispatchEvent(new KeyboardEvent("keydown", { key: action.key, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent("keyup", { key: action.key, bubbles: true }));
          return { success: true, key: action.key };
        }

        case "hover": {
          const el = findElement(action.selector);
          if (!el) return { success: false, error: `Element not found: ${action.selector}` };
          el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          return { success: true };
        }

        case "refresh":
          window.location.reload();
          return { success: true };

        default:
          return { success: false, error: `Unknown action type: ${action.type}` };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function findElement(selector) {
    if (!selector) return null;
    // Ref-based
    if (selector.startsWith("@ref:")) {
      const ref = selector.slice(5);
      return document.querySelector(`[data-imperium-ref="${CSS.escape(ref)}"]`);
    }
    // has-text pseudo
    if (selector.includes(":has-text(")) {
      const match = selector.match(/^(.*):has-text\("(.+)"\)$/);
      if (match) {
        const [, base, text] = match;
        const candidates = document.querySelectorAll(base);
        for (const c of candidates) {
          if (c.textContent?.trim().includes(text)) return c;
        }
        return null;
      }
    }
    return document.querySelector(selector);
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Signal that content script is ready
  try {
    chrome.runtime.sendMessage({ type: "CONTENT_READY", url: window.location.href });
  } catch {}
})();
