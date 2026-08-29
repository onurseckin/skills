import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export const MIN_ADVERSARIAL_PROBES = 5;
export const MANDATORY_COGNITIVE_PUSHBACKS = 5;

export interface PushbackQuotasCheckOptions {
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly tasks?: Readonly<Record<string, unknown>> | null | undefined;
  readonly events?: readonly Readonly<Record<string, unknown>>[] | null | undefined;
  readonly minProbes?: number | undefined;
  readonly minPushbacks?: number | undefined;
}

function countProbesForTask(task: Record<string, unknown>, events: readonly Record<string, unknown>[], taskId: string): number {
  let count = 0;
  if (Array.isArray(task.adversarial_probes)) count += task.adversarial_probes.length;
  else if (typeof task.adversarial_probes === "number") count += task.adversarial_probes;
  else if (Array.isArray(task.probes)) count += task.probes.length;
  else if (typeof task.probes === "number") count += task.probes;

  // Add event counts
  for (const evt of events) {
    const name = typeof evt.name === "string" ? evt.name : typeof evt.type === "string" ? evt.type : "";
    const payload = evt.payload && typeof evt.payload === "object" ? (evt.payload as Record<string, unknown>) : {};
    if (payload.task_id === taskId && (name.includes("probe") || name.includes("adversarial"))) {
      count += 1;
    }
  }

  return count;
}

function countPushbacksForTask(task: Record<string, unknown>, events: readonly Record<string, unknown>[], taskId: string): number {
  let count = 0;
  if (Array.isArray(task.cognitive_pushbacks)) count += task.cognitive_pushbacks.length;
  else if (typeof task.cognitive_pushbacks === "number") count += task.cognitive_pushbacks;
  else if (Array.isArray(task.pushbacks)) count += task.pushbacks.length;
  else if (typeof task.pushbacks === "number") count += task.pushbacks;

  // Add event counts
  for (const evt of events) {
    const name = typeof evt.name === "string" ? evt.name : typeof evt.type === "string" ? evt.type : "";
    const payload = evt.payload && typeof evt.payload === "object" ? (evt.payload as Record<string, unknown>) : {};
    if (payload.task_id === taskId && (name.includes("pushback") || name.includes("critic-feedback"))) {
      count += 1;
    }
  }

  return count;
}

/**
 * Engine 8: checkPushbackQuotas
 * Enforces MIN_ADVERSARIAL_PROBES = 5 and MANDATORY_COGNITIVE_PUSHBACKS = 5.
 * Any completed task with fewer than 5 cognitive pushbacks or 5 adversarial probes is an ERROR.
 */
export function checkPushbackQuotas(options: PushbackQuotasCheckOptions = {}): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const minProbes = options.minProbes ?? MIN_ADVERSARIAL_PROBES;
  const minPushbacks = options.minPushbacks ?? MANDATORY_COGNITIVE_PUSHBACKS;
  const rawEvents = (options.events ?? []) as readonly Record<string, unknown>[];

  const rawTasks = options.tasks ?? (options.state?.tasks as Record<string, unknown> | undefined);
  if (rawTasks && typeof rawTasks === "object") {
    for (const [key, val] of Object.entries(rawTasks)) {
      if (val && typeof val === "object") {
        const task = val as Record<string, unknown>;
        const id = typeof task.id === "string" ? task.id : key;
        const status = typeof task.status === "string" ? task.status : "open";
        const isCompleted = status === "satisfied" || status === "completed" || status === "done";

        const probeCount = countProbesForTask(task, rawEvents, id);
        const pushbackCount = countPushbacksForTask(task, rawEvents, id);

        if (isCompleted) {
          if (probeCount < minProbes) {
            findings.push({
              code: "PUSHBACK_QUOTA_ADVERSARIAL_PROBES_DEFICIT",
              severity: "ERROR",
              engine: "checkPushbackQuotas",
              message: `Task "${id}" completed with only ${probeCount}/${minProbes} adversarial probes (minimum required: ${minProbes})`,
              details: { taskId: id, actualProbes: probeCount, requiredProbes: minProbes },
            });
          }
          if (pushbackCount < minPushbacks) {
            findings.push({
              code: "PUSHBACK_QUOTA_COGNITIVE_PUSHBACKS_DEFICIT",
              severity: "ERROR",
              engine: "checkPushbackQuotas",
              message: `Task "${id}" completed with only ${pushbackCount}/${minPushbacks} cognitive pushbacks (minimum required: ${minPushbacks})`,
              details: { taskId: id, actualPushbacks: pushbackCount, requiredPushbacks: minPushbacks },
            });
          }
        } else {
          findings.push({
            code: "PUSHBACK_QUOTA_IN_FLIGHT_STATUS",
            severity: "INFO",
            engine: "checkPushbackQuotas",
            message: `Task "${id}" in flight: ${probeCount}/${minProbes} probes, ${pushbackCount}/${minPushbacks} pushbacks recorded`,
            details: { taskId: id, actualProbes: probeCount, actualPushbacks: pushbackCount },
          });
        }
      }
    }
  }

  return {
    engine: "checkPushbackQuotas",
    passed: findings.filter((f) => f.severity === "ERROR").length === 0,
    findings,
  };
}
