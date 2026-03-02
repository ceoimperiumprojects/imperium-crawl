import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { MIN_REPEATING_ELEMENTS } from "../constants.js";
import type { SkillFieldSelectors } from "./manager.js";

interface ElementGroup {
  selector: string;
  count: number;
  sample: cheerio.Cheerio<Element>;
  childSignature: string;
}

interface DetectedPattern {
  items_selector: string;
  fields: SkillFieldSelectors;
  count: number;
  score: number;
}

function getChildSignature($: cheerio.CheerioAPI, el: Element): string {
  const children = $(el).children();
  const tags: string[] = [];
  children.each((_, child) => {
    const tag = (child as Element).tagName?.toLowerCase() || "";
    const cls = $(child).attr("class")?.split(/\s+/).sort().join(".") || "";
    tags.push(cls ? `${tag}.${cls}` : tag);
  });
  return tags.join("|");
}

function buildSelector(el: Element, $: cheerio.CheerioAPI): string {
  const tag = el.tagName?.toLowerCase() || "div";
  const cls = $(el).attr("class");
  if (cls) {
    const classes = cls.split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      return `${tag}.${classes.join(".")}`;
    }
  }
  return tag;
}

function detectFields(
  $: cheerio.CheerioAPI,
  sample: cheerio.Cheerio<Element>,
): SkillFieldSelectors {
  const fields: SkillFieldSelectors = {};

  // Look for headings → title
  const headings = ["h1", "h2", "h3", "h4"];
  for (const h of headings) {
    const heading = sample.find(h).first();
    if (heading.length > 0) {
      const link = heading.find("a");
      if (link.length > 0) {
        fields["title"] = `${h} a`;
        fields["url"] = `${h} a @href`;
      } else {
        fields["title"] = h;
      }
      break;
    }
  }

  // Look for links (if no title link found)
  if (!fields["url"]) {
    const link = sample.find("a").first();
    if (link.length > 0) {
      if (!fields["title"]) {
        fields["title"] = "a";
      }
      fields["url"] = "a @href";
    }
  }

  // Look for time/date
  const time = sample.find("time").first();
  if (time.length > 0) {
    fields["date"] = "time @datetime";
  }

  // Look for images
  const img = sample.find("img").first();
  if (img.length > 0) {
    fields["image"] = "img @src";
  }

  // Look for paragraphs → summary
  const p = sample.find("p").first();
  if (p.length > 0) {
    fields["summary"] = "p";
  }

  // Look for author-like elements
  const authorSelectors = [
    "[class*='author']",
    "[class*='byline']",
    "[rel='author']",
  ];
  for (const sel of authorSelectors) {
    const author = sample.find(sel).first();
    if (author.length > 0) {
      const cls = author.attr("class");
      if (cls) {
        fields["author"] = `.${cls.split(/\s+/)[0]}`;
      } else {
        fields["author"] = sel;
      }
      break;
    }
  }

  return fields;
}

export function detectPatterns(html: string): DetectedPattern[] {
  const $ = cheerio.load(html);
  const groups: ElementGroup[] = [];

  // Find elements with classes that repeat
  const classCounts = new Map<string, { count: number; elements: Element[] }>();

  $("*[class]").each((_, el) => {
    const element = el as unknown as Element;
    const selector = buildSelector(element, $);
    const existing = classCounts.get(selector);
    if (existing) {
      existing.count++;
      existing.elements.push(element);
    } else {
      classCounts.set(selector, { count: 1, elements: [element] });
    }
  });

  // Filter to groups with enough repeating elements
  for (const [selector, data] of classCounts) {
    if (data.count < MIN_REPEATING_ELEMENTS) continue;

    // Check structural consistency
    const signatures = data.elements.map((el) => getChildSignature($, el));
    const primarySig = signatures[0];
    const consistent = signatures.filter((s) => s === primarySig).length;
    const consistency = consistent / signatures.length;

    if (consistency < 0.5) continue;

    groups.push({
      selector,
      count: data.count,
      sample: $(data.elements[0]) as cheerio.Cheerio<Element>,
      childSignature: primarySig,
    });
  }

  // Score and rank
  const patterns: DetectedPattern[] = groups
    .map((group) => {
      const fields = detectFields($, group.sample);
      const fieldCount = Object.keys(fields).length;
      if (fieldCount === 0) return null;

      // Score: more fields + more items + has title/url = better
      let score = fieldCount * 10 + group.count;
      if (fields["title"]) score += 20;
      if (fields["url"]) score += 15;
      if (fields["date"]) score += 5;
      if (fields["summary"]) score += 5;

      // Penalize very generic selectors
      if (group.selector === "div" || group.selector === "span") {
        score -= 50;
      }

      return {
        items_selector: group.selector,
        fields,
        count: group.count,
        score,
      };
    })
    .filter(Boolean) as DetectedPattern[];

  // Sort by score descending
  patterns.sort((a, b) => b.score - a.score);

  return patterns;
}

export function detectPagination($: cheerio.CheerioAPI): string | undefined {
  const candidates = [
    "a.load-more",
    "a.next",
    "a[rel='next']",
    "[class*='pagination'] a:last-child",
    "[class*='load-more']",
    "a[class*='next']",
  ];

  for (const sel of candidates) {
    if ($(sel).length > 0) {
      return sel;
    }
  }

  return undefined;
}
