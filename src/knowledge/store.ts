import fs from "node:fs/promises";
import path from "node:path";
import { getKnowledgeFilePath } from "../config.js";
import { getDomain } from "../utils/url.js";
import {
  type DomainKnowledge,
  type FetchOutcome,
  type PredictedConfig,
  predict,
  aggregateOutcome,
} from "./predictor.js";

// ── Constants ──

const DEBOUNCE_MS = 30_000;
const MAX_DOMAINS = 2000;
const PRUNE_AGE_DAYS = 30;
const PARENT_DOMAIN_CONFIDENCE_MULTIPLIER = 0.5;

// ── AdaptiveLearningEngine ──

export class AdaptiveLearningEngine {
  private store = new Map<string, DomainKnowledge>();
  /** Index: anti-bot system → Set of domains using it */
  private antiBotIndex = new Map<string, Set<string>>();
  private dirty = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private filePath: string;
  private loaded = false;
  private loading: Promise<void> | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? getKnowledgeFilePath();
  }

  // ── Lazy Load ──

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    // Deduplicate concurrent loads
    if (!this.loading) {
      this.loading = this.load();
    }
    await this.loading;
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(data) as Record<string, DomainKnowledge>;
      this.store.clear();
      this.antiBotIndex.clear();
      for (const [domain, knowledge] of Object.entries(parsed)) {
        this.store.set(domain, knowledge);
        this.indexAntiBot(domain, knowledge);
      }
      // Prune on load if over limit
      if (this.store.size > MAX_DOMAINS) {
        this.prune();
      }
    } catch (err: unknown) {
      const isEnoent =
        err && typeof err === "object" && "code" in err && (err as unknown as NodeJS.ErrnoException).code === "ENOENT";
      if (!isEnoent) {
        console.error("[knowledge] Failed to load knowledge file:", err instanceof Error ? err.message : String(err));
      }
      this.store.clear();
      this.antiBotIndex.clear();
    }
    this.loaded = true;
    this.loading = null;
  }

  /**
   * Index a domain by its anti-bot system for cross-domain lookup.
   */
  private indexAntiBot(domain: string, knowledge: DomainKnowledge): void {
    if (knowledge.antibot_system) {
      const existing = this.antiBotIndex.get(knowledge.antibot_system) || new Set();
      existing.add(domain);
      this.antiBotIndex.set(knowledge.antibot_system, existing);
    }
  }

  /**
   * Extract parent domain from a subdomain.
   * e.g., "shop.example.com" → "example.com"
   */
  private getParentDomain(domain: string): string | null {
    const parts = domain.split(".");
    if (parts.length <= 2) return null; // Already a root domain
    return parts.slice(1).join(".");
  }

  // ── Persistence ──

  async save(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    const obj: Record<string, DomainKnowledge> = {};
    for (const [domain, knowledge] of this.store) {
      obj[domain] = knowledge;
    }

    const json = JSON.stringify(obj, null, 2);
    const tmpPath = this.filePath + ".tmp";

    // Atomic write: write tmp → rename
    await fs.writeFile(tmpPath, json, "utf-8");
    await fs.rename(tmpPath, this.filePath);
    this.dirty = false;
  }

  private scheduleSave(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(async () => {
      this.writeTimer = null;
      if (this.dirty) {
        try {
          await this.save();
        } catch {
          // Silently fail — next scheduleSave will retry
        }
      }
    }, DEBOUNCE_MS);
    this.writeTimer.unref();
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (this.dirty) {
      await this.save();
    }
  }

  // ── Query ──

  async get(domain: string): Promise<DomainKnowledge | null> {
    await this.ensureLoaded();
    return this.store.get(domain) ?? null;
  }

  /**
   * Predict optimal fetch configuration for a URL.
   * Falls back to parent domain knowledge with reduced confidence.
   */
  async predict(url: string): Promise<PredictedConfig | null> {
    await this.ensureLoaded();
    const domain = getDomain(url);

    // Exact domain match
    const exactKnowledge = this.store.get(domain);
    if (exactKnowledge) {
      return predict(exactKnowledge);
    }

    // ── Cross-domain: parent domain fallback ──
    const parentDomain = this.getParentDomain(domain);
    if (parentDomain) {
      const parentKnowledge = this.store.get(parentDomain);
      if (parentKnowledge) {
        const prediction = predict(parentKnowledge);
        // Reduce confidence for parent-domain predictions
        prediction.confidence = Math.round(prediction.confidence * PARENT_DOMAIN_CONFIDENCE_MULTIPLIER * 100) / 100;
        prediction.reason = `parent:${parentDomain}, ${prediction.reason}`;
        return prediction;
      }
    }

    return null;
  }

  /**
   * Find domains known to use a specific anti-bot system.
   */
  async getDomainsWithAntiBot(system: string): Promise<string[]> {
    await this.ensureLoaded();
    const domains = this.antiBotIndex.get(system);
    return domains ? Array.from(domains) : [];
  }

  // ── Record ──

  async record(outcome: FetchOutcome): Promise<void> {
    await this.ensureLoaded();
    const existing = this.store.get(outcome.domain) ?? null;
    const updated = aggregateOutcome(existing, outcome);
    this.store.set(outcome.domain, updated);

    // Update anti-bot index
    this.indexAntiBot(outcome.domain, updated);

    this.dirty = true;
    this.scheduleSave();
  }

  // ── Maintenance ──

  prune(): void {
    const now = Date.now();
    const pruneMs = PRUNE_AGE_DAYS * 24 * 60 * 60 * 1000;

    // Remove entries older than PRUNE_AGE_DAYS
    for (const [domain, knowledge] of this.store) {
      const age = now - new Date(knowledge.last_updated).getTime();
      if (age > pruneMs) {
        this.store.delete(domain);
      }
    }

    // If still over limit, remove oldest entries
    if (this.store.size > MAX_DOMAINS) {
      const sorted = [...this.store.entries()].sort(
        (a, b) => new Date(a[1].last_updated).getTime() - new Date(b[1].last_updated).getTime(),
      );
      const toRemove = sorted.length - MAX_DOMAINS;
      for (let i = 0; i < toRemove; i++) {
        this.store.delete(sorted[i][0]);
      }
    }

    // Rebuild anti-bot index after pruning
    this.antiBotIndex.clear();
    for (const [domain, knowledge] of this.store) {
      this.indexAntiBot(domain, knowledge);
    }

    if (this.store.size > 0) {
      this.dirty = true;
    }
  }

  /** Exposed for testing */
  get size(): number {
    return this.store.size;
  }
}

// ── Singleton ──

let engine: AdaptiveLearningEngine | null = null;

export function getKnowledgeEngine(): AdaptiveLearningEngine {
  if (!engine) {
    engine = new AdaptiveLearningEngine();
  }
  return engine;
}

/** Reset singleton (for testing) */
export function resetKnowledgeEngine(): void {
  engine = null;
}
