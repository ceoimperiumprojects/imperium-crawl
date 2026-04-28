import fs from "node:fs/promises";
import path from "node:path";
import { htmlToMarkdown } from "../utils/markdown.js";
import { getTwoCaptchaApiKey } from "../config.js";
import { acquirePage } from "../stealth/chrome-profile.js";
import { getPool } from "../stealth/browser-pool.js";
import { trySolveCaptcha, hasCaptcha, detectCaptcha } from "../captcha/index.js";
import { executeAction } from "../tools/action-executor.js";
import type { ActionInput } from "../tools/action-executor.js";
import { getRequestLog } from "../network/interceptor.js";
import { loadFlow } from "./storage.js";
import { resolveFlowInputs, resolveStepTemplates } from "./templates.js";
import { resolveSmartTarget } from "./smart-target.js";
import type { CaptchaPolicy, FlowCaptchaEvent, FlowDefinition, FlowRunOptions, FlowRunResult } from "./types.js";

function runId(): string {
  return `flowrun_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function actionFromStep(step: Record<string, unknown>): ActionInput {
  const { id: _id, output: _output, output_from: _outputFrom, target: _target, ...rest } = step;
  return rest as ActionInput;
}

async function maybeHandleCaptcha(
  page: import("rebrowser-playwright").Page,
  policy: CaptchaPolicy,
  manualTimeoutMs: number,
): Promise<FlowCaptchaEvent> {
  const html = await page.content();
  if (!hasCaptcha(html)) return { detected: false, policy, action: "none" };

  const info = detectCaptcha(html);
  if (policy === "off") return { detected: true, policy, action: "off", captcha_type: info?.type };
  if (policy === "fail") {
    return { detected: true, policy, action: "failed", captcha_type: info?.type, error: "CAPTCHA detected and policy is fail" };
  }

  const key = getTwoCaptchaApiKey();
  if (policy === "auto" && key) {
    const attempt = await trySolveCaptcha(page, key);
    return {
      detected: attempt.detected,
      policy,
      action: attempt.solved ? "solved" : "failed",
      captcha_type: attempt.captchaType ?? info?.type,
      solve_time_ms: attempt.solveTimeMs,
      error: attempt.error,
    };
  }

  if (policy === "manual" || policy === "auto") {
    await page.waitForTimeout(manualTimeoutMs);
    return { detected: true, policy, action: "manual", captcha_type: info?.type };
  }

  return { detected: true, policy, action: "failed", captcha_type: info?.type };
}

async function saveText(filePath: string, text: string): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf-8");
  return filePath;
}

export async function runFlowDefinition(flow: FlowDefinition, options: FlowRunOptions = {}): Promise<FlowRunResult> {
  const started = Date.now();
  const id = runId();
  const actionLogs: FlowRunResult["actions"] = [];
  const captchaEvents: FlowCaptchaEvent[] = [];
  const outputs: Record<string, unknown> = {};
  const evidenceMode = options.evidence ?? "configured";
  const evidenceConfig = evidenceMode === "all"
    ? { screenshots: true, html: true, markdown: true, network_log: true, action_log: true }
    : evidenceMode === "off"
      ? {}
      : flow.evidence ?? {};
  const runDir = options.outputDir ? path.resolve(options.outputDir, id) : undefined;
  const screenshots: string[] = [];

  let handle: Awaited<ReturnType<typeof acquirePage>> | undefined;
  try {
    const input = resolveFlowInputs(flow, options.input ?? {});
    handle = await acquirePage({
      chromeProfile: options.chromeProfile ?? flow.chrome_profile,
      proxyUrl: options.proxy ?? flow.proxy,
      headless: !(
        options.browser === "headed" ||
        (options.browser === "auto" && (options.captcha ?? flow.captcha) === "manual")
      ),
    });
    const { page } = handle;
    const timeout = options.timeout ?? flow.timeout ?? 30_000;
    const captchaPolicy = options.captcha ?? flow.captcha ?? "auto";

    await page.goto(flow.url, { waitUntil: "load", timeout });
    captchaEvents.push(await maybeHandleCaptcha(page, captchaPolicy, options.manualCaptchaTimeoutMs ?? 120_000));
    const firstCaptcha = captchaEvents[captchaEvents.length - 1];
    if (firstCaptcha.action === "failed" && captchaPolicy === "fail") {
      throw new Error(firstCaptcha.error ?? "CAPTCHA blocked flow");
    }

    for (const rawStep of flow.steps) {
      const stepStart = Date.now();
      const resolvedStep = resolveStepTemplates(rawStep, flow, input);
      const { action, strategy } = await resolveSmartTarget(page, resolvedStep);
      const result = await executeAction(page, actionFromStep(action), screenshots, timeout, options.sessionId ?? flow.session_id);

      if (rawStep.output) {
        if (rawStep.output_from === "page_html") outputs[rawStep.output] = await page.content();
        else if (rawStep.output_from === "page_text") outputs[rawStep.output] = htmlToMarkdown(await page.content());
        else if (rawStep.output_from === "url") outputs[rawStep.output] = page.url();
        else outputs[rawStep.output] = result.result ?? result.success;
      }

      actionLogs.push({
        id: rawStep.id,
        type: rawStep.type,
        success: result.success,
        error: result.error,
        result: result.result,
        target_strategy: strategy,
        duration_ms: Date.now() - stepStart,
      });

      captchaEvents.push(await maybeHandleCaptcha(page, captchaPolicy, options.manualCaptchaTimeoutMs ?? 120_000));
      if (!result.success) throw new Error(result.error ?? `Flow step failed: ${rawStep.type}`);
      const latestCaptcha = captchaEvents[captchaEvents.length - 1];
      if (latestCaptcha.action === "failed" && captchaPolicy === "fail") {
        throw new Error(latestCaptcha.error ?? "CAPTCHA blocked flow");
      }
    }

    const evidence: FlowRunResult["evidence"] = {
      ...(runDir && { run_dir: runDir }),
      ...(evidenceConfig.action_log && { action_log: actionLogs }),
    };
    if (evidenceConfig.screenshots) {
      evidence.screenshots = [];
      for (let i = 0; i < screenshots.length; i++) {
        if (!runDir) continue;
        const file = path.join(runDir, `screenshot-${i + 1}.png`);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, Buffer.from(screenshots[i], "base64"));
        evidence.screenshots.push(file);
      }
    }
    if (evidenceConfig.html) {
      const html = await page.content();
      evidence.html = runDir ? await saveText(path.join(runDir, "final.html"), html) : html;
    }
    if (evidenceConfig.markdown) {
      const md = htmlToMarkdown(await page.content());
      evidence.markdown = runDir ? await saveText(path.join(runDir, "final.md"), md) : md;
    }
    if (evidenceConfig.network_log) evidence.network_log = getRequestLog(page);

    return {
      ok: true,
      run_id: id,
      family: flow.family,
      variant: flow.variant,
      outputs,
      actions: actionLogs,
      captcha: captchaEvents.filter((e) => e.detected),
      evidence,
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      run_id: id,
      family: flow.family,
      variant: flow.variant,
      outputs,
      actions: actionLogs,
      captcha: captchaEvents.filter((e) => e.detected),
      evidence: { ...(runDir && { run_dir: runDir }), action_log: actionLogs },
      duration_ms: Date.now() - started,
      error: {
        code: "FLOW_RUN_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  } finally {
    const wasProfile = handle?.isProfile;
    await handle?.cleanup();
    if (handle && !wasProfile) {
      await getPool().closeAll();
    }
  }
}

export async function runFlow(ref: { family: string; variant: string }, options: FlowRunOptions = {}): Promise<FlowRunResult> {
  const { flow } = await loadFlow(ref, options);
  return runFlowDefinition(flow, options);
}
