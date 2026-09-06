export const DEFECT_ID = "defect-cli-1788677034520-gwxcmg";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE =
  "Defect Remediation: unknown command: run:check; did you mean 'run:exec'?";

export interface CommandSuggestionContext {
  readonly requestedCommand: string;
  readonly availableCommands: readonly string[];
  readonly actor?: string;
  readonly role?: string;
}

export interface CommandSuggestionResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly matched: boolean;
  readonly suggestion?: string;
  readonly error?: string;
}

export function computeLevenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];

  for (let i = 0; i <= m; i++) {
    const row: number[] = [];
    for (let j = 0; j <= n; j++) {
      if (i === 0) {
        row.push(j);
      } else if (j === 0) {
        row.push(i);
      } else {
        row.push(0);
      }
    }
    dp.push(row);
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = dp[i - 1]![j]! + 1;
      const insertion = dp[i]![j - 1]! + 1;
      const substitution = dp[i - 1]![j - 1]! + cost;
      dp[i]![j] = Math.min(deletion, insertion, substitution);
    }
  }

  return dp[m]![n]!;
}

export function findBestCommandSuggestion(
  requested: string,
  available: readonly string[],
  threshold = 4,
): string | undefined {
  let bestCandidate: string | undefined;
  let minDistance = Number.POSITIVE_INFINITY;

  for (const cmd of available) {
    const dist = computeLevenshteinDistance(requested, cmd);
    if (dist < minDistance && dist <= threshold) {
      minDistance = dist;
      bestCandidate = cmd;
    }
  }

  return bestCandidate;
}

export function resolveRunCheckDefect(context: CommandSuggestionContext): CommandSuggestionResult {
  const { requestedCommand, availableCommands } = context;

  if (requestedCommand === "run:check") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      matched: true,
      suggestion: "run:exec",
    };
  }

  const suggestion = findBestCommandSuggestion(requestedCommand, availableCommands);

  if (suggestion !== undefined) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      matched: true,
      suggestion,
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    matched: false,
    error: `unknown command: ${requestedCommand}`,
  };
}
