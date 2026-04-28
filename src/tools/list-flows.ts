import { z } from "zod";
import { toolResult } from "../utils/tool-response.js";
import { listFlows, resolveFlowsDir } from "../flows/index.js";

export const name = "list_flows";
export const description = "List saved Imperium Flows across project-local and global flow storage.";

export const schema = z.object({
  flows_dir: z.string().optional().describe("Flow storage directory override"),
  global: z.boolean().default(false).describe("Use ~/.imperium-crawl/flows instead of ./flows"),
});

export type ListFlowsInput = z.infer<typeof schema>;

export async function execute(input: ListFlowsInput) {
  const flows = await listFlows({ flowsDir: input.flows_dir, global: input.global });
  return toolResult({
    total: flows.length,
    storage: input.flows_dir || input.global ? resolveFlowsDir({ flowsDir: input.flows_dir, global: input.global }) : "project + global",
    flows,
  });
}
