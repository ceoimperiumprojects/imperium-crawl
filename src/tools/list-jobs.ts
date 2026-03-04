import { z } from "zod";
import { getJobStore } from "../batch/index.js";

export const name = "list_jobs";

export const description =
  "List all batch scrape jobs with their status and progress. Use job_status to get full results for a specific job.";

export const schema = z.object({});

export type ListJobsInput = z.infer<typeof schema>;

export async function execute(_input: ListJobsInput) {
  const store = getJobStore();
  const ids = await store.list();

  if (ids.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              message: "No jobs found. Use batch_scrape to start one.",
              total: 0,
              jobs: [],
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const jobs = await Promise.all(
    ids.map(async (id) => {
      const job = await store.load(id);
      if (!job) return null;
      return {
        id: job.id,
        status: job.status,
        urls_total: job.urls_total,
        urls_completed: job.urls_completed,
        urls_failed: job.urls_failed,
        created_at: job.created_at,
        updated_at: job.updated_at,
      };
    }),
  );

  const validJobs = jobs.filter(Boolean);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            total: validJobs.length,
            jobs: validJobs,
          },
          null,
          2,
        ),
      },
    ],
  };
}
