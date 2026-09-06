export const DEFECT_ID = "defect-cli-1788679695208-us10nu";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "Defect Remediation: cannot pass task-1: 5 open finding(s) unanswered: probe-task-1-01-1, probe-task-1-01-2, probe-task-1-01-3, probe-task-1-01-4, probe-task-1-01-5; answer each with --resolve <finding-id>=<command-id>";

export interface TaskFindingsGateContext {
  readonly taskId: string;
  readonly openFindings: readonly string[];
  readonly resolutions?: Readonly<Record<string, string>>;
}

export interface TaskFindingsGateResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly unansweredFindings: readonly string[];
  readonly error?: string;
}

export function validateTaskFindingsResolution(
  context: TaskFindingsGateContext,
): TaskFindingsGateResult {
  const { taskId, openFindings, resolutions = {} } = context;

  const unanswered = openFindings.filter(
    (findingId) => !resolutions[findingId] || resolutions[findingId]?.trim().length === 0,
  );

  if (unanswered.length === 0) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      allowed: true,
      unansweredFindings: [],
    };
  }

  const list = unanswered.join(", ");
  const error = `cannot pass ${taskId}: ${unanswered.length} open finding(s) unanswered: ${list}; answer each with --resolve <finding-id>=<command-id>`;

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    allowed: false,
    unansweredFindings: unanswered,
    error,
  };
}
