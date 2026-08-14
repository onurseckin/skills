import type { JsonObject } from "./json.ts";

export type AgentRole =
  | "completeness-critic"
  | "implementer"
  | "planner"
  | "repairer"
  | "validator";

export interface PacketMetadata extends JsonObject {
  run_id: string;
  task_id: null | string;
  attempt: number;
  graph_revision: number;
  role: AgentRole;
  agent_id: string;
  packet_sha256: string;
  excluded_fields: string[];
}
