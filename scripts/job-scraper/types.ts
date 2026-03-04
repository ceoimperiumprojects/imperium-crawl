export interface Company {
  id: string;
  name: string;
  url: string;
  description?: string;
  industry?: string;
  employees?: string;
  revenue?: string;
}

export interface CareersDiscoveryResult {
  companyId: string;
  companyName: string;
  companyUrl: string;
  careersUrl: string | null;
  strategy: "common-paths" | "sitemap" | "homepage-links" | null;
  timestamp: string;
}

export interface JobPosting {
  title: string;
  location?: string;
  department?: string;
  url?: string;
  type?: string; // full-time, part-time, contract
}

export interface JobExtractionResult {
  companyId: string;
  companyName: string;
  careersUrl: string;
  jobs: JobPosting[];
  strategy: "json-ld" | "platform-css" | "generic-markdown" | null;
  platform?: string; // greenhouse, lever, ashby, etc.
  timestamp: string;
}

export interface ScraperState {
  phase: 1 | 2;
  processedIds: string[];
  stats: {
    total: number;
    processed: number;
    found: number;
    errors: number;
  };
  startedAt: string;
  lastSavedAt: string;
}

export interface ErrorEntry {
  companyId: string;
  companyName: string;
  url: string;
  phase: 1 | 2;
  error: string;
  timestamp: string;
}
