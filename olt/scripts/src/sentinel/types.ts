export const CANONICAL_ROLES = [
  "mind",
  "skill-auditor",
  "policy-discovery",
  "orchestrator",
  "mind-auditor",
  "coordinator",
  "planner",
  "plan-validator",
  "repairer",
  "completeness-critic",
  "implementer",
  "validator",
  "mechanic-validator",
  "ui-headless-validator",
  "ui-mechanic-validator",
  "ui-optical-validator",
  "ui-validator",
  "sub-implementer",
  "sub-validator",
  "sub-investigator",
] as const;

export type AgentRole = (typeof CANONICAL_ROLES)[number];

export function isCanonicalRole(role: unknown): role is AgentRole {
  return typeof role === "string" && (CANONICAL_ROLES as readonly string[]).includes(role);
}

export type SentinelSeverity = "CRITICAL" | "WARN" | "ADVISORY";

export interface SentinelViolation {
  readonly code: string;
  readonly severity: SentinelSeverity;
  readonly message: string;
  readonly target_file?: string | undefined;
  readonly remediation_cmd?: string | undefined;
  readonly documentation_ref?: string | undefined;
}

export interface DoctorAgentReport {
  readonly status: "HEALTHY" | "VIOLATION_DETECTED";
  readonly agent_id: string;
  readonly role: AgentRole;
  readonly task_id?: string | undefined;
  readonly strike_count: number;
  readonly violations: readonly SentinelViolation[];
}

export interface RoutingJourney {
  readonly origin_sentinel: string;
  readonly origin_role: AgentRole;
  readonly rule_code: string;
  readonly target_agent: string;
  readonly target_role: AgentRole;
  readonly parent_supervisor: string;
  readonly current_strike: number;
  readonly escalated: boolean;
  readonly timestamp: number;
  readonly sha256: string;
}

export interface StrikeRecord {
  readonly agent_id: string;
  readonly role: AgentRole;
  readonly task_id?: string | undefined;
  readonly strike_count: number;
  readonly active_violations: readonly SentinelViolation[];
  readonly updated_at: string;
  readonly frozen?: boolean | undefined;
}

export interface PreActionInput {
  readonly agent_id: string;
  readonly role: AgentRole;
  readonly action_type: "file_write" | "shell_command" | "task_submit" | "task_review";
  readonly target: string;
  readonly write_scope?: readonly string[] | undefined;
  readonly task_id?: string | undefined;
  readonly ppid?: number | undefined;
  readonly repo_root?: string | undefined;
}

export interface PreActionResult {
  readonly allowed: boolean;
  readonly code?: string | undefined;
  readonly reason?: string | undefined;
  readonly remediation?: string | undefined;
}

export interface PostActionInput {
  readonly agent_id: string;
  readonly role: AgentRole;
  readonly modified_files: readonly string[];
  readonly repo_root?: string | undefined;
}

export interface PostActionResult {
  readonly allowed: boolean;
  readonly violations: readonly SentinelViolation[];
}

export interface TurnEndInput {
  readonly agent_id: string;
  readonly role: AgentRole;
  readonly task_id?: string | undefined;
  readonly run_root?: string | undefined;
  readonly repo_root?: string | undefined;
  readonly parent_supervisor?: string | undefined;
  readonly dry_run?: boolean | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly modified_files?: readonly string[] | undefined;
  readonly executed_commands?: readonly string[] | undefined;
  readonly reviewed_screenshots?: readonly string[] | undefined;
  readonly probe_count?: number | undefined;
  readonly action?: string | undefined;
}

export interface TurnEndResult {
  readonly status: "HEALTHY" | "VIOLATION_DETECTED";
  readonly strike_count: number;
  readonly action_taken: "NONE" | "ADVISE" | "BLOCK" | "ESCALATE";
  readonly violations: readonly SentinelViolation[];
  readonly routing_journey?: RoutingJourney | undefined;
  readonly markdown_brief?: string | undefined;
}

export interface EvaluationContext {
  readonly agent_id: string;
  readonly role: AgentRole;
  readonly task_id?: string | undefined;
  readonly run_root?: string | undefined;
  readonly repo_root?: string | undefined;
  readonly modified_files?: readonly string[] | undefined;
  readonly executed_commands?: readonly string[] | undefined;
  readonly reviewed_screenshots?: readonly string[] | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly mailbox_unpolled_duration_s?: number | undefined;
  readonly wave_lane_count?: number | undefined;
  readonly wave_concurrency?: number | undefined;
  readonly working_tree_clean?: boolean | undefined;
  readonly task_status?: string | undefined;
  readonly has_uncommitted_changes?: boolean | undefined;
  readonly had_file_scoped_test_run?: boolean | undefined;
  readonly pending_defects_count?: number | undefined;
  readonly probe_count?: number | undefined;
  readonly action?: string | undefined;
}

export interface RoleDiagnosticProfile {
  readonly role: AgentRole;
  readonly tier: 0 | 1 | 2 | 3;
  readonly can_edit: boolean;
  readonly can_execute_shell: boolean;
  readonly evaluate: (context: EvaluationContext) => readonly SentinelViolation[];
}
