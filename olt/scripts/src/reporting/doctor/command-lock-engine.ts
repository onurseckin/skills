import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
  "socratic-validator",
  "socratic_validator",
  "ui-validator",
  "plan-validator",
]);

const IMPLEMENTER_ROLES = new Set([
  "implementer",
  "developer",
  "coder",
  "repairer",
  "worker",
  "sub-implementer",
  "custom-implementer",
]);

const normalizeRole = (role: string): string => role.trim().toLowerCase().replace(/_/gu, "-");

const isValidatorRole = (role: string): boolean => {
  const norm = normalizeRole(role);
  if (norm.includes("mechanic")) return false;
  return (
    BANNED_VALIDATOR_ROLES.has(norm) ||
    BANNED_VALIDATOR_ROLES.has(role.trim().toLowerCase()) ||
    norm.startsWith("validator") ||
    norm.includes("validator") ||
    norm.includes("critic")
  );
};

const isImplementerRole = (role: string): boolean => {
  const norm = normalizeRole(role);
  return (
    IMPLEMENTER_ROLES.has(norm) ||
    norm.startsWith("implementer") ||
    norm.includes("implementer") ||
    norm.includes("worker") ||
    norm.includes("repairer")
  );
};

const isTestFile = (arg: string): boolean => {
  if (arg.startsWith("-")) return false;
  return (
    arg.includes(".test.") ||
    arg.includes(".spec.") ||
    arg.endsWith(".test.ts") ||
    arg.endsWith(".spec.ts") ||
    arg.endsWith(".test.js") ||
    arg.endsWith(".spec.js") ||
    arg.endsWith(".test.tsx") ||
    arg.endsWith(".spec.tsx") ||
    /(\.(test|spec)\.[cm]?[jt]sx?|([/_]test|^test)[^/]*\.py|_test\.py|_spec\.rb)$/iu.test(arg)
  );
};

const isWholeSuite = (argv: readonly string[]): boolean => {
  if (argv.length === 0) return false;
  const f = (argv[0] ?? "").toLowerCase();
  const s = (argv[1] ?? "").toLowerCase();
  if (f === "vitest" || f === "jest" || f === "pytest") return !argv.slice(1).some(isTestFile);
  if (f === "npx" && (s === "vitest" || s === "jest")) return !argv.slice(2).some(isTestFile);
  if (f === "npm" || f === "pnpm" || f === "yarn") {
    if (
      s === "test" ||
      s === "t" ||
      (s === "run" && (argv[2] ?? "").toLowerCase().startsWith("test"))
    ) {
      return !argv.slice(2).some(isTestFile);
    }
  }
  if (f === "bun") {
    if (s === "test") return !argv.slice(2).some(isTestFile);
    if (s === "run" && (argv[2] ?? "").toLowerCase() === "test")
      return !argv.slice(3).some(isTestFile);
  }
  if (f === "bun-test") return !argv.slice(1).some(isTestFile);
  return false;
};

const isBadGit = (argv: readonly string[]): boolean => {
  if (argv.length === 0) return false;
  if ((argv[0] ?? "").toLowerCase() !== "git") return false;
  const sub = (argv[1] ?? "").toLowerCase();
  if (sub === "checkout" || sub === "reset") return true;
  if (sub === "push") {
    const rest = argv.slice(2);
    return rest.includes("--force") || rest.includes("-f") || rest.includes("--force-with-lease");
  }
  if (sub === "clean") {
    const rest = argv.slice(2);
    return (
      rest.includes("-f") ||
      rest.includes("-fd") ||
      rest.includes("-fx") ||
      rest.includes("-fxd") ||
      rest.includes("-df") ||
      rest.includes("--force") ||
      rest.some((a) => a.startsWith("-") && a.includes("f"))
    );
  }
  return false;
};

const parseArgv = (entry: Record<string, unknown>): readonly string[] => {
  if (Array.isArray(entry.argv) && entry.argv.every((a) => typeof a === "string"))
    return entry.argv as string[];
  if (typeof entry.command === "string")
    return entry.command
      .trim()
      .split(/\s+/u)
      .filter((s) => s.length > 0);
  if (typeof entry.id === "string")
    return entry.id
      .trim()
      .split(/\s+/u)
      .filter((s) => s.length > 0);
  return [];
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
  const engine = "checkCognitiveValidatorCommandLock";
  const prefix = event ? ` in event "${event}"` : "";
  if (isValidatorRole(role ?? "")) {
    findings.push({
      code: "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION",
      severity: "ERROR",
      engine,
      message: `Cognitive Validator Command Hard-Lock breached${prefix}: Agent "${agentId ?? "unknown"}" with role "${role}" executed command: "${cmdText}"`,
      details: { agentId, role, command: cmdText, recordId, eventName: event },
    });
  } else if (auditImplementers && isImplementerRole(role ?? "")) {
    if (isWholeSuite(argv)) {
      findings.push({
        code: "IMPLEMENTER_COMMAND_LOCK_VIOLATION",
        severity: "ERROR",
        engine,
        message: `Implementer Command Hard-Lock breached${prefix}: Agent "${agentId ?? "unknown"}" with role "${role}" executed whole-suite test command: "${cmdText}". Implementers may only run file-scoped unit tests.`,
        details: {
          agentId,
          role,
          command: cmdText,
          recordId,
          eventName: event,
          reason: "WHOLE_SUITE_TEST_RUN_DENIED",
        },
      });
    } else if (isBadGit(argv)) {
      findings.push({
        code: "IMPLEMENTER_COMMAND_LOCK_VIOLATION",
        severity: "ERROR",
        engine,
        message: `Implementer Command Hard-Lock breached${prefix}: Agent "${agentId ?? "unknown"}" with role "${role}" executed unauthorized git mutation: "${cmdText}"`,
        details: {
          agentId,
          role,
          command: cmdText,
          recordId,
          eventName: event,
          reason: "UNAUTHORIZED_GIT_MUTATION",
        },
      });
    }
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
  const inferRole = (agentId?: string, explicit?: string): string => {
    if (explicit) return explicit;
    if (!agentId) return "";
    if (roleMap.has(agentId)) return roleMap.get(agentId)!;
    const lower = agentId.toLowerCase();
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
        const role = inferRole(id, typeof cmd.role === "string" ? cmd.role : undefined);
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
        const role = inferRole(id, typeof payload.role === "string" ? payload.role : undefined);
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

function processCapsuleDirectory(
  capDir: string,
  findings: DoctorDiagnosticFinding[],
  capsuleName?: string,
): void {
  const name = capsuleName ?? capDir;
  const statePath = join(capDir, "state.json");
  const eventsPath = join(capDir, "events.jsonl");
  let state: Record<string, unknown> | null = null;
  const events: unknown[] = [];
  if (existsSync(statePath)) {
    try {
      state = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
    } catch {
      findings.push({
        code: "COMMAND_LOCK_STATE_CORRUPT",
        severity: "ERROR",
        engine: "checkCommandLockIntegrity",
        message: `Corrupted state.json in capsule ${name}`,
        details: { capsule: name, statePath },
      });
    }
  }
  if (existsSync(eventsPath)) {
    try {
      for (const line of readFileSync(eventsPath, "utf-8").split("\n")) {
        if (line.trim().length > 0) events.push(JSON.parse(line));
      }
    } catch {}
  }
  if (state || events.length > 0) {
    findings.push(...checkCognitiveValidatorCommandLock({ state, events }).findings);
  }
}

export function checkCommandLockIntegrity(oltDir: string): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const baseDir = existsSync(oltDir) ? oltDir : join(process.cwd(), oltDir);
  const directState = join(baseDir, "state.json");
  const directEvents = join(baseDir, "events.jsonl");
  if (existsSync(directState) || existsSync(directEvents)) {
    processCapsuleDirectory(baseDir, findings);
    return {
      engine: "checkCommandLockIntegrity",
      passed: findings.filter((f) => f.severity === "ERROR").length === 0,
      findings,
    };
  }
  const capsulesDir = existsSync(join(baseDir, "capsules"))
    ? join(baseDir, "capsules")
    : existsSync(join(baseDir, ".olt", "capsules"))
      ? join(baseDir, ".olt", "capsules")
      : existsSync(join(baseDir, ".capsules"))
        ? join(baseDir, ".capsules")
        : existsSync(baseDir) && (baseDir.endsWith("capsules") || baseDir.endsWith(".capsules"))
          ? baseDir
          : join(baseDir, "capsules");
  if (existsSync(capsulesDir)) {
    try {
      for (const entry of readdirSync(capsulesDir)) {
        const capDir = join(capsulesDir, entry);
        try {
          if (!statSync(capDir).isDirectory()) continue;
          processCapsuleDirectory(capDir, findings, entry);
        } catch {}
      }
    } catch {}
  }
  return {
    engine: "checkCommandLockIntegrity",
    passed: findings.filter((f) => f.severity === "ERROR").length === 0,
    findings,
  };
}
