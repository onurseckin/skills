import type { HarnessEvent, Manifest } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";
import { earliestOpenValidation } from "../workflow/review/validation-state.ts";
import type { AgentLedgerView } from "./agent-telemetry.ts";
import type { ArchivedRoundContext } from "./graph-round-context.ts";
import type { FileRef, MediaAsset, NodeFinding, NodeStatus } from "./types.ts";

export interface TaskNodeContext {
  task: TaskRecord;
  taskNodeId: string;
  validatorNodeId?: string | undefined;
  gateNodeId: string;
  taskName: string;
  taskStep: number;
  gateStep: number;
  taskWave: number;
  files: FileRef[];
  findings: NodeFinding[];
  implementerCommands: CommandRecord[];
  validatorCommands: CommandRecord[];
  agentId?: string | undefined;
  validatorId?: string | undefined;
  events?: readonly HarnessEvent[] | undefined;
  manifest?: Manifest | undefined;
  runRoot?: string | undefined;
  ledger: AgentLedgerView;
  /** Assets this task's implementer owns, already deduplicated against the rest of the dataset. */
  implementerAssets: MediaAsset[];
  /** Assets the validator owns. The two lists never overlap. */
  validatorAssets: MediaAsset[];
  /** Every rejected round this task lived through before the one described above, oldest first. */
  archivedRounds: ArchivedRoundContext[];
  /** `archivedRounds.length + 1` — the round number `taskNodeId`/`validatorNodeId` describe. */
  totalRounds: number;
}

export function mapTaskStatus(status: string): NodeStatus {
  if (status === "done" || status === "validated") return "success";
  if (status === "changes_requested") return "warning";
  if (status === "branched") return "running";
  if (status === "leased" || status === "running" || status === "submitted") return "running";
  if (status === "validating" || status === "gating") return "running";
  if (status === "failed" || status === "cancelled" || status === "escalated") return "error";
  return "pending";
}

export function mapGateStatus(task: TaskRecord): NodeStatus {
  if (task.status === "done" || task.status === "validated") return "success";
  if (task.status === "changes_requested") return "warning";
  if (task.status === "cancelled" || task.status === "escalated") return "error";
  if (
    task.status === "validating" ||
    task.status === "gating" ||
    (task.validations !== undefined && task.validations.length > 0)
  ) {
    return "running";
  }
  return "pending";
}

// B12.2: several domains can be open at once; the earliest-started one is the representative
// identity for the single validator-node-per-round shape this graph still draws (see
// graph-task-preparation.ts's own note on why the fallback below is deliberately narrower).
export function resolveValidatorId(task: TaskRecord): string | undefined {
  const open = earliestOpenValidation(task);
  if (open?.validator_id) return open.validator_id;
  const history = task.validation_history;
  if (Array.isArray(history) && history.length > 0) {
    return history[history.length - 1]?.validator_id;
  }
  return undefined;
}

/** The identity a node's work should be attributed to, or nothing when the run never recorded one. */
export function resolveImplementerId(task: TaskRecord): string | undefined {
  return task.lease?.agent_id ?? task.repair_assignee ?? task.original_implementer;
}
