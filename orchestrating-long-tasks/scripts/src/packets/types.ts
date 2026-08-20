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
  // A branch sub-task is an execution-time subdivision that never enters `state.tasks`, so a
  // sub-agent's packet binds to the ledger entry instead of to a plan task.
  subTask?: BranchSubTask;
  state: WorkflowState;
  commonInstructions: CanonicalCommonInstructions;
  // Resolved from `role` against the checked-in documents; injected only when a caller needs a
  // packet built against a contract that is not on disk.
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
