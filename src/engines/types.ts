/**
 * Browser engine abstraction — unified interface for Playwright and CamoFox.
 *
 * Each engine implements this interface so tool code can switch engines
 * with a single option (`engine: "playwright" | "camofox" | "auto"`).
 */

export interface EnginePage {
  url(): string;
  content(): Promise<string>;
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<void>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  fill(selector: string, text: string, options?: { timeout?: number }): Promise<void>;
  type(selector: string, text: string, options?: { delay?: number; timeout?: number }): Promise<void>;
  selectOption(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
  hover(selector: string, options?: { timeout?: number }): Promise<void>;
  press(key: string, options?: { timeout?: number }): Promise<void>;
  evaluate<T>(script: string): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>;
  screenshot(options?: { fullPage?: boolean }): Promise<Buffer>;
  close(): Promise<void>;
}

export interface AcquirePageResult {
  page: EnginePage;
  isProfile: boolean;
  cleanup: () => Promise<void>;
}

export interface BrowserEngine {
  readonly name: string;
  readonly description: string;
  isAvailable(): Promise<boolean>;
  launch(): Promise<void>;
  shutdown(): Promise<void>;
  acquirePage(options: {
    chromeProfile?: boolean;
    proxyUrl?: string;
    headless?: boolean;
    sessionId?: string;
    timeout?: number;
  }): Promise<AcquirePageResult>;
}

export type EngineName = "playwright" | "camofox" | "auto";
