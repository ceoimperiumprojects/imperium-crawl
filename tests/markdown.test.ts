import { describe, it, expect } from "vitest";
import { htmlToMarkdown, cleanHtml } from "../src/utils/markdown.js";

describe("cleanHtml", () => {
  it("removes ad containers", () => {
    const html = `<html><body>
      <p>Real content</p>
      <div class="advertisement">Buy stuff!</div>
      <div class="ad-container">More ads</div>
    </body></html>`;
    const cleaned = cleanHtml(html);
    expect(cleaned).not.toContain("Buy stuff!");
    expect(cleaned).not.toContain("More ads");
    expect(cleaned).toContain("Real content");
  });

  it("removes cookie banners", () => {
    const html = `<html><body>
      <p>Content</p>
      <div class="cookie-banner">Accept cookies</div>
      <div class="cookie-consent">We use cookies</div>
    </body></html>`;
    const cleaned = cleanHtml(html);
    expect(cleaned).not.toContain("Accept cookies");
    expect(cleaned).not.toContain("We use cookies");
    expect(cleaned).toContain("Content");
  });

  it("removes social share buttons", () => {
    const html = `<html><body>
      <p>Article text</p>
      <div class="social-share">Share on Twitter</div>
      <div class="share-buttons">Share</div>
    </body></html>`;
    const cleaned = cleanHtml(html);
    expect(cleaned).not.toContain("Share on Twitter");
    expect(cleaned).toContain("Article text");
  });

  it("removes comments section", () => {
    const html = `<html><body>
      <p>Article</p>
      <div class="comments">User comment 1</div>
    </body></html>`;
    const cleaned = cleanHtml(html);
    expect(cleaned).not.toContain("User comment 1");
  });

  it("removes sidebar", () => {
    const html = `<html><body>
      <main><p>Main content</p></main>
      <aside>Sidebar stuff</aside>
    </body></html>`;
    const cleaned = cleanHtml(html);
    expect(cleaned).not.toContain("Sidebar stuff");
    expect(cleaned).toContain("Main content");
  });

  it("removes navigation role", () => {
    const html = `<html><body>
      <div role="navigation">Nav links</div>
      <p>Real content here</p>
    </body></html>`;
    const cleaned = cleanHtml(html);
    expect(cleaned).not.toContain("Nav links");
    expect(cleaned).toContain("Real content here");
  });
});

describe("htmlToMarkdown", () => {
  it("converts basic HTML to markdown", () => {
    const html = `<h1>Title</h1><p>Paragraph text</p>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Title");
    expect(md).toContain("Paragraph text");
  });

  it("converts links", () => {
    const html = `<p>Visit <a href="https://example.com">Example</a></p>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("[Example](https://example.com)");
  });

  it("removes script and style tags", () => {
    const html = `<p>Content</p><script>alert('xss')</script><style>body{color:red}</style>`;
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("alert");
    expect(md).not.toContain("color:red");
    expect(md).toContain("Content");
  });

  it("removes SVG elements", () => {
    const html = `<p>Text</p><SVG><path d="M0 0"/></SVG>`;
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("path");
    expect(md).toContain("Text");
  });

  it("applies DOM cleaning before conversion", () => {
    const html = `<html><body>
      <p>Good content</p>
      <div class="advertisement">Ad content that should be removed</div>
    </body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("Good content");
    expect(md).not.toContain("Ad content");
  });

  it("handles GFM tables", () => {
    const html = `<table><thead><tr><th>Name</th><th>Age</th></tr></thead>
      <tbody><tr><td>John</td><td>30</td></tr></tbody></table>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("Name");
    expect(md).toContain("Age");
    expect(md).toContain("|");
  });

  it("handles code blocks", () => {
    const html = `<pre><code>const x = 1;</code></pre>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("```");
    expect(md).toContain("const x = 1;");
  });
});
