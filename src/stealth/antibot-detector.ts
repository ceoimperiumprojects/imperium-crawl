import type { StealthLevel } from "./index.js";

export type AntiBotSystem =
  | "cloudflare"
  | "akamai"
  | "perimeterx"
  | "datadome"
  | "kasada"
  | "aws-waf"
  | "f5-shape"
  | "incapsula"
  | "sucuri"
  | "geetest"
  | "distil"
  | "unknown"
  | "none";

export interface AntiBotDetection {
  system: AntiBotSystem;
  confidence: number; // 0-1
  recommendedLevel: StealthLevel;
  signals: string[];
}

interface DetectionRule {
  system: AntiBotSystem;
  weight: number;
  check: (ctx: DetectionContext) => boolean;
  signal: string;
}

interface DetectionContext {
  headers: Record<string, string>;
  cookies: string[];
  html: string;
}

const RULES: DetectionRule[] = [
  // ── Cloudflare ──
  { system: "cloudflare", weight: 0.5, signal: "cf_clearance cookie", check: (c) => c.cookies.some((k) => k.startsWith("cf_clearance")) },
  { system: "cloudflare", weight: 0.3, signal: "cf_ cookie prefix", check: (c) => c.cookies.some((k) => k.startsWith("cf_")) },
  { system: "cloudflare", weight: 0.4, signal: "cf-mitigated header", check: (c) => "cf-mitigated" in c.headers },
  { system: "cloudflare", weight: 0.3, signal: "cf-ray header", check: (c) => "cf-ray" in c.headers },
  { system: "cloudflare", weight: 0.5, signal: "challenge page title", check: (c) => /<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(c.html) },
  { system: "cloudflare", weight: 0.3, signal: "cloudflare challenge script", check: (c) => c.html.includes("/cdn-cgi/challenge-platform/") },
  { system: "cloudflare", weight: 0.2, signal: "server: cloudflare", check: (c) => c.headers["server"]?.toLowerCase() === "cloudflare" },

  // ── Akamai ──
  { system: "akamai", weight: 0.6, signal: "_abck cookie", check: (c) => c.cookies.some((k) => k.startsWith("_abck")) },
  { system: "akamai", weight: 0.4, signal: "bm_sz cookie", check: (c) => c.cookies.some((k) => k.startsWith("bm_sz")) },
  { system: "akamai", weight: 0.3, signal: "ak_bmsc cookie", check: (c) => c.cookies.some((k) => k.startsWith("ak_bmsc")) },
  { system: "akamai", weight: 0.2, signal: "akamai script", check: (c) => c.html.includes("akamaihd.net") },

  // ── PerimeterX / HUMAN ──
  { system: "perimeterx", weight: 0.7, signal: "_px cookie", check: (c) => c.cookies.some((k) => k.startsWith("_px")) },
  { system: "perimeterx", weight: 0.4, signal: "px-captcha", check: (c) => c.html.includes("px-captcha") },
  { system: "perimeterx", weight: 0.3, signal: "perimeterx script", check: (c) => c.html.includes("client.perimeterx.net") },

  // ── DataDome ──
  { system: "datadome", weight: 0.7, signal: "datadome cookie", check: (c) => c.cookies.some((k) => k.startsWith("datadome")) },
  { system: "datadome", weight: 0.4, signal: "x-datadome header", check: (c) => Object.keys(c.headers).some((k) => k.startsWith("x-datadome")) },
  { system: "datadome", weight: 0.3, signal: "datadome script", check: (c) => c.html.includes("js.datadome.co") },

  // ── Kasada ──
  { system: "kasada", weight: 0.7, signal: "x-kpsdk header", check: (c) => Object.keys(c.headers).some((k) => k.startsWith("x-kpsdk")) },
  { system: "kasada", weight: 0.4, signal: "kasada script", check: (c) => c.html.includes("ips.js") && c.html.includes("_kpsdk") },

  // ── AWS WAF ──
  { system: "aws-waf", weight: 0.6, signal: "aws-waf-token cookie", check: (c) => c.cookies.some((k) => k.startsWith("aws-waf-token")) },
  { system: "aws-waf", weight: 0.3, signal: "awswaf challenge", check: (c) => c.html.includes("awswaf") },

  // ── F5 / Shape Security ──
  { system: "f5-shape", weight: 0.5, signal: "TS cookie prefix", check: (c) => c.cookies.some((k) => /^ts[a-f0-9]{6,}/.test(k)) },
  { system: "f5-shape", weight: 0.3, signal: "shape script", check: (c) => c.html.includes("shape.js") || c.html.includes("shapesecurity.com") },

  // ── Incapsula / Imperva ──
  { system: "incapsula", weight: 0.6, signal: "_incap_ses_ cookie", check: (c) => c.cookies.some((k) => k.startsWith("_incap_ses_")) },
  { system: "incapsula", weight: 0.6, signal: "visid_incap cookie", check: (c) => c.cookies.some((k) => k.startsWith("visid_incap")) },
  { system: "incapsula", weight: 0.3, signal: "incap_ses cookie", check: (c) => c.cookies.some((k) => k.includes("incap")) },
  { system: "incapsula", weight: 0.4, signal: "incapsula script", check: (c) => c.html.includes("incapsula") || c.html.includes("imperva") },
  { system: "incapsula", weight: 0.3, signal: "x-iinfo header", check: (c) => "x-iinfo" in c.headers },

  // ── Sucuri ──
  { system: "sucuri", weight: 0.7, signal: "sucuri cookie", check: (c) => c.cookies.some((k) => k.includes("sucuri")) },
  { system: "sucuri", weight: 0.4, signal: "x-sucuri-id header", check: (c) => "x-sucuri-id" in c.headers },
  { system: "sucuri", weight: 0.3, signal: "sucuri script/content", check: (c) => c.html.includes("sucuri") && c.html.includes("cloudproxy") },

  // ── GeeTest ──
  { system: "geetest", weight: 0.7, signal: "geetest script", check: (c) => c.html.includes("geetest") || c.html.includes("gt.js") },
  { system: "geetest", weight: 0.5, signal: "geetest captcha div", check: (c) => c.html.includes("geetest_") || c.html.includes("gt_captcha") },

  // ── Distil Networks ──
  { system: "distil", weight: 0.6, signal: "D= cookie", check: (c) => c.cookies.some((k) => k === "d" || k.startsWith("d=")) },
  { system: "distil", weight: 0.5, signal: "distil script", check: (c) => c.html.includes("distil") || c.html.includes("distilnetworks") },
  { system: "distil", weight: 0.3, signal: "x-distil-cs header", check: (c) => "x-distil-cs" in c.headers },
];

// What stealth level each system typically needs
const RECOMMENDED_LEVELS: Record<AntiBotSystem, StealthLevel> = {
  cloudflare: 3,    // Usually needs full browser
  akamai: 3,        // JS fingerprinting requires browser
  perimeterx: 3,    // Heavy JS challenge
  datadome: 3,      // Device fingerprinting
  kasada: 3,        // Proof of work
  "aws-waf": 2,     // Often basic enough for TLS stealth
  "f5-shape": 3,    // JS obfuscation
  incapsula: 3,     // JS challenge + fingerprinting
  sucuri: 2,        // Usually simpler WAF rules
  geetest: 3,       // Interactive challenge
  distil: 3,        // Heavy JS fingerprinting
  unknown: 3,       // Unknown → assume worst case
  none: 1,
};

/**
 * Detect which anti-bot system protects a site based on headers, cookies, and HTML.
 */
export function detectAntiBot(
  headers: Record<string, string>,
  cookies: string[],
  html: string,
): AntiBotDetection {
  const ctx: DetectionContext = {
    headers: Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    ),
    cookies: cookies.map((c) => c.toLowerCase()),
    html,
  };

  // Accumulate scores per system
  const scores = new Map<AntiBotSystem, { total: number; signals: string[] }>();

  for (const rule of RULES) {
    try {
      if (rule.check(ctx)) {
        const existing = scores.get(rule.system) || { total: 0, signals: [] };
        existing.total += rule.weight;
        existing.signals.push(rule.signal);
        scores.set(rule.system, existing);
      }
    } catch {
      // Rule check failed, skip
    }
  }

  // Find highest scoring system
  let bestSystem: AntiBotSystem = "none";
  let bestScore = 0;
  let bestSignals: string[] = [];

  for (const [system, { total, signals }] of scores) {
    if (total > bestScore) {
      bestSystem = system;
      bestScore = total;
      bestSignals = signals;
    }
  }

  // ── "Unknown anti-bot" fallback detection ──
  // If no known system matched but page shows challenge characteristics
  if (bestSystem === "none") {
    const unknownSignals: string[] = [];

    // Challenge-like page: small body, mostly scripts, noscript fallback
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      const bodyContent = bodyMatch[1];
      const textOnly = bodyContent
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]*>/g, "")
        .trim();

      const scriptCount = (bodyContent.match(/<script/gi) || []).length;
      const hasNoscript = bodyContent.includes("<noscript>");

      // Small text content but lots of scripts → challenge page
      if (textOnly.length < 200 && scriptCount >= 2) {
        unknownSignals.push("small body with multiple scripts");
      }

      // noscript with content but body is mostly scripts → JS challenge
      if (hasNoscript && textOnly.length < 500 && scriptCount >= 3) {
        unknownSignals.push("noscript fallback with script-heavy body");
      }
    }

    // JS redirect pattern
    if (html.includes("window.location") && html.includes("document.cookie")) {
      unknownSignals.push("JS redirect with cookie manipulation");
    }

    if (unknownSignals.length >= 1) {
      bestSystem = "unknown";
      bestScore = 0.3;
      bestSignals = unknownSignals;
    }
  }

  // Normalize confidence to 0-1 (cap at 1)
  const confidence = Math.min(bestScore, 1);

  return {
    system: bestSystem,
    confidence,
    recommendedLevel: RECOMMENDED_LEVELS[bestSystem],
    signals: bestSignals,
  };
}

/**
 * Extract cookie names from Set-Cookie headers or cookie strings.
 */
export function parseCookieNames(setCookieHeaders: string[]): string[] {
  return setCookieHeaders.map((c) => {
    const eqIdx = c.indexOf("=");
    return eqIdx > 0 ? c.substring(0, eqIdx).trim() : c.trim();
  });
}
