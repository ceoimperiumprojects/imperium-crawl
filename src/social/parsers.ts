/**
 * Shared parsers for social media tools.
 *
 * parseCompactNumber: "1.2M" -> 1200000
 * parseRelativeTime: "3 hours ago" -> ISO date string
 * sanitizeText: strip HTML tags, collapse whitespace
 */

const MULTIPLIERS: Record<string, number> = {
  K: 1_000,
  M: 1_000_000,
  B: 1_000_000_000,
  T: 1_000_000_000_000,
};

/**
 * Parse compact number strings like "1.2M", "842K", "3.5B", "1,234".
 * Returns NaN for unparseable input.
 */
export function parseCompactNumber(str: string): number {
  if (!str) return NaN;

  // Clean: remove commas, spaces, plus signs
  const cleaned = str.replace(/[,\s+]/g, "").trim();

  // Try suffix match: "1.2M", "842K"
  const match = cleaned.match(/^([\d.]+)\s*([KMBT])/i);
  if (match) {
    const num = parseFloat(match[1]);
    const suffix = match[2].toUpperCase();
    return Math.round(num * (MULTIPLIERS[suffix] || 1));
  }

  // Plain number
  return parseFloat(cleaned) || NaN;
}

const TIME_UNITS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,   // ~30 days
  year: 31_536_000_000,   // ~365 days
};

/**
 * Parse relative time strings like "3 hours ago", "1 day ago", "2 months ago".
 * Returns ISO date string, or null if unparseable.
 */
export function parseRelativeTime(str: string): string | null {
  if (!str) return null;

  const match = str.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!match) return null;

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms = TIME_UNITS[unit];
  if (!ms) return null;

  return new Date(Date.now() - amount * ms).toISOString();
}

/**
 * Strip HTML tags and collapse whitespace.
 */
export function sanitizeText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract JSON from a script tag pattern like `var ytInitialData = {...};`
 * Also handles `<script id="varName" type="application/json">{...}</script>`.
 * Returns parsed object or null.
 */
export function extractScriptJson(html: string, varName: string): unknown | null {
  // Strategy 1: <script id="varName" type="application/json">{...}</script>
  const scriptTagPattern = new RegExp(
    `<script[^>]+id=["']${varName}["'][^>]*>([\\s\\S]*?)</script>`,
    "i",
  );
  const scriptTagMatch = scriptTagPattern.exec(html);
  if (scriptTagMatch) {
    try {
      return JSON.parse(scriptTagMatch[1]);
    } catch {
      // Fall through to other strategies
    }
  }

  // Strategy 2: var varName = {...}; or window['varName'] = {...};
  const patterns = [
    new RegExp(`var\\s+${varName}\\s*=\\s*`, "i"),
    new RegExp(`window\\[['"]${varName}['"]\\]\\s*=\\s*`, "i"),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match) continue;

    const start = match.index + match[0].length;
    // Find matching brace
    let depth = 0;
    let inString = false;
    let escape = false;
    let stringChar = "";

    for (let i = start; i < html.length; i++) {
      const ch = html[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (ch === "\\") {
        escape = true;
        continue;
      }

      if (inString) {
        if (ch === stringChar) inString = false;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        continue;
      }

      if (ch === "{" || ch === "[") depth++;
      if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) {
          const jsonStr = html.substring(start, i + 1);
          try {
            return JSON.parse(jsonStr);
          } catch {
            return null;
          }
        }
      }
    }
  }

  return null;
}
