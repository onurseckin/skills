import type { RunState } from "../contracts/capsule.ts";
import { isJsonObject, type JsonObject } from "../contracts/json.ts";
import { applicableGates, commandArgv } from "../workflow/gates/gate-policy.ts";
import type { TaskRecord, WorkflowState } from "../workflow/types.ts";
import { priorRoundDemands, type ProveDemand } from "./prior-round-demands.ts";
import type { RepositoryGitCommand } from "./repository-git-command.ts";
import { taskCommandEvidence, type RecordedCommand } from "./round-commands.ts";
import { anchoredDiff, diffAnchor, type DiffAnchor } from "./round-repository-delta.ts";

/** Where the round-N record sits in a validator's authoritative context. */
export const VALIDATION_ROUND_KEY = "validation_round";

export interface ValidationRoundInput {
  runRoot: string;
  /** The capsule state, which holds the registry of every repository inspection the run recorded. */
  runState: RunState;
  state: WorkflowState;
  task: TaskRecord;
  /** The grant context, read for the baseline and current inspections it already carries. */
  context: JsonObject;
  now?: Date;
  git?: RepositoryGitCommand;
}

export interface ValidationRound extends JsonObject {
  round: number;
  previous_round: JsonObject;
  prove_these_hold: ProveDemand[];
  commands_already_run: RecordedCommand[];
  gates: JsonObject[];
  repository_delta: JsonObject;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function inspection(context: JsonObject, key: string): JsonObject | undefined {
  const value = context[key];
  return isJsonObject(value) ? value : undefined;
}

/** The last moment the task left validation: where the previous round stopped looking. */
function previousRoundEnd(task: TaskRecord): string | undefined {
  return [...task.history].reverse().find((entry) => entry.from === "validating")?.at;
}

/**
 * The newest inspection the run recorded at or before an instant. Inspections are recorded whenever
 * a grant is handed out, so the one taken during the previous round is the repository as that round
 * saw it — a recorded observation, never a reconstruction.
 */
function inspectionAtOrBefore(runState: RunState, instant: string): JsonObject | undefined {
  const registry = runState.repository_inspections;
  if (!isJsonObject(registry)) return undefined;
  return Object.values(registry)
    .filter(isJsonObject)
    .filter((entry) => text(entry.captured_at) !== "" && text(entry.captured_at) <= instant)
    .sort((left, right) => text(left.captured_at).localeCompare(text(right.captured_at)))
    .at(-1);
}

function recordedChange(before: JsonObject, after: JsonObject): JsonObject {
  return {
    content_sha256_changed:
      text(before.repository_content_sha256) !== text(after.repository_content_sha256),
    file_count: {
      before: before.repository_file_count ?? null,
      after: after.repository_file_count ?? null,
    },
    total_bytes: {
      before: before.repository_total_bytes ?? null,
      after: after.repository_total_bytes ?? null,
    },
  };
}

function gateStatus(state: WorkflowState, task: TaskRecord): JsonObject[] {
  return applicableGates(state, task).map((gate) => {
    const runs = Object.values(state.commands)
      .filter((command) => command.task_id === task.id && command.gate_id === gate.id)
      .sort((left, right) => left.started_at.localeCompare(right.started_at));
    const latest = runs.at(-1);
    const passed = (task.gate_results ?? []).find(
      (result) => result.gate_id === gate.id && result.status === "passed",
    );
    return {
      gate_id: gate.id,
      command: commandArgv(gate.command),
      mandatory: gate.mandatory,
      ...(latest
        ? {
            latest_run: {
              command_id: latest.id,
              exit_code: latest.exit_code,
              finished_at: latest.finished_at,
              actor: latest.actor,
            },
          }
        : {}),
      ...(passed ? { recorded_pass: { command_id: passed.command_id } } : {}),
    };
  });
}

function repositoryDelta(input: ValidationRoundInput, boundary: string | undefined): JsonObject {
  const current = inspection(input.context, "current_repository_state");
  const baseline = inspection(input.context, "baseline_repository_state");
  const repositoryRoot = text(current?.repository_root);
  if (!current || !baseline || repositoryRoot === "") return {};
  const now = input.now ?? new Date();
  const measure = (anchor: DiffAnchor) => anchoredDiff(repositoryRoot, anchor, now, input.git);
  const previous = boundary ? inspectionAtOrBefore(input.runState, boundary) : undefined;
  return {
    full: measure(diffAnchor(baseline)),
    ...(previous
      ? {
          since_previous_round: {
            ...measure(diffAnchor(previous)),
            recorded_change: recordedChange(previous, current),
          },
        }
      : {}),
  };
}

/**
 * What the run has already recorded about this task, assembled for the validator arriving on a later
 * round. Round 1 has no previous round to carry, so it is handed nothing extra and its packet is the
 * packet it always was.
 */
export function validationRoundContext(input: ValidationRoundInput): ValidationRound | undefined {
  // Every domain open this round shares one attempt number (B12.2), so any open entry names it;
  // absent one (nothing open yet, or everything already archived) it is the round about to start.
  const round = input.task.validations?.[0]?.attempt ?? input.task.repair_round + 1;
  if (round <= 1) return undefined;
  const previous = input.task.validation_history?.at(-1);
  const endedAt = previousRoundEnd(input.task);
  const boundary = endedAt ?? previous?.started_at;
  return {
    round,
    previous_round: {
      round: round - 1,
      ...(previous?.started_at ? { started_at: previous.started_at } : {}),
      ...(endedAt ? { ended_at: endedAt } : {}),
    },
    prove_these_hold: priorRoundDemands(input.task),
    commands_already_run: taskCommandEvidence(input.runRoot, input.state, input.task.id),
    gates: gateStatus(input.state, input.task),
    repository_delta: repositoryDelta(input, boundary),
  };
}
