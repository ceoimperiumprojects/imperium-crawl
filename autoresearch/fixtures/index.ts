/**
 * SACRED — Do not modify during autoresearch runs.
 * Loads all fixture JSON files from subdirectories.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Fixture } from "../types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const FIXTURE_DIRS = ["scraping", "extraction", "readability", "edge-cases", "stealth"];

/**
 * Load all fixtures from fixture subdirectories.
 * Each .fixture.json file is loaded and validated.
 */
export function loadFixtures(): Fixture[] {
  const fixtures: Fixture[] = [];

  for (const dir of FIXTURE_DIRS) {
    const dirPath = resolve(__dirname, dir);
    let files: string[];
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith(".fixture.json"));
    } catch {
      // Directory might not exist yet
      continue;
    }

    for (const file of files) {
      const filePath = join(dirPath, file);
      const raw = readFileSync(filePath, "utf-8");
      const fixture = JSON.parse(raw) as Fixture;

      // Basic validation
      if (!fixture.id || !fixture.category || !fixture.html || !fixture.tool || !fixture.expected) {
        console.warn(`[fixtures] Skipping invalid fixture: ${filePath}`);
        continue;
      }

      fixtures.push(fixture);
    }
  }

  return fixtures;
}

/**
 * Load fixtures by category.
 */
export function loadFixturesByCategory(category: Fixture["category"]): Fixture[] {
  return loadFixtures().filter((f) => f.category === category);
}
