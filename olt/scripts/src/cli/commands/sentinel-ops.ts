import { HarnessError } from "../../core/errors/index.ts";
import {
  executePostActionHook,
  executePreActionHook,
  executeTurnEndHook,
  isCanonicalRole,
  runSentinelWatch,
  type AgentRole,
} from "../../sentinel/index.ts";
import { boolFlag, integerFlag, listFlag, textFlag, type Flags } from "../index.ts";

function requireRole(flags: Flags): AgentRole {
  const roleRaw = textFlag(flags, "role", true);
  if (!roleRaw || !isCanonicalRole(roleRaw)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid or missing canonical role: '${roleRaw}'`,
      [],
      2,
    );
  }
  return roleRaw;
}

function requireAgent(flags: Flags): string {
  const agent =
    textFlag(flags, "agent", false) ??
    textFlag(flags, "agent-id", false) ??
    textFlag(flags, "actor", false);
  if (!agent) {
    throw new HarnessError("INVALID_ARGUMENT", "--agent is required", [], 2);
  }
  return agent;
}

export async function sentinelPreActionCommand(flags: Flags): Promise<Record<string, unknown>> {
  const role = requireRole(flags);
  const agentId = requireAgent(flags);
  const actionTypeRaw =
    textFlag(flags, "action", false) ?? textFlag(flags, "action-type", false) ?? "file_write";
  const actionType =
    actionTypeRaw === "shell_command" ||
    actionTypeRaw === "task_submit" ||
    actionTypeRaw === "task_review"
      ? actionTypeRaw
      : "file_write";

  const target = textFlag(flags, "target", true)!;
  const writeScope = listFlag(flags, "write-scope", false);
  const taskId = textFlag(flags, "task", false) ?? textFlag(flags, "task-id", false);

  const result = executePreActionHook({
    agent_id: agentId,
    role,
    action_type: actionType,
    target,
    write_scope: writeScope,
    task_id: taskId,
  });

  if (!result.allowed) {
    throw new HarnessError(
      (result.code as "PATH_SAFETY" | "ROLE_BOUNDARY_DEVIATION") ?? "ROLE_BOUNDARY_DEVIATION",
      `[SENTINEL_BLOCK] ${result.reason ?? "Action blocked by sentinel"}`,
      [],
      1,
      result.remediation,
    );
  }

  return { allowed: true, agent_id: agentId, role, action_type: actionType, target };
}

export async function sentinelPostActionCommand(flags: Flags): Promise<Record<string, unknown>> {
  const role = requireRole(flags);
  const agentId = requireAgent(flags);
  const files = listFlag(flags, "files", true)!;
  const repoRoot = textFlag(flags, "repo-root", false);

  const result = executePostActionHook({
    agent_id: agentId,
    role,
    modified_files: files,
    repo_root: repoRoot,
  });

  if (!result.allowed) {
    return {
      allowed: false,
      agent_id: agentId,
      role,
      violations: result.violations,
    };
  }

  return { allowed: true, agent_id: agentId, role, files_inspected: files.length };
}

export async function sentinelTurnEndCommand(flags: Flags): Promise<Record<string, unknown>> {
  const role = requireRole(flags);
  const agentId = requireAgent(flags);
  const taskId = textFlag(flags, "task", false) ?? textFlag(flags, "task-id", false);
  const runRoot = textFlag(flags, "run", false) ?? textFlag(flags, "run-id", false);
  const repoRoot = textFlag(flags, "repo-root", false);
  const parentSupervisor = textFlag(flags, "parent-supervisor", false);
  const dryRun = boolFlag(flags, "dry-run");
  const modifiedFiles = listFlag(flags, "files", false);
  const executedCommands = listFlag(flags, "commands", false);

  const result = executeTurnEndHook({
    agent_id: agentId,
    role,
    task_id: taskId,
    run_root: runRoot,
    repo_root: repoRoot,
    parent_supervisor: parentSupervisor,
    dry_run: dryRun,
    modified_files: modifiedFiles,
    executed_commands: executedCommands,
  });

  return {
    status: result.status,
    agent_id: agentId,
    role,
    strike_count: result.strike_count,
    action_taken: result.action_taken,
    violations: result.violations,
    ...(result.routing_journey ? { routing_journey: result.routing_journey } : {}),
    ...(result.markdown_brief ? { markdown: result.markdown_brief } : {}),
  };
}

export async function sentinelWatchCommand(flags: Flags): Promise<Record<string, unknown>> {
  const role = requireRole(flags);
  const agentId = requireAgent(flags);
  const taskId = textFlag(flags, "task", false) ?? textFlag(flags, "task-id", false);
  const repoRoot = textFlag(flags, "repo-root", false);
  const intervalMs = integerFlag(flags, "interval", { required: false });
  const maxIterations = integerFlag(flags, "max-iterations", { required: false }) ?? 1;

  const result = await runSentinelWatch({
    agentId,
    role,
    taskId,
    repoRoot,
    intervalMs,
    maxIterations,
  });

  return {
    status: result.status,
    agent_id: agentId,
    role,
    completed_iterations: result.completedIterations,
    strike_count: result.strikeCount,
    violations: result.violations,
  };
}
