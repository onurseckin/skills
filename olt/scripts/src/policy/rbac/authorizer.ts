import type { AgentMetadata } from "../../runtime/index.ts";
import type { RepoPolicy } from "../types/index.ts";
import { analyzeCommandDispatch, inspectGitDispatch } from "./command-dispatch.ts";
import type { AuthorizationResult } from "./constants.ts";
import { compileEffectiveForbiddenPatterns } from "./pattern-compiler.ts";
import { hasUnshieldedSubshellOrChaining } from "./subshell-check.ts";
import { isKnownTestRunner, isUntargetedTestCommand } from "./test-runners.ts";

function inferRoleCanExecuteShell(_role: string): boolean {
  return true;
}

const RECOGNIZED_ROLES = new Set([
  "owner",
  "mind",
  "mind_supervisor",
  "mind-supervisor",
  "mind_auditor",
  "mind-auditor",
  "skill_auditor",
  "skill-auditor",
  "meta-auditor",
  "meta_auditor",
  "orchestrator",
  "coordinator",
  "autonomic_watchdog",
  "autonomic-watchdog",
  "watchdog",
  "planner",
  "independent-planner",
  "human",
  "validator",
  "cognitive-validator",
  "cognitive_validator",
  "critic",
  "completeness-critic",
  "completeness_critic",
  "plan-validator",
  "plan_validator",
  "sub-investigator",
  "sub_investigator",
  "mechanic-validator",
  "mechanic_validator",
  "sub-validator",
  "sub_validator",
  "implementer",
  "worker",
  "repairer",
  "sub-task-worker",
  "sub_task_worker",
  "agent",
]);

function isRecognizedRole(role: string): boolean {
  const norm = role.trim().toLowerCase();
  if (
    norm === "" ||
    norm === "unresolved" ||
    norm.startsWith("unregistered") ||
    norm.startsWith("unknown") ||
    norm === "anonymous" ||
    norm === "intruder" ||
    norm === "guest"
  ) {
    return false;
  }
  if (RECOGNIZED_ROLES.has(norm)) return true;
  if (norm.startsWith("validator-") || norm.startsWith("validator_")) return true;
  if (norm.startsWith("implementer-") || norm.startsWith("implementer_")) return true;
  return false;
}

export type ActorInput =
  | AgentMetadata
  | {
      readonly role?: string | undefined;
      readonly agent_id?: string | undefined;
      readonly actor_id?: string | undefined;
      readonly can_execute_shell?: boolean | undefined;
    }
  | null
  | undefined;

export function verifyCommandAuthorization(
  actor: ActorInput,
  command: string | readonly string[],
  policy?: RepoPolicy,
): AuthorizationResult {
  if (
    !actor ||
    typeof actor.role !== "string" ||
    actor.role.trim() === "" ||
    !isRecognizedRole(actor.role)
  ) {
    return {
      authorized: false,
      error_code: "PERMISSION_DENIED",
      reason: "Unresolved actor role",
      message: "[PERMISSION_DENIED] Unresolved actor role is not authorized to execute commands.",
    };
  }

  const role = actor.role.trim();
  const normalizedRole = role.toLowerCase();
  const roleCanExecute = inferRoleCanExecuteShell(role);
  const canExecute = !roleCanExecute
    ? false
    : "can_execute_shell" in actor && typeof actor.can_execute_shell === "boolean"
      ? actor.can_execute_shell
      : true;

  const commandStr = typeof command === "string" ? command.trim() : command.join(" ").trim();
  const rawArgv = typeof command === "string" ? command.trim().split(/\s+/) : command;
  const dispatch = analyzeCommandDispatch(rawArgv);
  if (dispatch.denialReason) {
    return {
      authorized: false,
      error_code: "UNSHIELDED_COMMAND_DEFECT",
      reason: dispatch.denialReason,
      message:
        `[UNSHIELDED_COMMAND_DEFECT] Command dispatch could not be safely normalized: '${commandStr}'.\n` +
        `Wrappers and ambiguous command forms are prohibited unless their nested argv is fully parsed and authorized.`,
    };
  }
  const argv = dispatch.tokens;
  const normalizedCommandStr = argv.join(" ");
  const activePolicy = policy;

  const isCognitiveValidator =
    normalizedRole === "validator" ||
    normalizedRole === "cognitive-validator" ||
    normalizedRole === "cognitive_validator" ||
    normalizedRole.startsWith("validator-") ||
    normalizedRole === "plan-validator" ||
    normalizedRole === "plan_validator" ||
    normalizedRole === "sub-investigator" ||
    normalizedRole === "sub_investigator";

  const isSupervisor =
    normalizedRole === "mind" ||
    normalizedRole === "orchestrator" ||
    normalizedRole === "coordinator" ||
    normalizedRole === "skill-auditor" ||
    normalizedRole === "skill_auditor" ||
    normalizedRole === "meta-auditor" ||
    normalizedRole === "meta_auditor" ||
    normalizedRole === "mind-auditor" ||
    normalizedRole === "mind_auditor";

  const subshellCheck = hasUnshieldedSubshellOrChaining(normalizedCommandStr, argv);
  if (subshellCheck.detected) {
    return {
      authorized: false,
      error_code: "UNSHIELDED_COMMAND_DEFECT",
      reason: subshellCheck.reason,
      message:
        `[UNSHIELDED_COMMAND_DEFECT] Direct subshell invocation, evaluator, or command chaining blocked: '${commandStr}'.\n` +
        `All commands must be executed as direct argv arrays via: 'bun harness.ts shell --actor <agent_id> -- <command>'.\n` +
        `Subshells ('sh -c', 'bash -c', 'eval') and command chaining ('&&', '||', ';', '|') are strictly prohibited.`,
    };
  }

  const isTestCommand = isKnownTestRunner(argv) || /\.(test|spec)\.[a-z0-9]+$/i.test(argv[0] ?? "");
  if ((isSupervisor || isCognitiveValidator) && isTestCommand) {
    return {
      authorized: false,
      error_code: "SUPERVISOR_TEST_EXECUTION_FORBIDDEN",
      reason: `Supervisors and validators cannot run tests: '${commandStr}'`,
      message: `[SUPERVISOR_TEST_EXECUTION_FORBIDDEN] Supervisory and validator roles are mechanically blocked from running test commands.`,
    };
  }

  if (!canExecute) {
    return {
      authorized: false,
      error_code: "PERMISSION_DENIED",
      reason: `Role '${role}' has 'can_execute_shell: false'`,
      message:
        `[PERMISSION_DENIED] Role '${role}' has 'can_execute_shell: false'.\n` +
        `This role is strictly prohibited from running commands.`,
    };
  }

  if (isUntargetedTestCommand(normalizedCommandStr, argv, activePolicy)) {
    const targetedExample = activePolicy?.test_runner?.targeted_pattern ?? "bun test <path>";
    return {
      authorized: false,
      error_code: "UNBOUNDED_TEST_RUNNER_FORBIDDEN",
      reason: `Un-targeted whole-repo test run detected: '${commandStr}'`,
      message:
        `[UNBOUNDED_TEST_RUNNER_FORBIDDEN] Un-targeted whole-repo test run detected: '${commandStr}'.\n` +
        `Implementers are forbidden from running full test suites.\n` +
        `You must pass a targeted file argument matching: '${targetedExample}'.`,
    };
  }

  const gitCheck = inspectGitDispatch(argv);
  if (gitCheck) {
    return {
      authorized: false,
      error_code: gitCheck.errorCode,
      reason: gitCheck.reason,
      message: `[${gitCheck.errorCode}] Command '${commandStr}' is prohibited for role '${role}': ${gitCheck.reason}`,
    };
  }

  const forbiddenPatterns = compileEffectiveForbiddenPatterns(role, activePolicy);
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(normalizedCommandStr)) {
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
