/**
 * Engine registry — resolves engine name to engine instance.
 *
 * Usage:
 *   const engine = await resolveEngine("camofox");
 *   const engine = await resolveEngine("auto"); // prefers CamoFox if available
 */

import type { BrowserEngine, EngineName } from "./types.js";

const engines = new Map<string, BrowserEngine>();

export function registerEngine(engine: BrowserEngine): void {
  engines.set(engine.name, engine);
}

export function getEngine(name: string): BrowserEngine | undefined {
  return engines.get(name);
}

export function listEngines(): BrowserEngine[] {
  return [...engines.values()];
}

export async function resolveEngine(name: EngineName): Promise<BrowserEngine> {
  // Lazy-load engines on first use to avoid startup cost
  if (engines.size === 0) {
    const { camofoxEngine } = await import("./camofox.js");
    registerEngine(camofoxEngine);
  }

  if (name === "auto") {
    // Prefer CamoFox if available (better anti-detection), fallback to default
    const cf = engines.get("camofox");
    if (cf && await cf.isAvailable()) return cf;
    throw new Error("No browser engine available. Install rebrowser-playwright or @askjo/camofox-browser.");
  }

  const engine = engines.get(name);
  if (!engine) {
    const available = [...engines.keys()].join(", ") || "none";
    throw new Error(`Unknown engine "${name}". Available: ${available}`);
  }

  if (!await engine.isAvailable()) {
    throw new Error(
      `Engine "${name}" is not available. Install with: npm install @askjo/camofox-browser`,
    );
  }

  return engine;
}
