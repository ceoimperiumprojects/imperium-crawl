import crypto from "node:crypto";
import { z } from "zod";
import { fetchPage } from "../utils/fetcher.js";
import { ConcurrencyLimiter } from "../utils/fetcher.js";
import { htmlToMarkdown } from "../utils/markdown.js";
import { createLLMClient, hasLLMConfigured } from "../llm/index.js";
import { extractWithLLM } from "../llm/extractor.js";
import { getJobStore } from "../batch/index.js";
import type { BatchJob, BatchJobResult } from "../batch/index.js";
import {
  MAX_URL_LENGTH,
  MAX_CONCURRENCY,
  DEFAULT_CONCURRENCY,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
} from "../constants.js";

export const name = "batch_scrape";

export const description =
  "Scrape multiple URLs in parallel with optional AI extraction. " +
  "Supports resume: pass the same job_id to continue an interrupted batch. " +
  "Failed URLs are recorded but do not stop the batch (soft fail).";

export const schema = z.object({
  urls: z.array(z.string().max(MAX_URL_LENGTH)).min(1).max(500),
  extraction_schema: z
    .union([
      z.string(),            // natural language: "extract product name and price"
      z.record(z.unknown()), // JSON schema object
      z.literal("auto"),
    ])
    .optional(),
  return_content: z.boolean().default(false),
  concurrency: z.number().min(1).max(MAX_CONCURRENCY).default(DEFAULT_CONCURRENCY),
  timeout: z.number().min(1000).max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS),
  job_id: z.string().max(200).optional(),
  proxy: z.string().max(MAX_URL_LENGTH).optional(),
});

type Input = z.infer<typeof schema>;

export async function execute(input: Input): Promise<{ content: Array<{ type: string; text: string }> }> {
  const jobStore = getJobStore();
  const jobId = input.job_id ?? crypto.randomUUID();
  const startTime = Date.now();

  // ── Resume: load existing job if job_id was provided ──
  let existingJob: BatchJob | null = null;
  if (input.job_id) {
    existingJob = await jobStore.load(input.job_id);
  }

  const processedUrls = new Set<string>(existingJob?.results.map((r) => r.url) ?? []);
  const skippedCount = processedUrls.size;

  // ── Initialize or continue job ──
  const now = new Date().toISOString();
  let job: BatchJob = existingJob ?? {
    id: jobId,
    status: "running",
    urls_total: input.urls.length,
    urls_completed: 0,
    urls_failed: 0,
    results: [],
    created_at: now,
    updated_at: now,
  };

  // Update status to running in case it was previously completed/failed
  job = { ...job, status: "running", urls_total: input.urls.length, updated_at: now };
  await jobStore.save(job);

  // ── LLM client (optional) ──
  const llmClient = input.extraction_schema !== undefined && hasLLMConfigured()
    ? await createLLMClient()
    : null;

  // ── Concurrency limiter ──
  const limiter = new ConcurrencyLimiter(input.concurrency);

  // ── Per-URL processor ──
  async function processUrl(url: string): Promise<void> {
    // Skip already-processed URLs (resume logic)
    if (processedUrls.has(url)) return;

    const urlStart = Date.now();
    let result: BatchJobResult;

    try {
      const fetchResult = await fetchPage(url, {
        proxy: input.proxy,
        timeout: input.timeout,
        respectRobots: true,
      });

      const markdown = htmlToMarkdown(fetchResult.html);

      let extractedData: unknown = undefined;
      if (input.extraction_schema !== undefined) {
        if (llmClient) {
          const extraction = await extractWithLLM(llmClient, markdown, input.extraction_schema);
          extractedData = extraction.data;
        } else {
          extractedData = { error: "LLM not configured — set LLM_API_KEY to enable extraction" };
        }
      }

      result = {
        url,
        success: true,
        content: input.return_content ? markdown : undefined,
        data: extractedData,
        status_code: fetchResult.status,
        duration_ms: Date.now() - urlStart,
      };
    } catch (err) {
      result = {
        url,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - urlStart,
      };
    }

    // Soft fail: always record result, checkpoint immediately
    job.results.push(result);
    if (result.success) {
      job.urls_completed++;
    } else {
      job.urls_failed++;
    }
    await jobStore.save(job);
  }

  // ── Run all URLs through limiter ──
  const pendingUrls = input.urls.filter((url) => !processedUrls.has(url));
  const tasks = pendingUrls.map((url) => limiter.run(() => processUrl(url)));
  await Promise.all(tasks);

  // ── Finalize ──
  job = { ...job, status: "completed", updated_at: new Date().toISOString() };
  await jobStore.save(job);

  const totalDuration = Date.now() - startTime;
  const allResults = job.results;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            job_id: jobId,
            stats: {
              total: input.urls.length,
              completed: job.urls_completed,
              failed: job.urls_failed,
              skipped: skippedCount,
              duration_ms: totalDuration,
            },
            results: allResults,
          },
          null,
          2,
        ),
      },
    ],
  };
}
