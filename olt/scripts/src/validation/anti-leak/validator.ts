import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot, resolveScratchDir } from "../../core/shared/paths.ts";
import { resolveGlobalSessionsDir } from "../../authority/session/paths.ts";
import { resolveActiveSession } from "../../authority/session/resolver.ts";
import type { SessionIdentity } from "../../authority/session/types.ts";
import type {
  AntiLeakValidationResult,
  BoundaryLeakCheck,
  BoundaryViolation,
  BoundaryViolationType,
} from "./types.ts";
import {
  isCodeMutationAction,
  isCriticOrValidatorAgent,
  isCriticOrValidatorRole,
  isExecutionToolCategory,
  isMechanicValidatorRole,
  isProhibitedValidatorExecutionAction,
  isSupervisorRole,
} from "./checks.ts";

function createViolation(
  type: BoundaryViolationType,
  check: BoundaryLeakCheck,
  taskId: string,
  targetFile: string | undefined,
  observation: string,
  remediation: string,
  extraEvidence?: Readonly<Record<string, unknown>>,
): BoundaryViolation {
  return {
    violation_type: type,
    severity: "critical",
    agent_id: check.agent_id,
    role: check.role,
    task_id: taskId,
    action: check.action,
    target_file: targetFile,
    observation,
    remediation,
    evidence: { task_id: taskId, agent_id: check.agent_id, role: check.role, action: check.action, target_file: targetFile, ...extraEvidence },
  };
}

export function validateBoundaryIntegrity(
  checks: readonly BoundaryLeakCheck[] | BoundaryLeakCheck,
): AntiLeakValidationResult {
  const checkList: readonly BoundaryLeakCheck[] = Array.isArray(checks) ? checks : [checks];
  const violations: BoundaryViolation[] = [];

  for (const check of checkList) {
    const role = check.role.trim().toLowerCase();
    const isCriticOrVal = isCriticOrValidatorRole(role) || isCriticOrValidatorAgent(check.agent_id);
    const isMechanicVal =
      isMechanicValidatorRole(role) || check.agent_id.trim().toLowerCase().includes("mechanic");
    const isSup = isSupervisorRole(role);
    const action = check.action.trim().toLowerCase();
    const taskId =
      typeof check.task_id === "string" && check.task_id.trim() !== ""
        ? check.task_id
        : "unknown-task";
    const targetFile =
      typeof check.target_file === "string" && check.target_file.trim() !== ""
        ? check.target_file
        : check.write_scope && check.write_scope.length > 0
          ? check.write_scope.join(", ")
          : undefined;

    if (isCriticOrVal) {
      if (action === "task:claim" || action === "claim") {
        violations.push(
          createViolation(
            "validator_write_lease",
            check,
            taskId,
            targetFile,
            `Agent '${check.agent_id}' with role '${check.role}' attempted to claim task '${taskId}' in violation of anti-boundary-leak rule.`,
            "Critics and Validators are strictly prohibited from claiming code write leases or editing source files directly. Record findings via task:reject / finding:report and assign a dedicated repairer via task:assign-repairer.",
          ),
        );
      } else if (isCodeMutationAction(action)) {
        const fileDisplay = targetFile && targetFile.length > 0 ? targetFile : "unspecified";
        violations.push(
          createViolation(
            "critic_code_edit",
            check,
            taskId,
            targetFile,
            `Agent '${check.agent_id}' with role '${check.role}' attempted direct code mutation via action '${check.action}' on file '${fileDisplay}'.`,
            "Critics and Validators must not edit code files directly. Delegate code remediation to a designated implementer or repairer.",
          ),
        );
      }

      if (!isMechanicVal) {
        const toolCategory = check.metadata
          ? ((check.metadata["tool_category"] ?? check.metadata["toolCategory"]) as
              | string
              | undefined)
          : undefined;
        const isToolCatProhibited =
          toolCategory !== undefined && isExecutionToolCategory(toolCategory);
        const isExecAction = isProhibitedValidatorExecutionAction(action);

        if (isExecAction || isToolCatProhibited) {
          violations.push(
            createViolation(
              "validator_hardlock_violation",
              check,
              taskId,
              targetFile,
              `Cognitive Validator Hard-Lock Violation: Cognitive Validator/Critic '${check.agent_id}' with role '${check.role}' attempted command execution or test running action '${check.action}'. Cognitive Validators and Critics are strictly locked from running bash, shell commands, test runners, build tools, or package managers.`,
              "Cognitive Validators must evaluate tasks strictly through read-only inspection and artifact review. Test execution authority is strictly reserved for Mechanic Validators (mechanic-validator / ui-mechanic-validator).",
              { metadata: check.metadata },
            ),
          );
        }
      }
    }

    if (isSup && (action === "task:claim" || action === "claim" || isCodeMutationAction(action))) {
      violations.push(
        createViolation(
          "supervisor_code_contamination",
          check,
          taskId,
          targetFile,
          `Supervisory agent '${check.agent_id}' with role '${check.role}' attempted code lease claim / mutation action '${check.action}'.`,
          "Supervisors (Tier 0 Mind, Tier 1 Orchestrator, Tier 2 Coordinator) must delegate execution to Tier 3 Implementers and must never edit code files or claim task leases.",
        ),
      );
    }

    if (
      check.metadata &&
      typeof check.metadata["assigned_repairer"] === "string" &&
      check.metadata["assigned_repairer"] === check.metadata["validator_id"]
    ) {
      violations.push({
        violation_type: "self_repair_violation",
        severity: "critical",
        agent_id: check.agent_id,
        role: check.role,
        task_id: taskId,
        action: check.action,
        target_file: targetFile,
        observation: `Validator '${check.metadata["validator_id"]}' was illegally assigned as repairer for task '${taskId}'.`,
        remediation:
          "A validator who discovers findings must not repair them (anti-boundary-leak rule). Assign a dedicated, separate repairer.",
        evidence: {
          task_id: taskId,
          validator_id: check.metadata["validator_id"],
          assigned_repairer: check.metadata["assigned_repairer"],
        },
      });
    }
  }

  const compliant = violations.length === 0;
  const summary = compliant
    ? `Anti-boundary-leak check passed: 0 violations across ${checkList.length} check(s).`
    : `Anti-boundary-leak violation: detected ${violations.length} boundary leak violation(s).`;
  return { compliant, valid: compliant, violations, summary };
}

export function assertNoBoundaryLeak(
  checks: readonly BoundaryLeakCheck[] | BoundaryLeakCheck,
): void {
  const result = validateBoundaryIntegrity(checks);
  if (!result.valid) {
    const first = result.violations[0];
    const obs =
      first?.observation && first.observation.length > 0
        ? first.observation
        : "Role confinement boundary breached";
    const rem =
      first?.remediation && first.remediation.length > 0
        ? first.remediation
        : "Delegate repair to an assigned implementer/repairer via task:assign-repairer.";
    const details = result.violations.map((v) => ({
      violation_type: v.violation_type,
      agent_id: v.agent_id,
      role: v.role,
      task_id: v.task_id !== undefined ? v.task_id : null,
      observation: v.observation,
      remediation: v.remediation,
    }));
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Anti-boundary-leak rule violation: ${obs}`,
      details,
      3,
      rem,
    );
  }
}

function matchesWriteScope(file: string, scopes: readonly string[]): boolean {
  const normFile = file.replace(/\\/g, "/").replace(/^\.\//, "");
  return scopes.some((scope) => {
    const s = scope.replace(/\\/g, "/").replace(/^\.\//, "");
    if (s === "*" || s === "**" || s === "") return true;
    if (s.endsWith("/")) return normFile.startsWith(s) || normFile === s.slice(0, -1);
    if (s.endsWith("/*") || s.endsWith("/**")) {
      const p = s.replace(/\/\*+$/, "");
      return normFile.startsWith(p + "/") || normFile === p;
    }
    return normFile === s || normFile.startsWith(s + "/");
  });
}

function findSessionByToken(
  token: string,
  file?: string,
  options?: { readonly runRoot?: string; readonly cwd?: string },
): SessionIdentity | null {
  const cur = resolveActiveSession({
    explicitToken: token,
    ...(options?.runRoot ? { runRoot: options.runRoot } : {}),
    ...(options?.cwd ? { cwd: options.cwd } : {}),
  });
  if (cur && cur.token === token) return cur;

  const dirs = new Set<string>();
  if (options?.runRoot) {
    dirs.add(resolveGlobalSessionsDir(options.runRoot));
    dirs.add(join(options.runRoot, ".olt", ".sessions"));
    dirs.add(join(options.runRoot, "runtime", "sessions"));
  }
  if (options?.cwd) {
    dirs.add(resolveGlobalSessionsDir(options.cwd));
    dirs.add(join(options.cwd, ".olt", ".sessions"));
  }
  if (file) {
    try {
      let p = dirname(resolve(file));
      while (p && p !== dirname(p)) {
        const sDir = join(p, ".olt", ".sessions");
        if (existsSync(sDir)) { dirs.add(sDir); break; }
        p = dirname(p);
      }
    } catch {}
  }
  try {
    dirs.add(resolveGlobalSessionsDir());
    dirs.add(resolveGlobalSessionsDir(findRepoRoot()));
    dirs.add(join(findRepoRoot(), ".olt", ".sessions"));
    dirs.add(join(resolveScratchDir(), ".sessions"));
    dirs.add(join(process.cwd(), ".olt", ".sessions"));
  } catch {}

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".json")) continue;
        try {
          const parsed = JSON.parse(readFileSync(join(dir, f), "utf8")) as SessionIdentity;
          if (parsed && typeof parsed === "object" && parsed.token === token) return parsed;
        } catch {}
      }
    } catch {}
  }
  return null;
}

export function assertLeaseTokenForFileMutation(
  file: string,
  token: string,
  options?: { readonly runRoot?: string; readonly cwd?: string },
): void {
  if (typeof file !== "string" || !file.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "Target file path must be a nonempty string");
  }
  if (!token || typeof token !== "string" || !token.trim() || token.trim() === "unauthenticated" || token.trim() === "none") {
    throw new HarnessError("PERMISSION_DENIED", "Mutation interlock violation: active lease token required for file mutation");
  }

  const session = findSessionByToken(token, file, options);
  if (session) {
    if (session.can_edit_files === false) {
      throw new HarnessError("PERMISSION_DENIED", `Actor role '${session.role}' is not permitted to mutate files`);
    }
    if (session.write_scope && session.write_scope.length > 0 && !matchesWriteScope(file, session.write_scope)) {
      throw new HarnessError("PERMISSION_DENIED", `Target file '${file}' is outside leased write scope: ${session.write_scope.join(", ")}`);
    }
  }
}
