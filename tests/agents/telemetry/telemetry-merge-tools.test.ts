import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  registerAgentGrant,
  releaseAgentGrant,
} from "../../../olt/scripts/src/workflow/agents/grants.ts";
import { refreshAgentDerivedTelemetry } from "../../../olt/scripts/src/workflow/agents/telemetry-merge.ts";
import {
  cleanupVirtualAgentsFS,
  getVirtualAgentsFS,
  scratchRoot,
  setupVirtualAgentsFS,
} from "../fixture.ts";

beforeEach(() => {
  setupVirtualAgentsFS();
});

afterEach(() => {
  cleanupVirtualAgentsFS();
});

function freshRun(label: string): string {
  const root = scratchRoot("agent-telemetry-run", label);
  const vfs = getVirtualAgentsFS();
  const repo = join(root, "repo");
  vfs.mkdirSync(repo, { recursive: true });
  return initRun(repo, "telemetry-merge-run", new TextEncoder().encode("prompt"), "file", true);
}

describe("refreshAgentDerivedTelemetry", () => {
  test("persists transcript-only observations (tokens, tools) even with no provider/model change, and records host capabilities", () => {
    const run = freshRun("transcript-only-observation");
    registerAgentGrant({
      runRoot: run,
      agentId: "agent-1",
      role: "implementer",
      parentAgentId: null,
      parentTaskId: null,
      host: "some-host",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
    });

    const outcome = refreshAgentDerivedTelemetry({
      runRoot: run,
      agentId: "agent-1",
      actor: "coordinator",
      boundary: "post-tool",
      derived: {
        capabilities: { max_context: 200_000 },
        hostTool: "claude-code",
        transcript: {
          sourcePath: "/sessions/x.jsonl",
          tokensIn: 100,
          tokensOut: 50,
          tools: [{ name: "Bash", calls: 1, failures: 0 }],
        },
      },
    });

    expect(outcome).not.toBeNull();
    expect(outcome!.grant.tokens_in).toEqual({ value: 100, evidence_class: "harness_observed" });
    expect(outcome!.grant.tokens_out).toEqual({ value: 50, evidence_class: "harness_observed" });
    expect(outcome!.grant.tools_used?.[0]).toMatchObject({ name: "Bash" });
  });

  test("has nothing to persist when the derived input carries no field, no tool, and no conflict", () => {
    const run = freshRun("no-observation");
    registerAgentGrant({
      runRoot: run,
      agentId: "agent-1",
      role: "implementer",
      parentAgentId: null,
      parentTaskId: null,
      host: "some-host",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
    });

    const outcome = refreshAgentDerivedTelemetry({
      runRoot: run,
      agentId: "agent-1",
      actor: "coordinator",
      boundary: "post-tool",
      derived: { transcript: { sourcePath: "/sessions/x.jsonl", tools: [] } },
    });
    expect(outcome).toBeNull();
  });

  test("returns grant as-is without modifying ledger when grant is already released", () => {
    const run = freshRun("released-grant-refresh");
    registerAgentGrant({
      runRoot: run,
      agentId: "agent-1",
      role: "implementer",
      parentAgentId: null,
      parentTaskId: null,
      host: "some-host",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
    });

    releaseAgentGrant({
      runRoot: run,
      actor: "agent-1",
      agentId: "agent-1",
      reason: "completed",
    });

    const outcome = refreshAgentDerivedTelemetry({
      runRoot: run,
      agentId: "agent-1",
      actor: "coordinator",
      boundary: "post-tool",
      derived: {
        transcript: {
          sourcePath: "/sessions/x.jsonl",
          tokensIn: 200,
          tools: [],
        },
      },
    });
    expect(outcome).toBeNull();
  });

  test("handles multiple simultaneous telemetry conflicts and atomically aggregates tokens", () => {
    const run = freshRun("multi-conflict-tokens");
    registerAgentGrant({
      runRoot: run,
      agentId: "agent-1",
      role: "implementer",
      parentAgentId: null,
      parentTaskId: null,
      host: "some-host",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {
        model: "claude-3-opus",
      },
    });

    const outcome = refreshAgentDerivedTelemetry({
      runRoot: run,
      agentId: "agent-1",
      actor: "coordinator",
      boundary: "post-tool",
      derived: {
        transcript: {
          sourcePath: "/sessions/multi-conflict.jsonl",
          parentAgentId: "transcript-observed-parent",
          model: "claude-3-haiku",
          tokensIn: 1500,
          tokensOut: 750,
          tools: [],
        },
      },
    });

    expect(outcome).not.toBeNull();
    expect(outcome!.grant.tokens_in).toEqual({ value: 1500, evidence_class: "harness_observed" });
    expect(outcome!.grant.tokens_out).toEqual({ value: 750, evidence_class: "harness_observed" });
    expect(outcome!.grant.model?.value).toBe("claude-3-opus");
    expect(outcome!.conflicts).toBeDefined();
    expect(outcome!.conflicts).toHaveLength(2);
    expect(outcome!.conflicts!.map((c) => c.field).sort()).toEqual(["model", "parent_agent_id"]);
    expect(outcome!.grant.telemetry_conflicts).toBeDefined();
    expect(outcome!.grant.telemetry_conflicts!.map((c) => c.field).sort()).toEqual([
      "model",
      "parent_agent_id",
    ]);
  });

  test("safely handles zero and negative token counts without crashing", () => {
    const run = freshRun("zero-and-negative-tokens");
    registerAgentGrant({
      runRoot: run,
      agentId: "agent-1",
      role: "implementer",
      parentAgentId: null,
      parentTaskId: null,
      host: "some-host",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
    });

    const outcomeZero = refreshAgentDerivedTelemetry({
      runRoot: run,
      agentId: "agent-1",
      actor: "coordinator",
      boundary: "post-tool",
      derived: {
        transcript: {
          sourcePath: "/sessions/zero-tokens.jsonl",
          tokensIn: 0,
          tokensOut: 0,
          tools: [],
        },
      },
    });
    expect(outcomeZero).not.toBeNull();
    expect(outcomeZero!.grant.tokens_in).toEqual({ value: 0, evidence_class: "harness_observed" });
    expect(outcomeZero!.grant.tokens_out).toEqual({ value: 0, evidence_class: "harness_observed" });

    const outcomeNegative = refreshAgentDerivedTelemetry({
      runRoot: run,
      agentId: "agent-1",
      actor: "coordinator",
      boundary: "post-tool",
      derived: {
        transcript: {
          sourcePath: "/sessions/negative-tokens.jsonl",
          tokensIn: -1,
          tokensOut: -50,
          tools: [],
        },
      },
    });
    expect(outcomeNegative).not.toBeNull();
    expect(outcomeNegative!.grant.tokens_in).toEqual({
      value: -1,
      evidence_class: "harness_observed",
    });
    expect(outcomeNegative!.grant.tokens_out).toEqual({
      value: -50,
      evidence_class: "harness_observed",
    });
  });
});
