import { z } from "zod";
import { toolResult, errorResult } from "../utils/tool-response.js";
import { parseFlowRef, runFlow } from "../flows/index.js";

export const name = "run_flow";
export const description = "Run a saved Imperium Flow by family/variant with runtime input JSON.";

const jsonRecord = (raw: string): Record<string, string> => JSON.parse(raw) as Record<string, string>;

export const schema = z.object({
  flow: z.string().optional().describe("Flow reference in '<family>/<variant>' form"),
  input: z.union([z.string().transform(jsonRecord), z.record(z.string())]).default({}).describe("Runtime input JSON object"),
  flows_dir: z.string().optional().describe("Flow storage directory override"),
  global: z.boolean().default(false).describe("Use ~/.imperium-crawl/flows instead of ./flows"),
  browser: z.enum(["auto", "headed", "headless"]).default("auto").describe("Browser mode hint"),
  captcha: z.enum(["auto", "manual", "off", "fail"]).optional().describe("Override flow CAPTCHA policy"),
  evidence: z.enum(["off", "configured", "all"]).default("configured").describe("Evidence collection mode"),
  output_dir: z.string().optional().describe("Directory for per-run evidence folders"),
  session_id: z.string().optional().describe("Session ID for cookie persistence"),
  chrome_profile: z.string().optional().describe("Chrome profile path for authenticated workflows"),
  proxy: z.string().optional().describe("Proxy URL"),
  timeout: z.number().min(1000).optional().describe("Navigation/action timeout in ms"),
  manual_captcha_timeout_ms: z.number().min(1000).default(120000).describe("Manual CAPTCHA pause timeout"),
});

export type RunFlowInput = z.infer<typeof schema>;

export async function execute(input: RunFlowInput) {
  try {
    if (!input.flow) throw new Error("Flow reference is required. Use run-flow <family>/<variant> or --flow <family>/<variant>.");
    const ref = parseFlowRef(input.flow);
    const result = await runFlow(ref, {
      flowsDir: input.flows_dir,
      global: input.global,
      input: input.input as Record<string, string>,
      browser: input.browser,
      captcha: input.captcha,
      evidence: input.evidence,
      outputDir: input.output_dir,
      sessionId: input.session_id,
      chromeProfile: input.chrome_profile,
      proxy: input.proxy,
      timeout: input.timeout,
      manualCaptchaTimeoutMs: input.manual_captcha_timeout_ms,
    });
    return toolResult(result);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
