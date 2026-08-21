import type { AgentRole } from "../contracts/packets.ts";
import type { BranchSubTask } from "../contracts/branch.ts";
import type { JsonObject } from "../contracts/json.ts";
import type { Clock, TaskRecord, WorkflowState } from "../workflow/types.ts";
import type { RoleContract } from "./role-contract.ts";

export interface PacketInput {
  runId: string;
  graphRevision: number;
  role: AgentRole;
  agentId: string;
  task?: TaskRecord;
  subTask?: BranchSubTask;
  state: WorkflowState;
  commonInstructions: CanonicalCommonInstructions;
  roleContract?: RoleContract;
  authoritativeContext: JsonObject;
  evidenceSchema: JsonObject;
  targetedCommands: string[][];
  planningWriteScope?: string[];
  leaseToken?: string;
  attempt: number;
  clock?: Clock;
}

export interface CanonicalCommonInstructions {
  bytes: Uint8Array;
  sha256: string;
}

export interface BuiltPacket {
  markdown: string;
  metadata: JsonObject;
}
