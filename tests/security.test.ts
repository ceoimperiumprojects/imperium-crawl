import { describe, it, expect, beforeEach } from "vitest";
import { getActionCategory, checkPolicy, describeAction, resetPolicyCache } from "../src/security/action-policy.js";
import { isDomainAllowed } from "../src/security/domain-filter.js";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

describe("Action Policy", () => {
  beforeEach(() => {
    resetPolicyCache();
  });

  describe("getActionCategory", () => {
    it("maps click actions to click category", () => {
      expect(getActionCategory("click")).toBe("click");
      expect(getActionCategory("hover")).toBe("click");
      expect(getActionCategory("drag")).toBe("click");
    });

    it("maps form actions to fill category", () => {
      expect(getActionCategory("type")).toBe("fill");
      expect(getActionCategory("select")).toBe("fill");
      expect(getActionCategory("upload")).toBe("fill");
    });

    it("maps navigate to navigate category", () => {
      expect(getActionCategory("navigate")).toBe("navigate");
    });

    it("maps evaluate to eval category", () => {
      expect(getActionCategory("evaluate")).toBe("eval");
    });

    it("maps screenshot/pdf to snapshot category", () => {
      expect(getActionCategory("screenshot")).toBe("snapshot");
      expect(getActionCategory("pdf")).toBe("snapshot");
    });

    it("maps state read actions", () => {
      expect(getActionCategory("cookie_get")).toBe("state");
      expect(getActionCategory("storage_get")).toBe("state");
    });

    it("maps state write actions", () => {
      expect(getActionCategory("cookie_set")).toBe("state_write");
      expect(getActionCategory("storage_set")).toBe("state_write");
    });

    it("returns unknown for unmapped actions", () => {
      expect(getActionCategory("xyzzy")).toBe("unknown");
    });
  });

  describe("checkPolicy", () => {
    it("allows everything with default allow policy", async () => {
      // Non-existent policy file → defaults to allow
      const result = await checkPolicy("click", "/tmp/nonexistent-policy.json");
      expect(result).toBe("allow");
    });

    it("respects deny list", async () => {
      const policyPath = path.join(os.tmpdir(), `test-policy-${Date.now()}.json`);
      await fs.writeFile(policyPath, JSON.stringify({ default: "allow", deny: ["eval"] }));

      const result = await checkPolicy("evaluate", policyPath);
      expect(result).toBe("deny");

      // Non-denied action should be allowed
      const result2 = await checkPolicy("click", policyPath);
      expect(result2).toBe("allow");

      await fs.unlink(policyPath);
    });

    it("respects confirm list", async () => {
      const policyPath = path.join(os.tmpdir(), `test-policy-confirm-${Date.now()}.json`);
      await fs.writeFile(policyPath, JSON.stringify({ default: "allow", confirm: ["navigate"] }));

      const result = await checkPolicy("navigate", policyPath);
      expect(result).toBe("confirm");

      await fs.unlink(policyPath);
    });

    it("deny takes priority over confirm", async () => {
      const policyPath = path.join(os.tmpdir(), `test-policy-priority-${Date.now()}.json`);
      await fs.writeFile(policyPath, JSON.stringify({
        default: "allow",
        deny: ["eval"],
        confirm: ["eval"],
      }));

      const result = await checkPolicy("evaluate", policyPath);
      expect(result).toBe("deny");

      await fs.unlink(policyPath);
    });

    it("falls through to default", async () => {
      const policyPath = path.join(os.tmpdir(), `test-policy-default-${Date.now()}.json`);
      await fs.writeFile(policyPath, JSON.stringify({ default: "deny" }));

      const result = await checkPolicy("click", policyPath);
      expect(result).toBe("deny");

      await fs.unlink(policyPath);
    });
  });

  describe("describeAction", () => {
    it("returns human-readable description", () => {
      expect(describeAction("click")).toBe("Click an element");
      expect(describeAction("navigate")).toBe("Navigate to a URL");
      expect(describeAction("evaluate")).toBe("Execute JavaScript code");
    });

    it("appends url details", () => {
      const desc = describeAction("navigate", { url: "https://example.com" });
      expect(desc).toContain("https://example.com");
    });

    it("appends selector details", () => {
      const desc = describeAction("click", { selector: "#btn" });
      expect(desc).toContain("#btn");
    });

    it("appends ref details", () => {
      const desc = describeAction("click", { ref: "e5" });
      expect(desc).toContain("e5");
    });

    it("handles unknown action types", () => {
      const desc = describeAction("custom_action");
      expect(desc).toContain("custom_action");
    });
  });
});

describe("Domain Filter", () => {
  describe("isDomainAllowed", () => {
    it("matches exact domain", () => {
      expect(isDomainAllowed("example.com", ["example.com"])).toBe(true);
    });

    it("rejects non-matching domain", () => {
      expect(isDomainAllowed("evil.com", ["example.com"])).toBe(false);
    });

    it("matches wildcard pattern", () => {
      expect(isDomainAllowed("sub.example.com", ["*.example.com"])).toBe(true);
      expect(isDomainAllowed("deep.sub.example.com", ["*.example.com"])).toBe(true);
    });

    it("wildcard matches the base domain itself", () => {
      expect(isDomainAllowed("example.com", ["*.example.com"])).toBe(true);
    });

    it("case insensitive matching", () => {
      expect(isDomainAllowed("Example.COM", ["example.com"])).toBe(true);
      expect(isDomainAllowed("sub.Example.COM", ["*.example.com"])).toBe(true);
    });

    it("rejects partial domain match", () => {
      expect(isDomainAllowed("notexample.com", ["example.com"])).toBe(false);
      expect(isDomainAllowed("example.com.evil.com", ["example.com"])).toBe(false);
    });

    it("handles multiple patterns", () => {
      const patterns = ["example.com", "*.cdn.example.com", "api.other.com"];
      expect(isDomainAllowed("example.com", patterns)).toBe(true);
      expect(isDomainAllowed("img.cdn.example.com", patterns)).toBe(true);
      expect(isDomainAllowed("api.other.com", patterns)).toBe(true);
      expect(isDomainAllowed("evil.com", patterns)).toBe(false);
    });

    it("handles empty patterns list", () => {
      expect(isDomainAllowed("example.com", [])).toBe(false);
    });
  });
});
