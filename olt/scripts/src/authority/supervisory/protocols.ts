import type { ActiveLeaseContext, SupervisoryScopeConflict } from "./types.ts";

export function computeScopeOverlaps(
  leases: readonly ActiveLeaseContext[],
): readonly SupervisoryScopeConflict[] {
  const collisions: { taskA: string; taskB: string; overlappingFiles: string[] }[] = [];
  for (let i = 0; i < leases.length; i++) {
    for (let j = i + 1; j < leases.length; j++) {
      const a = leases[i]!;
      const b = leases[j]!;
      const scopeA = a.writeScope ?? [];
      const scopeB = b.writeScope ?? [];
      const common = scopeA.filter((f) => scopeB.includes(f));
      if (common.length > 0) {
        collisions.push({
          taskA: a.taskId,
          taskB: b.taskId,
          overlappingFiles: common,
        });
      }
    }
  }
  return collisions;
}

export function parseTimeMs(val?: string | number | Date | undefined): number {
  if (typeof val === "number") return val;
  if (val instanceof Date) return val.getTime();
  if (typeof val === "string") {
    const p = Date.parse(val);
    if (Number.isFinite(p)) return p;
  }
  return Date.now();
}
