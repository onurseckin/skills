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

  // Cognitive Validators: Hard-lock matches everything (0 commands allowed)
  if (
    normalizedRole === "validator" ||
    normalizedRole === "cognitive-validator" ||
    normalizedRole === "cognitive_validator" ||
    normalizedRole.startsWith("validator-") ||
    normalizedRole === "critic" ||
    normalizedRole === "completeness-critic" ||
    normalizedRole === "completeness_critic" ||
    normalizedRole === "planner" ||
    normalizedRole === "plan-validator" ||
    normalizedRole === "plan_validator" ||
    normalizedRole === "sub-investigator" ||
    normalizedRole === "sub_investigator"
  ) {
    patterns = [/.*/];
  }

  // Supervisors
  else if (
    normalizedRole === "mind" ||
    normalizedRole === "orchestrator" ||
    normalizedRole === "coordinator" ||
    normalizedRole === "skill-auditor" ||
    normalizedRole === "skill_auditor" ||
    normalizedRole === "meta-auditor" ||
    normalizedRole === "meta_auditor" ||
    normalizedRole === "mind-auditor" ||
    normalizedRole === "mind_auditor"
  ) {
    const supervisorPatterns = [...STATIC_SUPERVISOR_FORBIDDEN_PATTERNS];
    if (policy?.forbidden_commands) {
      for (const cmd of policy.forbidden_commands) {
        supervisorPatterns.push(new RegExp(`^${escapeRegex(cmd)}`, "i"));
      }
    }
    patterns = supervisorPatterns;
  }

  // Mechanic Validators: Can run typechecks, AST static audits, tests; cannot mutate git or source files
  else if (
    normalizedRole === "mechanic-validator" ||
    normalizedRole === "mechanic_validator" ||
    normalizedRole === "sub-validator" ||
    normalizedRole === "sub_validator"
  ) {
    patterns = [
      /^git\s+(commit|push|reset|checkout(\s+-b)?|merge|rebase)/i,
      ...CODE_EDIT_TOOL_PATTERNS,
      /^bun\s+harness.*task:review/i,
      /^bun\s+harness.*run:complete/i,
    ];
  }

  // Implementers / Repairers / Workers
  else {
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
