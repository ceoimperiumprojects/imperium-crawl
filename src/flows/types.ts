import { z } from "zod";

export const FLOW_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export const captchaPolicySchema = z.enum(["auto", "manual", "off", "fail"]);
export const browserModeSchema = z.enum(["auto", "headed", "headless"]);
export const evidenceModeSchema = z.enum(["off", "configured", "all"]);

export const flowInputSchema = z.object({
  description: z.string().optional(),
  required: z.boolean().default(false).optional(),
  default: z.string().optional(),
  secret: z.boolean().default(false).optional(),
});

export const smartTargetSchema = z.object({
  tag: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  label: z.string().optional(),
  selector: z.string().optional(),
  xpath: z.string().optional(),
  attributes: z.record(z.string()).optional(),
  nearby_text: z.string().optional(),
  href: z.string().optional(),
  input_type: z.string().optional(),
  form_selector: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  viewport: z.object({
    width: z.number(),
    height: z.number(),
  }).optional(),
}).strict();

export const flowRecordingEventSchema = z.object({
  type: z.string(),
  timestamp: z.string(),
  page_url: z.string().optional(),
  title: z.string().optional(),
  target: smartTargetSchema.optional(),
  value: z.string().optional(),
  checked: z.boolean().optional(),
  selected_text: z.string().optional(),
  key: z.string().optional(),
  submitter: smartTargetSchema.optional(),
}).passthrough();

export const flowNetworkEventSchema = z.object({
  type: z.enum(["request", "response"]),
  timestamp: z.string(),
  url: z.string(),
  method: z.string().optional(),
  resource_type: z.string().optional(),
  status: z.number().optional(),
  content_type: z.string().optional(),
}).passthrough();

export const flowNavigationEventSchema = z.object({
  timestamp: z.string(),
  url: z.string(),
  frame_url: z.string().optional(),
}).passthrough();

export const flowRecordingSchema = z.object({
  started_at: z.string(),
  stopped_at: z.string().optional(),
  start_url: z.string(),
  user_agent: z.string().optional(),
  viewport: z.object({
    width: z.number(),
    height: z.number(),
  }).optional(),
  events: z.array(flowRecordingEventSchema).default([]),
  network: z.array(flowNetworkEventSchema).default([]),
  navigations: z.array(flowNavigationEventSchema).default([]),
}).default({
  started_at: new Date(0).toISOString(),
  start_url: "",
  events: [],
  network: [],
  navigations: [],
});

export const flowStepSchema = z.object({
  id: z.string().optional(),
  type: z.string(),
  selector: z.string().optional(),
  ref: z.string().optional(),
  target: smartTargetSchema.optional(),
  text: z.string().optional(),
  value: z.string().optional(),
  script: z.string().optional(),
  key: z.string().optional(),
  url: z.string().optional(),
  duration: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  target_selector: z.string().optional(),
  target_ref: z.string().optional(),
  file_paths: z.array(z.string()).optional(),
  storage: z.enum(["local", "session"]).optional(),
  auth_profile: z.string().optional(),
  next_selector: z.string().optional(),
  next_ref: z.string().optional(),
  extract_script: z.string().optional(),
  max_pages: z.number().optional(),
  wait_after_click: z.number().optional(),
  output: z.string().optional(),
  output_from: z.enum(["result", "page_text", "page_html", "url"]).optional(),
}).passthrough();

export const evidenceConfigSchema = z.object({
  screenshots: z.boolean().default(false).optional(),
  html: z.boolean().default(false).optional(),
  markdown: z.boolean().default(false).optional(),
  network_log: z.boolean().default(false).optional(),
  action_log: z.boolean().default(true).optional(),
}).default({});

export const flowSchema = z.object({
  schema_version: z.literal(1),
  family: z.string().regex(FLOW_NAME_RE),
  variant: z.string().regex(FLOW_NAME_RE),
  name: z.string().optional(),
  description: z.string().optional(),
  url: z.string().min(1),
  created_at: z.string(),
  updated_at: z.string().optional(),
  inputs: z.record(flowInputSchema).default({}),
  outputs: z.record(z.string()).default({}).optional(),
  steps: z.array(flowStepSchema).default([]),
  recording: flowRecordingSchema.optional(),
  captcha: captchaPolicySchema.default("auto").optional(),
  browser: browserModeSchema.default("auto").optional(),
  evidence: evidenceConfigSchema.optional(),
  session_id: z.string().optional(),
  allowed_domains: z.array(z.string()).optional(),
  timeout: z.number().min(1000).default(30_000).optional(),
  proxy: z.string().optional(),
  chrome_profile: z.string().optional(),
}).strict();

export type CaptchaPolicy = z.infer<typeof captchaPolicySchema>;
export type BrowserMode = z.infer<typeof browserModeSchema>;
export type EvidenceMode = z.infer<typeof evidenceModeSchema>;
export type FlowInputDefinition = z.infer<typeof flowInputSchema>;
export type SmartTarget = z.infer<typeof smartTargetSchema>;
export type FlowRecordingEvent = z.infer<typeof flowRecordingEventSchema>;
export type FlowNetworkEvent = z.infer<typeof flowNetworkEventSchema>;
export type FlowNavigationEvent = z.infer<typeof flowNavigationEventSchema>;
export type FlowRecording = z.infer<typeof flowRecordingSchema>;
export type FlowStep = z.infer<typeof flowStepSchema>;
export type EvidenceConfig = z.infer<typeof evidenceConfigSchema>;
export type FlowDefinition = z.infer<typeof flowSchema>;

export interface FlowRef {
  family: string;
  variant: string;
}

export interface FlowStorageOptions {
  flowsDir?: string;
  global?: boolean;
}

export interface FlowRunOptions extends FlowStorageOptions {
  input?: Record<string, string>;
  browser?: BrowserMode;
  captcha?: CaptchaPolicy;
  evidence?: EvidenceMode;
  outputDir?: string;
  sessionId?: string;
  chromeProfile?: string;
  proxy?: string;
  timeout?: number;
  manualCaptchaTimeoutMs?: number;
}

export interface FlowActionLog {
  id?: string;
  type: string;
  success: boolean;
  error?: string;
  result?: unknown;
  target_strategy?: string;
  duration_ms: number;
}

export interface FlowCaptchaEvent {
  detected: boolean;
  policy: CaptchaPolicy;
  action: "none" | "solved" | "manual" | "failed" | "off";
  captcha_type?: string;
  solve_time_ms?: number;
  error?: string;
}

export interface FlowEvidence {
  run_dir?: string;
  screenshots?: string[];
  html?: string;
  markdown?: string;
  network_log?: unknown[];
  action_log?: FlowActionLog[];
}

export interface FlowRunResult {
  ok: boolean;
  run_id: string;
  family: string;
  variant: string;
  outputs: Record<string, unknown>;
  actions: FlowActionLog[];
  captcha: FlowCaptchaEvent[];
  evidence: FlowEvidence;
  duration_ms: number;
  error?: {
    code: string;
    message: string;
  };
}
