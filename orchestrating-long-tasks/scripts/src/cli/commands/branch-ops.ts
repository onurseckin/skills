import { isBranchOpen, type BranchRecord } from "../../contracts/branch.ts";
import type { RunState } from "../../contracts/capsule.ts";
import { isJsonObject } from "../../contracts/json.ts";
import { getHarnessConfig } from "../../config/harness-config.ts";
import { isAgentRole, type AgentRole } from "../../contracts/packets.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { publishSubTaskRolePacket } from "../../packets/role-grant.ts";
import { loadRun } from "../../store/index.ts";
import { abandonBranch, collectBranch } from "../../workflow/branch/collect.ts";
import { readBranchLedger, requireSubTask } from "../../workflow/branch/ledger.ts";
import { openBranch, type SubTaskInput } from "../../workflow/branch/open.ts";
import { claimSubTask, submitSubTask } from "../../workflow/branch/sub-tasks.ts";
import {
  formatBranchAbandonBrief,
  formatBranchClaimBrief,
  formatBranchCollectBrief,
  formatBranchOpenBrief,
  formatBranchStatusBrief,
  formatBranchSubmitBrief,
} from "../formatters/branch-formatter.ts";
import { boolFlag, integerFlag, listFlag, textFlag, type Flags } from "../options.ts";

function splitPair(entry: string, flag: string): [string, string] {
  const index = entry.indexOf("=");
  if (index <= 0 || index === entry.length - 1) {
    throw new HarnessError("INVALID_ARGUMENT", `--${flag} must be given as <sub-task-id>=<value>`);
  }
  return [entry.slice(0, index), entry.slice(index + 1)];
}

function groupPairs(entries: readonly string[], flag: string): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const entry of entries) {
    const [id, value] = splitPair(entry, flag);
    grouped.set(id, [...(grouped.get(id) ?? []), value]);
  }
  return grouped;
}

function only(values: string[] | undefined, id: string, flag: string): string | undefined {
  if (values === undefined) return undefined;
  if (values.length > 1) {
    throw new HarnessError("INVALID_ARGUMENT", `sub-task ${id} has more than one --${flag}`);
  }
  return values[0];
}

/**
 * Sub-tasks are declared field by field so nothing is inferred: a sub-task without a label or a
 * write scope is rejected rather than given a generated one.
 */
function subTaskInputs(flags: Flags): SubTaskInput[] {
  const ids = listFlag(flags, "sub-task", true)!;
  const labels = groupPairs(listFlag(flags, "sub-label") ?? [], "sub-label");
  const scopes = groupPairs(listFlag(flags, "sub-scope") ?? [], "sub-scope");
  const gates = groupPairs(listFlag(flags, "sub-gate") ?? [], "sub-gate");
  for (const [flag, grouped] of [
    ["sub-label", labels],
    ["sub-scope", scopes],
    ["sub-gate", gates],
  ] as const) {
    for (const id of grouped.keys()) {
      if (!ids.includes(id)) {
        throw new HarnessError("INVALID_ARGUMENT", `--${flag} names undeclared sub-task ${id}`);
      }
    }
  }
  return ids.map((id) => {
    const label = only(labels.get(id), id, "sub-label");
    const writeScope = scopes.get(id);
    if (label === undefined) {
      throw new HarnessError("INVALID_ARGUMENT", `sub-task ${id} has no --sub-label`);
    }
    if (writeScope === undefined) {
      throw new HarnessError("INVALID_ARGUMENT", `sub-task ${id} has no --sub-scope`);
    }
    const gate = only(gates.get(id), id, "sub-gate");
    return { id, label, writeScope, ...(gate === undefined ? {} : { gate }) };
  });
}

function config(run: string, repo: string) {
  return getHarnessConfig(repo, run);
}

/** A branch dispatches into these three and nothing else; every other contract needs a plan task. */
const BRANCH_ROLES: readonly AgentRole[] = ["sub-implementer", "sub-investigator", "sub-validator"];

function branchRoleFlag(flags: Flags): AgentRole {
  const role = textFlag(flags, "role")!;
  if (!isAgentRole(role) || !BRANCH_ROLES.includes(role)) {
    throw new HarnessError("INVALID_ARGUMENT", `--role must be one of ${BRANCH_ROLES.join(", ")}`);
  }
  return role;
}

export function branchOpenCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const agent = textFlag(flags, "agent")!;
  const outcome = openBranch({
    runRoot: run,
    repoRoot: repo,
    parentTaskId: textFlag(flags, "parent-task")!,
    agentId: agent,
    token: textFlag(flags, "token")!,
    reason: textFlag(flags, "reason")!,
    subTasks: subTaskInputs(flags),
    actor: textFlag(flags, "actor", false) ?? agent,
    maxDepth: config(run, repo).max_branch_depth,
    maxAgents: config(run, repo).max_agents,
  });
  return {
    markdown: formatBranchOpenBrief(outcome.branch, run),
    run_root: run,
    branch: outcome.branch,
    branch_id: outcome.branch.id,
  };
}

export async function branchClaimCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const subTaskId = textFlag(flags, "sub-task")!;
  const agent = textFlag(flags, "agent")!;
  const role = branchRoleFlag(flags);
  const outcome = claimSubTask({
    runRoot: run,
    branchId: textFlag(flags, "branch")!,
    subTaskId,
    agentId: agent,
    actor: textFlag(flags, "actor", false) ?? agent,
    leaseSeconds:
      integerFlag(flags, "lease-seconds", { minimum: 5, maximum: 86_400 }) ??
      config(run, repo).default_lease_seconds,
  });
  const subTask = requireSubTask(outcome.branch, subTaskId);
  // A sub-agent is dispatched with the same pairing every other agent gets: the lease token that
  // grants it work and the published contract that bounds what the work may be.
  const published = await publishSubTaskRolePacket({
    runRoot: run,
    port: workflowPort(run),
    role,
    agentId: agent,
    token: outcome.token,
    subTaskId,
  });
  return {
    markdown: formatBranchClaimBrief(outcome.branch, subTask, outcome.token, run),
    run_root: run,
    token: outcome.token,
    branch: outcome.branch,
    sub_task: subTask,
    packet_id: published.record.id,
    packet_path: published.markdownPath,
    role_contract_sha256: published.packet.metadata.role_contract_sha256,
  };
}

export function branchSubmitCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const subTaskId = textFlag(flags, "sub-task")!;
  const agent = textFlag(flags, "agent")!;
  const outcome = submitSubTask({
    runRoot: run,
    branchId: textFlag(flags, "branch")!,
    subTaskId,
    agentId: agent,
    token: textFlag(flags, "token")!,
    actor: textFlag(flags, "actor", false) ?? agent,
    summary: textFlag(flags, "summary")!,
  });
  return {
    markdown: formatBranchSubmitBrief(outcome.branch, subTaskId),
    run_root: run,
    branch: outcome.branch,
    sub_task: requireSubTask(outcome.branch, subTaskId),
  };
}

/** The parent is either a plan task or another branch's sub-task; both report a status. */
function parentStatus(state: RunState, branch: BranchRecord): string {
  const tasks = state.tasks;
  if (isJsonObject(tasks)) {
    const task = tasks[branch.parent_task_id];
    if (isJsonObject(task) && typeof task.status === "string") return task.status;
  }
  const parent = readBranchLedger(state)
    .flatMap((entry) => entry.sub_tasks)
    .find((subTask) => subTask.id === branch.parent_task_id);
  return parent?.status ?? "unknown";
}

export function branchCollectCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const agent = textFlag(flags, "agent")!;
  const outcome = collectBranch({
    runRoot: run,
    repoRoot: repo,
    branchId: textFlag(flags, "branch")!,
    agentId: agent,
    token: textFlag(flags, "token")!,
    actor: textFlag(flags, "actor", false) ?? agent,
    summary: textFlag(flags, "summary")!,
  });
  const status = parentStatus(outcome.state, outcome.branch);
  return {
    markdown: formatBranchCollectBrief(outcome.branch, status),
    run_root: run,
    branch: outcome.branch,
    parent_status: status,
    files_changed: outcome.branch.files_changed ?? null,
  };
}

export function branchAbandonCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const agent = textFlag(flags, "agent")!;
  const outcome = abandonBranch({
    runRoot: run,
    branchId: textFlag(flags, "branch")!,
    agentId: agent,
    token: textFlag(flags, "token")!,
    actor: textFlag(flags, "actor", false) ?? agent,
    reason: textFlag(flags, "reason")!,
  });
  const status = parentStatus(outcome.state, outcome.branch);
  return {
    markdown: formatBranchAbandonBrief(outcome.branch, status),
    run_root: run,
    branch: outcome.branch,
    parent_status: status,
  };
}

export function branchStatusCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const branchId = textFlag(flags, "branch", false);
  const parentTaskId = textFlag(flags, "task", false);
  const includeClosed = boolFlag(flags, "all");
  const ledger = readBranchLedger(loadRun(run).state);
  const shown = ledger.filter(
    (branch) =>
      (branchId === undefined || branch.id === branchId) &&
      (parentTaskId === undefined || branch.parent_task_id === parentTaskId) &&
      (includeClosed || isBranchOpen(branch)),
  );
  return {
    markdown: formatBranchStatusBrief(shown, run),
    run_root: run,
    branches: shown,
    open_branches: ledger.filter(isBranchOpen).length,
    total_branches: ledger.length,
  };
}
