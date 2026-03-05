/** Action policy decision */
export type PolicyDecision = "allow" | "deny" | "confirm";

/** Action policy configuration */
export interface ActionPolicyConfig {
  /** Default decision for uncategorized actions */
  default: "allow" | "deny";
  /** Allowed categories override default */
  allow?: string[];
  /** Denied categories override default and allow */
  deny?: string[];
  /** Categories requiring explicit confirmation */
  confirm?: string[];
}

/** Domain filter patterns */
export interface DomainFilterConfig {
  /** Allowed domain patterns (exact or wildcard *.example.com) */
  allowed_domains: string[];
}
