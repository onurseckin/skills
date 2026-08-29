import type { TopologyRecord } from "../../core/contracts/index.ts";
import type { WorktreeAssignment } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { scopeConflict } from "../../engine/scheduler/conflicts.ts";

export interface AssignableTask {
  write_scope: readonly string[];
}

export function assignWorktrees(
  topology: TopologyRecord,
  tasksById: ReadonlyMap<string, AssignableTask>,
): { assignments: WorktreeAssignment[]; worktreeCount: number } {
  const worktreeCount = topology.waves.reduce(
    (max, wave) => Math.max(max, wave.task_ids.length),
    0,
  );
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
