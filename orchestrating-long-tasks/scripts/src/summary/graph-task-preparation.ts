import type { HarnessEvent, Manifest } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
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
}

/**
 * The step of this task's own submission, in the same space as `RunFacts.steps` (B15.2): the highest
 * `sequence` among this task's `task-submitted` events. A task the chain never saw submit gets no
 * step rather than one borrowed from a different task's round.
 */
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

/**
 * Only files the implementer reported as changed. The write scope is what it was allowed to touch,
 * not what it touched, so it stays in metadata instead of masquerading as a change set. The path
 * list itself is stamped `agent_reported` because nothing here opened the repository to produce it;
 * `lines`/`diff` are filled in separately from a real Git reading (B15.2), which does not change that
 * the *listing* is still the implementer's own claim.
 */
function changedFiles(
  task: TaskRecord,
  events: readonly HarnessEvent[] | undefined,
  runRoot: string | undefined,
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
  return enrichFileRefsWithDiffs(files, runRoot);
}

/**
 * Resolves one task into the context every node builder shares. Asset ownership is settled here, in
 * emission order, so each node receives only the evidence it produced and the finding projection
 * can point at ids that really exist somewhere in the dataset.
 */
export function prepareTaskContext(input: TaskPreparationInput): TaskNodeContext {
  const { task, registry } = input;
  const validatorId = resolveValidatorId(task);
  // A live validator node exists only while the state machine still holds a live `validation`
  // record. On reject, record-review.ts deletes it and moves the identity into
  // `validation_history`, which computeArchivedRounds already turns into that round's own node
  // pair below — so falling back to a historical identity here, as `validatorId` alone would, draws
  // the same validator twice: once honestly as the archived round, once as a phantom "live" node
  // whose handoff and verdict edges never actually happened for whatever round is now in progress.
  const hasValidator = Boolean(task.validation);
  const taskCommands = input.commands.filter((command) => command.task_id === task.id);
  const partition = partitionTaskCommands(taskCommands, validatorId);

  const implementerId = resolveImplementerId(task);
  // AssetMapOptions has no events field: nothing in the asset pipeline reads an event stream to
  // date an asset, and inferring a capture time from a nearby event would be a guess wearing the
  // shape of a measurement, exactly what collectReportAssets et al. already refuse to do.
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
    files: changedFiles(task, input.events, input.runRoot),
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
