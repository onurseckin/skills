export const DEFECT_ID = "defect-cli-1788679759242-9oasfd";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "Defect Remediation: running command intents lack terminal evidence: C-f87dc8e8-ef4d-4e56-927a-3a4c23c2b063";

export interface TerminalEvidence {
  readonly exitCode: number;
  readonly completedAt: number;
  readonly outputHash?: string;
  readonly terminalStatus: "completed" | "failed" | "killed";
}

export interface CommandIntent {
  readonly commandId: string;
  readonly intent: string;
  readonly status: "pending" | "running" | "completed";
  readonly terminalEvidence?: TerminalEvidence;
}

export interface TerminalEvidenceValidationContext {
  readonly commandIntents: readonly CommandIntent[];
  readonly requireTerminalEvidence?: boolean;
}

export interface TerminalEvidenceValidationResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly valid: boolean;
  readonly missingEvidenceCommandIds: readonly string[];
  readonly error?: string;
}

export function validateCommandTerminalEvidence(
  context: TerminalEvidenceValidationContext,
): TerminalEvidenceValidationResult {
  const { commandIntents, requireTerminalEvidence = true } = context;

  const missing: string[] = [];

  for (const cmd of commandIntents) {
    if (requireTerminalEvidence) {
      if (cmd.status === "running" && !cmd.terminalEvidence) {
        missing.push(cmd.commandId);
      }
    }
  }

  if (missing.length > 0) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      valid: false,
      missingEvidenceCommandIds: missing,
      error: `running command intents lack terminal evidence: ${missing.join(", ")}`,
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    valid: true,
    missingEvidenceCommandIds: [],
  };
}
