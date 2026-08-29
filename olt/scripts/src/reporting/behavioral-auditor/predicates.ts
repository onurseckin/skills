/**
 * Behavioral Auditor Predicates & Role Resolvers
 */
import { isAgentRole, isJsonObject, type JsonObject } from "../../core/contracts/index.ts";
import type { BehavioralFinding } from "./types.ts";

export function boundedEvidenceCause(error: unknown): string {
  if (typeof error === "string") return error.slice(0, 240);
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint" ||
    typeof error === "symbol" ||
    error === null ||
    error === undefined
  ) {
    return String(error).slice(0, 240);
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
      return descriptor.value.slice(0, 240);
    }
  } catch {}
  return "unknown error";
}

export function evidenceUnavailable(error: unknown): BehavioralFinding {
  return {
    agent_id: "system",
    role: "auditor",
    violation_type: "behavioral_evidence_unavailable",
    severity: "critical",
    observation: `Behavioral evidence is unavailable: ${boundedEvidenceCause(error)}`,
    remediation: "Restore a valid claimed capsule and rerun the behavioral audit.",
  };
}

export function isCoordinatorRole(role: string): boolean {
  return role === "coordinator" || role.startsWith("coordinator-");
}

export function isOrchestratorRole(role: string): boolean {
  return role === "orchestrator";
}

export function isImplementerRole(role: string): boolean {
  return (
    role === "implementer" || role === "repairer" || role === "sub-implementer" || role === "worker"
  );
}

export function isValidatorRole(role: string): boolean {
  return (
    role === "validator" ||
    role === "sub-validator" ||
    role === "plan-validator" ||
    role === "completeness-critic" ||
    role === "mind-auditor"
  );
}

export function isSubagentRole(role: string): boolean {
  return (
    role === "coordinator" ||
    role.startsWith("coordinator-") ||
    role === "orchestrator" ||
    role === "implementer" ||
    role === "repairer" ||
    role === "sub-implementer" ||
    role === "validator" ||
    role === "sub-validator" ||
    role === "plan-validator" ||
    role === "planner" ||
    role === "completeness-critic" ||
    role === "mind-auditor" ||
    role === "sub-investigator"
  );
}

export function inferRole(
  actorId: string,
  roleMap: Map<string, string>,
  state: JsonObject,
): string {
  if (roleMap.has(actorId)) return roleMap.get(actorId)!;
  if (isAgentRole(actorId)) return actorId;

  const packets = state.packets;
  if (isJsonObject(packets)) {
    for (const packet of Object.values(packets)) {
      if (isJsonObject(packet) && packet.agent_id === actorId && typeof packet.role === "string") {
        return packet.role;
      }
    }
  }

  const tasks = state.tasks;
  if (isJsonObject(tasks)) {
    for (const task of Object.values(tasks)) {
      if (!isJsonObject(task)) continue;
      const lease = task.lease;
      if (isJsonObject(lease) && lease.agent_id === actorId && typeof lease.role === "string") {
        return lease.role;
      }
      const attempts = task.attempts;
      if (Array.isArray(attempts)) {
        for (const attempt of attempts) {
          if (
            isJsonObject(attempt) &&
            attempt.agent_id === actorId &&
            typeof attempt.role === "string"
          ) {
            return attempt.role;
          }
        }
      }
    }
  }

  if (/^coord/i.test(actorId)) return "coordinator";
  if (/^orch/i.test(actorId)) return "orchestrator";
  if (/^(impl|repair|worker)/i.test(actorId)) return "implementer";
  if (/^(val|critic|audit)/i.test(actorId)) return "validator";
  if (/^plan/i.test(actorId)) return "planner";

  return "unknown";
}

export function isFullTestSuiteCommand(argv: readonly string[]): boolean {
  if (!argv || argv.length === 0) return false;
  const joined = argv.join(" ").trim();
  const lowerJoined = joined.toLowerCase();

  if (
    lowerJoined === "bun test" ||
    lowerJoined === "bun run test" ||
    lowerJoined === "bun run test:unit" ||
    lowerJoined === "bun test:unit" ||
    lowerJoined.includes("test --coverage") ||
    lowerJoined.includes("run test:unit") ||
    lowerJoined === "npm test" ||
    lowerJoined === "npm run test" ||
    lowerJoined === "npm run test:unit" ||
    lowerJoined === "yarn test" ||
    lowerJoined === "yarn test:unit" ||
    lowerJoined === "pnpm test" ||
    lowerJoined === "pnpm test:unit" ||
    lowerJoined === "pytest" ||
    lowerJoined === "vitest" ||
    lowerJoined === "cargo test" ||
    lowerJoined === "go test ./..."
  ) {
    return true;
  }

  const isTestRunner =
    (argv[0] === "bun" && argv[1] === "test") ||
    (argv[0] === "bun" &&
      argv[1] === "run" &&
      typeof argv[2] === "string" &&
      argv[2].startsWith("test")) ||
    (argv[0] === "npm" &&
      (argv[1] === "test" ||
        (argv[1] === "run" && typeof argv[2] === "string" && argv[2].startsWith("test")))) ||
    (argv[0] === "yarn" && (argv[1] === "test" || argv[1] === "test:unit")) ||
    (argv[0] === "pnpm" && (argv[1] === "test" || argv[1] === "test:unit")) ||
    argv[0] === "pytest" ||
    argv[0] === "vitest" ||
    argv[0] === "jest";

  if (isTestRunner) {
    const hasSingleTestFile = argv.some(
      (arg) =>
        !arg.startsWith("-") &&
        /(\.(test|spec)\.[cm]?[jt]sx?|([/_]test|^test)[^/]*\.py|_test\.py|_spec\.rb)$/i.test(arg),
    );
    if (!hasSingleTestFile) {
      return true;
    }
  }

  return false;
}
