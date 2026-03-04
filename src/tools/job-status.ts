import { z } from "zod";
import { getJobStore } from "../batch/index.js";

export const name = "job_status";

export const description =
  "Get full status and results for a specific batch scrape job by job_id. Includes all scraped results.";

export const schema = z.object({
  job_id: z.string().max(200).describe("The job ID returned by batch_scrape"),
});

export type JobStatusInput = z.infer<typeof schema>;

export async function execute(input: JobStatusInput) {
  const store = getJobStore();
  const job = await store.load(input.job_id);

  if (!job) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { error: "Job not found", job_id: input.job_id },
            null,
            2,
          ),
        },
      ],
    };
  }

  const done = job.urls_completed + job.urls_failed;
  const progress_pct =
    job.urls_total > 0 ? Math.round((done / job.urls_total) * 100) : 0;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            job_id: job.id,
            status: job.status,
            urls_total: job.urls_total,
            urls_completed: job.urls_completed,
            urls_failed: job.urls_failed,
            progress_pct,
            created_at: job.created_at,
            updated_at: job.updated_at,
            results: job.results,
          },
          null,
          2,
        ),
      },
    ],
  };
}
