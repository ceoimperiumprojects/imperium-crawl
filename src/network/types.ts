/** Rule for network request interception */
export interface InterceptRule {
  // URL pattern to match (glob syntax, e.g. "**/api/*", "*.css")
  url_pattern: string;
  /** Action to take on matching requests */
  action: "block" | "mock" | "modify" | "log";
  /** Mock response (required for "mock" action) */
  response?: {
    status?: number;
    body?: string;
    headers?: Record<string, string>;
    contentType?: string;
  };
}

/** Captured network request */
export interface NetworkRequest {
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  timing: {
    startTime: number;
    duration?: number;
  };
  headers?: Record<string, string>;
  responseSize?: number;
}
