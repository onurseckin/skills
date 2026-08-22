import type { JsonObject } from "./json.ts";

export type AgentRole =
  | "completeness-critic"
  | "coordinator"
  | "implementer"
  | "mind"
  | "mind-auditor"
  | "orchestrator"
  | "plan-validator"
  | "planner"
  | "repairer"
  | "sub-implementer"
  | "sub-investigator"
  | "sub-validator"
  | "validator";

export const AGENT_ROLES: readonly AgentRole[] = [
  "completeness-critic",
  "coordinator",
  "implementer",
  "mind",
  "mind-auditor",
  "orchestrator",
  "plan-validator",
  "planner",
  "repairer",
  "sub-implementer",
  "sub-investigator",
  "sub-validator",
  "validator",
];

const ROLE_SET = new Set<string>(AGENT_ROLES);

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && ROLE_SET.has(value);
}

export interface PacketMetadata extends JsonObject {
  run_id: string;
  task_id: null | string;
  attempt: number;
  graph_revision: number;
  role: AgentRole;
  agent_id: string;
  packet_sha256: string;
  role_contract_sha256: string;
  excluded_fields: string[];
}

export interface ResponsibilityChecklistItem {
  readonly id: string;
  readonly text: string;
  readonly role?: AgentRole;
  readonly mandatory: boolean;
}

export interface CapsuleMemoryPointer {
  readonly run_id: string;
  readonly task_id: string | null;
  readonly role: AgentRole;
  readonly capsule_root: string;
  readonly command_examples: readonly string[];
}
