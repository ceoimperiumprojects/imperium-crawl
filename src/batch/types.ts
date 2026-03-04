export interface BatchJobResult {
  url: string;
  success: boolean;
  content?: string;       // markdown if return_content=true
  data?: unknown;         // LLM extraction output
  error?: string;
  status_code?: number;
  duration_ms: number;
}

export interface BatchJob {
  id: string;
  status: "running" | "completed" | "failed";
  urls_total: number;
  urls_completed: number;
  urls_failed: number;
  results: BatchJobResult[];
  created_at: string;
  updated_at: string;
}
