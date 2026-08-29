import type { RepoPolicy } from "../../policy/types/index.ts";
import { inspectRepoPolicy } from "../../policy/repo-policy.ts";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export const MIN_ADVERSARIAL_PROBES = 5;
export const MANDATORY_COGNITIVE_PUSHBACKS = 5;

export interface PushbackQuotasCheckOptions {
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly tasks?: Readonly<Record<string, unknown>> | null | undefined;
  readonly events?: readonly unknown[] | null | undefined;
  readonly minProbes?: number | undefined;
  readonly minPushbacks?: number | undefined;
  readonly repoRoot?: string | undefined;
  readonly policy?: RepoPolicy | undefined;
}

function resolveQuotas(options: PushbackQuotasCheckOptions): {
  minProbes: number;
  minPushbacks: number;
} {
  let policy = options.policy;
  if (!policy && options.repoRoot) {
    const inspected = inspectRepoPolicy(options.repoRoot);
    if (inspected.status === "valid_custom" || inspected.status === "auto_detected") {
      policy = inspected.policy;
    }
  }

  const validatorQuota = policy?.agents?.["validator_code_quality"]?.quotas;
  const reviewProtocol = policy?.review_protocol;

  const minProbes = options.minProbes ?? MIN_ADVERSARIAL_PROBES;

  const minPushbacks =
    options.minPushbacks ??
    validatorQuota?.mandatory_cognitive_pushbacks ??
    reviewProtocol?.cognitive_pushes ??
    MANDATORY_COGNITIVE_PUSHBACKS;

  return { minProbes, minPushbacks };
}

function matchesTaskId(
  payload: Record<string, unknown>,
  evt: Record<string, unknown>,
  taskId: string,
): boolean {
  return (
    payload["task_id"] === taskId ||
    payload["taskId"] === taskId ||
    payload["task"] === taskId ||
    evt["task_id"] === taskId ||
    evt["taskId"] === taskId ||
    evt["task"] === taskId
  );
}

function countProbesForTask(
  task: Record<string, unknown>,
  events: readonly Record<string, unknown>[],
  taskId: string,
): number {
  let count = 0;
  if (Array.isArray(task["adversarial_probes"])) count += task["adversarial_probes"].length;
  else if (typeof task["adversarial_probes"] === "number") count += task["adversarial_probes"];
  else if (Array.isArray(task["probes"])) count += task["probes"].length;
  else if (typeof task["probes"] === "number") count += task["probes"];

  if (typeof task["probe_round"] === "number" && task["probe_round"] > count) {
    count = task["probe_round"];
  }

  const reviewHistory = task["review_history"];
  if (Array.isArray(reviewHistory)) {
    const historyAdv = reviewHistory.filter(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as Record<string, unknown>)["channel"] === "adversarial",
    ).length;
    if (historyAdv > count) count = historyAdv;
  }

  for (const evt of events) {
    const name =
      typeof evt["name"] === "string"
        ? evt["name"]
        : typeof evt["type"] === "string"
          ? evt["type"]
          : "";
    const payload =
      evt["payload"] && typeof evt["payload"] === "object"
        ? (evt["payload"] as Record<string, unknown>)
        : {};
    if (
      matchesTaskId(payload, evt, taskId) &&
      (name.includes("probe") || name.includes("adversarial") || name === "task-probe")
    ) {
      count += 1;
    }
  }

  return count;
}

function countPushbacksForTask(
  task: Record<string, unknown>,
  events: readonly Record<string, unknown>[],
  taskId: string,
): number {
  let count = 0;
  if (Array.isArray(task["cognitive_pushbacks"])) count += task["cognitive_pushbacks"].length;
  else if (typeof task["cognitive_pushbacks"] === "number") count += task["cognitive_pushbacks"];
  else if (Array.isArray(task["pushbacks"])) count += task["pushbacks"].length;
  else if (typeof task["pushbacks"] === "number") count += task["pushbacks"];

  if (
    typeof task["cognitive_rounds_completed"] === "number" &&
    task["cognitive_rounds_completed"] > count
  ) {
    count = task["cognitive_rounds_completed"];
  }

  const reviewHistory = task["review_history"];
  if (Array.isArray(reviewHistory)) {
    const historyCog = reviewHistory.filter(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as Record<string, unknown>)["channel"] === "cognitive",
    ).length;
    if (historyCog > count) count = historyCog;
  }

  for (const evt of events) {
    const name =
      typeof evt["name"] === "string"
        ? evt["name"]
        : typeof evt["type"] === "string"
          ? evt["type"]
          : "";
    const payload =
      evt["payload"] && typeof evt["payload"] === "object"
        ? (evt["payload"] as Record<string, unknown>)
        : {};
    if (
      matchesTaskId(payload, evt, taskId) &&
      (name.includes("pushback") ||
        name.includes("critic-feedback") ||
        name.includes("task-rejected") ||
        name.includes("cognitive") ||
        name === "coordinator-pushback")
    ) {
      count += 1;
    }
  }

  return count;
}

/**
 * Engine 8: checkPushbackQuotas
 * Verifies that completed tasks satisfy mandatory_cognitive_pushbacks and max_adversarial_probes from .olt/policy.json.
 */
export function checkPushbackQuotas(
  options: PushbackQuotasCheckOptions = {},
): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const { minProbes, minPushbacks } = resolveQuotas(options);
  const rawEvents = (options.events ?? []) as readonly Record<string, unknown>[];

  const rawTasks = options.tasks ?? (options.state?.tasks as Record<string, unknown> | undefined);
  if (rawTasks && typeof rawTasks === "object") {
    for (const [key, val] of Object.entries(rawTasks)) {
      if (val && typeof val === "object") {
        const task = val as Record<string, unknown>;
        const id = typeof task["id"] === "string" ? task["id"] : key;
        const status = typeof task["status"] === "string" ? task["status"] : "open";
        const isCompleted =
          status === "satisfied" ||
          status === "completed" ||
          status === "done" ||
          status === "closed" ||
          task["resolution"] !== undefined;

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
              details: {
                taskId: id,
                actualPushbacks: pushbackCount,
                requiredPushbacks: minPushbacks,
              },
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
