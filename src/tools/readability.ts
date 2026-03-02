import { z } from "zod";
import { parseHTML } from "linkedom";
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { fetchPage } from "../utils/fetcher.js";
import { htmlToMarkdown } from "../utils/markdown.js";
import { normalizeUrl } from "../utils/url.js";

export const name = "readability";

export const description =
  "Extract the main article content from a web page using Mozilla's Readability. Returns title, author, text, date, and excerpt. Uses linkedom for fast DOM parsing.";

export const schema = z.object({
  url: z.string().describe("The URL to extract the article from"),
  format: z.enum(["markdown", "html", "text"]).default("markdown").describe("Output format for content"),
});

export type ReadabilityInput = z.infer<typeof schema>;

export async function execute(input: ReadabilityInput) {
  const url = normalizeUrl(input.url);
  const result = await fetchPage(url);

  const { document } = parseHTML(result.html);

  // Pre-check: is this page likely readable?
  if (!isProbablyReaderable(document as unknown as Document)) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { error: "Page does not appear to contain article content", url: result.url },
            null,
            2,
          ),
        },
      ],
    };
  }

  const reader = new Readability(document as unknown as Document, { charThreshold: 50 });
  const article = reader.parse();

  if (!article) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "Could not extract article content", url: result.url }, null, 2),
        },
      ],
    };
  }

  let articleContent: string;
  switch (input.format) {
    case "html":
      articleContent = article.content;
      break;
    case "text":
      articleContent = article.textContent;
      break;
    case "markdown":
    default:
      articleContent = htmlToMarkdown(article.content);
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            url: result.url,
            title: article.title,
            byline: article.byline,
            excerpt: article.excerpt,
            siteName: article.siteName,
            publishedTime: article.publishedTime,
            content: articleContent,
          },
          null,
          2,
        ),
      },
    ],
  };
}
