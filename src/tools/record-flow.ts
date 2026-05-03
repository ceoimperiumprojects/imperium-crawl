import { z } from "zod";
import readline from "node:readline";
import { toolResult, errorResult } from "../utils/tool-response.js";
import {
  saveFlow,
  validateFlowName,
  type FlowDefinition,
  type FlowRecording,
  type FlowRecordingEvent,
  type FlowStep,
  type SmartTarget,
} from "../flows/index.js";
import { normalizeUrl } from "../utils/url.js";
import { executeAction, type ActionInput } from "../core/action-executor.js";
import { detectParameterCandidates } from "../skills/index.js";

export const name = "record_flow";
export const description = "Record a headed browser workflow and save it as a generic Imperium Flow family/variant.";

export const schema = z.object({
  family: z.string().regex(/^[a-zA-Z0-9_-]+$/).describe("Flow family name"),
  variant: z.string().regex(/^[a-zA-Z0-9_-]+$/).describe("Flow variant name"),
  url: z.string().describe("Starting URL"),
  description: z.string().optional().describe("Flow description"),
  flows_dir: z.string().optional().describe("Flow storage directory override"),
  global: z.boolean().default(false).describe("Use ~/.imperium-crawl/flows instead of ./flows"),
  session_id: z.string().optional().describe("Session ID to associate with the saved flow"),
  captcha: z.enum(["auto", "manual", "off", "fail"]).default("auto").describe("Default CAPTCHA policy"),
});

export type RecordFlowInput = z.infer<typeof schema>;

const MAX_RECORDED_EVENTS = 2_000;
const MAX_NETWORK_EVENTS = 1_000;

function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function stepFromAction(action: ActionInput, output?: string): FlowStep {
  return {
    ...action,
    ...(action.selector && { target: { selector: action.selector } }),
    ...(output && { output, output_from: "result" as const }),
  } as FlowStep;
}

function compactTarget(target: unknown): SmartTarget | undefined {
  if (!target || typeof target !== "object") return undefined;
  const raw = target as Record<string, unknown>;
  return {
    tag: typeof raw.tag === "string" ? raw.tag : undefined,
    role: typeof raw.role === "string" ? raw.role : undefined,
    name: typeof raw.name === "string" ? raw.name : undefined,
    text: typeof raw.text === "string" ? raw.text : undefined,
    label: typeof raw.label === "string" ? raw.label : undefined,
    selector: typeof raw.selector === "string" ? raw.selector : undefined,
    xpath: typeof raw.xpath === "string" ? raw.xpath : undefined,
    attributes: typeof raw.attributes === "object" && raw.attributes ? raw.attributes as Record<string, string> : undefined,
    nearby_text: typeof raw.nearby_text === "string" ? raw.nearby_text : undefined,
    href: typeof raw.href === "string" ? raw.href : undefined,
    input_type: typeof raw.input_type === "string" ? raw.input_type : undefined,
    form_selector: typeof raw.form_selector === "string" ? raw.form_selector : undefined,
    x: typeof raw.x === "number" ? raw.x : undefined,
    y: typeof raw.y === "number" ? raw.y : undefined,
    viewport: typeof raw.viewport === "object" && raw.viewport ? raw.viewport as SmartTarget["viewport"] : undefined,
  };
}

function stepFromRecordedEvent(event: FlowRecordingEvent): FlowStep | null {
  if (!event.target) return null;
  if (event.type === "click" || event.type === "submit") {
    return {
      type: "click",
      selector: event.target.selector,
      target: event.target,
    } as FlowStep;
  }
  if (["input", "change", "select"].includes(event.type)) {
    return {
      type: event.target.tag === "select" || event.type === "select" ? "select" : "type",
      selector: event.target.selector,
      target: event.target,
      text: event.value,
      value: event.value,
    } as FlowStep;
  }
  return null;
}

function attachNetworkRecorder(page: import("rebrowser-playwright").Page, recording: FlowRecording): void {
  page.on("request", (request) => {
    if (recording.network.length >= MAX_NETWORK_EVENTS) return;
    recording.network.push({
      type: "request",
      timestamp: new Date().toISOString(),
      url: request.url(),
      method: request.method(),
      resource_type: request.resourceType(),
    });
  });

  page.on("response", (response) => {
    if (recording.network.length >= MAX_NETWORK_EVENTS) return;
    recording.network.push({
      type: "response",
      timestamp: new Date().toISOString(),
      url: response.url(),
      status: response.status(),
      content_type: response.headers()["content-type"],
    });
  });

  page.on("framenavigated", (frame) => {
    recording.navigations.push({
      timestamp: new Date().toISOString(),
      url: page.url(),
      frame_url: frame.url(),
    });
  });
}

async function installBrowserRecorder(page: import("rebrowser-playwright").Page, steps: FlowStep[], recording: FlowRecording): Promise<void> {
  await page.exposeFunction("__imperiumRecordFlowAction", (event: Record<string, unknown>) => {
    if (recording.events.length >= MAX_RECORDED_EVENTS) return;
    const recorded: FlowRecordingEvent = {
      type: typeof event.type === "string" ? event.type : "unknown",
      timestamp: typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString(),
      page_url: typeof event.page_url === "string" ? event.page_url : undefined,
      title: typeof event.title === "string" ? event.title : undefined,
      target: compactTarget(event.target),
      submitter: compactTarget(event.submitter),
      value: typeof event.value === "string" ? event.value : undefined,
      checked: typeof event.checked === "boolean" ? event.checked : undefined,
      selected_text: typeof event.selected_text === "string" ? event.selected_text : undefined,
      key: typeof event.key === "string" ? event.key : undefined,
    };
    recording.events.push(recorded);
    const step = stepFromRecordedEvent(recorded);
    if (step) {
      steps.push(step);
      process.stderr.write(`captured ${recorded.type} (${steps.length} replay step${steps.length === 1 ? "" : "s"})\n`);
    }
  });

  await page.addInitScript(() => {
    const now = () => new Date().toISOString();

    const cssPath = (el: Element): string => {
      if ((el as HTMLElement).id) return `#${CSS.escape((el as HTMLElement).id)}`;
      const testId = el.getAttribute("data-testid") || el.getAttribute("data-test");
      if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
      const name = el.getAttribute("name");
      if (name) return `${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur.nodeType === 1 && parts.length < 5) {
        let part = cur.tagName.toLowerCase();
        const parent: Element | null = cur.parentElement;
        if (parent) {
          const siblings = (Array.from(parent.children) as Element[]).filter((c: Element) => c.tagName === cur!.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
        }
        parts.unshift(part);
        cur = parent;
      }
      return parts.join(" > ");
    };

    const xpathFor = (el: Element): string => {
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur.nodeType === 1) {
        const parent: Element | null = cur.parentElement;
        if (!parent) {
          parts.unshift(`/${cur.tagName.toLowerCase()}`);
          break;
        }
        const sameTag = (Array.from(parent.children) as Element[]).filter((child: Element) => child.tagName === cur!.tagName);
        const index = sameTag.indexOf(cur) + 1;
        parts.unshift(`${cur.tagName.toLowerCase()}[${index}]`);
        cur = parent;
      }
      return "/" + parts.join("/");
    };

    const labelFor = (el: Element): string | undefined => {
      const id = (el as HTMLElement).id;
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label?.textContent?.trim()) return label.textContent.trim();
      }
      const wrapped = el.closest("label");
      return wrapped?.textContent?.trim() || undefined;
    };

    const attrsFor = (el: Element): Record<string, string> => {
      const attrs: Record<string, string> = {};
      for (const key of [
        "id",
        "name",
        "type",
        "placeholder",
        "aria-label",
        "aria-labelledby",
        "data-testid",
        "data-test",
        "data-cy",
        "href",
        "value",
        "autocomplete",
      ]) {
        const val = el.getAttribute(key);
        if (val) attrs[key] = val;
      }
      return attrs;
    };

    const targetFor = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120);
      const form = el.closest("form");
      const before = el.previousElementSibling?.textContent?.trim().replace(/\s+/g, " ").slice(0, 80);
      const after = el.nextElementSibling?.textContent?.trim().replace(/\s+/g, " ").slice(0, 80);
      return {
        tag: el.tagName.toLowerCase(),
        selector: cssPath(el),
        xpath: xpathFor(el),
        role: el.getAttribute("role") || undefined,
        name: el.getAttribute("aria-label") || text || undefined,
        text: text || undefined,
        label: labelFor(el),
        attributes: attrsFor(el),
        nearby_text: [before, after].filter(Boolean).join(" | ") || undefined,
        href: el instanceof HTMLAnchorElement ? el.href : undefined,
        input_type: el instanceof HTMLInputElement ? el.type : undefined,
        form_selector: form ? cssPath(form) : undefined,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    };

    const emit = (type: string, el: Element, extra: Record<string, unknown> = {}) => {
      void (window as any).__imperiumRecordFlowAction?.({
        type,
        timestamp: now(),
        page_url: location.href,
        title: document.title,
        target: targetFor(el),
        ...extra,
      });
    };

    document.addEventListener("click", (event) => {
      const el = event.target instanceof Element ? event.target.closest("button,a,input,select,textarea,[role]") || event.target : null;
      if (el) emit("click", el);
    }, true);

    document.addEventListener("input", (event) => {
      const el = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
        ? event.target
        : null;
      if (el) emit("input", el, { value: el.value, checked: el instanceof HTMLInputElement ? el.checked : undefined });
    }, true);

    document.addEventListener("change", (event) => {
      const el = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement
        ? event.target
        : null;
      if (el) {
        const selectedText = el instanceof HTMLSelectElement
          ? Array.from(el.selectedOptions).map((opt) => opt.textContent?.trim()).filter(Boolean).join(", ")
          : undefined;
        emit(el instanceof HTMLSelectElement ? "select" : "change", el, {
          value: el.value,
          selected_text: selectedText,
          checked: el instanceof HTMLInputElement ? el.checked : undefined,
        });
      }
    }, true);

    document.addEventListener("submit", (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (form) {
        void (window as any).__imperiumRecordFlowAction?.({
          type: "submit",
          timestamp: now(),
          page_url: location.href,
          title: document.title,
          target: targetFor(form),
          submitter: event.submitter instanceof Element ? targetFor(event.submitter) : undefined,
        });
      }
    }, true);

    window.addEventListener("popstate", () => {
      void (window as any).__imperiumRecordFlowAction?.({
        type: "url_change",
        timestamp: now(),
        page_url: location.href,
        title: document.title,
      });
    });
  });
}

async function promptSaveReview(steps: FlowStep[]): Promise<Record<string, { description?: string; required?: boolean }>> {
  const detected = detectParameterCandidates(steps as Array<Record<string, unknown>>);
  return Object.fromEntries(
    Object.entries(detected).map(([key, val]) => [
      key,
      { description: val.description, required: val.required },
    ]),
  );
}

export async function execute(input: RecordFlowInput) {
  try {
    validateFlowName(input.family, "family");
    validateFlowName(input.variant, "variant");
    const url = normalizeUrl(input.url);
    const { chromium } = await import("rebrowser-playwright");
    const { STEALTH_ARGS } = await import("../core/constants.js");
    const browser = await chromium.launch({ headless: false, args: STEALTH_ARGS });
    const context = await browser.newContext();
    const page = await context.newPage();
    const steps: FlowStep[] = [];
    const screenshots: string[] = [];
    const recording: FlowRecording = {
      started_at: new Date().toISOString(),
      start_url: url,
      events: [],
      network: [],
      navigations: [],
    };
    attachNetworkRecorder(page, recording);
    await installBrowserRecorder(page, steps, recording);

    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    recording.user_agent = await page.evaluate(() => navigator.userAgent).catch(() => undefined);
    recording.viewport = page.viewportSize() ?? undefined;
    process.stderr.write("Click/type naturally in the browser. Commands: wait [ms], navigate <url>, scroll [px], output <name> <script>, undo, status, save, exit\n");

    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, prompt: "record-flow› " });
    rl.prompt();

    const savedPath = await new Promise<string>((resolve, reject) => {
      rl.on("line", async (raw) => {
        const line = raw.trim();
        if (!line) { rl.prompt(); return; }
        const [cmd, ...args] = tokenize(line);
        try {
          if (cmd === "save") {
            recording.stopped_at = new Date().toISOString();
            const flow: FlowDefinition = {
              schema_version: 1,
              family: input.family,
              variant: input.variant,
              name: `${input.family}/${input.variant}`,
              description: input.description,
              url,
              created_at: new Date().toISOString(),
              inputs: await promptSaveReview(steps),
              steps,
              recording,
              captcha: input.captcha,
              browser: "auto",
              evidence: { action_log: true, screenshots: false, html: false, markdown: false, network_log: false },
              session_id: input.session_id,
            };
            const file = await saveFlow(flow, { flowsDir: input.flows_dir, global: input.global });
            rl.close();
            await browser.close();
            resolve(file);
            return;
          }
          if (cmd === "exit" || cmd === "quit") {
            rl.close();
            await browser.close();
            reject(new Error("record-flow cancelled"));
            return;
          }
          if (cmd === "undo") {
            const removed = steps.pop();
            process.stderr.write(removed ? `removed ${removed.type}\n` : "nothing to undo\n");
            rl.prompt();
            return;
          }
          if (cmd === "status") {
            process.stderr.write(`${steps.length} recorded step${steps.length === 1 ? "" : "s"} at ${page.url()}\n`);
            rl.prompt();
            return;
          }

          let action: ActionInput | null = null;
          if (cmd === "wait") action = { type: "wait", duration: Number(args[0] ?? 1000) };
          if (cmd === "scroll") action = { type: "scroll", y: Number(args[0] ?? 500) };
          if (cmd === "navigate") action = { type: "navigate", url: args[0] };
          if (cmd === "output") action = { type: "evaluate", script: args.slice(1).join(" ") };
          if (!action) throw new Error(`Unknown command: ${cmd}`);
          const result = await executeAction(page, action, screenshots, 30_000, input.session_id);
          if (!result.success) throw new Error(result.error ?? "action failed");
          steps.push(stepFromAction(action, cmd === "output" ? args[0] : undefined));
          process.stderr.write(`recorded ${cmd} (${steps.length} step${steps.length === 1 ? "" : "s"})\n`);
        } catch (err) {
          process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
        }
        rl.prompt();
      });
      rl.on("error", reject);
    });

    return toolResult({ ok: true, path: savedPath, family: input.family, variant: input.variant, steps: steps.length });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
