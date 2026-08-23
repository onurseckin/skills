import type { AgentMetadata } from "../runtime/agent-metadata.ts";
import { inferCanExecuteShell } from "../runtime/agent-metadata.ts";
import type { RepoPolicy } from "./repo-policy.ts";
import { loadRepoPolicy } from "./repo-policy.ts";

export interface AuthorizationResult {
  readonly authorized: boolean;
  readonly error_code?:
    | "PERMISSION_DENIED"
    | "INVALID_SCOPE"
    | "UNSHIELDED_COMMAND_BLUNDER"
    | string
    | undefined;
  readonly reason?: string | undefined;
  readonly message?: string | undefined;
}

export const STATIC_SUPERVISOR_FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /^git\s+(commit|push|reset|checkout\s+-b|merge|rebase)/i,
  /write_to_file/i,
  /replace_file/i,
  /^bun\s+test(\s+)?$/i,
  /^npm\s+test(\s+)?$/i,
  /^vitest(\s+)?$/i,
  /^pytest(\s+)?$/i,
  /^cargo\s+test(\s+)?$/i,
];

export const STATIC_IMPLEMENTER_FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /^git\s+(commit|push|reset|checkout(\s+-b)?|rebase|merge)/i,
  /^bun\s+harness.*task:review/i,
  /^bun\s+harness.*run:complete/i,
  /^bun\s+harness.*mind:/i,
];

export const UNTARGETED_TEST_PATTERNS: readonly RegExp[] = [
  /^npm\s+test(\s+)?$/i,
  /^bun\s+test(\s+)?$/i,
  /^vitest(\s+)?$/i,
  /^pytest(\s+)?$/i,
  /^cargo\s+test(\s+)?$/i,
  /^pnpm\s+test(\s+)?$/i,
  /^yarn\s+test(\s+)?$/i,
  /^python\s+-m\s+pytest(\s+)?$/i,
];

export function compileEffectiveForbiddenPatterns(role: string, policy?: RepoPolicy): RegExp[] {
  const normalizedRole = role.trim().toLowerCase();
  const activePolicy = policy ?? loadRepoPolicy();

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
    return [/.*/];
  }

  // Supervisors
  if (
    normalizedRole === "mind" ||
    normalizedRole === "orchestrator" ||
    normalizedRole === "coordinator" ||
    normalizedRole === "meta-auditor" ||
    normalizedRole === "meta_auditor" ||
    normalizedRole === "mind-auditor" ||
    normalizedRole === "mind_auditor"
  ) {
    const supervisorPatterns = [...STATIC_SUPERVISOR_FORBIDDEN_PATTERNS];
    if (activePolicy.forbidden_commands) {
      for (const cmd of activePolicy.forbidden_commands) {
        supervisorPatterns.push(new RegExp(`^${escapeRegex(cmd)}`, "i"));
      }
    }
    return supervisorPatterns;
  }

  // Mechanic Validators: Can run typechecks, AST static audits, tests; cannot mutate git or source files
  if (
    normalizedRole === "mechanic-validator" ||
    normalizedRole === "mechanic_validator" ||
    normalizedRole === "sub-validator" ||
    normalizedRole === "sub_validator"
  ) {
    return [
      /^git\s+(commit|push|reset|checkout(\s+-b)?|merge|rebase)/i,
      /write_to_file/i,
      /replace_file/i,
      /^bun\s+harness.*task:review/i,
      /^bun\s+harness.*run:complete/i,
    ];
  }

  // Implementers / Repairers / Workers
  const implementerPatterns: RegExp[] = [
    ...STATIC_IMPLEMENTER_FORBIDDEN_PATTERNS,
    ...UNTARGETED_TEST_PATTERNS,
  ];

  // Dynamic injections from repository policy
  if (activePolicy.test_runner) {
    const fullCmd = activePolicy.test_runner.full_suite_command.trim();
    if (fullCmd) {
      implementerPatterns.push(new RegExp(`^${escapeRegex(fullCmd)}(\\s+)?$`, "i"));
    }
  }

  if (activePolicy.forbidden_commands) {
    for (const cmd of activePolicy.forbidden_commands) {
      implementerPatterns.push(new RegExp(`^${escapeRegex(cmd)}`, "i"));
    }
  }

  return implementerPatterns;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isUntargetedTestCommand(commandStr: string): boolean {
  const trimmed = commandStr.trim();
  for (const pattern of UNTARGETED_TEST_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  return false;
}

export function verifyCommandAuthorization(
  actor:
    | AgentMetadata
    | {
        readonly role: string;
        readonly agent_id?: string | undefined;
        readonly actor_id?: string | undefined;
        readonly can_execute_shell?: boolean | undefined;
      },
  command: string | readonly string[],
  policy?: RepoPolicy,
): AuthorizationResult {
  const role = actor.role.trim();
  const canExecute =
    "can_execute_shell" in actor && typeof actor.can_execute_shell === "boolean"
      ? actor.can_execute_shell
      : inferCanExecuteShell(role);

  const commandStr = typeof command === "string" ? command.trim() : command.join(" ").trim();
  const activePolicy = policy ?? loadRepoPolicy();

  if (!canExecute) {
    return {
      authorized: false,
      error_code: "PERMISSION_DENIED",
      reason: `Role '${role}' has 'can_execute_shell: false'`,
      message:
        `[PERMISSION_DENIED] Role '${role}' has 'can_execute_shell: false'.\n` +
        `Cognitive Validators are strictly prohibited from running commands.\n` +
        `Focus exclusively on Socratic diff review and logic critique.`,
    };
  }

  const forbiddenPatterns = compileEffectiveForbiddenPatterns(role, activePolicy);

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(commandStr)) {
      if (isUntargetedTestCommand(commandStr)) {
        const targetedExample = activePolicy.test_runner?.targeted_pattern ?? "bun test <path>";
        return {
          authorized: false,
          error_code: "INVALID_SCOPE",
          reason: `Un-targeted whole-repo test run detected: '${commandStr}'`,
          message:
            `[INVALID_SCOPE] Un-targeted whole-repo test run detected: '${commandStr}'.\n` +
            `Implementers are forbidden from running full test suites.\n` +
            `You must pass a targeted file argument matching: '${targetedExample}'.`,
        };
      }

      return {
        authorized: false,
        error_code: "PERMISSION_DENIED",
        reason: `Command matched forbidden pattern: ${pattern.toString()}`,
        message: `[PERMISSION_DENIED] Command '${commandStr}' is prohibited for role '${role}'.`,
      };
    }
  }

  return { authorized: true };
}
