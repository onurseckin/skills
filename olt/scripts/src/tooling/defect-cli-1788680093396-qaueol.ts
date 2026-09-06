export const DEFECT_ID = "defect-cli-1788680093396-qaueol";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "Defect Remediation: cannot pass task-4: 5 open finding(s) unanswered: probe-task-4-01-1, probe-task-4-01-2, probe-task-4-01-3, probe-task-4-01-4, probe-task-4-01-5; answer each with --resolve <finding-id>=<command-id>";

export interface Task4ProbeCheckContext {
  readonly taskId: string;
  readonly findings: readonly string[];
  readonly resolutions?: Readonly<Record<string, string>>;
}

export interface Task4ProbeCheckResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly approved: boolean;
  readonly unansweredFindings: readonly string[];
  readonly error?: string;
}

export function checkTask4ProbeResolutions(
  context: Task4ProbeCheckContext,
): Task4ProbeCheckResult {
  const { taskId, findings, resolutions = {} } = context;

  const unanswered = findings.filter(
    (f) => !resolutions[f] || resolutions[f]?.trim().length === 0,
  );

  if (unanswered.length === 0) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      approved: true,
      unansweredFindings: [],
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    approved: false,
    unansweredFindings: unanswered,
    error: `cannot pass ${taskId}: ${unanswered.length} open finding(s) unanswered: ${unanswered.join(
      ", ",
    )}; answer each with --resolve <finding-id>=<command-id>`,
  };
}
