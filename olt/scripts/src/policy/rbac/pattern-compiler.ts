import type { RepoPolicy } from "../types/index.ts";
import {
  CODE_EDIT_TOOL_PATTERNS,
  escapeRegex,
  STATIC_IMPLEMENTER_FORBIDDEN_PATTERNS,
  STATIC_SUPERVISOR_FORBIDDEN_PATTERNS,
} from "./constants.ts";

const regexCache = new Map<string, RegExp[]>();

export function compileEffectiveForbiddenPatterns(role: string, policy?: RepoPolicy): RegExp[] {
  const normalizedRole = role.trim().toLowerCase();
  const forbiddenCommands = policy?.forbidden_commands ?? [];
  const forbiddenCommandsStr = forbiddenCommands.join(",");
  const cacheKey = `${normalizedRole}:${forbiddenCommandsStr}`;

  if (regexCache.has(cacheKey)) {
    return regexCache.get(cacheKey)!;
  }

  let patterns: RegExp[];

  const isValidator =
    normalizedRole === "validator" ||
    normalizedRole === "cognitive-validator" ||
    normalizedRole === "cognitive_validator" ||
    normalizedRole.startsWith("validator-") ||
    normalizedRole.startsWith("validator_") ||
    normalizedRole === "critic" ||
    normalizedRole === "completeness-critic" ||
    normalizedRole === "completeness_critic" ||
    normalizedRole === "planner" ||
    normalizedRole === "plan-validator" ||
    normalizedRole === "plan_validator" ||
    normalizedRole === "sub-investigator" ||
    normalizedRole === "sub_investigator" ||
    normalizedRole === "sub-validator" ||
    normalizedRole === "sub_validator" ||
    normalizedRole === "ui-validator" ||
    normalizedRole === "ui_validator" ||
    normalizedRole === "mechanic-validator" ||
    normalizedRole === "mechanic_validator" ||
    normalizedRole === "ui-mechanic-validator" ||
    normalizedRole === "ui_mechanic_validator";

  const isSupervisor =
    normalizedRole === "mind" ||
    normalizedRole === "mind_supervisor" ||
    normalizedRole === "mind-supervisor" ||
    normalizedRole === "orchestrator" ||
    normalizedRole === "coordinator" ||
    normalizedRole === "skill-auditor" ||
    normalizedRole === "skill_auditor" ||
    normalizedRole === "meta-auditor" ||
    normalizedRole === "meta_auditor" ||
    normalizedRole === "mind-auditor" ||
    normalizedRole === "mind_auditor" ||
    normalizedRole === "autonomic_watchdog" ||
    normalizedRole === "autonomic-watchdog" ||
    normalizedRole === "watchdog";

  if (isValidator || isSupervisor) {
    const supervisorPatterns = [...STATIC_SUPERVISOR_FORBIDDEN_PATTERNS];
    if (policy?.forbidden_commands) {
      for (const cmd of policy.forbidden_commands) {
        supervisorPatterns.push(new RegExp(`^${escapeRegex(cmd)}`, "i"));
      }
    }
    patterns = supervisorPatterns;
  } else {
    const implementerPatterns: RegExp[] = [...STATIC_IMPLEMENTER_FORBIDDEN_PATTERNS];

    if (policy?.forbidden_commands) {
      for (const cmd of policy.forbidden_commands) {
        implementerPatterns.push(new RegExp(`^${escapeRegex(cmd)}`, "i"));
      }
    }
    patterns = implementerPatterns;
  }

  regexCache.set(cacheKey, patterns);
  return patterns;
}
