import { describe, it, expect } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema, execute } from "../src/tools/pdf-extract.js";

/**
 * Minimal valid PDF with a single page containing the text "Hello CBAM".
 * Handcrafted — no deps. Used to validate native text-layer extraction.
 */
const MINIMAL_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 100 700 Td (Hello CBAM) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000095 00000 n
0000000180 00000 n
0000000275 00000 n
trailer<</Size 6/Root 1 0 R>>
startxref
340
%%EOF`;

describe("pdf-extract schema", () => {
  it("requires input", () => {
    const r = schema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("applies defaults", () => {
    const r = schema.parse({ input: "/tmp/x.pdf" });
    expect(r.output).toBe("./extracted.json");
    expect(r.preserve_layout).toBe(true);
    expect(r.extract_tables).toBe(true);
    expect(r.max_pages).toBe(0);
  });

  it("accepts url input", () => {
    const r = schema.safeParse({ input: "https://example.com/report.pdf" });
    expect(r.success).toBe(true);
  });

  it("rejects negative max_pages", () => {
    const r = schema.safeParse({ input: "/tmp/x.pdf", max_pages: -1 });
    expect(r.success).toBe(false);
  });
});

describe("pdf-extract execute", () => {
  it("returns graceful error for missing file", async () => {
    const out = await execute({
      input: "/tmp/does-not-exist-imperium-crawl.pdf",
      output: "/tmp/out.json",
      preserve_layout: true,
      extract_tables: true,
      max_pages: 0,
    });
    const parsed = JSON.parse(out.content[0].text!);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toMatch(/not found/i);
  });

  it("extracts text from a native PDF", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pdftest-"));
    const pdfPath = join(dir, "hello.pdf");
    const outPath = join(dir, "out.json");
    await writeFile(pdfPath, MINIMAL_PDF, "latin1");

    const res = await execute({
      input: pdfPath,
      output: outPath,
      preserve_layout: true,
      extract_tables: true,
      max_pages: 0,
    });
    const parsed = JSON.parse(res.content[0].text!);

    expect(parsed.error).toBeUndefined();
    expect(parsed.strategy_used).toBe("native");
    expect(parsed.metadata.pages).toBe(1);
    expect(parsed.pages).toHaveLength(1);
    expect(parsed.text).toContain("Hello");

    await rm(dir, { recursive: true, force: true });
  }, 30000);

  it("honors max_pages = 1 on a single-page PDF (no-op)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pdftest-"));
    const pdfPath = join(dir, "hello.pdf");
    const outPath = join(dir, "out.json");
    await writeFile(pdfPath, MINIMAL_PDF, "latin1");

    const res = await execute({
      input: pdfPath,
      output: outPath,
      preserve_layout: true,
      extract_tables: true,
      max_pages: 1,
    });
    const parsed = JSON.parse(res.content[0].text!);
    expect(parsed.error).toBeUndefined();
    expect(parsed.pages).toHaveLength(1);

    await rm(dir, { recursive: true, force: true });
  }, 30000);
});
