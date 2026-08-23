import { describe, expect, test } from "bun:test";
import {
  buildNodeTelemetry,
  buildNodeTools,
  readAgentLedgerView,
  reportedTokenUsage,
} from "../../../olt/scripts/src/summary/agent-telemetry.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/contracts/agents.ts";

function grant(overrides: Partial<AgentGrantRecord> = {}): AgentGrantRecord {
  return {
    id: "agent-1",
    role: "implementer",
    parent_agent_id: null,
    parent_task_id: null,
    host: "claude-code",
    granted_at: "2026-08-19T00:00:00Z",
    status: "active",
    ...overrides,
  };
}

describe("readAgentLedgerView", () => {
  test("returns an empty view when state is not a JSON object", () => {
    expect(readAgentLedgerView(null)).toEqual({ grants: new Map() });
    expect(readAgentLedgerView("nope")).toEqual({ grants: new Map() });
  });

  test("indexes valid grant records by id", () => {
    const view = readAgentLedgerView({ agents: [grant(), grant({ id: "agent-2" })] });
    expect(view.grants.size).toBe(2);
    expect(view.grants.get("agent-1")?.host).toBe("claude-code");
    expect(view.integrityIssue).toBeUndefined();
  });

  test("captures an integrity issue and returns empty grants when state.agents is malformed", () => {
    const view = readAgentLedgerView({ agents: "not-an-array" });
    expect(view.grants.size).toBe(0);
    expect(view.integrityIssue).toContain("state.agents must be an array");
  });
});

describe("buildNodeTelemetry", () => {
  const view = { grants: new Map([["agent-1", grant()]]) };

  test("returns undefined without an agentId or an unknown agentId", () => {
    expect(buildNodeTelemetry(undefined, view)).toBeUndefined();
    expect(buildNodeTelemetry("agent-missing", view)).toBeUndefined();
  });

  test("includes only the base fields when the grant has no optional telemetry", () => {
    const telemetry = buildNodeTelemetry("agent-1", view);
    expect(telemetry).toEqual({
      agentId: "agent-1",
      role: "implementer",
      host: "claude-code",
      grantStatus: "active",
    });
  });

  test("adds every optional field once it is present on the grant", () => {
    const richView = {
      grants: new Map([
        [
          "agent-1",
          grant({
            provider: { value: "anthropic", evidence_class: "agent_reported" },
            model: { value: "sonnet", evidence_class: "agent_reported" },
            model_tier: { value: "l", evidence_class: "derived" },
            thinking_level: { value: "high", evidence_class: "derived" },
            context_window: { value: 200000, evidence_class: "host_reported" },
            tokens_in: { value: 10, evidence_class: "harness_observed" },
            tokens_out: { value: 5, evidence_class: "harness_observed" },
            token_extras: { cache_read: { value: 3, evidence_class: "harness_observed" } },
            telemetry_conflicts: [
              {
                field: "model",
                recorded_value: "sonnet",
                recorded_evidence_class: "agent_reported",
                probed_value: "opus",
                probed_evidence_class: "host_reported",
              },
            ],
          }),
        ],
      ]),
    };

    const telemetry = buildNodeTelemetry("agent-1", richView);
    expect(telemetry?.provider).toEqual({ value: "anthropic", evidence_class: "agent_reported" });
    expect(telemetry?.model).toEqual({ value: "sonnet", evidence_class: "agent_reported" });
    expect(telemetry?.modelTier).toEqual({ value: "l", evidence_class: "derived" });
    expect(telemetry?.thinkingLevel).toEqual({ value: "high", evidence_class: "derived" });
    expect(telemetry?.contextWindow).toEqual({ value: 200000, evidence_class: "host_reported" });
    expect(telemetry?.tokensIn).toEqual({ value: 10, evidence_class: "harness_observed" });
    expect(telemetry?.tokensOut).toEqual({ value: 5, evidence_class: "harness_observed" });
    expect(telemetry?.tokenExtras).toEqual({
      cache_read: { value: 3, evidence_class: "harness_observed" },
    });
    expect(telemetry?.telemetryConflicts).toHaveLength(1);
  });

  test("omits token_extras when the map is present but empty", () => {
    const view2 = { grants: new Map([["agent-1", grant({ token_extras: {} })]]) };
    expect(buildNodeTelemetry("agent-1", view2)?.tokenExtras).toBeUndefined();
  });

  test("omits telemetry_conflicts when the list is present but empty", () => {
    const view2 = { grants: new Map([["agent-1", grant({ telemetry_conflicts: [] })]]) };
    expect(buildNodeTelemetry("agent-1", view2)?.telemetryConflicts).toBeUndefined();
  });
});

describe("buildNodeTools", () => {
  test("returns an empty list without an agentId or an unknown agentId", () => {
    const view = { grants: new Map([["agent-1", grant()]]) };
    expect(buildNodeTools(undefined, view)).toEqual([]);
    expect(buildNodeTools("agent-missing", view)).toEqual([]);
  });

  test("merges tools_used and tools_granted, de-duplicating by name and preferring reported use", () => {
    const view = {
      grants: new Map([
        [
          "agent-1",
          grant({
            tools_used: [
              {
                name: "bash",
                category: "system",
                extras: { risk: "low" },
                evidence_class: "agent_reported",
                first_reported_at: "2026-08-19T00:00:01Z",
              },
            ],
            tools_granted: {
              value: [
                { name: "bash" },
                { name: "edit", category: "filesystem" },
                { name: "read", extras: { scope: "repo" } },
              ],
              evidence_class: "host_reported",
            },
          }),
        ],
      ]),
    };

    const tools = buildNodeTools("agent-1", view);
    expect(tools).toHaveLength(3);
    expect(tools[0]).toEqual({
      name: "bash",
      category: "system",
      extras: { risk: "low" },
      evidence_class: "agent_reported",
      firstReportedAt: "2026-08-19T00:00:01Z",
    });
    expect(tools[1]).toEqual({
      name: "edit",
      category: "filesystem",
      evidence_class: "host_reported",
    });
    expect(tools[2]).toEqual({
      name: "read",
      extras: { scope: "repo" },
      evidence_class: "host_reported",
    });
  });

  test("falls back to unknown evidence when tools_granted carries no evidence class", () => {
    const view = {
      grants: new Map([
        [
          "agent-1",
          grant({
            tools_granted: {
              value: [{ name: "bash" }],
            } as unknown as AgentGrantRecord["tools_granted"],
          }),
        ],
      ]),
    };
    const tools = buildNodeTools("agent-1", view);
    expect(tools[0]?.evidence_class).toBe("unknown");
  });

  test("handles a grant with neither tools_used nor tools_granted", () => {
    const view = { grants: new Map([["agent-1", grant()]]) };
    expect(buildNodeTools("agent-1", view)).toEqual([]);
  });
});

describe("reportedTokenUsage", () => {
  test("returns undefined without an agentId, an unknown agentId, or no token data", () => {
    const view = { grants: new Map([["agent-1", grant()]]) };
    expect(reportedTokenUsage(undefined, view)).toBeUndefined();
    expect(reportedTokenUsage("agent-missing", view)).toBeUndefined();
    expect(reportedTokenUsage("agent-1", view)).toBeUndefined();
  });

  test("sums input and output tokens and carries their evidence class", () => {
    const view = {
      grants: new Map([
        [
          "agent-1",
          grant({
            tokens_in: { value: 100, evidence_class: "harness_observed" },
            tokens_out: { value: 40, evidence_class: "agent_reported" },
          }),
        ],
      ]),
    };
    expect(reportedTokenUsage("agent-1", view)).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      isEstimated: false,
      evidenceClass: "harness_observed",
    });
  });

  test("computes total from only tokens_out and falls back to its evidence class", () => {
    const view = {
      grants: new Map([
        ["agent-1", grant({ tokens_out: { value: 25, evidence_class: "derived" } })],
      ]),
    };
    expect(reportedTokenUsage("agent-1", view)).toEqual({
      outputTokens: 25,
      totalTokens: 25,
      isEstimated: false,
      evidenceClass: "derived",
    });
  });
});
