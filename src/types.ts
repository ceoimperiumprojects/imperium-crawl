// Central type re-exports — one import for the most common types.
// All types stay in their original modules; this is just a discovery layer.

export type { ToolDefinition } from "./tools/index.js";
export type { StoredCookie } from "./sessions/types.js";
export type { ActionInput } from "./core/action-executor.js";
export type { StealthLevel } from "./stealth/index.js";
export type { SkillConfig, InteractSkillConfig, ExtractSkillConfig } from "./skills/index.js";
export type { FlowDefinition, FlowRunResult, FlowStep } from "./flows/types.js";
export type { BatchJob, BatchJobResult } from "./batch/types.js";
export type { AuthProfile } from "./security/index.js";
export type { PolicyDecision } from "./security/index.js";
export type { DomainKnowledge } from "./knowledge/predictor.js";
export type {
  SocialVideo,
  SocialPost,
  SocialComment,
  SocialProfile,
  SocialSearchResult,
  InstagramProfile,
  InstagramPost,
  InstagramDiscoverResult,
} from "./social/index.js";
export type { NetworkRequest, InterceptRule } from "./network/index.js";

// Re-export package version for convenience
export { PACKAGE_VERSION } from "./core/constants.js";
