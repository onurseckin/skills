import type { JsonObject } from "../../core/contracts/index.ts";
import { CODE_EDIT_TOOLS } from "../../platform/index.ts";

export type BehavioralViolationType =
  | "coordinator_code_writing"
  | "orchestrator_direct_implementation"
  | "implementer_self_grading"
  | "implementer_graph_mutation"
  | "subagent_pulse_termination"
  | "role_confinement_violation"
  | "behavioral_evidence_unavailable";

export type BehavioralSeverity = "critical" | "important" | "minor";

export interface BehavioralFinding {
  agent_id: string;
  role: string;
  violation_type: BehavioralViolationType;
  severity: BehavioralSeverity;
  observation: string;
  remediation: string;
  evidence?: JsonObject;
}

export interface BehavioralHealthSummary {
  healthy: boolean;
  violation_count: number;
  findings: BehavioralFinding[];
  issues: string[];
}

export const FILE_EDIT_TOOLS: ReadonlySet<string> = CODE_EDIT_TOOLS;

export const GRAPH_MUTATION_COMMANDS: ReadonlySet<string> = new Set([
  "plan:init",
  "plan:enhance",
  "plan:add",
  "plan:compile",
  "plan:apply",
  "plan:replan",
  "plan:claim",
  "mind:init",
  "mind:candidate",
  "mind:admit",
]);

export const VALIDATION_COMMANDS: ReadonlySet<string> = new Set([
  "task:validate-start",
  "task:review",
  "task:probe",
  "task:reject",
  "critic:start",
  "critic:remediate",
  "gate:prove",
  "coordinator:pushback",
]);

export const TERMINAL_PULSE_OUTCOMES: ReadonlySet<string> = new Set([
  "halted",
  "unarmed",
  "stopped",
  "completed",
]);
