import type { PlanTaskInput } from "./engine/index.ts";
import {
  createWorktree,
  type CreateWorktreeOptions,
  type TrackWorktreeInfo,
} from "../../workflow/worktree/index.ts";

export interface TaskCluster {
  readonly trackId: string;
  readonly tasks: readonly PlanTaskInput[];
}

export interface ClusterAndProvisionOptions {
  readonly repoRoot: string;
  readonly tasks: readonly PlanTaskInput[];
  readonly maxTracks?: number | undefined;
  readonly baseBranch?: string | undefined;
  readonly lockTimeoutMs?: number | undefined;
  readonly worktreeCreator?: ((options: CreateWorktreeOptions) => TrackWorktreeInfo) | undefined;
}

export interface ProvisionedCluster extends TaskCluster {
  readonly worktree: TrackWorktreeInfo;
}

function hasOverlap(scopeA: readonly string[], scopeB: readonly string[]): boolean {
  for (const a of scopeA) {
    if (scopeB.includes(a)) return true;
  }
  return false;
}

export function clusterTasks(
  tasks: readonly PlanTaskInput[],
  maxTracks: number = 5,
): readonly TaskCluster[] {
  if (tasks.length === 0) return [];
  if (maxTracks < 1) maxTracks = 1;

  const adj = new Map<string, Set<string>>();
  for (const task of tasks) {
    adj.set(task.id, new Set<string>());
  }

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const t1 = tasks[i]!;
      const t2 = tasks[j]!;

      const depOverlap =
        (t1.dependencies?.includes(t2.id) ?? false) || (t2.dependencies?.includes(t1.id) ?? false);

      const scopeOverlap = hasOverlap(t1.write_scope ?? [], t2.write_scope ?? []);

      if (depOverlap || scopeOverlap) {
        adj.get(t1.id)!.add(t2.id);
        adj.get(t2.id)!.add(t1.id);
      }
    }
  }

  const visited = new Set<string>();
  const components: PlanTaskInput[][] = [];

  for (const task of tasks) {
    if (!visited.has(task.id)) {
      const comp: PlanTaskInput[] = [];
      const queue = [task];
      visited.add(task.id);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        comp.push(curr);
        for (const neighborId of adj.get(curr.id)!) {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            const neighbor = tasks.find((t) => t.id === neighborId)!;
            queue.push(neighbor);
          }
        }
      }
      components.push(comp);
    }
  }

  while (components.length > maxTracks) {
    components.sort((a, b) => a.length - b.length);
    const smallest = components.shift()!;
    const nextSmallest = components.shift()!;
    components.push([...smallest, ...nextSmallest]);
  }

  return components.map((comp, index) => ({
    trackId: `track-${index + 1}`,
    tasks: comp,
  }));
}

export function provisionTaskClusters(
  options: ClusterAndProvisionOptions,
): readonly ProvisionedCluster[] {
  const clusters = clusterTasks(options.tasks, options.maxTracks ?? 5);
  const creator = options.worktreeCreator ?? createWorktree;
  const result: ProvisionedCluster[] = [];

  for (const cluster of clusters) {
    const worktreeInfo = creator({
      trackId: cluster.trackId,
      repoRoot: options.repoRoot,
      baseBranch: options.baseBranch,
      lockTimeoutMs: options.lockTimeoutMs,
    });
    result.push({
      ...cluster,
      worktree: worktreeInfo,
    });
  }

  return result;
}
