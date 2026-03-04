// Common careers page paths to probe (ordered by frequency)
export const CAREERS_PATHS = [
  "/careers",
  "/jobs",
  "/careers/",
  "/jobs/",
  "/about/careers",
  "/company/careers",
  "/hiring",
  "/join-us",
  "/join",
  "/work-with-us",
  "/open-positions",
  "/opportunities",
  "/team/join",
  "/about/jobs",
  "/company/jobs",
];

// Regex patterns to detect careers URLs in links
export const CAREERS_URL_PATTERNS = [
  /\/careers/i,
  /\/jobs/i,
  /\/hiring/i,
  /\/join[-_]?us/i,
  /\/open[-_]?positions/i,
  /\/work[-_]?with[-_]?us/i,
  /\/opportunities/i,
  /\/vacancies/i,
];

// Anchor text patterns that suggest a careers link
export const CAREERS_ANCHOR_PATTERNS = [
  /careers/i,
  /jobs/i,
  /hiring/i,
  /join\s+(us|our\s+team)/i,
  /open\s+(positions|roles)/i,
  /work\s+with\s+us/i,
  /we.re\s+hiring/i,
];

// Known job board platform domains
export const JOB_BOARD_DOMAINS = [
  "greenhouse.io",
  "boards.greenhouse.io",
  "lever.co",
  "jobs.lever.co",
  "ashbyhq.com",
  "jobs.ashbyhq.com",
  "workable.com",
  "apply.workable.com",
  "bamboohr.com",
  "breezy.hr",
  "recruitee.com",
  "smartrecruiters.com",
  "jobs.smartrecruiters.com",
  "jobvite.com",
  "icims.com",
  "myworkdayjobs.com",
  "ultipro.com",
  "jazz.co",
  "applytojob.com",
  "rippling.com",
  "dover.com",
  "wellfound.com",
  "angel.co",
];

// CSS selectors per known platform
export const PLATFORM_SELECTORS: Record<
  string,
  {
    match: RegExp;
    container: string;
    title: string;
    location?: string;
    department?: string;
    link?: string;
  }
> = {
  greenhouse: {
    match: /greenhouse\.io/i,
    container: ".opening",
    title: ".opening a",
    location: ".location",
    department: ".department",
    link: ".opening a",
  },
  lever: {
    match: /lever\.co/i,
    container: ".posting",
    title: ".posting-title h5, .posting-title a",
    location: ".posting-categories .location, .sort-by-location",
    department: ".posting-categories .department, .sort-by-team",
    link: ".posting-title a, .posting-btn-submit a",
  },
  ashby: {
    match: /ashbyhq\.com/i,
    container: '[class*="job"], [data-testid*="job"]',
    title: 'a[href*="/jobs/"], h3',
    location: '[class*="location"]',
    department: '[class*="department"], [class*="team"]',
    link: 'a[href*="/jobs/"]',
  },
  workable: {
    match: /workable\.com/i,
    container: '[data-ui="job"]',
    title: '[data-ui="job-title"] a, h3 a',
    location: '[data-ui="job-location"]',
    department: '[data-ui="job-department"]',
    link: '[data-ui="job-title"] a, h3 a',
  },
  smartrecruiters: {
    match: /smartrecruiters\.com/i,
    container: ".opening-job, .js-openings-list li",
    title: ".opening-job-title a, h4 a",
    location: ".opening-job-location",
    department: ".opening-job-department",
    link: ".opening-job-title a, h4 a",
  },
};

// Role keywords — a title MUST contain at least one of these
export const ROLE_KEYWORDS = [
  "engineer",
  "developer",
  "designer",
  "manager",
  "director",
  "analyst",
  "scientist",
  "architect",
  "lead",
  "specialist",
  "coordinator",
  "intern",
  "consultant",
  "administrator",
  "executive",
  "officer",
  "head of",
  "vp of",
  "vice president",
  "associate",
  "recruiter",
  "representative",
  "strategist",
  "counsel",
  "accountant",
  "writer",
  "editor",
  "researcher",
];

// Section headings that should NOT be treated as job titles
export const SECTION_HEADING_PATTERNS = [
  /^(?:about|our|the|meet)\s/i,
  /^(?:why|how|benefits|perks|culture|values|mission)/i,
  /^(?:open\s+)?(?:positions|roles|jobs|opportunities)$/i,
  /^(?:join\s+(?:us|our)|we.re\s+hiring)/i,
  /\b(?:team|leadership|board of)\b.*$/i,
];

// Location detection patterns
export const LOCATION_PATTERNS = [
  /\b(?:remote|hybrid|on-?site)\b/i,
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2}\b/, // City, ST
  /\b(?:US|USA|UK|EU|EMEA|APAC|LATAM|worldwide|global)\b/i,
];

// Department keywords (lowercased for matching)
export const DEPARTMENT_KEYWORDS = [
  "engineering",
  "product",
  "design",
  "marketing",
  "sales",
  "operations",
  "finance",
  "legal",
  "human resources",
  "data",
  "security",
  "infrastructure",
  "platform",
  "research",
  "science",
  "clinical",
  "business development",
  "customer success",
  "people",
  "general & administrative",
  "it",
  "support",
];

// HTML fingerprints for detecting embedded job platforms
export const PLATFORM_HTML_FINGERPRINTS: Record<
  string,
  { patterns: RegExp[]; iframeSrc?: RegExp }
> = {
  greenhouse: {
    patterns: [/boards\.greenhouse\.io/i, /id="grnhse_app"/i],
    iframeSrc: /boards\.greenhouse\.io\/embed\/job_board\?for=(\S+)/i,
  },
  lever: {
    patterns: [/jobs\.lever\.co/i, /lever-jobs-container/i],
    iframeSrc: /jobs\.lever\.co\/([^/"'\s]+)/i,
  },
  ashby: {
    patterns: [/jobs\.ashbyhq\.com/i, /ashby-job-posting-widget/i],
    iframeSrc: /jobs\.ashbyhq\.com\/([^/"'\s]+)/i,
  },
  workable: {
    patterns: [/apply\.workable\.com/i, /workable-careers-widget/i],
    iframeSrc: /apply\.workable\.com\/([^/"'\s]+)/i,
  },
  smartrecruiters: {
    patterns: [/jobs\.smartrecruiters\.com/i],
    iframeSrc: /jobs\.smartrecruiters\.com\/([^/"'\s]+)/i,
  },
};

// Scraper concurrency settings
export const CONCURRENCY = 2;
export const DELAY_MS = 1500;
export const COMMON_PATH_TIMEOUT_MS = 10_000;
export const STATE_SAVE_INTERVAL = 10;

// Output directory (relative to script CWD)
export const OUTPUT_DIR = "scripts/job-scraper/output";
