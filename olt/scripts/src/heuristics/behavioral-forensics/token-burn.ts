/**
 * @file token-burn.ts
 * Behavioral heuristics for detecting token burning, excessive exploration, and prompt bloat.
 */

import { createIncident } from "./incident-generator.ts";
import type { BehavioralForensicsContext, ExtractedToolCall, ForensicsSeverity } from "./types.ts";

export interface TokenBurnAnalysisResult {
  readonly excessiveReadsCount: number;
  readonly highExplorationDetected: boolean;
  readonly promptBloatDetected: boolean;
}

export function evaluateTokenBurnHeuristics(
  ctx: BehavioralForensicsContext,
): TokenBurnAnalysisResult {
  const { allToolCalls, agents, addIncident } = ctx;
  let excessiveReadsCount = 0;
  let highExplorationDetected = false;
  let promptBloatDetected = false;

  const callsByAgent = new Map<string, ExtractedToolCall[]>();
  for (const call of allToolCalls) {
    const aid = call.agentId ?? "unknown";
    const existing = callsByAgent.get(aid);
    if (existing) {
      existing.push(call);
    } else {
      callsByAgent.set(aid, [call]);
    }
  }

  for (const [aid, agentCalls] of callsByAgent.entries()) {
    let readsBeforeWrite = 0;
    for (const call of agentCalls) {
      if (call.isWrite) {
        break;
      }
      if (call.isRead) {
        readsBeforeWrite++;
      }
    }

    if (readsBeforeWrite >= 5) {
      excessiveReadsCount++;
      const severity: ForensicsSeverity = readsBeforeWrite > 10 ? "CRITICAL" : "HIGH";
      addIncident(
        createIncident({
          category: "TOKEN_BURNING",
          target: `excessive_reads_${aid}`,
          title: "Token Burning: Excessive Read Exploration Before First Edit",
          observation: `Agent '${aid}' executed ${readsBeforeWrite} read operations before first code modification.`,
          severity,
          agentId: aid,
          toolCallsCount: readsBeforeWrite,
          metricsSnapshot: { readsBeforeWrite, aid },
        }),
      );
    }
  }

  if (allToolCalls.length >= 15) {
    const readCalls = allToolCalls.filter((c) => c.isRead).length;
    const explorationRatio = readCalls / allToolCalls.length;
    if (explorationRatio > 0.85) {
      highExplorationDetected = true;
      const pct = Math.round(explorationRatio * 100);
      addIncident(
        createIncident({
          category: "TOKEN_BURNING",
          target: "high_exploration_ratio",
          title: "Token Burning: High Exploration-to-Edit Ratio",
          observation: `Exploration ratio of ${pct}% exceeds the 85% maximum threshold.`,
          severity: explorationRatio > 0.95 ? "HIGH" : "MEDIUM",
          toolCallsCount: readCalls,
          metricsSnapshot: { readCalls, totalCalls: allToolCalls.length, explorationRatio },
        }),
      );
    }
  }

  if (agents && agents.length > 0) {
    for (const agent of agents) {
      const tokensIn = agent.tokensIn ?? 0;
      const totalTokens = agent.totalTokens ?? tokensIn + (agent.tokensOut ?? 0);
      if (totalTokens > 150000 || tokensIn > 120000) {
        promptBloatDetected = true;
        const severity: ForensicsSeverity =
          totalTokens > 180000 || tokensIn > 150000 ? "CRITICAL" : "HIGH";
        const isBloat = tokensIn > 120000 && totalTokens <= 150000;
        addIncident(
          createIncident({
            category: "CONTEXT_OVERFLOW",
            target: `prompt_bloat_${agent.id}`,
            title: isBloat
              ? "Context Overflow: Active Prompt Token Bloat"
              : "Context Overflow: Agent Exceeded Safe Token Budget",
            observation: isBloat
              ? `Agent '${agent.id}' prompt payload (${tokensIn.toLocaleString()} tokens_in) approached context window limits.`
              : `Agent '${agent.id}' consumed ${totalTokens.toLocaleString()} total tokens.`,
            severity,
            agentId: agent.id,
            metricsSnapshot: { tokensIn, totalTokens },
          }),
        );
      }
    }
  }

  return {
    excessiveReadsCount,
    highExplorationDetected,
    promptBloatDetected,
  };
}
