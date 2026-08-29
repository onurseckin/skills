import type { SchedulingMetrics } from "../metrics.ts";

export type ScheduledTask = Record<string, unknown> & {
  id: string;
  priority: number;
  created_order: number;
  effort: number;
  requirement_ids: string[];
  resource_scope?: string[];
  write_scope: string[];
};

function compareNumber(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function rankTasks(tasks: ScheduledTask[], metrics: SchedulingMetrics): ScheduledTask[] {
  return tasks.sort((left, right) => {
    return (
      compareNumber(right.priority, left.priority) ||
      compareNumber(
        metrics.criticalDepth.get(right.id) ?? 0,
        metrics.criticalDepth.get(left.id) ?? 0,
      ) ||
      compareNumber(
        metrics.descendants.get(right.id) ?? 0,
        metrics.descendants.get(left.id) ?? 0,
      ) ||
      compareNumber(left.created_order, right.created_order) ||
      compareNumber(left.effort, right.effort) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    );
  });
}
