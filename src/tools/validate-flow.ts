import { z } from "zod";
import { toolResult, errorResult } from "../utils/tool-response.js";
import { parseFlowRef, validateStoredFlow } from "../flows/index.js";

export const name = "validate_flow";
export const description = "Validate an Imperium Flow schema and report its inputs, steps, and storage path.";

export const schema = z.object({
  flow: z.string().optional().describe("Flow reference in '<family>/<variant>' form"),
  flows_dir: z.string().optional().describe("Flow storage directory override"),
  global: z.boolean().default(false).describe("Use ~/.imperium-crawl/flows instead of ./flows"),
});

export type ValidateFlowInput = z.infer<typeof schema>;

export async function execute(input: ValidateFlowInput) {
  try {
    if (!input.flow) throw new Error("Flow reference is required. Use validate-flow <family>/<variant> or --flow <family>/<variant>.");
    const ref = parseFlowRef(input.flow);
    const validation = await validateStoredFlow(ref, { flowsDir: input.flows_dir, global: input.global });
    return toolResult(validation);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
