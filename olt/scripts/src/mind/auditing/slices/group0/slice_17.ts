import { basename, dirname, join, resolve } from "node:path";
import { isMindRole } from "./slice_16.ts";
export { isMindRole };
export function isOrchestratorRole(role: string): boolean {
  const r = role.toLowerCase().trim();
  return (
    r === "orchestrator" ||
    r.startsWith("orchestrator-") ||
    r.startsWith("orch-") ||
    r.includes("orchestrator")
  );
}

export function isCoordinatorRole(role: string): boolean {
  const r = role.toLowerCase().trim();
  return (
    r === "coordinator" ||
    r.startsWith("coordinator-") ||
    r.startsWith("coord-") ||
    r.includes("coordinator")
  );
}

export function isImplementerRole(role: string): boolean {
  const r = role.toLowerCase().trim();
  return (
    r === "implementer" ||
    r === "repairer" ||
    r === "sub-implementer" ||
    r === "worker" ||
    r.startsWith("impl-") ||
    r.includes("implementer")
  );
}

export function isValidatorRole(role: string): boolean {
  const r = role.toLowerCase().trim();
  return (
    r === "validator" ||
    r === "sub-validator" ||
    r === "plan-validator" ||
    r === "completeness-critic" ||
    r === "mind-auditor" ||
    r.includes("validator") ||
    r.includes("critic")
  );
}

export function isMechanicValidatorRole(role: string): boolean {
  const normalized = role.toLowerCase().trim();
  return (
    normalized === "mechanic-validator" ||
    normalized === "ui-mechanic-validator" ||
    normalized === "mechanic_validator" ||
    normalized.startsWith("mechanic-") ||
    normalized.endsWith("-mechanic-validator")
  );
}

export function isCognitiveValidatorRole(role: string): boolean {
  const normalized = role.toLowerCase().trim();
  if (isMechanicValidatorRole(normalized)) return false;
  return (
    normalized === "validator" ||
    normalized === "ui-validator" ||
    normalized.startsWith("validator-")
  );
}

export const PROHIBITED_COGNITIVE_TOOL_CATEGORIES: ReadonlySet<string> = new Set([
  "shell",
  "test-runner",
  "build",
  "package-manager",
  "bash",
  "terminal",
  "exec",
]);

export const PROHIBITED_COGNITIVE_TOOLS: ReadonlySet<string> = new Set([
  "run_command",
  "bash",
  "sh",
  "zsh",
  "exec",
  "terminal",
  "test_runner",
  "bun_test",
  "npm_test",
]);

export function roleToTier(role: string): number {
  if (isMindRole(role)) return 0;
  if (isOrchestratorRole(role)) return 1;
  if (isCoordinatorRole(role)) return 2;
  return 3;
}

export function isFullTestSuiteCommand(argv: readonly string[]): boolean {
  if (!argv || argv.length === 0) return false;
  const joined = argv.join(" ").trim().toLowerCase();

  if (
    joined === "bun test" ||
    joined === "bun run test" ||
    joined === "bun run test:unit" ||
    joined === "bun test:unit" ||
    joined.includes("test --coverage") ||
    joined.includes("run test:unit") ||
    joined === "npm test" ||
    joined === "npm run test" ||
    joined === "npm run test:unit" ||
    joined === "yarn test" ||
    joined === "yarn test:unit" ||
    joined === "pnpm test" ||
    joined === "pnpm test:unit" ||
    joined === "pytest" ||
    joined === "vitest" ||
    joined === "cargo test" ||
    joined === "go test ./..."
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

export type ZeroToleranceBoundaryInvariant =
  | "0_coordinator_code_writing"
  | "0_orchestrator_task_implementation"
  | "0_unassigned_test_running"
  | "anti_boundary_leak"
  | "spawning_hierarchy"
  | "command_authorization"
  | "validator_hardlock";

export type RoleBoundaryViolationType =
  | "coordinator_code_writing"
  | "orchestrator_direct_implementation"
  | "unassigned_test_running"
  | "anti_boundary_leak"
  | "cross_tier_spawning"
  | "leaf_spawning"
  | "supervisory_task_claim"
  | "forbidden_command_execution"
  | "role_confinement_violation"
  | "validator_hardlock_violation";

export interface RoleBoundaryAction {
  readonly agentId: string;
  readonly role: string;
  readonly tier?: number | undefined;
  readonly actionType:
    | "tool_use"
    | "command_exec"
    | "task_lease"
    | "task_submit"
    | "test_run"
    | "file_write"
    | "graph_mutation"
    | "spawning";
  readonly toolName?: string | undefined;
  readonly toolCategory?: string | undefined;
  readonly argv?: readonly string[] | undefined;
  readonly taskId?: string | undefined;
  readonly assignedTaskId?: string | undefined;
  readonly assignedTestFiles?: readonly string[] | undefined;
  readonly assignedWriteScope?: readonly string[] | undefined;
  readonly targetFile?: string | undefined;
  readonly targetRole?: string | undefined;
  readonly targetTier?: number | undefined;
  readonly timestamp?: string | undefined;
  readonly context?: Readonly<Record<string, unknown>> | undefined;
}

export interface RoleBoundaryViolation {
  readonly id: string;
  readonly invariant: ZeroToleranceBoundaryInvariant;
  readonly violationType: RoleBoundaryViolationType;
  readonly severity: RoleAuditSeverity;
  readonly agentId: string;
  readonly role: string;
  readonly tier: number;
  readonly title: string;
  readonly observation: string;
  readonly remediation: string;
  readonly action: RoleBoundaryAction;
  readonly timestamp: string;
  readonly defectEntry?: DefectEntry | undefined;
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface RoleBoundaryWatchdogOptions {
  readonly strictZeroTolerance?: boolean | undefined;
  readonly autoLogDefect?: boolean | undefined;
  readonly capsuleRoot?: string | undefined;
  readonly defectLogger?: ((violation: RoleBoundaryViolation) => DefectEntry | void) | undefined;
  readonly onViolation?: ((violation: RoleBoundaryViolation) => void) | undefined;
  readonly allowedTaskTests?: ReadonlyMap<string, readonly string[]> | undefined;
}

export interface RoleBoundaryAuditResult {
  readonly valid: boolean;
  readonly violations: readonly RoleBoundaryViolation[];
  readonly actionsAuditedCount: number;
  readonly summary: string;
}