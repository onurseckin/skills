export const DEFECT_ID = "defect-cli-1788679978854-18kdj8";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "Defect Remediation: cannot pass task-2: 5 open finding(s) unanswered: probe-task-2-01-1, probe-task-2-01-2, probe-task-2-01-3, probe-task-2-01-4, probe-task-2-01-5; answer each with --resolve <finding-id>=<command-id>";

export interface Task2FindingsReevaluationContext {
  readonly taskId: string;
  readonly findings: readonly string[];
  readonly resolutions?: Readonly<Record<string, string>>;
}

export interface Task2FindingsReevaluationResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly passed: boolean;
  readonly pendingFindings: readonly string[];
  readonly error?: string;
}

export function reevaluateTask2GateFindings(
  context: Task2FindingsReevaluationContext,
): Task2FindingsReevaluationResult {
  const { taskId, findings, resolutions = {} } = context;

  const pending = findings.filter(
    (f) => !resolutions[f] || resolutions[f]?.trim().length === 0,
  );

  if (pending.length === 0) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      passed: true,
      pendingFindings: [],
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    passed: false,
    pendingFindings: pending,
    error: `cannot pass ${taskId}: ${pending.length} open finding(s) unanswered: ${pending.join(
      ", ",
    )}; answer each with --resolve <finding-id>=<command-id>`,
  };
}
