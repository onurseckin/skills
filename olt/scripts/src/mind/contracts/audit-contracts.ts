/**
 * Shared Leaf Contracts for Mind & Cognitive Auditing
 */

export type RootCauseCategory =
  | "TOKEN_BURNING"
  | "FALSE_SERIALIZATION"
  | "ROLE_BOUNDARY_DEVIATION"
  | "POLLING_WASTE"
  | "CONTEXT_OVERFLOW"
  | "GHOST_LEASE"
  | "STRAGGLER";

export const ROOT_CAUSE_CATEGORIES: readonly RootCauseCategory[] = [
  "TOKEN_BURNING",
  "FALSE_SERIALIZATION",
  "ROLE_BOUNDARY_DEVIATION",
  "POLLING_WASTE",
  "CONTEXT_OVERFLOW",
  "GHOST_LEASE",
  "STRAGGLER",
];

export interface ForensicsIncident {
  readonly id: string;
  readonly category: RootCauseCategory;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly description: string;
  readonly evidence: readonly string[];
  readonly timestamp: string;
  readonly remediation?: string | undefined;
}

export interface ForensicsAnalysisResult {
  readonly efficiencyScore: number;
  readonly incidents: readonly ForensicsIncident[];
  readonly totalToolCalls: number;
  readonly summary: string;
}

export interface AuditorCursor {
  readonly lastEvaluatedTimestamp: string;
  readonly evaluatedCount: number;
  readonly cursorOffset?: number | undefined;
}

export interface SkillAuditLiveResult {
  readonly compliant: boolean;
  readonly violations: readonly string[];
  readonly checkedCount: number;
  readonly timestamp: string;
}
