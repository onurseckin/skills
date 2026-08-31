/**
 * @file system-leaks.ts
 * Behavioral heuristics for polling waste, context overflows, ghost leases, and stragglers.
 */

import { createIncident } from "./incident-generator.ts";
import type {
  AgentRecord,
  BehavioralForensicsContext,
  ForensicsSeverity,
  TaskRecord,
} from "./types.ts";

export interface SystemLeaksAnalysisResult {
  readonly pollingCallsCount: number;
  readonly ghostLeasesCount: number;
  readonly stragglerTasksCount: number;
  readonly contextOverflowCount: number;
}

export function evaluateSystemLeaksHeuristics(
  ctx: BehavioralForensicsContext,
): SystemLeaksAnalysisResult {
  const { allToolCalls, tasks, agents, state, addIncident } = ctx;
  let pollingCallsCount = 0;
  let ghostLeasesCount = 0;
  let stragglerTasksCount = 0;
  let contextOverflowCount = 0;

  let firstPollingAgent: string | undefined;
  for (const call of allToolCalls) {
    if (call.isPoll) {
      pollingCallsCount++;
      if (!firstPollingAgent && call.agentId) {
        firstPollingAgent = call.agentId;
      }
    }
  }

  if (pollingCallsCount >= 5) {
    const severity: ForensicsSeverity = pollingCallsCount >= 12 ? "HIGH" : "MEDIUM";
    addIncident(
      createIncident({
        category: "POLLING_WASTE",
        target: "high_frequency_polling_loops",
        title: "Polling Waste: High Frequency Status Polling Loop",
        observation: `Observed ${pollingCallsCount} active status polling calls instead of reactive wakeups.`,
        severity,
        agentId: firstPollingAgent,
        toolCallsCount: pollingCallsCount,
        metricsSnapshot: { pollingCallsCount },
      }),
    );
  }

  const agentList: AgentRecord[] = [];
  if (agents && agents.length > 0) {
    agentList.push(...agents);
  } else if (state && Array.isArray(state["agents"])) {
    for (const a of state["agents"]) {
      if (typeof a === "object" && a !== null) {
        const raw = a as Record<string, unknown>;
        agentList.push({
          id: String(raw["id"] ?? raw["agent_id"] ?? raw["name"] ?? "agent"),
          role: typeof raw["role"] === "string" ? raw["role"] : undefined,
          status: typeof raw["status"] === "string" ? raw["status"] : undefined,
          tokensIn: typeof raw["tokens_in"] === "number" ? raw["tokens_in"] : 0,
          tokensOut: typeof raw["tokens_out"] === "number" ? raw["tokens_out"] : 0,
          totalTokens: typeof raw["total_tokens"] === "number" ? raw["total_tokens"] : 0,
        });
      }
    }
  }

  const releasedAgentIds = new Set<string>();
  for (const ag of agentList) {
    if (ag.status === "released" || ag.status === "quiesced" || ag.status === "dead") {
      releasedAgentIds.add(ag.id);
    }
  }

  const taskList: TaskRecord[] = [];
  if (tasks && tasks.length > 0) {
    taskList.push(...tasks);
  } else if (
    state &&
    typeof state === "object" &&
    typeof state["tasks"] === "object" &&
    state["tasks"] !== null
  ) {
    const rawTasks = state["tasks"] as Record<string, Record<string, unknown>>;
    for (const [id, raw] of Object.entries(rawTasks)) {
      const lease =
        typeof raw["lease"] === "object" && raw["lease"] !== null
          ? (raw["lease"] as Record<string, unknown>)
          : undefined;
      const leaseAgentId =
        lease && typeof lease["agent_id"] === "string" ? lease["agent_id"] : undefined;
      const durationSec = typeof raw["duration_sec"] === "number" ? raw["duration_sec"] : undefined;

      taskList.push({
        id,
        status: typeof raw["status"] === "string" ? raw["status"] : "unknown",
        writeScope: [],
        dependencies: [],
        durationSec,
        lease: leaseAgentId ? { agentId: leaseAgentId } : undefined,
      });
    }
  }

  for (const task of taskList) {
    const leaseHolder = task.lease?.agentId;
    const isLeased = task.status === "leased" || leaseHolder !== undefined;
    if (isLeased && leaseHolder && releasedAgentIds.has(leaseHolder)) {
      ghostLeasesCount++;
      addIncident(
        createIncident({
          category: "GHOST_LEASE",
          target: `ghost_lease_${task.id}`,
          title: "Ghost Lease: Task Retained by Released or Quiesced Agent",
          observation: `Task '${task.id}' remained leased to agent '${leaseHolder}' which has already been released.`,
          severity: "HIGH",
          taskId: task.id,
          agentId: leaseHolder,
          metricsSnapshot: { taskId: task.id, leaseHolder },
        }),
      );
    }
  }

  const durations = taskList
    .filter((t) => typeof t.durationSec === "number" && t.durationSec > 0)
    .map((t) => ({ id: t.id, durationSec: t.durationSec as number }));

  if (durations.length > 0) {
    const totalSec = durations.reduce((acc, d) => acc + d.durationSec, 0);
    const avgSec = totalSec / durations.length;

    for (const { id, durationSec } of durations) {
      let isStraggler = false;
      let ratio = 1;

      if (durations.length === 1) {
        if (durationSec > 300) {
          isStraggler = true;
          ratio = Math.round(durationSec / 120);
        }
      } else {
        const otherCount = durations.length - 1;
        const otherAvg = (totalSec - durationSec) / otherCount;
        if (durationSec > 300 || (durationSec > 120 && durationSec > 3 * (otherAvg || avgSec))) {
          isStraggler = true;
          ratio = Math.round(durationSec / (otherAvg || avgSec || 1));
        }
      }

      if (isStraggler) {
        stragglerTasksCount++;
        addIncident(
          createIncident({
            category: "STRAGGLER",
            target: `straggler_${id}`,
            title: "Straggler: Task Dominating Turn Span",
            observation: `Task '${id}' took ${Math.round(durationSec)}s (${ratio}x cohort peer average of ${Math.round(avgSec)}s).`,
            severity: durationSec > 600 ? "HIGH" : "MEDIUM",
            taskId: id,
            metricsSnapshot: { durationSec, avgSec, ratio },
          }),
        );
      }
    }
  }

  for (const agent of agentList) {
    const totalTokens = agent.totalTokens ?? (agent.tokensIn ?? 0) + (agent.tokensOut ?? 0);
    if (totalTokens > 150000) {
      contextOverflowCount++;
    }
  }

  return {
    pollingCallsCount,
    ghostLeasesCount,
    stragglerTasksCount,
    contextOverflowCount,
  };
}
