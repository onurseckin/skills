import type { AgentGrantRecord } from "../../core/contracts/agents.ts";
import { isJsonObject } from "../../core/contracts/json.ts";
import { readAgentLedger } from "../../workflow/agents/ledger.ts";
import type { NodeTelemetry, NodeTool, TokenUsageDetail } from "../types.ts";

export interface AgentLedgerView {
  grants: Map<string, AgentGrantRecord>;
  integrityIssue?: string;
}

export function readAgentLedgerView(state: unknown): AgentLedgerView {
  if (!isJsonObject(state)) return { grants: new Map() };
  try {
    const grants = new Map<string, AgentGrantRecord>();
    for (const grant of readAgentLedger(state)) {
      grants.set(grant.id, grant);
    }
    return { grants };
  } catch (error) {
    return {
      grants: new Map(),
      integrityIssue: error instanceof Error ? error.message : "state.agents is unreadable",
    };
  }
}

export function buildNodeTelemetry(
  agentId: string | undefined,
  view: AgentLedgerView,
): NodeTelemetry | undefined {
  if (!agentId) return undefined;
  const grant = view.grants.get(agentId);
  if (!grant) return undefined;

  const telemetry: NodeTelemetry = {
    agentId: grant.id,
    role: grant.role,
    host: grant.host,
    grantStatus: grant.status,
  };
  if (grant.provider) telemetry.provider = grant.provider;
  if (grant.model) telemetry.model = grant.model;
  if (grant.model_tier) telemetry.modelTier = grant.model_tier;
  if (grant.thinking_level) telemetry.thinkingLevel = grant.thinking_level;
  if (grant.context_window) telemetry.contextWindow = grant.context_window;
  if (grant.tokens_in) telemetry.tokensIn = grant.tokens_in;
  if (grant.tokens_out) telemetry.tokensOut = grant.tokens_out;
  if (grant.token_extras && Object.keys(grant.token_extras).length > 0) {
    telemetry.tokenExtras = grant.token_extras;
  }
  if (grant.telemetry_conflicts && grant.telemetry_conflicts.length > 0) {
    telemetry.telemetryConflicts = grant.telemetry_conflicts;
  }
  return telemetry;
}

export function buildNodeTools(agentId: string | undefined, view: AgentLedgerView): NodeTool[] {
  if (!agentId) return [];
  const grant = view.grants.get(agentId);
  if (!grant) return [];

  const tools: NodeTool[] = [];
  const seen = new Set<string>();
  for (const used of grant.tools_used ?? []) {
    if (seen.has(used.name)) continue;
    seen.add(used.name);
    tools.push({
      name: used.name,
      ...(used.category === undefined ? {} : { category: used.category }),
      ...(used.extras === undefined ? {} : { extras: used.extras }),
      evidence_class: used.evidence_class,
      ...(used.first_reported_at ? { firstReportedAt: used.first_reported_at } : {}),
    });
  }
  for (const granted of grant.tools_granted?.value ?? []) {
    if (seen.has(granted.name)) continue;
    seen.add(granted.name);
    tools.push({
      name: granted.name,
      ...(granted.category === undefined ? {} : { category: granted.category }),
      ...(granted.extras === undefined ? {} : { extras: granted.extras }),
      evidence_class: grant.tools_granted?.evidence_class ?? "unknown",
    });
  }
  return tools;
}

export function reportedTokenUsage(
  agentId: string | undefined,
  view: AgentLedgerView,
): TokenUsageDetail | undefined {
  if (!agentId) return undefined;
  const grant = view.grants.get(agentId);
  if (!grant) return undefined;
  const input = grant.tokens_in?.value;
  const output = grant.tokens_out?.value;
  if (input === undefined && output === undefined) return undefined;
  return {
    ...(input !== undefined ? { inputTokens: input } : {}),
    ...(output !== undefined ? { outputTokens: output } : {}),
    totalTokens: (input ?? 0) + (output ?? 0),
    isEstimated: false,
    evidenceClass: grant.tokens_in?.evidence_class ?? grant.tokens_out?.evidence_class ?? "unknown",
  };
}
