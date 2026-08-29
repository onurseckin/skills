import { isAgentRole, isJsonObject, type JsonObject } from "../../../core/contracts/index.ts";
import { CODE_EDIT_TOOLS } from "../../../platform/index.ts";
import type { TierConfinementFinding } from "./types.ts";

export const DOCTOR_SUPERVISOR_CODE_CONTAMINATION = "DOCTOR_SUPERVISOR_CODE_CONTAMINATION";

export { CODE_EDIT_TOOLS };

export const GRAPH_MUTATION_COMMANDS: ReadonlySet<string> = new Set([
  "plan:init",
  "plan:enhance",
  "plan:add",
  "plan:compile",
  "plan:apply",
  "plan:replan",
  "plan:claim",
  "mind:init",
  "mind:candidate",
  "mind:admit",
]);

export const VALIDATION_COMMANDS: ReadonlySet<string> = new Set([
  "task:validate-start",
  "task:review",
  "task:probe",
  "task:reject",
  "critic:start",
  "critic:remediate",
  "gate:prove",
  "coordinator:pushback",
]);

export const TERMINAL_PULSE_OUTCOMES: ReadonlySet<string> = new Set([
  "halted",
  "unarmed",
  "stopped",
  "completed",
]);

export function isMindRole(role: string): boolean {
  return role === "mind" || role.startsWith("mind-");
}

export function isCoordinatorRole(role: string): boolean {
  return role === "coordinator" || role.startsWith("coordinator-") || role.startsWith("coord-");
}

export function isOrchestratorRole(role: string): boolean {
  return role === "orchestrator" || role.startsWith("orch-") || role.startsWith("orchestrator-");
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

export function isTier3Role(role: string): boolean {
  return (
    isImplementerRole(role) ||
    isValidatorRole(role) ||
    role === "planner" ||
    role === "sub-investigator"
  );
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

export function isSourceCodeFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase().trim();
  if (normalized.startsWith(".capsules/") || normalized.includes("/.capsules/")) {
    return false;
  }
  if (
    normalized.endsWith(".md") ||
    normalized.endsWith(".json") ||
    normalized.endsWith(".yaml") ||
    normalized.endsWith(".yml") ||
    normalized.endsWith(".txt")
  ) {
    if (
      normalized.includes("/src/") ||
      normalized.includes("scripts/src/") ||
      normalized.endsWith(".ts") ||
      normalized.endsWith(".js")
    ) {
      return true;
    }
    return false;
  }
  return (
    /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|rb|c|cpp|h|hpp|cs|java|kt|swift|scala|sh|bash|zsh)$/i.test(
      normalized,
    ) ||
    normalized.includes("/src/") ||
    normalized.includes("scripts/src/")
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
  if (/^mind/i.test(actorId)) return "mind";

  return "unknown";
}

export function deduplicateFindings(
  findings: readonly TierConfinementFinding[],
): TierConfinementFinding[] {
  const seen = new Set<string>();
  const deduplicated: TierConfinementFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.agent_id}::${finding.violation_type}::${finding.observation}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(finding);
    }
  }
  return deduplicated;
}
