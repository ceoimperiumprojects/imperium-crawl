/**
 * Browser-injected event recorder for the visual builder.
 *
 * Records five event types while the user interacts with the page:
 *   - click    — element clicks (Ctrl/Meta/middle-click passed through for new tabs)
 *   - input    — text typed into fields (debounced 500ms)
 *   - navigate — URL changes (polled every 500ms for SPA compat)
 *   - tab-open  — new tab/popup opened (emitted by Node)
 *   - tab-close — tab/popup closed (emitted by Node)
 *
 * Events are pushed to Node in real-time via __imperiumPushEvent__.
 * Clicking "End Workflow" signals completion (Node already has all events).
 */

export interface OverlayConfig {
  url: string;
}

export interface RecordedEvent {
  type: "click" | "input" | "navigate" | "tab-open" | "tab-close";
  selector: string;
  tagName: string;
  text: string;
  attributes: Record<string, string>;
  parentSelector: string;
  siblingIndex: number;
  timestamp: number;
  pageUrl: string;
  inputValue?: string;
  toUrl?: string;
  tabInfo?: {
    pageId: string;
    opener?: string;
  };
}

export function getOverlayScript(_config?: OverlayConfig): string {
  return `
(function() {
  "use strict";

  function __imperiumInit() {

  // Re-injection guard: addInitScript re-runs on same-tab navigation,
  // but window persists — prevent duplicate overlays and listeners.
  if (window.__imp_initialized) return;
  window.__imp_initialized = true;

  var eventCount = 0;

  // ── Helpers ──
  function buildSelector(el) {
    if (el.id && !el.id.startsWith("__imp_")) return "#" + el.id;
    var parts = [];
    var cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      var sel = cur.tagName.toLowerCase();
      if (cur.id && !cur.id.startsWith("__imp_")) {
        sel += "#" + cur.id;
        parts.unshift(sel);
        break;
      }
      if (cur.className && typeof cur.className === "string") {
        var cls = cur.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3);
        if (cls.length) sel += "." + cls.join(".");
      }
      // nth-child for disambiguation
      var parent = cur.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function(c) {
          return c.tagName === cur.tagName;
        });
        if (siblings.length > 1) {
          sel += ":nth-child(" + (Array.from(parent.children).indexOf(cur) + 1) + ")";
        }
      }
      parts.unshift(sel);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  function getAttributes(el) {
    var attrs = {};
    var dominated = ["href", "src", "alt", "title", "value", "type", "name",
                     "data-id", "data-url", "data-src", "datetime", "aria-label"];
    for (var i = 0; i < dominated.length; i++) {
      var v = el.getAttribute(dominated[i]);
      if (v) attrs[dominated[i]] = v;
    }
    if (el.className && typeof el.className === "string") {
      attrs["class"] = el.className.trim();
    }
    if (el.id) attrs["id"] = el.id;
    return attrs;
  }

  function getSiblingIndex(el) {
    if (!el.parentElement) return 0;
    return Array.from(el.parentElement.children).indexOf(el);
  }

  function getParentSelector(el) {
    var p = el.parentElement;
    if (!p || p === document.body) return "body";
    return buildSelector(p);
  }

  function pushEvent(evt) {
    if (window.__imperiumPushEvent__) {
      window.__imperiumPushEvent__(JSON.stringify(evt));
    }
    eventCount++;
    counter.textContent = eventCount + " event" + (eventCount !== 1 ? "s" : "");
  }

  // ── Recording Bar ──
  var bar = document.createElement("div");
  bar.id = "__imp_bar";
  bar.style.cssText = [
    "position: fixed", "top: 0", "left: 0", "right: 0", "z-index: 2147483647",
    "background: #1a1a2e", "color: #e0e0e0", "font: 13px/1 -apple-system, monospace",
    "padding: 10px 20px", "display: flex", "align-items: center", "gap: 16px",
    "box-shadow: 0 2px 12px rgba(0,0,0,0.5)", "user-select: none",
  ].join(" !important;") + " !important";

  // Recording dot
  var dot = document.createElement("span");
  dot.style.cssText = "width:10px;height:10px;border-radius:50%;background:#e74c3c;display:inline-block;animation:__imp_pulse 1.5s infinite";
  var style = document.createElement("style");
  style.textContent = "@keyframes __imp_pulse{0%,100%{opacity:1}50%{opacity:0.3}}";
  document.head.appendChild(style);

  // Label
  var label = document.createElement("span");
  label.style.cssText = "color: #ccc !important; font-size: 13px !important;";
  label.textContent = "Recording";

  // Counter
  var counter = document.createElement("span");
  counter.style.cssText = "color: #4A90D9 !important; font-weight: bold !important; font-size: 14px !important;";
  counter.textContent = "0 events";

  // End button
  var endBtn = document.createElement("button");
  endBtn.textContent = "End Workflow";
  endBtn.style.cssText = [
    "margin-left: auto", "background: #27ae60", "color: white", "border: none",
    "padding: 8px 20px", "border-radius: 4px", "cursor: pointer",
    "font: bold 13px -apple-system, monospace",
  ].join(" !important;") + " !important";
  endBtn.addEventListener("mouseenter", function() { endBtn.style.opacity = "0.85"; });
  endBtn.addEventListener("mouseleave", function() { endBtn.style.opacity = "1"; });

  bar.appendChild(dot);
  bar.appendChild(label);
  bar.appendChild(counter);
  bar.appendChild(endBtn);
  document.documentElement.appendChild(bar);

  // Push page down
  document.body.style.setProperty("margin-top", bar.offsetHeight + "px", "important");

  // ── Flash highlight ──
  function flash(el) {
    var prev = el.style.outline;
    el.style.setProperty("outline", "3px solid #4A90D9", "important");
    setTimeout(function() {
      if (prev) el.style.outline = prev;
      else el.style.removeProperty("outline");
    }, 600);
  }

  // ── Hover highlight ──
  var hovered = null;
  function onMove(e) {
    if (hovered) hovered.style.removeProperty("outline");
    var el = e.target;
    if (el.closest && el.closest("#__imp_bar")) return;
    hovered = el;
    el.style.setProperty("outline", "2px solid rgba(74,144,217,0.5)", "important");
  }
  function onOut() {
    if (hovered) { hovered.style.removeProperty("outline"); hovered = null; }
  }

  // ── Click Capture ──
  function onClick(e) {
    var el = e.target;
    if (el.closest && el.closest("#__imp_bar")) return;

    // Allow Ctrl+Click, Cmd+Click, and middle-click to open new tabs
    var isNewTabGesture = e.ctrlKey || e.metaKey || e.button === 1;
    if (!isNewTabGesture) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }

    if (hovered) hovered.style.removeProperty("outline");

    flash(el);

    pushEvent({
      type: "click",
      selector: buildSelector(el),
      tagName: el.tagName.toLowerCase(),
      text: (el.textContent || "").trim().substring(0, 200),
      attributes: getAttributes(el),
      parentSelector: getParentSelector(el),
      siblingIndex: getSiblingIndex(el),
      timestamp: Date.now(),
      pageUrl: location.href,
    });
  }

  // ── Input Capture (debounced 500ms) ──
  var inputTimers = {};
  function onInput(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && !el.isContentEditable) return;
    if (el.closest && el.closest("#__imp_bar")) return;

    var key = buildSelector(el);
    if (inputTimers[key]) clearTimeout(inputTimers[key]);

    inputTimers[key] = setTimeout(function() {
      delete inputTimers[key];
      var value = el.isContentEditable
        ? (el.textContent || "").trim()
        : (el.value || "");

      flash(el);

      pushEvent({
        type: "input",
        selector: key,
        tagName: tag,
        text: value.substring(0, 200),
        attributes: getAttributes(el),
        parentSelector: getParentSelector(el),
        siblingIndex: getSiblingIndex(el),
        timestamp: Date.now(),
        inputValue: value.substring(0, 500),
        pageUrl: location.href,
      });
    }, 500);
  }

  // ── Navigation Tracking (poll 500ms) ──
  var lastUrl = location.href;
  var navInterval = setInterval(function() {
    var current = location.href;
    if (current !== lastUrl) {
      pushEvent({
        type: "navigate",
        selector: "",
        tagName: "",
        text: document.title || "",
        attributes: {},
        parentSelector: "",
        siblingIndex: 0,
        timestamp: Date.now(),
        toUrl: current,
        pageUrl: current,
      });
      lastUrl = current;
    }
  }, 500);

  // ── End Workflow ──
  endBtn.addEventListener("click", function(e) {
    e.stopPropagation();

    // Cleanup
    clearInterval(navInterval);
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseout", onOut, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("input", onInput, true);
    document.body.style.removeProperty("margin-top");
    if (bar.parentNode) bar.parentNode.removeChild(bar);

    if (window.__imperiumComplete__) {
      window.__imperiumComplete__();
    }
  });

  // ── Register ──
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseout", onOut, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("input", onInput, true);

  } // end __imperiumInit

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", __imperiumInit);
  } else {
    __imperiumInit();
  }
})();
`;
}
