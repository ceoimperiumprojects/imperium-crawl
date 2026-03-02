import { describe, it, expect } from "vitest";
import { validateSkillName } from "../src/skills/manager.js";
import { z } from "zod";

describe("Skill name validation (path traversal prevention)", () => {
  // Valid names
  it.each([
    "my-skill",
    "tc-ai-news",
    "scraper_v2",
    "ProductExtractor",
    "skill123",
    "a",
    "A-Z_0-9",
  ])("accepts valid name: %s", (name) => {
    expect(() => validateSkillName(name)).not.toThrow();
  });

  // Path traversal attempts
  it.each([
    "../../etc/passwd",
    "../.ssh/authorized_keys",
    "..\\windows\\system32",
    "foo/bar",
    "foo\\bar",
    "./sneaky",
  ])("rejects path traversal: %s", (name) => {
    expect(() => validateSkillName(name)).toThrow(/Invalid skill name/);
  });

  // Special characters
  it.each([
    "skill name",
    "skill.json",
    "skill;rm -rf",
    "",
    "skill\0null",
    "skill\nnewline",
  ])("rejects special characters: %s", (name) => {
    expect(() => validateSkillName(name)).toThrow(/Invalid skill name/);
  });
});

describe("Skill Zod schema validation", () => {
  const nameSchema = z.string().regex(
    /^[a-zA-Z0-9_-]+$/,
    "Skill name may only contain letters, numbers, hyphens, and underscores",
  );

  it("rejects path traversal in Zod schema", () => {
    const result = nameSchema.safeParse("../../etc/passwd");
    expect(result.success).toBe(false);
  });

  it("accepts valid name in Zod schema", () => {
    const result = nameSchema.safeParse("my-cool-skill");
    expect(result.success).toBe(true);
  });
});
