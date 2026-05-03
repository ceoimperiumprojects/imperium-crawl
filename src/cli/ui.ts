/**
 * TTY-aware UI primitives for the CLI.
 *
 * All output is suppressed (noop) when:
 *   - stdout is not a TTY (piped, redirected)
 *   - NO_COLOR env var is set
 *   - CI env var is set
 *
 * This ensures agents/scripts always get clean JSON while
 * humans get colored spinners and tables.
 */

import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";

export const isTTY: boolean =
  process.stdout.isTTY === true &&
  !process.env.NO_COLOR &&
  !process.env.CI;

// ── Spinner ───────────────────────────────────────────────────────────

export interface SpinnerHandle {
  succeed(msg: string): void;
  fail(msg: string): void;
  stop(): void;
}

const noopSpinner: SpinnerHandle = {
  succeed: () => {},
  fail: () => {},
  stop: () => {},
};

export function createSpinner(text: string): SpinnerHandle {
  if (!isTTY) return noopSpinner;

  const s = ora({ text, stream: process.stderr }).start();
  return {
    succeed: (msg: string) => { s.succeed(msg); },
    fail: (msg: string) => { s.fail(msg); },
    stop: () => { s.stop(); },
  };
}

// ── Colored messages (always to stderr) ──────────────────────────────

export function errorMsg(msg: string): void {
  process.stderr.write((isTTY ? chalk.red("✗ " + msg) : "✗ " + msg) + "\n");
}

// ── Table ─────────────────────────────────────────────────────────────

/**
 * Render a CLI table in TTY mode. Returns empty string in non-TTY
 * (caller should fall through to JSON output instead).
 */
export function renderTable(headers: string[], rows: string[][]): string {
  if (!isTTY) return "";

  const table = new Table({
    head: headers.map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
  });

  for (const row of rows) {
    table.push(row);
  }

  return table.toString();
}

// ── URL colorizer ─────────────────────────────────────────────────────

export function colorUrl(url: string): string {
  return isTTY ? chalk.cyan(url) : url;
}

