import { downstreamMap, topologicalOrder, type DependencyMap } from "../../graph/topology.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { statusGlyph } from "../../summary/dag-visualizer.ts";

export interface SchedulingMetrics {
  criticalDepth: Map<string, number>;
  descendants: Map<string, number>;
}

export function schedulingMetrics(dependencies: DependencyMap): SchedulingMetrics {
  const downstream = downstreamMap(dependencies);
  const order = topologicalOrder(dependencies);
  if (order.length !== dependencies.size) {
    throw new HarnessError("INTEGRITY", "depends_on edges contain an execution cycle");
  }
  const criticalDepth = new Map([...dependencies.keys()].map((id) => [id, 0]));
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const id = order[index]!;
    let depth = 0;
    for (const child of downstream.get(id) ?? []) {
      depth = Math.max(depth, 1 + (criticalDepth.get(child) ?? 0));
    }
    criticalDepth.set(id, depth);
  }
  const descendants = new Map<string, number>();
  for (const id of dependencies.keys()) {
    const visited = new Set<string>();
    const pending = [...(downstream.get(id) ?? [])];
    while (pending.length) {
      const descendant = pending.pop()!;
      if (visited.has(descendant)) continue;
      visited.add(descendant);
      for (const child of downstream.get(descendant) ?? []) {
        if (!visited.has(child)) pending.push(child);
      }
    }
    descendants.set(id, visited.size);
  }
  return { criticalDepth, descendants };
}

export function generateTaskDagBadge(
  taskId: string,
  status: string,
  options: {
    wave?: number | undefined;
    lane?: number | undefined;
    assignedAgent?: string | null | undefined;
    role?: string | null | undefined;
    hasDeps?: boolean | undefined;
  } = {},
): string {
  const wave = options.wave ?? 1;
  const laneStr = options.lane !== undefined ? `:L${options.lane}` : "";
  const glyph = statusGlyph(status, options.hasDeps ?? false);

  if (
    options.assignedAgent &&
    (status === "leased" || status === "running" || status === "validating")
  ) {
    const roleStr = options.role ? ` (${options.role})` : "";
    return `[W${wave}${laneStr} ${glyph} ${options.assignedAgent}${roleStr} @ ${taskId}]`;
  }
  return `[W${wave}${laneStr} ${glyph} ${taskId}]`;
}

export function generateWaveLaneBadges(
  waveGroups: readonly {
    wave: number;
    tasks: readonly { id: string; status: string; assignedAgent?: string | null | undefined }[];
  }[],
): readonly string[] {
  return waveGroups.map((wg) => {
    const total = wg.tasks.length;
    const activeCount = wg.tasks.filter(
      (t) => t.status === "leased" || t.status === "running" || t.status === "validating",
    ).length;
    const readyCount = wg.tasks.filter(
      (t) => t.status === "ready" || t.status === "retry_ready",
    ).length;
    const doneCount = wg.tasks.filter(
      (t) => t.status === "done" || t.status === "validated",
    ).length;

    const statusParts: string[] = [];
    if (activeCount > 0) statusParts.push(`${activeCount} active`);
    if (readyCount > 0) statusParts.push(`${readyCount} ready`);
    if (doneCount > 0) statusParts.push(`${doneCount} done`);
    const details = statusParts.length > 0 ? ` (${statusParts.join(", ")})` : "";

    return `[WAVE ${wg.wave}: ${total} lane(s)${details}]`;
  });
}

export function formatWorkSpanBadge(
  totalWork: number,
  span: number,
  parallelismFactor?: number,
): string {
  const pFactor = parallelismFactor ?? (span > 0 ? Number((totalWork / span).toFixed(2)) : 1);
  return `[WORK/SPAN: W=${totalWork} | S=${span} | P=${pFactor}]`;
}
