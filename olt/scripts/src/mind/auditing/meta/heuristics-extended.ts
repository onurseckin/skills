import { generateIncidentId } from "./types.ts";
import type { ForensicsSeverity, HeuristicsContext } from "./types.ts";

export function runExtendedForensicsHeuristics(ctx: HeuristicsContext): void {
  const { allToolCalls, state, agentLedger, addIncident } = ctx;

  let pollingCallsCount = 0;
  let pollingAgent: string | undefined;
  for (const call of allToolCalls) {
    if (call.isPoll) {
      pollingCallsCount++;
      if (!pollingAgent && call.agentId) pollingAgent = call.agentId;
    }
  }
  if (pollingCallsCount >= 5) {
    addIncident({
      id: generateIncidentId("POLLING_WASTE", "high_frequency_polling"),
      category: "POLLING_WASTE",
      severity: "MEDIUM",
      title: "Polling Waste: High Frequency Status Polling",
      observation: `Observed ${pollingCallsCount} polling calls.`,
      description: `Observed ${pollingCallsCount} polling calls.`,
      remediation: "Use reactive background notifications and stop polling in loops.",
      recommendation: "Use reactive background notifications and stop polling in loops.",
      agentId: pollingAgent,
    });
  }

  const agentsToCheck: {
    id: string;
    tokensIn: number;
    tokensOut: number;
    totalTokens: number;
  }[] = [];
  if (agentLedger && agentLedger.length > 0) {
    for (const a of agentLedger) {
      const rec = a as unknown as Record<string, unknown>;
      const id = String(rec["id"] ?? rec["agent_id"] ?? rec["name"] ?? "agent");
      const tokensIn = typeof rec["tokens_in"] === "number" ? rec["tokens_in"] : 0;
      const tokensOut = typeof rec["tokens_out"] === "number" ? rec["tokens_out"] : 0;
      const totalTokens =
        typeof rec["total_tokens"] === "number" ? rec["total_tokens"] : tokensIn + tokensOut;
      agentsToCheck.push({ id, tokensIn, tokensOut, totalTokens });
    }
  } else if (state && Array.isArray(state["agents"])) {
    for (const a of state["agents"]) {
      if (typeof a === "object" && a !== null) {
        const rec = a as Record<string, unknown>;
        const id = String(rec["id"] ?? rec["agent_id"] ?? rec["name"] ?? "agent");
        const tokensIn = typeof rec["tokens_in"] === "number" ? rec["tokens_in"] : 0;
        const tokensOut = typeof rec["tokens_out"] === "number" ? rec["tokens_out"] : 0;
        const totalTokens =
          typeof rec["total_tokens"] === "number" ? rec["total_tokens"] : tokensIn + tokensOut;
        agentsToCheck.push({ id, tokensIn, tokensOut, totalTokens });
      }
    }
  }

  for (const { id, tokensIn, totalTokens } of agentsToCheck) {
    if (totalTokens > 150000 || tokensIn > 120000) {
      const severity: ForensicsSeverity =
        totalTokens > 180000 || tokensIn > 150000 ? "CRITICAL" : "HIGH";
      const isPromptBloat = tokensIn > 120000 && totalTokens <= 150000;
      const observation = isPromptBloat
        ? `Agent '${id}' prompt payload (${tokensIn} tokens_in) approached context window boundary.`
        : `Agent '${id}' consumed ${totalTokens} tokens.`;

      addIncident({
        id: generateIncidentId("CONTEXT_OVERFLOW", id),
        category: "CONTEXT_OVERFLOW",
        severity,
        title: isPromptBloat
          ? "Context Overflow: Active Prompt Token Bloat"
          : "Context Overflow: Agent Exceeded Token Threshold",
        observation,
        description: observation,
        remediation: "Quiesce and rotate agent to prevent context degeneration.",
        recommendation: "Quiesce and rotate agent to prevent context degeneration.",
        agentId: id,
      });
    }
  }

  if (state && typeof state === "object") {
    const rawAgents = Array.isArray(state["agents"])
      ? (state["agents"] as Record<string, unknown>[])
      : [];
    const releasedAgents = new Set<string>();
    for (const a of rawAgents) {
      if (a["status"] === "released" && typeof a["id"] === "string") {
        releasedAgents.add(a["id"]);
      }
    }

    const rawTasks =
      typeof state["tasks"] === "object" && state["tasks"] !== null
        ? (state["tasks"] as Record<string, Record<string, unknown>>)
        : {};
    for (const [tid, task] of Object.entries(rawTasks)) {
      const lease =
        typeof task["lease"] === "object" && task["lease"] !== null
          ? (task["lease"] as Record<string, unknown>)
          : null;
      const agentId = lease ? String(lease["agent_id"] ?? "") : "";
      const isLeased = task["status"] === "leased" || lease !== null;

      if (isLeased && agentId && releasedAgents.has(agentId)) {
        addIncident({
          id: generateIncidentId("GHOST_LEASE", tid),
          category: "GHOST_LEASE",
          severity: "HIGH",
          title: "Ghost Lease: Task Lease Retained by Released Agent",
          observation: `Task '${tid}' remains leased to released agent '${agentId}'.`,
          description: `Task '${tid}' remains leased to released agent '${agentId}'.`,
          remediation: "Reclaim and reset ghost leased task to queue.",
          recommendation: "Reclaim and reset ghost leased task to queue.",
          taskId: tid,
          agentId,
        });
      }
    }
  }

  if (
    state &&
    typeof state === "object" &&
    typeof state["tasks"] === "object" &&
    state["tasks"] !== null
  ) {
    const rawTasks = Object.entries(state["tasks"] as Record<string, Record<string, unknown>>);
    const taskDurations: { id: string; durationSec: number }[] = [];

    for (const [tid, task] of rawTasks) {
      if (Array.isArray(task["attempts"]) && task["attempts"].length > 0) {
        const lastAtt = task["attempts"][task["attempts"].length - 1] as Record<string, unknown>;
        if (
          typeof lastAtt["started_at"] === "string" &&
          typeof lastAtt["completed_at"] === "string"
        ) {
          const s = Date.parse(lastAtt["started_at"]);
          const c = Date.parse(lastAtt["completed_at"]);
          if (!isNaN(s) && !isNaN(c) && c > s) {
            taskDurations.push({ id: tid, durationSec: (c - s) / 1000 });
          }
        }
      }
    }

    if (taskDurations.length > 0) {
      const N = taskDurations.length;
      const avgDuration = taskDurations.reduce((acc, t) => acc + t.durationSec, 0) / N;

      for (const { id, durationSec } of taskDurations) {
        let isStraggler = false;
        let stragglerRatio = 1;

        if (N === 1) {
          if (durationSec > 300) {
            isStraggler = true;
            stragglerRatio = Math.round(durationSec / 120);
          }
        } else if (N === 2) {
          if (durationSec > 120 && durationSec > 3 * avgDuration) {
            isStraggler = true;
            stragglerRatio = Math.round(durationSec / avgDuration);
          }
        } else {
          if (durationSec > 120 && durationSec > 3 * avgDuration) {
            isStraggler = true;
            stragglerRatio = Math.round(durationSec / avgDuration);
          }
        }

        if (isStraggler) {
          addIncident({
            id: generateIncidentId("STRAGGLER", id),
            category: "STRAGGLER",
            severity: "MEDIUM",
            title: "Straggler: Task Execution Time Disproportionately Long",
            observation: `Task '${id}' ran for ${Math.round(durationSec)}s (${stragglerRatio}x average).`,
            description: `Task '${id}' ran for ${Math.round(durationSec)}s (${stragglerRatio}x average).`,
            remediation: "Decompose complex requirements into smaller granular tasks.",
            recommendation: "Decompose complex requirements into smaller granular tasks.",
            taskId: id,
          });
        }
      }
    }
  }
}
