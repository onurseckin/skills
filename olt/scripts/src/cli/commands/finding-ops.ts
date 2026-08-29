import { HarnessError } from "../../core/errors/index.ts";
import {
  syncDoctorFindingsToDefects,
  type DoctorFindingInput,
} from "../../mind/defects/sync/lifecycle-sync.ts";
import { integerFlag, textFlag, type Flags } from "../options.ts";

export interface FindingFileOptions {
  readonly code: string;
  readonly severity?: string | undefined;
  readonly file?: string | undefined;
  readonly path?: string | undefined;
  readonly line?: number | undefined;
  readonly message?: string | undefined;
  readonly description?: string | undefined;
  readonly taskId?: string | undefined;
  readonly commitSha?: string | undefined;
  readonly defectsPath?: string | undefined;
  readonly remediation?: string | undefined;
  readonly actor?: string | undefined;
}

export interface FindingFileResult {
  readonly success: boolean;
  readonly finding: DoctorFindingInput;
  readonly totalDefects: number;
  readonly newlyCreated: number;
  readonly reopened: number;
  readonly defectsFile: string;
}

function parseSeverity(raw?: string): DoctorFindingInput["severity"] {
  const norm = raw?.trim().toLowerCase();
  if (
    norm === "critical" ||
    norm === "error" ||
    norm === "warn" ||
    norm === "warning" ||
    norm === "info" ||
    norm === "low" ||
    norm === "medium" ||
    norm === "high"
  ) {
    return norm;
  }
  return "warning";
}

/**
 * Core implementation for recording a finding to .olt/defects.jsonl under flock lock.
 */
export async function executeFindingFileCommand(
  options: FindingFileOptions,
): Promise<FindingFileResult> {
  if (!options.code || !options.code.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "Finding code must be specified (--code)");
  }

  const finding: DoctorFindingInput = {
    code: options.code.trim(),
    severity: parseSeverity(options.severity),
    file: (options.file ?? options.path)?.trim(),
    line: options.line,
    message: (options.message ?? options.description)?.trim() ?? options.code.trim(),
    remediation: options.remediation?.trim(),
    context: {
      ...(options.taskId ? { task_id: options.taskId.trim() } : {}),
      ...(options.commitSha ? { commit_sha: options.commitSha.trim() } : {}),
      ...(options.actor ? { recorded_by: options.actor.trim() } : {}),
    },
    ...(options.commitSha && options.taskId
      ? {
          failure_proof: {
            commit_sha: options.commitSha.trim(),
            task_id: options.taskId.trim(),
            test_assertion: (options.message ?? options.description)?.trim() ?? options.code.trim(),
            timestamp: new Date().toISOString(),
          },
        }
      : {}),
  };

  const syncResult = syncDoctorFindingsToDefects([finding], {
    defectsPath: options.defectsPath,
    commitSha: options.commitSha,
  });

  return {
    success: true,
    finding,
    totalDefects: syncResult.defects.length,
    newlyCreated: syncResult.newlyCreated,
    reopened: syncResult.reopened,
    defectsFile: syncResult.defects_file ?? options.defectsPath ?? ".olt/defects.jsonl",
  };
}

/**
 * CLI command handler for `finding:file`.
 */
export async function findingFileCommand(flags: Flags): Promise<Record<string, unknown>> {
  const code = textFlag(flags, "code")!;
  const severity = textFlag(flags, "severity", false);
  const file = textFlag(flags, "file", false) ?? textFlag(flags, "path", false);
  const line = integerFlag(flags, "line", { required: false });
  const message = textFlag(flags, "message", false) ?? textFlag(flags, "description", false);
  const taskId = textFlag(flags, "task-id", false);
  const commitSha = textFlag(flags, "commit-sha", false);
  const defectsPath = textFlag(flags, "defects-path", false) ?? textFlag(flags, "defects", false);
  const remediation = textFlag(flags, "remediation", false);
  const actor = textFlag(flags, "actor", false);

  const result = await executeFindingFileCommand({
    code,
    severity,
    file,
    line,
    message,
    taskId,
    commitSha,
    defectsPath,
    remediation,
    actor,
  });

  return {
    success: result.success,
    code: result.finding.code,
    severity: result.finding.severity,
    file: result.finding.file ?? null,
    line: result.finding.line ?? null,
    message: result.finding.message,
    newly_created: result.newlyCreated,
    reopened: result.reopened,
    total_defects: result.totalDefects,
    defects_file: result.defectsFile,
  };
}
