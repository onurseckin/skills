import { OrphanedTasksProbeResult, StaleLeasesProbeResult, StaleLeaseInfo } from "./types.ts";
import { parseTimestamp } from "../../../authority/watchdog-manager";
import { isRecord } from "../../store/layout/layout-json.ts";

export function boundedEvidenceCause(error: unknown): string {
  if (typeof error === "string") return error.slice(0, 240);
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint" ||
    typeof error === "symbol" ||
    error === null ||
    error === undefined
  ) {
    return String(error).slice(0, 240);
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
      return descriptor.value.slice(0, 240);
    }
  } catch {}
  return "unknown error";
}
export function probeOrphanedTasks(state: unknown): OrphanedTasksProbeResult {
  const orphanedTaskIds: string[] = [];
  const disconnectedTaskIds: string[] = [];
  const unmappedRequirementTaskIds: string[] = [];
  const details: string[] = [];

  if (!isRecord(state) || !isRecord(state.tasks)) {
    return {
      passed: false,
      orphanedTaskIds: [],
      disconnectedTaskIds: [],
      unmappedRequirementTaskIds: [],
      details: ["State has no valid tasks record."],
    };
  }

  // Collect active requirement IDs
  const knownRequirementIds = new Set<string>();
  if (isRecord(state.requirements)) {
    const reqList = Array.isArray(state.requirements.requirements)
      ? state.requirements.requirements
      : Array.isArray(state.requirements)
        ? state.requirements
        : [];
    for (const req of reqList) {
      if (isRecord(req) && typeof req.id === "string") {
        knownRequirementIds.add(req.id);
      }
    }
  } else if (Array.isArray(state.requirements)) {
    for (const req of state.requirements) {
      if (isRecord(req) && typeof req.id === "string") {
        knownRequirementIds.add(req.id);
      }
    }
  }

  // Collect graph node task IDs
  const graphTaskIds = new Set<string>();
  if (isRecord(state.graph) && Array.isArray(state.graph.nodes)) {
    for (const node of state.graph.nodes) {
      if (isRecord(node) && node.type === "task" && typeof node.id === "string") {
        graphTaskIds.add(node.id);
      }
      if (
        isRecord(node) &&
        node.type === "requirement" &&
        typeof node.requirement_id === "string"
      ) {
        knownRequirementIds.add(node.requirement_id);
      }
    }
  }

  for (const [taskId, rawTask] of Object.entries(state.tasks)) {
    if (!isRecord(rawTask)) {
      orphanedTaskIds.push(taskId);
      details.push(`Task '${taskId}' has invalid record structure.`);
      continue;
    }

    const reqIds = Array.isArray(rawTask.requirement_ids) ? rawTask.requirement_ids : [];
    if (reqIds.length === 0) {
      orphanedTaskIds.push(taskId);
      unmappedRequirementTaskIds.push(taskId);
      details.push(`Task '${taskId}' has no mapped requirement_ids.`);
    } else {
      const invalidReqs = reqIds.filter(
        (id) =>
          typeof id !== "string" || (knownRequirementIds.size > 0 && !knownRequirementIds.has(id)),
      );
      if (invalidReqs.length > 0) {
        orphanedTaskIds.push(taskId);
        unmappedRequirementTaskIds.push(taskId);
        details.push(
          `Task '${taskId}' references unknown requirements: [${invalidReqs.join(", ")}].`,
        );
      }
    }

    // Check if task exists in graph nodes
    if (graphTaskIds.size > 0 && !graphTaskIds.has(taskId)) {
      disconnectedTaskIds.push(taskId);
      if (!orphanedTaskIds.includes(taskId)) {
        orphanedTaskIds.push(taskId);
      }
      details.push(`Task '${taskId}' exists in state tasks but is missing from graph nodes.`);
    }
  }

  return {
    passed: orphanedTaskIds.length === 0,
    orphanedTaskIds,
    disconnectedTaskIds,
    unmappedRequirementTaskIds,
    details,
  };
}
export function probeStaleLeases(
  state: unknown,
  options: { now?: Date | string | number | undefined; timeoutMs?: number | undefined } = {},
): StaleLeasesProbeResult {
  const nowMs = parseTimestamp(options.now);
  const timeoutMs = options.timeoutMs ?? 360_000;
  const staleTaskIds: string[] = [];
  const staleLeases: StaleLeaseInfo[] = [];
  const details: string[] = [];

  if (!isRecord(state) || !isRecord(state.tasks)) {
    return {
      passed: true,
      staleTaskIds: [],
      staleLeases: [],
      details: [],
    };
  }

  for (const [taskId, rawTask] of Object.entries(state.tasks)) {
    if (!isRecord(rawTask)) continue;
    const status = String(rawTask.status);

    if (status === "stale") {
      staleTaskIds.push(taskId);
      details.push(`Task '${taskId}' is explicitly marked stale.`);
      continue;
    }

    if (["leased", "running", "validating"].includes(status)) {
      if (isRecord(rawTask.lease)) {
        const lease = rawTask.lease;
        const expiresAtStr = typeof lease.expires_at === "string" ? lease.expires_at : "";
        const heartbeatAtStr = typeof lease.heartbeat_at === "string" ? lease.heartbeat_at : "";
        const issuedAtStr = typeof lease.issued_at === "string" ? lease.issued_at : "";
        const agentId = typeof lease.agent_id === "string" ? lease.agent_id : "unknown";
        const role = typeof lease.role === "string" ? lease.role : "unknown";
        const durationSeconds =
          typeof lease.duration_seconds === "number" ? lease.duration_seconds : 300;

        const expiresAtMs = expiresAtStr ? parseTimestamp(expiresAtStr) : 0;
        const heartbeatAtMs = heartbeatAtStr ? parseTimestamp(heartbeatAtStr) : 0;

        // Check if expires_at timestamp has passed
        if (expiresAtMs > 0 && expiresAtMs < nowMs) {
          const overdue = nowMs - expiresAtMs;
          staleTaskIds.push(taskId);
          staleLeases.push({
            taskId,
            agentId,
            role,
            issuedAt: issuedAtStr,
            expiresAt: expiresAtStr,
            lastHeartbeatAt: heartbeatAtStr,
            durationSeconds,
            overdueMs: overdue,
            reason: "expired_timestamp",
          });
          details.push(
            `Task '${taskId}' lease expired at ${expiresAtStr} (overdue by ${overdue}ms).`,
          );
          continue;
        }

        // Check if heartbeat is overdue
        if (heartbeatAtMs > 0 && nowMs - heartbeatAtMs > timeoutMs) {
          const overdue = nowMs - heartbeatAtMs;
          staleTaskIds.push(taskId);
          staleLeases.push({
            taskId,
            agentId,
            role,
            issuedAt: issuedAtStr,
            expiresAt: expiresAtStr,
            lastHeartbeatAt: heartbeatAtStr,
            durationSeconds,
            overdueMs: overdue,
            reason: "heartbeat_timeout",
          });
          details.push(
            `Task '${taskId}' heartbeat overdue by ${overdue}ms (threshold: ${timeoutMs}ms).`,
          );
        }
      }
    }
  }

  return {
    passed: staleTaskIds.length === 0,
    staleTaskIds,
    staleLeases,
    details,
  };
}
