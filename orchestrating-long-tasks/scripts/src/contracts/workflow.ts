import type { JsonObject } from "./json.ts";

export type TaskStatus =
  | "blocked"
  | "cancelled"
  | "changes_requested"
  | "done"
  | "escalated"
  | "gating"
  | "leased"
  | "proposed"
  | "ready"
  | "retry_ready"
  | "running"
  | "stale"
  | "submitted"
  | "validated"
  | "validating";

export interface Lease extends JsonObject {
  agent_id: string;
  role: string;
  attempt: number;
  token_digest: string;
  issued_at: string;
  expires_at: string;
  heartbeat_at: string;
  duration_seconds: number;
}

export interface Finding extends JsonObject {
  id: string;
  requirement_id: string;
  severity: "critical" | "important" | "minor";
  observation: string;
  evidence: JsonObject[];
  remediation: string;
  revalidation: string;
  status: "open" | "resolved";
}

export interface GateResult extends JsonObject {
  gate_id: string;
  command_id: string;
  status: "passed";
}
