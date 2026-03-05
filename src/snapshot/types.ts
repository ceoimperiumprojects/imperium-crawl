/** Semantic locator info resolved from a ref */
export interface RefEntry {
  /** Playwright semantic locator string, e.g. getByRole('button', { name: 'Submit', exact: true }) */
  selector: string;
  /** ARIA role */
  role: string;
  /** Accessible name */
  name: string;
  /** nth index when multiple elements share same role+name */
  nth?: number;
}

/** Map of ref IDs (e.g. "e1", "e2") to their locator info */
export interface RefMap {
  [ref: string]: RefEntry;
}

/** Result from getEnhancedSnapshot */
export interface EnhancedSnapshot {
  /** ARIA tree with [ref=eN] annotations */
  tree: string;
  /** Ref-to-locator mapping */
  refs: RefMap;
  /** Stats about the snapshot */
  stats: {
    totalElements: number;
    interactiveElements: number;
    contentElements: number;
  };
}

/** Options for snapshot extraction */
export interface SnapshotOptions {
  /** Only include interactive elements (default: true) */
  interactive?: boolean;
  /** Also detect cursor:pointer/onclick elements without ARIA roles (default: false) */
  cursor?: boolean;
  /** Maximum depth of ARIA tree to include */
  maxDepth?: number;
  /** Filter out structural elements without refs (default: true) */
  compact?: boolean;
  /** CSS selector to scope the snapshot to a subtree */
  selector?: string;
}
