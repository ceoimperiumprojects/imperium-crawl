/**
 * Imperium Recorder — shared action types.
 *
 * Exact format match with imperium-crawl's ActionInput / FlowDefinition.
 * This ensures recorded flows can be used directly with `run-flow` and `run-skill`.
 */

export const ACTION_TYPES = [
  "navigate", "click", "type", "scroll", "wait", "screenshot",
  "evaluate", "press", "select", "hover", "upload", "refresh",
  "auto_click", "save_pdf", "storage", "cookies", "auth_login",
] as const;

export type ActionType = typeof ACTION_TYPES[number];

export interface ActionInput {
  type: ActionType;
  selector?: string;
  text?: string;
  value?: string;
  url?: string;
  key?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  duration?: number;
  milliseconds?: number;
  code?: string;
  fullPage?: boolean;
  path?: string;
  button?: string;
}

export interface RecordedAction {
  action: ActionInput;
  pageUrl: string;
  pageTitle: string;
  timestamp: number;
  x?: number;
  y?: number;
}

export interface FlowRecording {
  family: string;
  variant: string;
  description?: string;
  url: string;
  steps: Array<{
    type: string;
    id: string;
    selector?: string;
    text?: string;
    value?: string;
    url?: string;
    key?: string;
    direction?: string;
    amount?: number;
    duration?: number;
    code?: string;
    output?: string;
  }>;
  evidence: {
    screenshots: boolean;
    html: boolean;
    markdown: boolean;
    action_log: boolean;
  };
}
