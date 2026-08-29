import { HarnessError } from "../../core/errors/index.ts";
import { topologicalOrder, type DependencyMap } from "../../graph/dag-forensics.ts";

export interface SchedulingMetrics {
  readonly criticalDepth: Map<string, number>;
  readonly descendants: Map<string, number>;
}

export function schedulingMetrics(dependencies: DependencyMap): SchedulingMetrics {
  const order = topologicalOrder(dependencies);
  if (order.length !== dependencies.size) {
    throw new HarnessError("INTEGRITY", "depends_on edges contain an execution cycle");
  }

  const criticalDepth = new Map<string, number>();
  const descendants = new Map<string, number>();
  const descendantSets = new Map<string, Set<string>>();

  // Build reverse map (parent -> children)
  const childrenMap = new Map<string, Set<string>>();
  for (const node of dependencies.keys()) {
    childrenMap.set(node, new Set<string>());
    descendantSets.set(node, new Set<string>());
  }

  for (const [node, prereqs] of dependencies.entries()) {
    for (const p of prereqs) {
      if (childrenMap.has(p)) {
        childrenMap.get(p)!.add(node);
      }
    }
  }

  // Compute depth and descendants in reverse topological order (leaves first)
  const reversedOrder = [...order].reverse();

  for (const node of reversedOrder) {
    const children = childrenMap.get(node) ?? new Set<string>();
    let maxChildDepth = -1;
    const allDescendants = new Set<string>();

    for (const child of children) {
      const cDepth = criticalDepth.get(child) ?? 0;
      if (cDepth > maxChildDepth) maxChildDepth = cDepth;
      allDescendants.add(child);
      const childDescendants = descendantSets.get(child);
      if (childDescendants) {
        for (const cd of childDescendants) allDescendants.add(cd);
      }
    }

    criticalDepth.set(node, maxChildDepth + 1);
    descendantSets.set(node, allDescendants);
    descendants.set(node, allDescendants.size);
  }

  return { criticalDepth, descendants };
}

export function generateTaskDagBadge(
  taskId: string,
  status: string,
  options?: {
    readonly wave?: number | undefined;
    readonly lane?: number | undefined;
    readonly assignedAgent?: string | undefined;
    readonly role?: string | undefined;
    readonly hasDeps?: boolean | undefined;
  },
): string {
  const wave = options?.wave ?? 1;
  const laneStr = options?.lane !== undefined ? `:L${options.lane}` : "";
  const s = status.toLowerCase();

  if (s === "running" || s === "in_progress" || s === "leased" || s === "dispatched") {
    const agent = options?.assignedAgent || "agent";
    const role = options?.role ? ` (${options.role})` : "";
    return `[W${wave}${laneStr} (🟢 ACTIVE) ${agent}${role} @ ${taskId}]`;
  }

  if (s === "done" || s === "completed") {
    return `[W${wave}${laneStr} (✅ DONE) ${taskId}]`;
  }

  if (s === "ready") {
    return `[W${wave}${laneStr} (⚡ READY) ${taskId}]`;
  }

  return `[W${wave}${laneStr} (⏳ BLOCKED) ${taskId}]`;
}

export function generateWaveLaneBadges(
  waves: readonly {
    readonly wave: number;
    readonly tasks: readonly {
      readonly id: string;
      readonly status?: string | undefined;
      readonly assignedAgent?: string | undefined;
      readonly role?: string | undefined;
    }[];
  }[],
): readonly string[] {
  return waves.map((w) => {
    const counts = { active: 0, ready: 0, done: 0, blocked: 0 };
    for (const t of w.tasks) {
      const s = (t.status || "proposed").toLowerCase();
      if (s === "running" || s === "leased") counts.active += 1;
      else if (s === "ready") counts.ready += 1;
      else if (s === "done") counts.done += 1;
      else counts.blocked += 1;
    }
    return `[Wave ${w.wave}: ${w.tasks.length} tasks (🟢 ${counts.active}, ⚡ ${counts.ready}, ✅ ${counts.done}, ⏳ ${counts.blocked})]`;
  });
}

export function formatWorkSpanBadge(work: number, span: number): string {
  const parallelism = Number((work / Math.max(1, span)).toFixed(2));
  return `[WorkSpan: work=${work}, span=${span}, P=${parallelism}x]`;
}
