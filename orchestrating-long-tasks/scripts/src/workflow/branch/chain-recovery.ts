import {
  isBranchOpen,
  isSubTaskTerminal,
  type BranchLease,
  type BranchRecord,
} from "../../contracts/branch.ts";
import { isJsonObject, type JsonObject } from "../../contracts/json.ts";
import type { ScopedLease } from "../types.ts";
import { isLeaseSuspended, leaseIsExpired } from "../lease/suspension.ts";
import { transition, utc } from "../task-state.ts";
import { locateSubTask, readBranchLedger, writeBranchLedger } from "./ledger.ts";
import { resolveBranchParent, type BranchParent } from "./parent.ts";

export interface ReclaimedChainLink {
  branch_id: string;
  parent_id: string;
  parent_kind: "sub_task" | "task";
  dead_agent_id: string;
}

/**
 * The last moment anyone moved the branch forward. Recovery times the parent's window from here
 * rather than from the frozen lease clock, and a reclaimed sub-task counts: re-opening work hands
 * the level above a fresh window to dispatch into it before it is judged dead in turn.
 */
function lastActivityAt(branch: BranchRecord): number {
  let latest = Date.parse(branch.opened_at);
  for (const subTask of branch.sub_tasks) {
    const stamps = [
      subTask.claimed_at,
      subTask.submitted_at,
      subTask.abandoned_at,
      subTask.recovery?.recovered_at,
    ];
    for (const stamp of stamps) {
      if (typeof stamp !== "string") continue;
      const at = Date.parse(stamp);
      if (Number.isFinite(at) && (!Number.isFinite(latest) || at > latest)) latest = at;
    }
  }
  return latest;
}

/**
 * Work still running below the parent. A sub-task nobody has claimed is not work in progress — it
 * is the parent's job to dispatch into it, which is exactly what a dead parent stops doing.
 */
function hasActiveWork(branch: BranchRecord, now: Date, graceMs: number): boolean {
  return branch.sub_tasks.some((subTask) => {
    if (subTask.status === "branched") return true;
    if (subTask.status !== "claimed" || !subTask.lease) return false;
    return !leaseIsExpired(subTask.lease, now, graceMs);
  });
}

/**
 * Recovery is the last thing that should break, so a branch whose parent is missing entirely is
 * skipped rather than thrown on: the rest of the chain can still be reclaimed.
 */
function findParent(
  draft: JsonObject,
  ledger: readonly BranchRecord[],
  parentId: string,
): BranchParent | undefined {
  const tasks = draft.tasks;
  const isPlanTask = isJsonObject(tasks) && Object.hasOwn(tasks, parentId);
  if (!isPlanTask && !locateSubTask(ledger, parentId)) return undefined;
  return resolveBranchParent(draft, ledger, parentId);
}

function parentLease(parent: BranchParent): BranchLease | ScopedLease | undefined {
  return parent.kind === "task" ? parent.task.lease : parent.subTask.lease;
}

function closeBranch(branch: BranchRecord, now: Date, reason: string): void {
  for (const subTask of branch.sub_tasks) {
    if (isSubTaskTerminal(subTask)) continue;
    subTask.status = "abandoned";
    subTask.abandoned_at = utc(now);
    delete subTask.lease;
  }
  branch.status = "abandoned";
  branch.abandoned_at = utc(now);
  branch.outcome_summary = reason;
}

/**
 * The parent goes back to where a fresh agent can pick it up. A plan task returns to the queue the
 * same way an expired lease does; a sub-task returns to `open` so its own parent can dispatch into
 * it again, which is what stops a death mid-chain from freezing every level above it.
 */
function reclaimParent(parent: BranchParent, actor: string, now: Date, reason: string): void {
  const lease = parentLease(parent);
  if (parent.kind === "sub_task") {
    if (lease) {
      parent.subTask.recovery = {
        recovered_at: utc(now),
        expired_agent_id: lease.agent_id,
        expired_at: lease.expires_at,
      };
    }
    delete parent.subTask.lease;
    delete parent.subTask.agent_id;
    parent.subTask.status = "open";
    return;
  }
  const task = parent.task;
  const attempt = task.attempts.at(-1);
  if (attempt) {
    Object.assign(attempt, {
      stale_at: utc(now),
      result: "stale",
      ...(lease === undefined
        ? {}
        : { expired_agent_id: lease.agent_id, expired_token_digest: lease.token_digest }),
    });
  }
  const repair = attempt?.kind === "repair";
  delete task.lease;
  transition(task, repair ? "changes_requested" : "retry_ready", actor, now, reason);
}

/**
 * Walks the suspended-lease chain from the inside out. A frozen lease is exempt from expiry only
 * while the branch beneath it is moving; once that branch has gone quiet for longer than the
 * parent's own lease window, the parent is the one who stopped, so its level is reclaimed and its
 * branch closed. Each pass reclaims the deepest stopped level and gives the level above a fresh
 * window, so repeated recovery walks a dead chain all the way to the top without reaping a parent
 * whose children are still working.
 */
export function recoverSuspendedChains(
  draft: JsonObject,
  actor: string,
  now: Date,
  graceMs: number,
): ReclaimedChainLink[] {
  const ledger = readBranchLedger(draft);
  if (ledger.length === 0) return [];
  const reclaimed: ReclaimedChainLink[] = [];
  const deepestFirst = ledger.filter(isBranchOpen).sort((left, right) => right.depth - left.depth);
  for (const branch of deepestFirst) {
    if (hasActiveWork(branch, now, graceMs)) continue;
    const parent = findParent(draft, ledger, branch.parent_task_id);
    if (!parent) continue;
    const lease = parentLease(parent);
    if (!lease || !isLeaseSuspended(lease)) continue;
    const duration = lease.duration_seconds;
    if (!Number.isSafeInteger(duration) || duration <= 0) continue;
    const since = lastActivityAt(branch);
    if (!Number.isFinite(since) || since + duration * 1_000 + graceMs > now.valueOf()) continue;
    const reason = `${branch.parent_agent_id} never returned to collect branch ${branch.id}; reclaimed by chain recovery`;
    closeBranch(branch, now, reason);
    reclaimParent(parent, actor, now, reason);
    reclaimed.push({
      branch_id: branch.id,
      parent_id: parent.id,
      parent_kind: parent.kind,
      dead_agent_id: lease.agent_id,
    });
  }
  if (reclaimed.length > 0) writeBranchLedger(draft, ledger);
  return reclaimed;
}
