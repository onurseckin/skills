import type { HarnessEvent, Manifest } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import type { RepositoryGitCommand } from "../packets/repository-git-command.ts";
import type { TaskRecord } from "../workflow/types.ts";
import type { AgentLedgerView } from "./agent-telemetry.ts";
import { mapFindingDetails, mapMediaAssets, type AssetMapOptions } from "./asset-mapper.ts";
import { enrichFileRefsWithDiffs } from "./file-diff-reader.ts";
import { projectFindingsForNode, type AssetRegistry } from "./graph-asset-ownership.ts";
import {
  resolveImplementerId,
  resolveValidatorId,
  type TaskNodeContext,
} from "./graph-node-context.ts";
import { computeArchivedRounds } from "./graph-round-context.ts";
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
  gitCommand?: RepositoryGitCommand | undefined;
}

function taskSubmittedStep(
  taskId: string,
  events: readonly HarnessEvent[] | undefined,
): number | undefined {
  if (events === undefined) return undefined;
  let latest: number | undefined;
  for (const event of events) {
    if (event.kind !== "task-submitted") continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (payload.task_id !== taskId) continue;
    if (typeof event.sequence !== "number") continue;
    if (latest === undefined || event.sequence > latest) latest = event.sequence;
  }
  return latest;
}

function changedFiles(
  task: TaskRecord,
  events: readonly HarnessEvent[] | undefined,
  runRoot: string | undefined,
  gitCommand: RepositoryGitCommand | undefined,
): FileRef[] {
  const reported = task.report?.files_changed;
  if (!Array.isArray(reported)) return [];
  const rationale = typeof task.report?.summary === "string" ? task.report.summary : undefined;
  const requirementIds = Array.isArray(task.report?.requirement_ids)
    ? task.report.requirement_ids.filter((id): id is string => typeof id === "string")
    : undefined;
  const step = taskSubmittedStep(task.id, events);
  const files = reported
    .filter((entry): entry is string => typeof entry === "string")
    .map((path): FileRef => ({
      path,
      mode: "write",
      evidence_class: "agent_reported",
      ...(rationale !== undefined ? { rationale } : {}),
      ...(requirementIds !== undefined && requirementIds.length > 0 ? { requirementIds } : {}),
      ...(step !== undefined ? { step } : {}),
    }));
  return enrichFileRefsWithDiffs(files, runRoot, gitCommand);
}

export function prepareTaskContext(input: TaskPreparationInput): TaskNodeContext {
  const { task, registry } = input;
  const validatorId = resolveValidatorId(task);
  const hasValidator = task.validations !== undefined && task.validations.length > 0;
  const taskCommands = input.commands.filter((command) => command.task_id === task.id);
  const partition = partitionTaskCommands(taskCommands, validatorId);

  const implementerId = resolveImplementerId(task);
  const options: AssetMapOptions = {
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
  const archivedRounds = computeArchivedRounds(task, taskCommands);

  return {
    task,
    taskNodeId: `node-task-${task.id}`,
    ...(hasValidator ? { validatorNodeId: `node-validator-${task.id}` } : {}),
    gateNodeId: `node-gate-${task.id}`,
    archivedRounds,
    totalRounds: archivedRounds.length + 1,
    taskName: typeof task.label === "string" ? task.label : task.id,
    taskStep: input.taskStep,
    gateStep: input.taskStep + 1,
    taskWave: input.taskWave,
    files: changedFiles(task, input.events, input.runRoot, input.gitCommand),
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
