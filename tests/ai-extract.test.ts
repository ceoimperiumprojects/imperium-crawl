import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseJsonFromLLMResponse, extractWithLLM } from "../src/llm/extractor.js";
import type { LLMClient } from "../src/llm/index.js";
import { hasLLMConfigured } from "../src/llm/index.js";

// ── Unit: JSON parser ──────────────────────────────────────────────────────

describe("parseJsonFromLLMResponse", () => {
  it("parses clean JSON object", () => {
    const result = parseJsonFromLLMResponse('{"name": "test", "price": 9.99}');
    expect(result).toEqual({ name: "test", price: 9.99 });
  });

  it("parses clean JSON array", () => {
    const result = parseJsonFromLLMResponse('[{"id": 1}, {"id": 2}]');
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("extracts JSON from markdown code block (```json)", () => {
    const response = '```json\n{"title": "Hello", "views": 100}\n```';
    const result = parseJsonFromLLMResponse(response);
    expect(result).toEqual({ title: "Hello", views: 100 });
  });

  it("extracts JSON from generic code block (```)", () => {
    const response = '```\n{"title": "World"}\n```';
    const result = parseJsonFromLLMResponse(response);
    expect(result).toEqual({ title: "World" });
  });

  it("extracts JSON from prose with leading text", () => {
    const response = 'Here is the extracted data:\n{"items": ["a", "b", "c"]}';
    const result = parseJsonFromLLMResponse(response);
    expect(result).toEqual({ items: ["a", "b", "c"] });
  });

  it("extracts JSON array from prose", () => {
    const response = 'Results:\n[{"name": "foo"}, {"name": "bar"}]';
    const result = parseJsonFromLLMResponse(response);
    expect(result).toEqual([{ name: "foo" }, { name: "bar" }]);
  });

  it("throws on completely invalid response", () => {
    expect(() => parseJsonFromLLMResponse("This is just plain text with no JSON")).toThrow(
      "Could not parse JSON",
    );
  });

  it("handles nested JSON correctly", () => {
    const json = JSON.stringify({ products: [{ name: "Widget", specs: { color: "red", size: "M" } }] });
    expect(parseJsonFromLLMResponse(json)).toEqual({
      products: [{ name: "Widget", specs: { color: "red", size: "M" } }],
    });
  });
});

// ── Unit: extractWithLLM (mocked LLM client) ──────────────────────────────

describe("extractWithLLM", () => {
  const mockClient: LLMClient = {
    complete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls LLM and returns parsed data for string schema", async () => {
    const mockResponse = { text: '{"title": "Test Article", "author": "John"}', model: "claude-haiku-4-5", inputTokens: 100, outputTokens: 50 };
    vi.mocked(mockClient.complete).mockResolvedValue(mockResponse);

    const result = await extractWithLLM(mockClient, "Some web content here", "extract title and author");

    expect(result.data).toEqual({ title: "Test Article", author: "John" });
    expect(result.model).toBe("claude-haiku-4-5");
    expect(result.schemaUsed).toBe("extract title and author");
    expect(result.tokenUsage).toEqual({ input: 100, output: 50 });
  });

  it("uses auto schema and returns inferred data", async () => {
    const mockData = { pageType: "product", title: "Widget", price: "$9.99" };
    vi.mocked(mockClient.complete).mockResolvedValue({
      text: JSON.stringify(mockData),
      model: "gpt-4o-mini",
    });

    const result = await extractWithLLM(mockClient, "Product page content", "auto");

    expect(result.data).toEqual(mockData);
    expect(result.schemaUsed).toBe("auto");
    expect(result.tokenUsage).toBeUndefined();
  });

  it("passes correct system prompts for extract vs auto", async () => {
    vi.mocked(mockClient.complete).mockResolvedValue({ text: "[]", model: "test" });

    await extractWithLLM(mockClient, "content", "extract titles");
    const extractCall = vi.mocked(mockClient.complete).mock.calls[0][0];
    expect(extractCall[0].role).toBe("system");
    expect(extractCall[0].content).toContain("Return ONLY valid JSON");

    await extractWithLLM(mockClient, "content", "auto");
    const autoCall = vi.mocked(mockClient.complete).mock.calls[1][0];
    expect(autoCall[0].role).toBe("system");
    expect(autoCall[0].content).toContain("automatically identify");
  });

  it("handles JSON response inside code block", async () => {
    vi.mocked(mockClient.complete).mockResolvedValue({
      text: "```json\n[{\"name\": \"item1\"}, {\"name\": \"item2\"}]\n```",
      model: "test-model",
    });

    const result = await extractWithLLM(mockClient, "content", "extract names");
    expect(result.data).toEqual([{ name: "item1" }, { name: "item2" }]);
  });

  it("respects maxTokens parameter", async () => {
    vi.mocked(mockClient.complete).mockResolvedValue({ text: "{}", model: "test" });

    await extractWithLLM(mockClient, "content", "schema", 500);
    expect(vi.mocked(mockClient.complete)).toHaveBeenCalledWith(expect.any(Array), 500);
  });
});

// ── Integration: ai-extract tool (skipped without LLM_API_KEY) ────────────

describe("ai-extract tool (integration)", () => {
  const hasLLM = hasLLMConfigured();

  describe.skipIf(!hasLLM)("with LLM_API_KEY configured", () => {
    it(
      "extracts data from a real page with natural language schema",
      async () => {
        const { execute } = await import("../src/tools/ai-extract.js");
        const result = await execute({
          url: "https://news.ycombinator.com",
          schema: "extract top 3 story titles and their points",
          format: "json",
          max_tokens: 1000,
        });
        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text!);
        expect(parsed.data).toBeDefined();
        expect(parsed.metadata.model).toBeTruthy();
      },
      30_000,
    );

    it(
      "auto schema infers structure from page",
      async () => {
        const { execute } = await import("../src/tools/ai-extract.js");
        const result = await execute({
          url: "https://example.com",
          schema: "auto",
          format: "json",
          max_tokens: 500,
        });
        const parsed = JSON.parse(result.content[0].text!);
        expect(parsed.data).toBeDefined();
        expect(parsed.metadata.schema).toBe("auto");
      },
      30_000,
    );
  });

  describe.skipIf(hasLLM)("without LLM_API_KEY", () => {
    it("returns configuration error gracefully", async () => {
      const { execute } = await import("../src/tools/ai-extract.js");
      const result = await execute({
        url: "https://example.com",
        schema: "extract title",
        format: "json",
        max_tokens: 1000,
      });
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.error).toBe("LLM not configured");
    });
  });
});
