/**
 * Action Recorder — captures browser actions during an explore REPL session.
 *
 * Records every action the user performs, supports undo, and can export
 * the captured sequence as an InteractSkillConfig JSON file.
 *
 * Usage: instantiate one per explore session, call record() after each action,
 * call toSkillConfig() at the end to get a saveable skill.
 */

import type { ActionInput } from "../core/action-executor.js";
import type { InteractSkillConfig } from "../skills/index.js";
import type { SkillParameters } from "../skills/index.js";
import { detectParameterCandidates } from "../skills/index.js";

export interface RecordedAction {
  action: ActionInput;
  rawCommand: string; // Original REPL input for display
  pageUrl: string;
  timestamp: number;
}

export class ActionRecorder {
  private history: RecordedAction[] = [];
  private startUrl: string;

  constructor(startUrl: string) {
    this.startUrl = startUrl;
  }

  /** Record an action after it was successfully executed. */
  record(action: ActionInput, rawCommand: string, pageUrl: string): void {
    this.history.push({
      action,
      rawCommand,
      pageUrl,
      timestamp: Date.now(),
    });
  }

  /** Remove the last recorded action. */
  undo(): RecordedAction | null {
    return this.history.pop() ?? null;
  }

  /** Current number of recorded actions. */
  get count(): number {
    return this.history.length;
  }

  /** List all recorded actions for display. */
  getHistory(): RecordedAction[] {
    return [...this.history];
  }

  /** Clear all recorded actions. */
  clear(): void {
    this.history = [];
  }

  /**
   * Heuristically detect fields that should be parameterized.
   * Returns suggested SkillParameters — user reviews and adjusts.
   */
  detectParameters(): SkillParameters {
    const actions = this.history.map((r) => r.action as Record<string, unknown>);
    return detectParameterCandidates(actions);
  }

  /**
   * Export recorded session to InteractSkillConfig.
   * Ready to save with skills/manager.ts save().
   */
  toSkillConfig(
    name: string,
    description: string,
    sessionId?: string,
    parameters?: SkillParameters,
  ): InteractSkillConfig {
    return {
      name,
      description,
      tool: "interact",
      url: this.startUrl,
      created_at: new Date().toISOString(),
      session_id: sessionId,
      actions: this.history.map((r) => ({ ...r.action })),
      ...(parameters && Object.keys(parameters).length > 0 && { parameters }),
    };
  }
}
