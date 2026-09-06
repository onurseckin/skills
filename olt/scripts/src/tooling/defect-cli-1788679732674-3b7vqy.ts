export const DEFECT_ID = "defect-cli-1788679732674-3b7vqy";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "Defect Remediation: cannot pass task-4: 5 open finding(s) unanswered: probe-task-4-01-1, probe-task-4-01-2, probe-task-4-01-3, probe-task-4-01-4, probe-task-4-01-5; answer each with --resolve <finding-id>=<command-id>";

export interface Task4FindingsContext {
  readonly taskId: string;
  readonly findings: readonly string[];
  readonly resolutions?: Readonly<Record<string, string>>;
}

export interface Task4FindingsResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly passed: boolean;
  readonly openFindings: readonly string[];
  readonly error?: string;
}

export function evaluateTask4GateFindings(
  context: Task4FindingsContext,
): Task4FindingsResult {
  const { taskId, findings, resolutions = {} } = context;

  const unanswered = findings.filter(
    (f) => !resolutions[f] || resolutions[f]?.trim().length === 0,
  );

  if (unanswered.length === 0) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      passed: true,
      openFindings: [],
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    passed: false,
    openFindings: unanswered,
    error: `cannot pass ${taskId}: ${unanswered.length} open finding(s) unanswered: ${unanswered.join(
      ", ",
    )}; answer each with --resolve <finding-id>=<command-id>`,
  };
}
