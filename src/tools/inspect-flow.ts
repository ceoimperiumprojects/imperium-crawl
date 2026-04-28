import { z } from "zod";
import { toolResult, errorResult } from "../utils/tool-response.js";
import { loadFlow, parseFlowRef } from "../flows/index.js";

export const name = "inspect_flow";
export const description = "Inspect one Imperium Flow definition by family/variant.";

export const schema = z.object({
  flow: z.string().optional().describe("Flow reference in '<family>/<variant>' form"),
  flows_dir: z.string().optional().describe("Flow storage directory override"),
  global: z.boolean().default(false).describe("Use ~/.imperium-crawl/flows instead of ./flows"),
});

export type InspectFlowInput = z.infer<typeof schema>;

export async function execute(input: InspectFlowInput) {
  try {
    if (!input.flow) throw new Error("Flow reference is required. Use inspect-flow <family>/<variant> or --flow <family>/<variant>.");
    const ref = parseFlowRef(input.flow);
    const { flow, path } = await loadFlow(ref, { flowsDir: input.flows_dir, global: input.global });
    return toolResult({ path, flow });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
