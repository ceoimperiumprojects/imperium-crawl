import { resolveString } from "../skills/index.js";
import type { FlowDefinition, FlowStep } from "./types.js";

export function resolveFlowInputs(flow: FlowDefinition, input: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, def] of Object.entries(flow.inputs ?? {})) {
    const val = input[key] ?? def.default;
    if ((val === undefined || val === "") && def.required) {
      throw new Error(`Missing required flow input: ${key}`);
    }
    if (val !== undefined) out[key] = String(val);
  }
  for (const [key, val] of Object.entries(input)) out[key] = String(val);
  return out;
}

export function resolveStepTemplates(step: FlowStep, flow: FlowDefinition, input: Record<string, string>): FlowStep {
  const params = Object.fromEntries(
    Object.entries(flow.inputs ?? {}).map(([key, def]) => [
      key,
      { source: "input" as const, key, description: def.description, default: def.default, required: def.required },
    ]),
  );

  const resolved: Record<string, unknown> = { ...step };
  for (const key of ["selector", "text", "value", "script", "key", "url", "target_selector", "extract_script"] as const) {
    if (typeof resolved[key] === "string") {
      resolved[key] = resolveString(resolved[key] as string, params, input);
    }
  }
  if (step.target) {
    resolved.target = Object.fromEntries(
      Object.entries(step.target).map(([key, val]) => [
        key,
        typeof val === "string" ? resolveString(val, params, input) : val,
      ]),
    );
  }
  return resolved as FlowStep;
}
