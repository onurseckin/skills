export const DEFECT_ID = "defect-cli-1788677389904-zdl9hj";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE = "Defect Remediation: unknown command: status";

export interface StatusCommandMapping {
  readonly rawCommand: string;
  readonly resolvedCommand: string;
  readonly isAlias: boolean;
  readonly domain: string;
}

export interface StatusResolutionContext {
  readonly command: string;
  readonly actor?: string;
  readonly role?: string;
  readonly runId?: string;
}

export interface StatusResolutionResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly resolved: boolean;
  readonly targetCommand?: string;
  readonly error?: string;
}

export const CANONICAL_STATUS_COMMANDS: Readonly<Record<string, string>> = {
  status: "run:status",
  "task:status": "task:brief",
  "queue:status": "queue:wave",
  "capsule:status": "run:status",
};

export function resolveStatusCommand(context: StatusResolutionContext): StatusResolutionResult {
  const { command } = context;
  const canonical = CANONICAL_STATUS_COMMANDS[command];

  if (canonical !== undefined) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      targetCommand: canonical,
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    resolved: false,
    error: `unknown command: ${command}`,
  };
}

export function buildStatusCommandManifest(): readonly StatusCommandMapping[] {
  return [
    {
      rawCommand: "status",
      resolvedCommand: "run:status",
      isAlias: true,
      domain: "run",
    },
    {
      rawCommand: "task:status",
      resolvedCommand: "task:brief",
      isAlias: true,
      domain: "task",
    },
    {
      rawCommand: "queue:status",
      resolvedCommand: "queue:wave",
      isAlias: true,
      domain: "queue",
    },
    {
      rawCommand: "capsule:status",
      resolvedCommand: "run:status",
      isAlias: true,
      domain: "run",
    },
  ];
}
