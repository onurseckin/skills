import type { CommandRecord } from "../../core/contracts/commands.ts";
import type { EvidenceClass } from "../../core/contracts/evidence.ts";
import type { JsonObject } from "../../core/contracts/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import type { TaskRecord } from "../types.ts";
import { pathAllowed } from "./validate-report.ts";

export interface SubmissionReportInputs {
  readonly task: TaskRecord;
  readonly agentId: string;
  readonly summary: string;
  readonly declaredFiles?: readonly string[] | undefined;
  readonly declaredCommandIds?: readonly string[] | undefined;
  readonly observedFiles: readonly string[] | null;
  readonly commands: Readonly<Record<string, CommandRecord>>;
  readonly allowEmptyFiles?: boolean;
}

function resolveFiles(inputs: SubmissionReportInputs): {
  files: string[];
  evidenceClass: EvidenceClass;
} {
  if (inputs.declaredFiles && inputs.declaredFiles.length > 0)
    return { files: [...inputs.declaredFiles], evidenceClass: "agent_reported" };
  const observed = (inputs.observedFiles ?? []).filter((path) =>
    pathAllowed(path, inputs.task.write_scope),
  );
  if (observed.length === 0) {
    if (inputs.allowEmptyFiles) return { files: [], evidenceClass: "agent_reported" };
    throw new HarnessError(
      "INVALID_STATE",
      `cannot determine files_changed for ${inputs.task.id}: no working-tree change inside the task write scope was observed; pass --files-changed or --report, or --no-op if none was needed`,
    );
  }
  return { files: observed, evidenceClass: "harness_observed" };
}

function resolveChecks(inputs: SubmissionReportInputs): {
  commands: CommandRecord[];
  evidenceClass: EvidenceClass;
} {
  const declared = inputs.declaredCommandIds;
  if (declared && declared.length > 0) {
    const commands = declared.map((id) => {
      const command = inputs.commands[id];
      if (!command)
        throw new HarnessError(
          "INVALID_STATE",
          `submission evidence names no recorded command: ${id}`,
        );
      if (command.task_id !== null && command.task_id !== inputs.task.id)
        throw new HarnessError(
          "INVALID_STATE",
          `submission evidence command ${id} belongs to task ${String(command.task_id)}`,
        );
      return command;
    });
    return { commands, evidenceClass: "agent_reported" };
  }
  const observed = Object.values(inputs.commands)
    .filter((command) => command.task_id === inputs.task.id && command.actor === inputs.agentId)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (observed.length === 0) {
    throw new HarnessError(
      "INVALID_STATE",
      `cannot determine checks for ${inputs.task.id}: the agent has no recorded command; run the task gate through run:exec, or pass --evidence or --report`,
    );
  }
  return { commands: observed, evidenceClass: "harness_observed" };
}

export function buildSubmissionReport(inputs: SubmissionReportInputs): JsonObject {
  const { files, evidenceClass: filesClass } = resolveFiles(inputs);
  const { commands, evidenceClass: checksClass } = resolveChecks(inputs);
  return {
    summary: inputs.summary,
    requirement_ids: [...inputs.task.requirement_ids],
    files_changed: files,
    files_changed_evidence_class: filesClass,
    checks: commands.map((command) => ({ command_id: command.id })),
    checks_evidence_class: checksClass,
    evidence: commands.map((command) => ({
      kind: "command_record",
      command_id: command.id,
      path: command.record_path,
    })),
  };
}
