import { basename } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { CONVENTIONAL_COMMIT_TYPES } from "../engine/worktree/domain-sync-types.ts";
import type { RepoPolicy } from "./types/index.ts";

export type PolicyEnforcementAction =
  | {
      readonly type: "worktree";
      readonly trackId: string;
      readonly worktreePath: string;
      readonly branch?: string | undefined;
      readonly writeScope?: readonly string[] | undefined;
      readonly modifiedPaths?: readonly string[] | undefined;
    }
  | {
      readonly type: "commit";
      readonly message: string;
      readonly changedLines?: number | undefined;
      readonly maxCommitLines?: number | undefined;
    }
  | {
      readonly type: "file_density";
      readonly filePath: string;
      readonly lineCount?: number | undefined;
      readonly fileContent?: string | undefined;
      readonly siblingFileCount?: number | undefined;
      readonly maxLinesPerFile?: number | undefined;
      readonly maxFilesPerDirectory?: number | undefined;
    }
  | {
      readonly type: "command";
      readonly command: string;
      readonly role?: string | undefined;
    }
  | {
      readonly type: "planning";
      readonly fileCount?: number | undefined;
      readonly promptComplexity?: "simple" | "complex" | undefined;
      readonly taskCount?: number | undefined;
    };

export interface PolicyEnforcementResult {
  readonly allowed: boolean;
  readonly violations: readonly string[];
  readonly warnings: readonly string[];
}

export interface EnforcePolicyOptions {
  readonly assert?: boolean | undefined;
}

function enforceWorktreeAction(action: Extract<PolicyEnforcementAction, { type: "worktree" }>): {
  violations: string[];
  warnings: string[];
} {
  const violations: string[] = [];
  const warnings: string[] = [];
  if (!action.trackId || !/^[a-zA-Z0-9_-]+$/.test(action.trackId)) {
    violations.push(
      `Invalid worktree trackId '${action.trackId}': must be non-empty alphanumeric with dashes/underscores`,
    );
  }
  if (
    !action.worktreePath ||
    (!action.worktreePath.includes(".olt/worktrees") &&
      !action.worktreePath.includes(".capsules") &&
      !action.worktreePath.includes("worktrees"))
  ) {
    violations.push(
      `Worktree path '${action.worktreePath}' is not within designated worktree roots (.olt/worktrees/ or .capsules/)`,
    );
  }
  if (
    action.branch &&
    !action.branch.startsWith("track/") &&
    !action.branch.startsWith("harness--")
  ) {
    violations.push(
      `Worktree branch '${action.branch}' violates isolation naming convention ('track/<id>' or 'harness--<domain>-<runId>')`,
    );
  }
  if (action.modifiedPaths && action.writeScope) {
    for (const mod of action.modifiedPaths) {
      const inScope = action.writeScope.some(
        (s) => mod === s || mod.startsWith(s.replace(/\/\*\*?$/u, "")) || s === ".",
      );
      if (!inScope)
        violations.push(
          `Modified path '${mod}' is outside task write scope [${action.writeScope.join(", ")}]`,
        );
    }
  }
  return { violations, warnings };
}

function enforceCommitAction(action: Extract<PolicyEnforcementAction, { type: "commit" }>): {
  violations: string[];
  warnings: string[];
} {
  const violations: string[] = [];
  const warnings: string[] = [];
  if (!action.message || action.message.trim() === "") {
    violations.push("Commit message cannot be empty");
    return { violations, warnings };
  }
  const firstLine = action.message.split(/\r?\n/)[0]?.trim() ?? "";
  const headerMatch = /^([a-zA-Z0-9_-]+)(?:\(([a-zA-Z0-9_/-]+)\))?(!)?:\s+(.+)$/u.exec(firstLine);
  if (!headerMatch) {
    violations.push(
      `Commit header '${firstLine}' violates Conventional Commits format '<type>(<scope>): <description>'`,
    );
  } else {
    const type = headerMatch[1]!.toLowerCase();
    if (!CONVENTIONAL_COMMIT_TYPES.has(type)) {
      violations.push(
        `Commit type '${type}' is not recognized. Must be one of: ${Array.from(CONVENTIONAL_COMMIT_TYPES).join(", ")}`,
      );
    }
  }
  if (
    action.changedLines !== undefined &&
    action.maxCommitLines !== undefined &&
    action.changedLines > action.maxCommitLines
  ) {
    warnings.push(
      `Commit changed ${action.changedLines} lines, exceeding target limit of ${action.maxCommitLines} lines`,
    );
  }
  return { violations, warnings };
}

function enforceFileDensityAction(
  action: Extract<PolicyEnforcementAction, { type: "file_density" }>,
): { violations: string[]; warnings: string[] } {
  const violations: string[] = [];
  const warnings: string[] = [];
  const name = basename(action.filePath);
  if (
    (name.startsWith("defect-") || name.startsWith("fb-")) &&
    !action.filePath.includes("docs/") &&
    !action.filePath.includes("tests/")
  ) {
    violations.push(`Prohibited defect/feedback prefix in source file name: '${name}'`);
  }
  const maxLines = action.maxLinesPerFile ?? 300;
  const lineCount =
    action.lineCount ?? (action.fileContent ? action.fileContent.split(/\r?\n/).length : undefined);
  if (lineCount !== undefined && lineCount > maxLines) {
    violations.push(
      `File '${action.filePath}' has ${lineCount} lines, exceeding density limit of ${maxLines} lines`,
    );
  }
  const maxFiles = action.maxFilesPerDirectory ?? 10;
  if (action.siblingFileCount !== undefined && action.siblingFileCount > maxFiles) {
    violations.push(
      `Directory containing '${action.filePath}' has ${action.siblingFileCount} files, exceeding limit of ${maxFiles} files`,
    );
  }
  return { violations, warnings };
}

function enforceCommandAction(
  policy: RepoPolicy,
  action: Extract<PolicyEnforcementAction, { type: "command" }>,
): { violations: string[]; warnings: string[] } {
  const violations: string[] = [];
  const warnings: string[] = [];
  const cmd = action.command.trim();
  if (policy.forbidden_commands && policy.forbidden_commands.length > 0) {
    for (const forbidden of policy.forbidden_commands) {
      if (cmd === forbidden || cmd.startsWith(`${forbidden} `)) {
        violations.push(
          `Command '${cmd}' violates forbidden command policy: matches '${forbidden}'`,
        );
      }
    }
  }
  if (
    action.role === "implementer" &&
    (cmd === "bun test" || cmd === "npm test" || cmd === "yarn test" || cmd === "pytest")
  ) {
    violations.push(
      `Untargeted whole-tree test execution '${cmd}' is forbidden for implementers; use targeted file-scoped tests`,
    );
  }
  return { violations, warnings };
}

function enforcePlanningAction(
  policy: RepoPolicy,
  action: Extract<PolicyEnforcementAction, { type: "planning" }>,
): { violations: string[]; warnings: string[] } {
  const violations: string[] = [];
  const warnings: string[] = [];
  if (
    policy.planning?.max_files_per_task &&
    action.fileCount !== undefined &&
    action.fileCount > policy.planning.max_files_per_task
  ) {
    violations.push(
      `Task touches ${action.fileCount} files, exceeding max_files_per_task policy limit of ${policy.planning.max_files_per_task}`,
    );
  }
  if (
    action.promptComplexity === "complex" &&
    policy.planning?.min_tasks_per_complex_prompt &&
    action.taskCount !== undefined &&
    action.taskCount < policy.planning.min_tasks_per_complex_prompt
  ) {
    violations.push(
      `Complex prompt plan generated ${action.taskCount} tasks, below minimum requirement of ${policy.planning.min_tasks_per_complex_prompt} tasks`,
    );
  }
  return { violations, warnings };
}

export function enforceRepoPolicy(
  policy: RepoPolicy,
  action: PolicyEnforcementAction,
  options: EnforcePolicyOptions = { assert: true },
): PolicyEnforcementResult {
  let outcome: { violations: string[]; warnings: string[] };
  switch (action.type) {
    case "worktree":
      outcome = enforceWorktreeAction(action);
      break;
    case "commit":
      outcome = enforceCommitAction(action);
      break;
    case "file_density":
      outcome = enforceFileDensityAction(action);
      break;
    case "command":
      outcome = enforceCommandAction(policy, action);
      break;
    case "planning":
      outcome = enforcePlanningAction(policy, action);
      break;
  }
  const result: PolicyEnforcementResult = {
    allowed: outcome.violations.length === 0,
    violations: outcome.violations,
    warnings: outcome.warnings,
  };
  if (options.assert !== false && !result.allowed) {
    throw new HarnessError(
      "PERMISSION_DENIED",
      `Central policy enforcement failed: ${result.violations.join("; ")}`,
      result.violations.map((v) => ({ violation: v })),
      3,
      "Review repository policy in .olt/policy.json and ensure all operations adhere to constraints.",
    );
  }
  return result;
}
