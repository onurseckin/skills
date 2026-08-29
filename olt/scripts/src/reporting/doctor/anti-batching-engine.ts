import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export interface AntiBatchingIsolationOptions {
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly tasks?: Readonly<Record<string, unknown>> | null | undefined;
  readonly grants?: readonly unknown[] | null | undefined;
}

interface ActiveTaskInfo {
  readonly id: string;
  readonly agentId?: string | undefined;
  readonly writeScope: readonly string[];
  readonly status: string;
  readonly laneId?: string | undefined;
}

function normalizeScopePattern(pattern: string): string {
  const p = pattern.trim();
  if (p.startsWith("./")) return p.slice(2);
  if (p.startsWith("/")) return p.slice(1);
  return p;
}

function scopesOverlap(scopeA: readonly string[], scopeB: readonly string[]): string[] {
  const overlaps: string[] = [];
  for (const a of scopeA) {
    const normA = normalizeScopePattern(a);
    for (const b of scopeB) {
      const normB = normalizeScopePattern(b);
      if (normA === normB) {
        overlaps.push(normA);
      } else if (normA.endsWith("/**") && normB.startsWith(normA.slice(0, -3))) {
        overlaps.push(`${normB} matched by ${normA}`);
      } else if (normB.endsWith("/**") && normA.startsWith(normB.slice(0, -3))) {
        overlaps.push(`${normA} matched by ${normB}`);
      }
    }
  }
  return overlaps;
}

export function checkAntiBatchingIsolation(
  options: AntiBatchingIsolationOptions = {},
): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const activeTasks: ActiveTaskInfo[] = [];

  const rawTasks = options.tasks ?? (options.state?.tasks as Record<string, unknown> | undefined);
  if (rawTasks && typeof rawTasks === "object") {
    for (const [key, val] of Object.entries(rawTasks)) {
      if (val && typeof val === "object") {
        const task = val as Record<string, unknown>;
        const id = typeof task.id === "string" ? task.id : key;
        const status = typeof task.status === "string" ? task.status : "open";
        const lease =
          task.lease && typeof task.lease === "object"
            ? (task.lease as Record<string, unknown>)
            : undefined;
        const agentId =
          typeof lease?.agent_id === "string"
            ? lease.agent_id
            : typeof task.assigned_agent === "string"
              ? task.assigned_agent
              : undefined;
        const writeScope = Array.isArray(task.write_scope)
          ? task.write_scope.filter((s): s is string => typeof s === "string")
          : [];
        const laneId = typeof task.lane_id === "string" ? task.lane_id : undefined;

        const isActive = ["in_progress", "active", "running", "claimed"].includes(status);
        if (isActive) {
          activeTasks.push({ id, agentId, writeScope, status, laneId });
        }
      }
    }
  }

  const agentTaskMap = new Map<string, string[]>();
  for (const task of activeTasks) {
    if (task.agentId) {
      const existing = agentTaskMap.get(task.agentId) ?? [];
      existing.push(task.id);
      agentTaskMap.set(task.agentId, existing);
    }
  }

  for (const [agentId, taskIds] of agentTaskMap.entries()) {
    if (taskIds.length > 1) {
      findings.push({
        code: "ANTI_BATCHING_MULTIPLE_ACTIVE_LEASES",
        severity: "ERROR",
        engine: "checkAntiBatchingIsolation",
        message: `Anti-batching isolation breach: Agent "${agentId}" holds active concurrent leases across ${taskIds.length} tasks: ${taskIds.join(", ")}`,
        details: { agentId, taskIds },
      });
    }
  }

  for (let i = 0; i < activeTasks.length; i += 1) {
    for (let j = i + 1; j < activeTasks.length; j += 1) {
      const taskA = activeTasks[i]!;
      const taskB = activeTasks[j]!;
      if (taskA.writeScope.length > 0 && taskB.writeScope.length > 0) {
        const overlaps = scopesOverlap(taskA.writeScope, taskB.writeScope);
        if (overlaps.length > 0) {
          findings.push({
            code: "ANTI_BATCHING_WRITE_SCOPE_COLLISION",
            severity: "ERROR",
            engine: "checkAntiBatchingIsolation",
            message: `Concurrent tasks "${taskA.id}" and "${taskB.id}" have overlapping write scopes: ${overlaps.join(", ")}`,
            details: {
              taskA: taskA.id,
              taskB: taskB.id,
              overlaps,
            },
          });
        }
      }
    }
  }

  return {
    engine: "checkAntiBatchingIsolation",
    passed: findings.filter((f) => f.severity === "ERROR").length === 0,
    findings,
  };
}
