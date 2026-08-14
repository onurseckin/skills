import type { JsonObject } from "./json.ts";

export interface AcceptanceCriterion extends JsonObject {
  id: string;
  criterion: string;
  evidence: string[];
}

export interface CandidateGate extends JsonObject {
  argv: string[];
  cwd: string;
}

export interface Requirement extends JsonObject {
  id: string;
  source_lines: number[];
  source_excerpt: string;
  instruction: string;
  implementation: string;
  subsystem: string;
  acceptance: AcceptanceCriterion[];
  candidate_gates: CandidateGate[];
  priority: number;
  risk: "low" | "medium" | "high" | "critical";
  ambiguity: string[];
  dependencies: string[];
  disposition: "actionable" | "needs_authority";
  status: "planned" | "satisfied";
}

export interface Disposition extends JsonObject {
  line: number;
  kind: "constraint" | "context" | "needs_authority" | "non_actionable" | "requirement";
  requirement_id?: string;
  requirement_ids?: string[];
  rationale?: string;
}

export interface RequirementDocument extends JsonObject {
  schema: "harness.requirements";
  version: number;
  prompt_sha256: string;
  requirements: Requirement[];
  dispositions: Disposition[];
}
