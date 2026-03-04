import { z } from "zod";
import { getJobStore } from "../batch/index.js";

export const name = "delete_job";

export const description =
  "Delete a batch scrape job and its stored results by job_id.";

export const schema = z.object({
  job_id: z.string().max(200).describe("The job ID to delete"),
});

export type DeleteJobInput = z.infer<typeof schema>;

export async function execute(input: DeleteJobInput) {
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

  await store.delete(input.job_id);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ deleted: true, job_id: input.job_id }, null, 2),
      },
    ],
  };
}
