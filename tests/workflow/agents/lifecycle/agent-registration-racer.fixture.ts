import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { registerAgentGrant } from "../../../../olt/scripts/src/workflow/agents/grants.ts";

export interface RegistrationRacerResult {
  readonly ok: boolean;
  readonly code?: string;
}

export function executeRegistrationRacer(
  runRoot: string,
  agentId: string,
): RegistrationRacerResult {
  try {
    registerAgentGrant({
      runRoot,
      agentId,
      role: "coordinator",
      parentAgentId: null,
      parentTaskId: null,
      host: "fixture",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
    });
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      ...(error instanceof HarnessError ? { code: error.code } : {}),
    };
  }
}
