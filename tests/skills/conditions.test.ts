import { describe, it, expect } from "vitest";
import { evaluateCondition, getByPath } from "../../src/skills/conditions.js";

describe("getByPath", () => {
  it("returns top-level property", () => {
    expect(getByPath({ a: 1 }, "a")).toBe(1);
  });

  it("returns nested property", () => {
    expect(getByPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  it("returns array element", () => {
    expect(getByPath({ items: ["x", "y", "z"] }, "items[1]")).toBe("y");
  });

  it("returns undefined for missing path", () => {
    expect(getByPath({ a: 1 }, "b.c")).toBeUndefined();
  });

  it("handles null safely", () => {
    expect(getByPath(null, "a")).toBeUndefined();
  });
});

describe("evaluateCondition", () => {
  const vars = {
    result: { count: 5, ok: true, name: "John", items: ["a", "b", "c"] },
    empty: { count: 0, ok: false },
  };

  it("evaluates truthiness check", () => {
    expect(evaluateCondition("$result.ok", vars)).toBe(true);
    expect(evaluateCondition("$empty.ok", vars)).toBe(false);
  });

  it("evaluates strict equality", () => {
    expect(evaluateCondition("$result.name === 'John'", vars)).toBe(true);
    expect(evaluateCondition("$result.name === 'Jane'", vars)).toBe(false);
  });

  it("evaluates strict inequality", () => {
    expect(evaluateCondition("$result.name !== 'Jane'", vars)).toBe(true);
  });

  it("evaluates greater than", () => {
    expect(evaluateCondition("$result.count > 0", vars)).toBe(true);
    expect(evaluateCondition("$empty.count > 0", vars)).toBe(false);
  });

  it("evaluates less than", () => {
    expect(evaluateCondition("$result.count < 10", vars)).toBe(true);
  });

  it("evaluates >= and <=", () => {
    expect(evaluateCondition("$result.count >= 5", vars)).toBe(true);
    expect(evaluateCondition("$result.count <= 5", vars)).toBe(true);
    expect(evaluateCondition("$result.count >= 6", vars)).toBe(false);
  });

  it("evaluates AND operator", () => {
    expect(evaluateCondition("$result.ok && $result.count > 0", vars)).toBe(true);
    expect(evaluateCondition("$result.ok && $empty.count > 0", vars)).toBe(false);
  });

  it("evaluates OR operator", () => {
    expect(evaluateCondition("$empty.ok || $result.ok", vars)).toBe(true);
    expect(evaluateCondition("$empty.ok || $empty.count > 0", vars)).toBe(false);
  });

  it("handles boolean literals", () => {
    expect(evaluateCondition("$result.ok === true", vars)).toBe(true);
    expect(evaluateCondition("$empty.ok === false", vars)).toBe(true);
  });

  it("handles number literals", () => {
    expect(evaluateCondition("$result.count === 5", vars)).toBe(true);
  });

  it("returns false for empty expression", () => {
    expect(evaluateCondition("", vars)).toBe(false);
  });

  it("resolves array length via path", () => {
    expect(getByPath(vars.result, "items.length")).toBe(3);
    expect(evaluateCondition("$result.items.length > 0", vars)).toBe(true);
  });
});
