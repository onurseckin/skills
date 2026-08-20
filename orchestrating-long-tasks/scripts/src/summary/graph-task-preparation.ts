import type { HarnessEvent, Manifest } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";
import type { AgentLedgerView } from "./agent-telemetry.ts";
import { mapFindingDetails, mapMediaAssets, type AssetMapOptions } from "./asset-mapper.ts";
import { projectFindingsForNode, type AssetRegistry } from "./graph-asset-ownership.ts";
import {
  resolveImplementerId,
  resolveValidatorId,
  type TaskNodeContext,
} from "./graph-node-context.ts";
import { partitionTaskCommands } from "./node-evidence.ts";
import type { FileRef } from "./types.ts";

export interface TaskPreparationInput {
  task: TaskRecord;
  taskStep: number;
  taskWave: number;
  commands: readonly CommandRecord[];
  ledger: AgentLedgerView;
  registry: AssetRegistry;
  events?: readonly HarnessEvent[] | undefined;
  manifest?: Manifest | undefined;
  runRoot?: string | undefined;
}

/**
 * Only files the implementer reported as changed. The write scope is what it was allowed to touch,
 * not what it touched, so it stays in metadata instead of masquerading as a change set. The list is
 * stamped `agent_reported` because nothing here opened the repository to check it, and the harness
 * records no diff text for a plan task — an absent diff stays absent rather than being reconstructed.
 */
function changedFiles(task: TaskRecord): FileRef[] {
  const reported = task.report?.files_changed;
  if (!Array.isArray(reported)) return [];
  return reported
    .filter((entry): entry is string => typeof entry === "string")
    .map((path) => ({ path, mode: "write" as const, evidence_class: "agent_reported" as const }));
}

/**
 * Resolves one task into the context every node builder shares. Asset ownership is settled here, in
 * emission order, so each node receives only the evidence it produced and the finding projection
 * can point at ids that really exist somewhere in the dataset.
 */
export function prepareTaskContext(input: TaskPreparationInput): TaskNodeContext {
  const { task, registry } = input;
  const validatorId = resolveValidatorId(task);
  const hasValidator = validatorId !== undefined || Boolean(task.validation);
  const taskCommands = input.commands.filter((command) => command.task_id === task.id);
  const partition = partitionTaskCommands(taskCommands, validatorId);

  const implementerId = resolveImplementerId(task);
  const options: AssetMapOptions = {
    ...(input.events !== undefined ? { events: input.events } : {}),
    ...(input.manifest !== undefined ? { manifest: input.manifest } : {}),
    ...(input.runRoot !== undefined ? { runRoot: input.runRoot } : {}),
    ...(validatorId !== undefined ? { validatorId } : {}),
    ...(implementerId !== undefined ? { implementerId } : {}),
  };

  const implementerAssets = registry.claim(
    mapMediaAssets(task, partition.implementer, { ...options, scope: "implementer" }),
  );
  const validatorAssets = registry.claim(
    mapMediaAssets(task, partition.validator, { ...options, scope: "validator" }),
  );
  const findings = projectFindingsForNode(mapFindingDetails(task, options), registry);

  return {
    task,
    taskNodeId: `node-task-${task.id}`,
    ...(hasValidator ? { validatorNodeId: `node-validator-${task.id}` } : {}),
    gateNodeId: `node-gate-${task.id}`,
    taskName: typeof task.label === "string" ? task.label : task.id,
    taskStep: input.taskStep,
    gateStep: input.taskStep + 1,
    taskWave: input.taskWave,
    files: changedFiles(task),
    findings,
    implementerCommands: partition.implementer,
    validatorCommands: partition.validator,
    ...(implementerId !== undefined ? { agentId: implementerId } : {}),
    ...(validatorId !== undefined ? { validatorId } : {}),
    ...(input.events !== undefined ? { events: input.events } : {}),
    ...(input.manifest !== undefined ? { manifest: input.manifest } : {}),
    ...(input.runRoot !== undefined ? { runRoot: input.runRoot } : {}),
    ledger: input.ledger,
    implementerAssets,
    validatorAssets,
  };
}
