import { describe, it, expect } from "vitest";
import { detectCaptcha, hasCaptcha } from "../src/captcha/detector.js";

describe("CAPTCHA Detector", () => {
  // ── reCAPTCHA v2 ──
  describe("reCAPTCHA v2", () => {
    it("detects reCAPTCHA v2 from data-sitekey attribute", () => {
      const html = `<div class="g-recaptcha" data-sitekey="6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"></div>`;
      const result = detectCaptcha(html);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("recaptcha_v2");
      expect(result!.sitekey).toBe("6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI");
    });

    it("detects reCAPTCHA v2 from grecaptcha.render call", () => {
      const html = `<script>grecaptcha.render('recaptcha', { 'sitekey': '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI' });</script>`;
      const result = detectCaptcha(html);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("recaptcha_v2");
      expect(result!.sitekey).toBe("6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI");
    });

    it("detects reCAPTCHA Enterprise", () => {
      const html = `
        <script src="https://www.google.com/recaptcha/enterprise.js"></script>
        <div class="g-recaptcha" data-sitekey="6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"></div>
      `;
      const result = detectCaptcha(html);
      expect(result).not.toBeNull();
      expect(result!.enterprise).toBe(true);
    });

    it("extracts data-s for invisible reCAPTCHA", () => {
      const html = `<div class="g-recaptcha" data-sitekey="6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI" data-s="some-s-value"></div>`;
      const result = detectCaptcha(html);
      expect(result).not.toBeNull();
      expect(result!.s).toBe("some-s-value");
    });
  });

  // ── reCAPTCHA v3 ──
  describe("reCAPTCHA v3", () => {
    it("detects reCAPTCHA v3 from render param + execute call", () => {
      const html = `
        <script src="https://www.google.com/recaptcha/api.js?render=6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"></script>
        <script>
          grecaptcha.execute('6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI', {action: 'login'}).then(function(token) {});
        </script>
      `;
      const result = detectCaptcha(html);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("recaptcha_v3");
      expect(result!.sitekey).toBe("6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI");
      expect(result!.action).toBe("login");
    });
  });

  // ── hCaptcha ──
  describe("hCaptcha", () => {
    it("detects hCaptcha from data-sitekey (UUID format)", () => {
      const html = `<div class="h-captcha" data-sitekey="a5f74b19-9e45-40e0-b45d-47ff91b7a6c2"></div>`;
      const result = detectCaptcha(html);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("hcaptcha");
      expect(result!.sitekey).toBe("a5f74b19-9e45-40e0-b45d-47ff91b7a6c2");
    });

    it("detects hCaptcha with hcaptcha.com script", () => {
      const html = `
        <script src="https://hcaptcha.com/1/api.js"></script>
        <div class="h-captcha" data-sitekey="a5f74b19-9e45-40e0-b45d-47ff91b7a6c2"></div>
      `;
      const result = detectCaptcha(html);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("hcaptcha");
    });
  });

  // ── Cloudflare Turnstile ──
  describe("Cloudflare Turnstile", () => {
    it("detects Turnstile from cf-turnstile class + data-sitekey", () => {
      const html = `<div class="cf-turnstile" data-sitekey="0x4AAAAAAADnPIDROrmt1Wwj"></div>`;
      const result = detectCaptcha(html);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("turnstile");
      expect(result!.sitekey).toBe("0x4AAAAAAADnPIDROrmt1Wwj");
    });

    it("detects Turnstile with challenges.cloudflare.com script", () => {
      const html = `
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
        <div class="cf-turnstile" data-sitekey="0x4AAAAAAADnPIDROrmt1Wwj"></div>
      `;
      const result = detectCaptcha(html);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("turnstile");
    });
  });

  // ── No CAPTCHA ──
  describe("No CAPTCHA", () => {
    it("returns null for normal HTML", () => {
      const html = `<html><body><h1>Hello World</h1><p>No captcha here</p></body></html>`;
      expect(detectCaptcha(html)).toBeNull();
    });

    it("returns null for empty HTML", () => {
      expect(detectCaptcha("")).toBeNull();
    });
  });

  // ── hasCaptcha quick check ──
  describe("hasCaptcha (quick check)", () => {
    it("returns true for reCAPTCHA", () => {
      expect(hasCaptcha('<div class="g-recaptcha"></div>')).toBe(true);
    });

    it("returns true for hCaptcha", () => {
      expect(hasCaptcha('<div class="h-captcha"></div>')).toBe(true);
    });

    it("returns true for Turnstile", () => {
      expect(hasCaptcha('<div class="cf-turnstile"></div>')).toBe(true);
    });

    it("returns false for clean page", () => {
      expect(hasCaptcha("<html><body>Hello</body></html>")).toBe(false);
    });
  });

  // ── Priority: Turnstile > hCaptcha > reCAPTCHA ──
  describe("Detection priority", () => {
    it("prefers Turnstile over reCAPTCHA when both present", () => {
      const html = `
        <div class="cf-turnstile" data-sitekey="0x4AAAAAAADnPIDROrmt1Wwj"></div>
        <div class="g-recaptcha" data-sitekey="6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"></div>
      `;
      const result = detectCaptcha(html);
      expect(result!.type).toBe("turnstile");
    });

    it("prefers hCaptcha over reCAPTCHA when both present", () => {
      const html = `
        <div class="h-captcha" data-sitekey="a5f74b19-9e45-40e0-b45d-47ff91b7a6c2"></div>
        <div class="g-recaptcha" data-sitekey="6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"></div>
      `;
      const result = detectCaptcha(html);
      expect(result!.type).toBe("hcaptcha");
    });
  });
});
