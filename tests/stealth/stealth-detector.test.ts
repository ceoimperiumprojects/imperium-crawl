import { describe, it, expect } from "vitest";
import { isBlocked, needsJSRendering, isCaptchaPage } from "../../src/stealth/detector.js";
import { detectAntiBot, parseCookieNames } from "../../src/stealth/antibot-detector.js";

// ── isBlocked ──

describe("isBlocked", () => {
  it("detects 403 with anti-bot headers as blocked", () => {
    expect(isBlocked("<html>Forbidden</html>", 403, { "cf-ray": "abc123" })).toBe(true);
  });

  it("detects 429 with anti-bot headers as blocked", () => {
    expect(isBlocked("<html>Too Many</html>", 429, { "cf-mitigated": "challenge" })).toBe(true);
  });

  it("detects 503 with challenge script as blocked", () => {
    const html = '<html><body><script src="/cdn-cgi/challenge-platform/v1"></script></body></html>';
    expect(isBlocked(html, 503, { "cf-ray": "abc" })).toBe(true);
  });

  it("does NOT flag 403 without anti-bot signals (regular server)", () => {
    expect(isBlocked("<html><body><p>You don't have permission to access this resource. The directory listing is not allowed. Please check the URL.</p></body></html>", 403, { "server": "nginx" })).toBe(false);
  });

  it("does NOT flag 503 without anti-bot signals (maintenance)", () => {
    expect(isBlocked("<html><body><p>We are currently performing maintenance. Please check back soon. Our engineers are working to resolve the issue.</p></body></html>", 503)).toBe(false);
  });

  it("detects 403 with small body and blocked indicators", () => {
    expect(isBlocked("<html><body>Access Denied</body></html>", 403)).toBe(true);
  });

  it("detects Cloudflare challenge page", () => {
    const html = `<html><head><title>Just a moment...</title></head><body></body></html>`;
    expect(isBlocked(html, 200)).toBe(true);
  });

  it("detects 'access denied' in small body (no headers needed)", () => {
    expect(isBlocked("<html><body>Access Denied</body></html>", 200)).toBe(true);
  });

  it("detects 'verify you are human' in small body", () => {
    expect(isBlocked("<html><body>Please verify you are human to continue</body></html>", 200)).toBe(true);
  });

  it("detects captcha keyword in small body", () => {
    expect(isBlocked("<html><body>Please solve the CAPTCHA</body></html>", 200)).toBe(true);
  });

  it("does NOT flag large article mentioning 'blocked' and 'captcha'", () => {
    const longContent = "A".repeat(6000);
    const html = `<html><body><nav><a href='/1'>1</a><a href='/2'>2</a><a href='/3'>3</a><a href='/4'>4</a><a href='/5'>5</a><a href='/6'>6</a><a href='/7'>7</a><a href='/8'>8</a><a href='/9'>9</a><a href='/10'>10</a><a href='/11'>11</a></nav><p>This article discusses how users get blocked by captcha systems. ${longContent}</p></body></html>`;
    expect(isBlocked(html, 200)).toBe(false);
  });

  it("detects 'Attention Required' title", () => {
    const html = `<html><head><title>Attention Required! | Cloudflare</title></head><body>challenge</body></html>`;
    expect(isBlocked(html, 200)).toBe(true);
  });

  it("detects cf-mitigated header", () => {
    expect(isBlocked("<html><body>OK</body></html>", 200, { "cf-mitigated": "challenge" })).toBe(true);
  });

  it("passes clean 200 response", () => {
    const html = `<html><body><h1>Welcome</h1><p>This is a normal page with lots of content here.</p></body></html>`;
    expect(isBlocked(html, 200)).toBe(false);
  });

  it("passes normal page without indicators", () => {
    expect(isBlocked("<html><body>Hello World, this is a nice article about cooking.</body></html>", 200)).toBe(false);
  });
});

// ── isCaptchaPage ──

describe("isCaptchaPage", () => {
  it("detects reCAPTCHA", () => {
    expect(isCaptchaPage('<html><div class="g-recaptcha"></div></html>')).toBe(true);
  });

  it("detects Turnstile", () => {
    expect(isCaptchaPage('<html><div class="cf-turnstile"></div></html>')).toBe(true);
  });

  it("detects hCaptcha", () => {
    expect(isCaptchaPage('<html><div class="h-captcha"></div></html>')).toBe(true);
  });

  it("does not flag normal page", () => {
    expect(isCaptchaPage('<html><body>Regular content</body></html>')).toBe(false);
  });
});

// ── needsJSRendering ──

describe("needsJSRendering", () => {
  it("detects React SPA shell", () => {
    const html = `<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>`;
    expect(needsJSRendering(html)).toBe(true);
  });

  it("detects Next.js shell", () => {
    const html = `<html><body><div id="__next"></div><script>__NEXT_DATA__={}</script></body></html>`;
    expect(needsJSRendering(html)).toBe(true);
  });

  it("detects Vue app shell", () => {
    const html = `<html><body><div id="app"></div></body></html>`;
    expect(needsJSRendering(html)).toBe(true);
  });

  it("detects Nuxt shell", () => {
    expect(needsJSRendering('<html><body><div id="__nuxt"></div></body></html>')).toBe(true);
  });

  it("detects near-empty body", () => {
    const html = `<html><body><script>app.init()</script></body></html>`;
    expect(needsJSRendering(html)).toBe(true);
  });

  it("passes content-rich page", () => {
    const html = `<html><body>
      <h1>Article Title</h1>
      <p>This is a long paragraph with actual content that would be found on a real webpage.
      It has enough text to pass the content threshold check and should not trigger JS rendering.</p>
    </body></html>`;
    expect(needsJSRendering(html)).toBe(false);
  });
});

// ── Anti-bot Detector ──

describe("detectAntiBot", () => {
  it("detects Cloudflare from cf-ray header", () => {
    const result = detectAntiBot(
      { "cf-ray": "abc123", server: "cloudflare" },
      [],
      "",
    );
    expect(result.system).toBe("cloudflare");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.recommendedLevel).toBe(3);
  });

  it("detects Cloudflare from cf_clearance cookie", () => {
    const result = detectAntiBot({}, ["cf_clearance=abc123"], "");
    expect(result.system).toBe("cloudflare");
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("detects Cloudflare challenge page", () => {
    const html = `<html><head><title>Just a moment...</title></head>
      <script src="/cdn-cgi/challenge-platform/scripts/abc.js"></script></html>`;
    const result = detectAntiBot({ server: "cloudflare" }, [], html);
    expect(result.system).toBe("cloudflare");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("detects Akamai from _abck cookie", () => {
    const result = detectAntiBot({}, ["_abck=xyz123"], "");
    expect(result.system).toBe("akamai");
    expect(result.recommendedLevel).toBe(3);
  });

  it("detects Akamai from bm_sz + _abck cookies", () => {
    const result = detectAntiBot({}, ["_abck=xyz", "bm_sz=abc"], "");
    expect(result.system).toBe("akamai");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("detects PerimeterX from _px cookie", () => {
    const result = detectAntiBot({}, ["_px3=abc123"], "");
    expect(result.system).toBe("perimeterx");
  });

  it("detects DataDome from datadome cookie", () => {
    const result = detectAntiBot({}, ["datadome=abc123"], "");
    expect(result.system).toBe("datadome");
  });

  it("detects DataDome from header + script", () => {
    const result = detectAntiBot(
      { "x-datadome-cid": "abc" },
      [],
      '<script src="https://js.datadome.co/tags.js"></script>',
    );
    expect(result.system).toBe("datadome");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("detects Kasada from x-kpsdk header", () => {
    const result = detectAntiBot({ "x-kpsdk-ct": "abc" }, [], "");
    expect(result.system).toBe("kasada");
  });

  it("detects AWS WAF from aws-waf-token cookie", () => {
    const result = detectAntiBot({}, ["aws-waf-token=xyz"], "");
    expect(result.system).toBe("aws-waf");
    expect(result.recommendedLevel).toBe(2);
  });

  it("detects F5/Shape from TS cookie prefix", () => {
    const result = detectAntiBot({}, ["TSabcdef1234=xyz"], "");
    expect(result.system).toBe("f5-shape");
  });

  it("returns none for clean response", () => {
    const result = detectAntiBot(
      { "content-type": "text/html" },
      [],
      "<html><body>Hello</body></html>",
    );
    expect(result.system).toBe("none");
    expect(result.confidence).toBe(0);
    expect(result.recommendedLevel).toBe(1);
  });
});

// ── parseCookieNames ──

describe("parseCookieNames", () => {
  it("extracts cookie names from Set-Cookie strings", () => {
    const names = parseCookieNames([
      "cf_clearance=abc; Path=/; HttpOnly",
      "_abck=xyz; Secure",
      "session=123",
    ]);
    expect(names).toEqual(["cf_clearance", "_abck", "session"]);
  });

  it("handles empty array", () => {
    expect(parseCookieNames([])).toEqual([]);
  });
});
