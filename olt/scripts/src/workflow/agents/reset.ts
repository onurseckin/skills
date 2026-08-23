import type { AgentGrantRecord } from "../../core/contracts/agents.ts";
import type { JsonObject } from "../../core/contracts/json.ts";
import {
  readAgentLedger,
  releaseAllActiveGrants,
  releaseGrantInLedger,
  writeAgentLedger,
} from "./ledger.ts";

export interface WorkflowPort {
  read(): JsonObject;
  write(draft: JsonObject): void;
}

export interface AgentResetOptions {
  agentIds?: readonly string[] | undefined;
  allActive?: boolean | undefined;
  reason?: string | undefined;
  clock?: () => string | undefined;
}

export interface AgentResetResult {
  releasedAgentIds: readonly string[];
  releasedCount: number;
  hostDirectives: {
    action: "kill" | "kill_all";
    conversationIds?: readonly string[] | undefined;
  };
  summary: string;
}

export function executeAgentReset(
  port: WorkflowPort,
  options?: AgentResetOptions,
): AgentResetResult {
  const state = port.read();
  const ledger = readAgentLedger(state);
  const reason =
    typeof options?.reason === "string" && options.reason.length > 0
      ? options.reason
      : "hard_agent_reset";
  const releasedAt = options?.clock?.() ?? new Date().toISOString();

  let targetAgentIds: string[];
  let updatedLedger: AgentGrantRecord[];
  let hostDirectives: AgentResetResult["hostDirectives"];

  if (options?.allActive) {
    const activeGrants = ledger.filter((g) => g.status === "active");
    targetAgentIds = activeGrants.map((g) => g.id);
    updatedLedger = releaseAllActiveGrants(ledger, reason, releasedAt);
    hostDirectives = { action: "kill_all" };
  } else {
    const requestedIds = options?.agentIds ?? [];
    const requestedSet = new Set(requestedIds);
    const activeGrants = ledger.filter((g) => g.status === "active" && requestedSet.has(g.id));
    targetAgentIds = activeGrants.map((g) => g.id);

    let nextLedger = [...ledger];
    for (const id of targetAgentIds) {
      nextLedger = releaseGrantInLedger(nextLedger, id, reason, releasedAt);
    }
    updatedLedger = nextLedger;
    hostDirectives = {
      action: "kill",
      conversationIds: targetAgentIds,
    };
  }

  const updatedState: JsonObject = { ...state };
  writeAgentLedger(updatedState, updatedLedger);
  port.write(updatedState);

  const releasedCount = targetAgentIds.length;
  const summary =
    releasedCount === 0
      ? "No active agent grants were released."
      : `Released ${releasedCount} active agent grant(s): ${targetAgentIds.join(", ")}.`;

  return {
    releasedAgentIds: targetAgentIds,
    releasedCount,
    hostDirectives,
    summary,
  };
}

export function formatAgentResetBrief(result: AgentResetResult): string {
  const lines: string[] = [
    "# Hard Agent Reset Brief",
    "",
    `- **Released Count**: ${result.releasedCount}`,
    `- **Directive Action**: \`${result.hostDirectives.action}\``,
  ];

  if (result.releasedAgentIds.length > 0) {
    lines.push(
      `- **Released Agents**: ${result.releasedAgentIds.map((id) => `\`${id}\``).join(", ")}`,
    );
  } else {
    lines.push("- **Released Agents**: _None_");
  }

  if (result.hostDirectives.conversationIds !== undefined) {
    if (result.hostDirectives.conversationIds.length > 0) {
      lines.push(
        `- **Conversation IDs**: ${result.hostDirectives.conversationIds.map((id) => `\`${id}\``).join(", ")}`,
      );
    } else {
      lines.push("- **Conversation IDs**: _None_");
    }
  }

  lines.push(`- **Summary**: ${result.summary}`);
  return lines.join("\n");
}
