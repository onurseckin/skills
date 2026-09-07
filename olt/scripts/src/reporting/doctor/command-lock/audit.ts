import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "../types.ts";
import { isBadGit, isWholeSuite, parseArgv } from "./classifiers.ts";
import { isImplementerRole, isValidatorRole } from "./roles.ts";
import type { CognitiveValidatorCommandLockOptions } from "./types.ts";

const inferRole = (agentId?: string, explicit?: string): string => {
  if (explicit) return explicit;
  if (!agentId) return "";
  const lower = agentId.toLowerCase();
  if (lower.includes("headless")) return "ui-headless-validator";
  if (
    lower.startsWith("validator") ||
    lower.includes("-validator-") ||
    lower.includes("_validator_") ||
    lower.endsWith("validator")
  )
    return "validator";
  if (
    lower.startsWith("critic") ||
    lower.includes("-critic-") ||
    lower.includes("_critic_") ||
    lower.endsWith("critic")
  )
    return "critic";
  if (
    lower.startsWith("implementer") ||
    lower.includes("-implementer-") ||
    lower.includes("_implementer_") ||
    lower.endsWith("implementer")
  )
    return "implementer";
  if (
    lower.startsWith("worker") ||
    lower.includes("-worker-") ||
    lower.includes("_worker_") ||
    lower.endsWith("worker")
  )
    return "worker";
  return "";
};

const auditCommand = (
  agentId: string | undefined,
  role: string | undefined,
  argv: readonly string[],
  cmdText: string,
  recordId: string | undefined,
  event: string | undefined,
  findings: DoctorDiagnosticFinding[],
  auditImplementers: boolean,
): void => {
  const engine = "checkCognitiveValidatorCommandLock",
    prefix = event ? ` in event "${event}"` : "";
  const baseDetail = { agentId, role, command: cmdText, recordId, eventName: event };
  if (isValidatorRole(role ?? "")) {
    findings.push({
      code: "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION",
      severity: "ERROR",
      engine,
      message: `Cognitive Validator Command Hard-Lock breached${prefix}: Agent "${agentId ?? "unknown"}" with role "${role}" executed command: "${cmdText}"`,
      details: baseDetail,
    });
  } else if (auditImplementers && isImplementerRole(role ?? "")) {
    if (isWholeSuite(argv))
      findings.push({
        code: "IMPLEMENTER_COMMAND_LOCK_VIOLATION",
        severity: "ERROR",
        engine,
        message: `Implementer Command Hard-Lock breached${prefix}: Agent "${agentId ?? "unknown"}" with role "${role}" executed whole-suite test command: "${cmdText}". Implementers may only run file-scoped unit tests.`,
        details: { ...baseDetail, reason: "WHOLE_SUITE_TEST_RUN_DENIED" },
      });
    else if (isBadGit(argv))
      findings.push({
        code: "IMPLEMENTER_COMMAND_LOCK_VIOLATION",
        severity: "ERROR",
        engine,
        message: `Implementer Command Hard-Lock breached${prefix}: Agent "${agentId ?? "unknown"}" with role "${role}" executed unauthorized git mutation: "${cmdText}"`,
        details: { ...baseDetail, reason: "UNAUTHORIZED_GIT_MUTATION" },
      });
  }
};

export function checkCognitiveValidatorCommandLock(
  options: CognitiveValidatorCommandLockOptions = {},
): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const roleMap = new Map<string, string>();
  const grants = options.grants ?? (options.state?.grants as readonly unknown[] | undefined);
  if (Array.isArray(grants)) {
    for (const g of grants) {
      if (g && typeof g === "object") {
        const obj = g as Record<string, unknown>;
        const id =
          typeof obj.id === "string"
            ? obj.id
            : typeof obj.agent_id === "string"
              ? obj.agent_id
              : undefined;
        const role = typeof obj.role === "string" ? obj.role : undefined;
        if (id && role) roleMap.set(id, role);
      }
    }
  }
  const agents = options.state?.agents as Record<string, unknown> | undefined;
  if (agents && typeof agents === "object") {
    for (const [id, a] of Object.entries(agents)) {
      if (a && typeof a === "object") {
        const role =
          typeof (a as Record<string, unknown>).role === "string"
            ? ((a as Record<string, unknown>).role as string)
            : undefined;
        if (role) roleMap.set(id, role);
      }
    }
  }
  const resolveRole = (agentId?: string, explicitRole?: string): string => {
    if (explicitRole) return explicitRole;
    if (agentId && roleMap.has(agentId)) return roleMap.get(agentId)!;
    return inferRole(agentId, explicitRole);
  };
  const auditImplementers =
    options.state !== undefined || (Array.isArray(options.events) && options.events.length > 0);
  const rawCommands =
    options.commands ?? (options.state?.commands as Record<string, unknown> | undefined);
  if (rawCommands && typeof rawCommands === "object") {
    const list = Array.isArray(rawCommands) ? rawCommands : Object.values(rawCommands);
    for (const c of list) {
      if (c && typeof c === "object") {
        const cmd = c as Record<string, unknown>;
        const id =
          typeof cmd.agent_id === "string"
            ? cmd.agent_id
            : typeof cmd.actor === "string"
              ? cmd.actor
              : undefined;
        const role = resolveRole(id, typeof cmd.role === "string" ? cmd.role : undefined);
        const argv = parseArgv(cmd);
        const text =
          typeof cmd.command === "string"
            ? cmd.command
            : argv.length > 0
              ? argv.join(" ")
              : typeof cmd.id === "string"
                ? cmd.id
                : "unknown";
        auditCommand(
          id,
          role,
          argv,
          text,
          typeof cmd.id === "string" ? cmd.id : undefined,
          undefined,
          findings,
          auditImplementers,
        );
      }
    }
  }
  if (Array.isArray(options.events)) {
    for (const e of options.events) {
      if (e && typeof e === "object") {
        const evt = e as Record<string, unknown>;
        const eventName =
          typeof evt.name === "string" ? evt.name : typeof evt.type === "string" ? evt.type : "";
        const payload =
          evt.payload && typeof evt.payload === "object"
            ? (evt.payload as Record<string, unknown>)
            : {};
        const id =
          typeof payload.agent_id === "string"
            ? payload.agent_id
            : typeof evt.actor === "string"
              ? evt.actor
              : undefined;
        const role = resolveRole(id, typeof payload.role === "string" ? payload.role : undefined);
        if (
          eventName === "command-executed" ||
          eventName === "command-recorded" ||
          eventName === "test-executed" ||
          eventName === "command"
        ) {
          const argv = parseArgv(payload);
          const text =
            typeof payload.command === "string"
              ? payload.command
              : argv.length > 0
                ? argv.join(" ")
                : eventName;
          auditCommand(
            id,
            role,
            argv,
            text,
            typeof payload.id === "string" ? payload.id : undefined,
            eventName,
            findings,
            true,
          );
        }
      }
    }
  }
  return { engine: "checkCognitiveValidatorCommandLock", passed: findings.length === 0, findings };
}
