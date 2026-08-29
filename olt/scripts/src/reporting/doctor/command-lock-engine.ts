import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export interface CognitiveValidatorCommandLockOptions {
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly commands?: Readonly<Record<string, unknown>> | readonly unknown[] | null | undefined;
  readonly events?: readonly unknown[] | null | undefined;
  readonly grants?: readonly unknown[] | null | undefined;
}

const BANNED_VALIDATOR_ROLES = new Set([
  "validator",
  "cognitive-validator",
  "cognitive_validator",
  "critic",
  "completeness-critic",
  "completeness_critic",
  "socratic-validator",
  "socratic_validator",
]);

function normalizeRole(role: string): string {
  return role.trim().toLowerCase().replace(/_/gu, "-");
}

function isBannedValidatorRole(role: string): boolean {
  const norm = normalizeRole(role);
  return (
    BANNED_VALIDATOR_ROLES.has(norm) ||
    BANNED_VALIDATOR_ROLES.has(role.trim().toLowerCase()) ||
    norm.startsWith("validator") ||
    norm.includes("validator") ||
    norm.includes("critic")
  );
}

/**
 * Engine 6: checkCognitiveValidatorCommandLock
 * Enforces Cognitive Validator Command Hard-Lock. Scans recorded commands and events:
 * agents with roles validator, cognitive-validator, critic, completeness-critic MUST have 0 executed commands / tests.
 * Any command is an immediate ERROR.
 */
export function checkCognitiveValidatorCommandLock(
  options: CognitiveValidatorCommandLockOptions = {},
): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const agentRoleMap = new Map<string, string>();

  // 1. Build agent -> role mapping from state / grants
  const rawGrants = options.grants ?? (options.state?.grants as readonly unknown[] | undefined);
  if (Array.isArray(rawGrants)) {
    for (const grant of rawGrants) {
      if (grant && typeof grant === "object") {
        const g = grant as Record<string, unknown>;
        const id =
          typeof g.id === "string" ? g.id : typeof g.agent_id === "string" ? g.agent_id : undefined;
        const role = typeof g.role === "string" ? g.role : undefined;
        if (id && role) {
          agentRoleMap.set(id, role);
        }
      }
    }
  }

  const rawAgents = options.state?.agents as Record<string, unknown> | undefined;
  if (rawAgents && typeof rawAgents === "object") {
    for (const [id, agent] of Object.entries(rawAgents)) {
      if (agent && typeof agent === "object") {
        const role =
          typeof (agent as Record<string, unknown>).role === "string"
            ? ((agent as Record<string, unknown>).role as string)
            : undefined;
        if (role) {
          agentRoleMap.set(id, role);
        }
      }
    }
  }

  // Also infer from agent ID naming conventions (e.g. validator_xxx, critic_xxx)
  function inferRole(agentId?: string, explicitRole?: string): string {
    if (explicitRole) return explicitRole;
    if (!agentId) return "";
    if (agentRoleMap.has(agentId)) return agentRoleMap.get(agentId)!;
    const lower = agentId.toLowerCase();
    if (
      lower.startsWith("validator") ||
      lower.includes("-validator-") ||
      lower.includes("_validator_")
    )
      return "validator";
    if (lower.startsWith("critic") || lower.includes("-critic-") || lower.includes("_critic_"))
      return "critic";
    if (lower.startsWith("completeness-critic") || lower.includes("completeness_critic"))
      return "completeness-critic";
    if (lower.startsWith("cognitive-validator") || lower.includes("cognitive_validator"))
      return "cognitive-validator";
    return "";
  }

  // 2. Scan state.commands / options.commands
  const rawCommands =
    options.commands ?? (options.state?.commands as Record<string, unknown> | undefined);
  if (rawCommands && typeof rawCommands === "object") {
    const cmdList = Array.isArray(rawCommands) ? rawCommands : Object.values(rawCommands);
    for (const entry of cmdList) {
      if (entry && typeof entry === "object") {
        const cmd = entry as Record<string, unknown>;
        const agentId =
          typeof cmd.agent_id === "string"
            ? cmd.agent_id
            : typeof cmd.actor === "string"
              ? cmd.actor
              : undefined;
        const role = inferRole(agentId, typeof cmd.role === "string" ? cmd.role : undefined);
        const commandText =
          typeof cmd.command === "string"
            ? cmd.command
            : Array.isArray(cmd.argv)
              ? cmd.argv.join(" ")
              : typeof cmd.id === "string"
                ? cmd.id
                : "unknown command";

        if (isBannedValidatorRole(role)) {
          findings.push({
            code: "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION",
            severity: "ERROR",
            engine: "checkCognitiveValidatorCommandLock",
            message: `Cognitive Validator Command Hard-Lock breached: Agent "${agentId ?? "unknown"}" with role "${role}" executed command: "${commandText}"`,
            details: {
              agentId,
              role,
              command: commandText,
              recordId: cmd.id,
            },
          });
        }
      }
    }
  }

  // 3. Scan events for executed commands / tools by validator roles
  if (Array.isArray(options.events)) {
    for (const event of options.events) {
      if (event && typeof event === "object") {
        const evt = event as Record<string, unknown>;
        const eventName =
          typeof evt.name === "string" ? evt.name : typeof evt.type === "string" ? evt.type : "";
        const actor = typeof evt.actor === "string" ? evt.actor : undefined;
        const payload =
          evt.payload && typeof evt.payload === "object"
            ? (evt.payload as Record<string, unknown>)
            : {};
        const agentId = typeof payload.agent_id === "string" ? payload.agent_id : actor;
        const role = inferRole(
          agentId,
          typeof payload.role === "string" ? payload.role : undefined,
        );

        const isCommandEvent =
          eventName === "command-executed" ||
          eventName === "command-recorded" ||
          eventName === "test-executed";
        if (isCommandEvent && isBannedValidatorRole(role)) {
          const commandText = typeof payload.command === "string" ? payload.command : eventName;
          findings.push({
            code: "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION",
            severity: "ERROR",
            engine: "checkCognitiveValidatorCommandLock",
            message: `Cognitive Validator Command Hard-Lock breached in event "${eventName}": Agent "${agentId ?? "unknown"}" with role "${role}" executed command: "${commandText}"`,
            details: {
              eventName,
              agentId,
              role,
              command: commandText,
            },
          });
        }
      }
    }
  }

  return {
    engine: "checkCognitiveValidatorCommandLock",
    passed: findings.length === 0,
    findings,
  };
}
