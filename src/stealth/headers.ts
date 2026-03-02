import { HeaderGenerator } from "header-generator";

const generator = new HeaderGenerator({
  browsers: [
    { name: "chrome", minVersion: 120 },
    { name: "firefox", minVersion: 120 },
    { name: "edge", minVersion: 120 },
  ],
  devices: ["desktop"],
  operatingSystems: ["windows", "macos", "linux"],
});

export function generateHeaders(overrides?: Record<string, string>): Record<string, string> {
  const headers = generator.getHeaders();
  return { ...headers, ...overrides };
}

export function getRandomUserAgent(): string {
  const headers = generator.getHeaders();
  return headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
}
