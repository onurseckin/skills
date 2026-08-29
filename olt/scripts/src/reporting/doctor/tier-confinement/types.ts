import type { ExecutionTier } from "../../../authority/thread/index.ts";

export type TierViolationType =
  | "cross_tier_spawning_violation"
  | "coordinator_code_writing"
  | "orchestrator_direct_implementation"
  | "implementer_self_grading"
  | "implementer_graph_mutation"
  | "subagent_pulse_termination"
  | "role_confinement_violation"
  | "supervisor_code_contamination";

export type TierViolationSeverity = "critical" | "important" | "minor";

export interface TierConfinementFinding {
  readonly agent_id: string;
  readonly role: string;
  readonly tier: ExecutionTier;
  readonly violation_type: TierViolationType;
  readonly severity: TierViolationSeverity;
  readonly observation: string;
  readonly remediation: string;
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface TierConfinementSummary {
  readonly healthy: boolean;
  readonly violation_count: number;
  readonly findings: readonly TierConfinementFinding[];
  readonly issues: readonly string[];
}

export interface GitDiffRecord {
  readonly path: string;
  readonly status?: string | undefined;
  readonly actor?: string | undefined;
  readonly role?: string | undefined;
}
