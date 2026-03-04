import type { JobPosting, JobExtractionResult } from "./types.js";
import {
  PLATFORM_SELECTORS,
  ROLE_KEYWORDS,
  SECTION_HEADING_PATTERNS,
  LOCATION_PATTERNS,
  DEPARTMENT_KEYWORDS,
  PLATFORM_HTML_FINGERPRINTS,
} from "./config.js";
import { execute as scrapeExecute } from "../../src/tools/scrape.js";
import { execute as extractExecute } from "../../src/tools/extract.js";
import { needsJSRendering } from "../../src/stealth/detector.js";
import type { DomainMemory, DomainEntry } from "./domain-memory.js";
import { getDomainHint, recordSuccess } from "./domain-memory.js";

// ── Helpers: Sanitization, Filtering, Parsing ─────────────────

function sanitizeTitle(raw: string): string {
  return raw
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "") // zero-width chars
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // **bold** / *italic*
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1") // __bold__ / _italic_
    .replace(/`([^`]+)`/g, "$1") // `code`
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

function isLikelyFalsePositive(title: string): boolean {
  // "Name, Ph.D. – Title" pattern (team bios)
  const hasDash = /[\u2013\u2014\u2012\u002D\u2015–—-]/.test(title);
  const startsWithName =
    /^[A-Z][a-z]+\s+(?:(?:van|de|von|del|la)\s+)?[A-Z]/.test(title);
  if (hasDash && startsWithName) return true;

  // Academic/professional credentials: "Name, Ph.D."
  if (/,\s*(?:Ph\.?D|M\.?D|MBA|JD|CPA|RN|BSN|M\.?S\.?)\.?\b/i.test(title))
    return true;

  // Section headings
  if (SECTION_HEADING_PATTERNS.some((p) => p.test(title))) return true;

  return false;
}

function isLocationLike(text: string): boolean {
  return LOCATION_PATTERNS.some((p) => p.test(text));
}

function isDepartmentLike(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return DEPARTMENT_KEYWORDS.some(
    (kw) => lower === kw || lower.startsWith(kw + " ") || lower.endsWith(" " + kw),
  );
}

interface ParsedJobLine {
  title: string;
  location?: string;
  department?: string;
}

function parseJobLine(rawTitle: string): ParsedJobLine {
  let title = sanitizeTitle(rawTitle);
  let location: string | undefined;
  let department: string | undefined;

  // "Title (Remote)" or "Title (San Francisco, CA)"
  const parenMatch = title.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch && isLocationLike(parenMatch[2])) {
    title = parenMatch[1].trim();
    location = parenMatch[2].trim();
  }

  // "Title — Location" or "Title | Location | Department"
  const parts = title.split(/\s*(?:[\u2013\u2014–—|])\s*/).filter(Boolean);
  if (parts.length >= 2) {
    title = parts[0];
    for (const part of parts.slice(1)) {
      if (!location && isLocationLike(part)) location = part;
      else if (!department && isDepartmentLike(part)) department = part;
    }
  }

  return { title, location, department };
}

// ── Deduplication ──────────────────────────────────────────────

function normalizeKey(title: string, location?: string): string {
  const t = title.toLowerCase().replace(/\s+/g, " ").trim();
  const l = (location ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return `${t}|||${l}`;
}

function deduplicateJobs(jobs: JobPosting[]): JobPosting[] {
  if (jobs.length <= 1) return jobs;

  // Step 1: Detect concatenated titles (e.g. "Engineering ManagerSenior SRE")
  const concatenatedIndices = new Set<number>();
  for (let i = 0; i < jobs.length; i++) {
    const candidate = jobs[i].title;
    const contained = jobs.filter((j, j2) => i !== j2 && candidate.includes(j.title));
    if (contained.length < 2) continue;
    let remaining = candidate;
    for (const c of contained) remaining = remaining.replace(c.title, "");
    if (remaining.trim() === "") concatenatedIndices.add(i);
  }

  // Step 2: Dedup by (title + location)
  const seen = new Set<string>();
  const result: JobPosting[] = [];
  for (let i = 0; i < jobs.length; i++) {
    if (concatenatedIndices.has(i)) continue;
    const key = normalizeKey(jobs[i].title, jobs[i].location);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(jobs[i]);
  }

  // Log cleanup stats
  if (concatenatedIndices.size > 0 || jobs.length - concatenatedIndices.size > result.length) {
    const rc = concatenatedIndices.size;
    const rd = jobs.length - rc - result.length;
    const parts: string[] = [];
    if (rc > 0) parts.push(`${rc} concatenated`);
    if (rd > 0) parts.push(`${rd} duplicates`);
    console.log(`  🧹 Dedup: removed ${parts.join(", ")} (${jobs.length} → ${result.length})`);
  }

  return result;
}

// ── Strategy 1: JSON-LD Structured Data ───────────────────────

interface JsonLdJobPosting {
  "@type"?: string;
  title?: string;
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string } } | string;
  hiringOrganization?: { name?: string };
  employmentType?: string;
  url?: string;
}

function parseJsonLdJobs(structured: unknown[]): JobPosting[] {
  const jobs: JobPosting[] = [];

  for (const item of structured) {
    const obj = item as Record<string, unknown>;
    // Handle @graph arrays
    const items: JsonLdJobPosting[] = obj["@graph"]
      ? (obj["@graph"] as JsonLdJobPosting[])
      : [obj as JsonLdJobPosting];

    for (const entry of items) {
      if (entry["@type"] !== "JobPosting") continue;
      const loc = entry.jobLocation;
      let location: string | undefined;
      if (typeof loc === "string") {
        location = loc;
      } else if (loc?.address) {
        location = [loc.address.addressLocality, loc.address.addressRegion]
          .filter(Boolean)
          .join(", ");
      }

      const title = sanitizeTitle(entry.title ?? "Unknown");
      if (isLikelyFalsePositive(title)) continue;

      jobs.push({
        title,
        location: location || undefined,
        type: entry.employmentType
          ? String(entry.employmentType)
          : undefined,
        url: entry.url ? String(entry.url) : undefined,
      });
    }
  }
  return jobs;
}

// ── Strategy 2: Known Platform CSS ────────────────────────────

async function tryPlatformCss(
  careersUrl: string,
): Promise<{
  jobs: JobPosting[];
  strategy: "platform-css";
  platform: string;
} | null> {
  // Find matching platform
  const platform = Object.entries(PLATFORM_SELECTORS).find(([, cfg]) =>
    cfg.match.test(careersUrl),
  );
  if (!platform) return null;

  const [platformName, cfg] = platform;

  try {
    const result = await extractExecute({
      url: careersUrl,
      items_selector: cfg.container,
      selectors: {
        title: cfg.title,
        ...(cfg.location ? { location: cfg.location } : {}),
        ...(cfg.department ? { department: cfg.department } : {}),
        ...(cfg.link ? { link: `${cfg.link} @href` } : {}),
      },
    });

    const parsed = JSON.parse(result.content[0].text) as {
      items?: Array<Record<string, string>>;
    };
    const items = parsed.items ?? [];
    if (items.length === 0) return null;

    const jobs: JobPosting[] = items
      .filter((item) => item.title && item.title.trim().length > 0)
      .map((item) => ({
        title: sanitizeTitle(item.title),
        location: item.location?.trim() || undefined,
        department: item.department?.trim() || undefined,
        url: item.link || undefined,
      }))
      .filter((job) => !isLikelyFalsePositive(job.title));

    if (jobs.length === 0) return null;

    return { jobs, strategy: "platform-css", platform: platformName };
  } catch {
    return null;
  }
}

// ── Strategy 3: Generic Markdown Heuristic ────────────────────

function extractJobsFromMarkdown(markdown: string): JobPosting[] {
  const jobs: JobPosting[] = [];
  const seen = new Set<string>();
  const lines = markdown.split("\n");

  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  const listPattern = /^[\s]*[-*]\s+(.+)/;
  const headerPattern = /^#{1,4}\s+(.+)/;

  const roleRegex = new RegExp(
    `\\b(${ROLE_KEYWORDS.join("|")})\\b`,
    "i",
  );

  let currentDepartment: string | undefined;

  function tryAddJob(rawText: string, url?: string): void {
    const parsed = parseJobLine(rawText);
    const { title } = parsed;

    if (title.length <= 5 || title.length >= 120) return;
    if (!roleRegex.test(title)) return;
    if (isLikelyFalsePositive(title)) return;

    const key = normalizeKey(title, parsed.location);
    if (seen.has(key)) return;
    seen.add(key);

    jobs.push({
      title,
      location: parsed.location || undefined,
      department: parsed.department || currentDepartment || undefined,
      url: url || undefined,
    });
  }

  for (const line of lines) {
    // Check if header is a department label (not a job)
    const headerMatch = line.match(headerPattern);
    if (headerMatch) {
      const text = sanitizeTitle(headerMatch[1]);
      if (!roleRegex.test(text) && isDepartmentLike(text)) {
        currentDepartment = text;
        continue;
      }
      // Header might be a job title — fall through to tryAddJob
      tryAddJob(text);
      continue;
    }

    // Try markdown links first
    let match: RegExpExecArray | null;
    linkPattern.lastIndex = 0;
    while ((match = linkPattern.exec(line)) !== null) {
      tryAddJob(match[1], match[2]);
    }

    // Try list items (strip inline links first)
    const listMatch = line.match(listPattern);
    if (listMatch) {
      const text = listMatch[1].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
      tryAddJob(text);
    }
  }

  return jobs;
}

// ── Strategy 4: Detect embedded platform from HTML ────────────

function detectPlatformFromHtml(
  html: string,
  _pageUrl: string,
): { platform: string; embedUrl: string } | null {
  for (const [platform, fp] of Object.entries(PLATFORM_HTML_FINGERPRINTS)) {
    const matched = fp.patterns.some((p) => p.test(html));
    if (!matched) continue;

    // Try to extract iframe/embed src for direct scraping
    if (fp.iframeSrc) {
      const srcMatch = html.match(fp.iframeSrc);
      if (srcMatch) {
        // Build the full board URL from captured slug
        const slug = srcMatch[1];
        const urlMap: Record<string, string> = {
          greenhouse: `https://boards.greenhouse.io/${slug}`,
          lever: `https://jobs.lever.co/${slug}`,
          ashby: `https://jobs.ashbyhq.com/${slug}`,
          workable: `https://apply.workable.com/${slug}`,
          smartrecruiters: `https://jobs.smartrecruiters.com/${slug}`,
        };
        const embedUrl = urlMap[platform];
        if (embedUrl) return { platform, embedUrl };
      }
    }
  }
  return null;
}

// ── Strategy 5: Browser retry for SPA shells ──────────────────

async function tryBrowserRendering(
  careersUrl: string,
): Promise<{ jobs: JobPosting[]; strategy: "generic-markdown" } | null> {
  try {
    const result = await scrapeExecute({
      url: careersUrl,
      format: "markdown",
      include: ["structured_data"],
      stealth_level: 3, // force Playwright rendering
    });

    const page = JSON.parse(result.content[0].text) as {
      content?: string;
      structured_data?: { jsonLd?: unknown[] };
    };

    // Try JSON-LD first (might appear after JS rendering)
    const jsonLd = page.structured_data?.jsonLd;
    if (jsonLd && jsonLd.length > 0) {
      const jobs = parseJsonLdJobs(jsonLd);
      if (jobs.length > 0) return { jobs, strategy: "generic-markdown" };
    }

    // Try markdown from rendered content
    if (page.content && page.content.length >= 100) {
      const jobs = extractJobsFromMarkdown(page.content);
      if (jobs.length > 0) return { jobs, strategy: "generic-markdown" };
    }

    return null;
  } catch {
    return null;
  }
}

// ── Domain Learning: Try Learned Strategy ─────────────────────

async function tryLearnedStrategy(
  careersUrl: string,
  hint: DomainEntry,
): Promise<{ jobs: JobPosting[]; strategy: "json-ld" | "platform-css" | "generic-markdown"; platform?: string } | null> {
  try {
    if (hint.strategy === "json-ld") {
      const result = await scrapeExecute({
        url: careersUrl,
        format: "markdown",
        include: ["structured_data"],
      });
      const page = JSON.parse(result.content[0].text) as {
        structured_data?: { jsonLd?: unknown[] };
      };
      const jsonLd = page.structured_data?.jsonLd;
      if (jsonLd && jsonLd.length > 0) {
        const jobs = parseJsonLdJobs(jsonLd);
        if (jobs.length > 0) return { jobs, strategy: "json-ld" };
      }
    }

    if (hint.strategy === "platform-css") {
      const targetUrl = hint.embedUrl || careersUrl;
      const cssResult = await tryPlatformCss(targetUrl);
      if (cssResult) return { ...cssResult, platform: hint.platform };
    }

    if (hint.strategy === "generic-markdown") {
      const result = await scrapeExecute({
        url: careersUrl,
        format: "markdown",
      });
      const page = JSON.parse(result.content[0].text) as { content?: string };
      if (page.content && page.content.length >= 100) {
        const jobs = extractJobsFromMarkdown(page.content);
        if (jobs.length > 0) return { jobs, strategy: "generic-markdown" };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ── Main: Single-Fetch Cascade ────────────────────────────────

export async function extractJobs(
  companyId: string,
  companyName: string,
  careersUrl: string,
  memory?: DomainMemory,
): Promise<JobExtractionResult> {
  const base = {
    companyId,
    companyName,
    careersUrl,
    timestamp: new Date().toISOString(),
  };

  // ── Check domain memory for learned strategy ──
  const hint = memory ? getDomainHint(memory, careersUrl) : null;
  if (hint) {
    const hintResult = await tryLearnedStrategy(careersUrl, hint);
    if (hintResult && hintResult.jobs.length > 0) {
      const deduped = deduplicateJobs(hintResult.jobs);
      if (memory) recordSuccess(memory, careersUrl, { strategy: hintResult.strategy, platform: hintResult.platform, jobCount: deduped.length });
      return { ...base, ...hintResult, jobs: deduped };
    }
    // Learned strategy failed — fall through to full cascade
  }

  // ── Single fetch: markdown + structured_data + html ──
  let page: {
    content?: string;
    structured_data?: { jsonLd?: unknown[] };
    html?: string;
  } = {};

  try {
    const result = await scrapeExecute({
      url: careersUrl,
      format: "markdown",
      include: ["structured_data", "html"],
    });
    page = JSON.parse(result.content[0].text);
  } catch {
    return { ...base, jobs: [], strategy: null };
  }

  // Strategy 1: JSON-LD (from structured_data — no extra fetch)
  const jsonLd = page.structured_data?.jsonLd;
  if (jsonLd && jsonLd.length > 0) {
    const jobs = parseJsonLdJobs(jsonLd);
    if (jobs.length > 0) {
      const deduped = deduplicateJobs(jobs);
      if (memory) recordSuccess(memory, careersUrl, { strategy: "json-ld", jobCount: deduped.length });
      return { ...base, jobs: deduped, strategy: "json-ld" };
    }
  }

  // Strategy 2a: Platform CSS by URL (separate fetch — only for known platforms)
  const platformResult = await tryPlatformCss(careersUrl);
  if (platformResult) {
    const deduped = deduplicateJobs(platformResult.jobs);
    if (memory) recordSuccess(memory, careersUrl, { strategy: "platform-css", platform: platformResult.platform, jobCount: deduped.length });
    return { ...base, ...platformResult, jobs: deduped };
  }

  // Strategy 2b: Platform detection from HTML (iframe/embed sniffing)
  if (page.html) {
    const detected = detectPlatformFromHtml(page.html, careersUrl);
    if (detected) {
      const embedResult = await tryPlatformCss(detected.embedUrl);
      if (embedResult) {
        const deduped = deduplicateJobs(embedResult.jobs);
        if (memory) recordSuccess(memory, careersUrl, { strategy: "platform-css", platform: detected.platform, embedUrl: detected.embedUrl, jobCount: deduped.length });
        return { ...base, ...embedResult, platform: detected.platform, jobs: deduped };
      }
    }
  }

  // Strategy 3: Generic markdown (from page.content — no extra fetch)
  if (page.content && page.content.length >= 100) {
    const jobs = extractJobsFromMarkdown(page.content);
    if (jobs.length > 0) {
      const deduped = deduplicateJobs(jobs);
      if (memory) recordSuccess(memory, careersUrl, { strategy: "generic-markdown", jobCount: deduped.length });
      return { ...base, jobs: deduped, strategy: "generic-markdown" };
    }
  }

  // Strategy 4: Browser retry (only if SPA shell detected)
  if (page.html && needsJSRendering(page.html)) {
    const browserResult = await tryBrowserRendering(careersUrl);
    if (browserResult) {
      const deduped = deduplicateJobs(browserResult.jobs);
      if (memory) recordSuccess(memory, careersUrl, { strategy: browserResult.strategy, jobCount: deduped.length });
      return { ...base, ...browserResult, jobs: deduped };
    }
  }

  // No jobs found
  return { ...base, jobs: [], strategy: null };
}
