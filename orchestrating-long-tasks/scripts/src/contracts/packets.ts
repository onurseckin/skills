import type { JsonObject } from "./json.ts";

export type AgentRole =
  | "completeness-critic"
  | "coordinator"
  | "implementer"
  | "mechanic-validator"
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
  "mechanic-validator",
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

export function isCognitiveValidatorRole(role: string): boolean {
  const normalized = role.toLowerCase().trim();
  return (
    normalized === "validator" ||
    normalized === "ui-validator" ||
    normalized.startsWith("validator-")
  );
}

export function isMechanicValidatorRole(role: string): boolean {
  const normalized = role.toLowerCase().trim();
  return (
    normalized === "mechanic-validator" ||
    normalized === "ui-mechanic-validator" ||
    normalized === "mechanic_validator"
  );
}

export function isAnyValidatorRole(role: string): boolean {
  return isCognitiveValidatorRole(role) || isMechanicValidatorRole(role);
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

export interface ReviewPayloadGating extends JsonObject {
  readonly is_ui_task: boolean;
  readonly include_companion_manifests?: boolean;
  readonly include_visual_artifacts?: boolean;
  readonly max_packet_bytes?: number;
}

export interface ReviewPacketPayload extends JsonObject {
  readonly task_id: string;
  readonly validator: string;
  readonly token_digest?: string;
  readonly status: "pass" | "fail";
  readonly verdict: "pass" | "reject";
  readonly summary?: string;
  readonly created_at: string;
  readonly checks: string[];
  readonly findings: JsonObject[];
  readonly task_scope_findings?: JsonObject[];
  readonly checklist_coverage?: JsonObject;
  readonly resolved_findings?: JsonObject[];
  readonly unblocked?: string[];
  readonly task?: JsonObject;
  readonly screenshots?: string[];
  readonly screenshot_records?: JsonObject[];
  readonly companion_manifests?: JsonObject[];
  readonly dual_channel_audit?: JsonObject;
  readonly visual_report?: JsonObject;
}
