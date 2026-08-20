import type { TopologyRecord } from "../../contracts/topology.ts";
import type { WorktreeAssignment } from "../../contracts/worktree.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { scopeConflict } from "../../scheduler/conflicts.ts";

export interface AssignableTask {
  write_scope: readonly string[];
}

/**
 * B22.2's assignment, reusing the scheduler's own disjoint-write-scope analysis rather than a
 * second copy of it.
 *
 * Design decision, stated plainly because the backlog's own wording ("non-colliding tasks MAY
 * share one worktree") is ambiguous between two readings that point opposite directions:
 *
 * 1. Two CONCURRENT (same-wave) tasks with disjoint scopes could share a worktree, since their
 *    files never overlap.
 * 2. A worktree is only ever safe to share between tasks that never run at the same time.
 *
 * Reading 1 reopens the exact problem B22 exists to close (B18.1): a repo-wide pre-commit gate run
 * against a shared working directory can fail on a wave-mate's unrelated half-written file even
 * when the two tasks' write scopes never overlap. Every task in a wave is ALREADY guaranteed
 * disjoint from every other task in that same wave — that is what makes it a wave — so reading 1
 * would only ever fire on pairs that were never going to conflict in the first place, while still
 * carrying the collision risk. It buys nothing.
 *
 * This implementation takes reading 2: worktree slots are reused round-robin ACROSS waves only, so
 * two tasks are never assigned the same slot while both could be running. Sizing the pool to the
 * widest wave means every concurrent task still gets its own worktree, and the total worktree count
 * never exceeds `default_max_parallel`. `scopeConflict` is used as a defense-in-depth assertion: if
 * a corrupted or hand-edited topology ever put two colliding tasks in the same wave, that is caught
 * here as an INTEGRITY failure rather than silently producing two agents racing one directory.
 */
export function assignWorktrees(
  topology: TopologyRecord,
  tasksById: ReadonlyMap<string, AssignableTask>,
): { assignments: WorktreeAssignment[]; worktreeCount: number } {
  const worktreeCount = topology.waves.reduce((max, wave) => Math.max(max, wave.task_ids.length), 0);
  const assignments: WorktreeAssignment[] = [];
  for (const wave of topology.waves) {
    for (const [index, taskId] of wave.task_ids.entries()) {
      for (const otherId of wave.task_ids.slice(0, index)) {
        const task = tasksById.get(taskId);
        const other = tasksById.get(otherId);
        if (task && other && scopeConflict(task.write_scope, other.write_scope)) {
          throw new HarnessError(
            "INTEGRITY",
            `topology wave ${wave.wave} puts colliding tasks ${taskId} and ${otherId} in the same wave`,
          );
        }
      }
      assignments.push({ task_id: taskId, worktree_id: `wt-${index}`, wave: wave.wave });
    }
  }
  return { assignments, worktreeCount };
}
