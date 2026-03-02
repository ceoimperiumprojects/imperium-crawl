/**
 * CAPTCHA type detection from HTML.
 * Identifies reCAPTCHA v2/v3, hCaptcha, and Cloudflare Turnstile,
 * and extracts the sitekey needed for solving.
 */

export type CaptchaType = "recaptcha_v2" | "recaptcha_v3" | "hcaptcha" | "turnstile";

export interface CaptchaInfo {
  type: CaptchaType;
  sitekey: string;
  action?: string;        // reCAPTCHA v3 action
  enterprise?: boolean;   // reCAPTCHA Enterprise
  s?: string;             // reCAPTCHA data-s (invisible)
}

// ── reCAPTCHA Detection ──

const RECAPTCHA_SITEKEY_PATTERNS = [
  /data-sitekey=["']([A-Za-z0-9_-]{40})["']/,
  /grecaptcha\.render\s*\([^,]*,\s*\{\s*['"]?sitekey['"]?\s*:\s*['"]([A-Za-z0-9_-]{40})["']/,
  /['"]sitekey['"]\s*:\s*['"]([A-Za-z0-9_-]{40})["']/,
  /recaptcha\/api2?\/anchor\?.*?k=([A-Za-z0-9_-]{40})/,
  /recaptcha\/enterprise\/anchor\?.*?k=([A-Za-z0-9_-]{40})/,
];

const RECAPTCHA_V3_INDICATORS = [
  "grecaptcha.execute",
  "recaptcha/api.js?render=",
  "recaptcha/enterprise.js?render=",
  "recaptcha-v3",
  '"size":"invisible"',
];

const RECAPTCHA_ENTERPRISE_INDICATORS = [
  "recaptcha/enterprise",
  "grecaptcha.enterprise",
];

function detectRecaptcha(html: string): CaptchaInfo | null {
  // Try to find sitekey
  let sitekey: string | null = null;
  for (const pattern of RECAPTCHA_SITEKEY_PATTERNS) {
    const match = html.match(pattern);
    if (match) {
      sitekey = match[1];
      break;
    }
  }

  if (!sitekey) {
    // Check for general reCAPTCHA presence without sitekey
    if (!html.includes("g-recaptcha") && !html.includes("grecaptcha") && !html.includes("recaptcha/api")) {
      return null;
    }
    // Try render param as sitekey
    const renderMatch = html.match(/recaptcha\/(?:enterprise\/)?api\.js\?.*?render=([A-Za-z0-9_-]{40})/);
    if (renderMatch) {
      sitekey = renderMatch[1];
    } else {
      return null;
    }
  }

  const isEnterprise = RECAPTCHA_ENTERPRISE_INDICATORS.some((i) => html.includes(i));
  const isV3 = RECAPTCHA_V3_INDICATORS.some((i) => html.includes(i));

  // Try to extract action for v3
  let action: string | undefined;
  if (isV3) {
    const actionMatch = html.match(/grecaptcha\.(?:enterprise\.)?execute\s*\(\s*['"][^'"]*['"]\s*,\s*\{\s*action\s*:\s*['"]([^'"]+)['"]/);
    action = actionMatch?.[1] || "verify";
  }

  // Extract data-s if present (invisible reCAPTCHA)
  const sMatch = html.match(/data-s=["']([^"']+)["']/);

  return {
    type: isV3 ? "recaptcha_v3" : "recaptcha_v2",
    sitekey,
    action,
    enterprise: isEnterprise || undefined,
    s: sMatch?.[1],
  };
}

// ── hCaptcha Detection ──

const HCAPTCHA_SITEKEY_PATTERNS = [
  /data-sitekey=["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/,
  /hcaptcha\.render\s*\([^,]*,\s*\{[^}]*sitekey['"]\s*:\s*['"]([0-9a-f-]{36})["']/,
  /['"]sitekey['"]\s*:\s*['"]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/,
];

function detectHcaptcha(html: string): CaptchaInfo | null {
  // Must have hCaptcha indicators
  if (!html.includes("h-captcha") && !html.includes("hcaptcha") && !html.includes("hcaptcha.com")) {
    return null;
  }

  for (const pattern of HCAPTCHA_SITEKEY_PATTERNS) {
    const match = html.match(pattern);
    if (match) {
      return { type: "hcaptcha", sitekey: match[1] };
    }
  }

  return null;
}

// ── Cloudflare Turnstile Detection ──

const TURNSTILE_SITEKEY_PATTERNS = [
  /class=["'][^"']*cf-turnstile[^"']*["'][^>]*data-sitekey=["']([A-Za-z0-9_-]+)["']/,
  /data-sitekey=["']([A-Za-z0-9_-]+)["'][^>]*class=["'][^"']*cf-turnstile/,
  /turnstile\.render\s*\([^,]*,\s*\{[^}]*sitekey['"]\s*:\s*['"]([A-Za-z0-9_-]+)["']/,
];

function detectTurnstile(html: string): CaptchaInfo | null {
  if (!html.includes("cf-turnstile") && !html.includes("challenges.cloudflare.com/turnstile")) {
    return null;
  }

  for (const pattern of TURNSTILE_SITEKEY_PATTERNS) {
    const match = html.match(pattern);
    if (match) {
      return { type: "turnstile", sitekey: match[1] };
    }
  }

  return null;
}

// ── Main Detector ──

/**
 * Detect CAPTCHA type and extract sitekey from HTML.
 * Checks in order: Turnstile (most specific) → hCaptcha → reCAPTCHA.
 * Returns null if no CAPTCHA detected.
 */
export function detectCaptcha(html: string): CaptchaInfo | null {
  // Turnstile first (Cloudflare-specific, most precise match)
  const turnstile = detectTurnstile(html);
  if (turnstile) return turnstile;

  // hCaptcha (UUID sitekey is very specific)
  const hcaptcha = detectHcaptcha(html);
  if (hcaptcha) return hcaptcha;

  // reCAPTCHA (most common, check last)
  const recaptcha = detectRecaptcha(html);
  if (recaptcha) return recaptcha;

  return null;
}

/**
 * Quick check if HTML contains any CAPTCHA indicators.
 * Faster than full detection — use as pre-filter.
 */
export function hasCaptcha(html: string): boolean {
  return (
    html.includes("g-recaptcha") ||
    html.includes("grecaptcha") ||
    html.includes("h-captcha") ||
    html.includes("hcaptcha") ||
    html.includes("cf-turnstile") ||
    html.includes("challenges.cloudflare.com/turnstile")
  );
}
