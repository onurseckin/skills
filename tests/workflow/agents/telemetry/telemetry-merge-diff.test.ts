import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentGrantRecord,
  TelemetryFieldConflict,
} from "../../../../olt/scripts/src/core/contracts/index.ts";
import { evidenced } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { writeAgentLedger } from "../../../../olt/scripts/src/workflow/agents/ledger.ts";
import {
  appendTelemetryConflicts,
  applyDerivedTelemetry,
  checkParentAgentConflict,
  type DerivedTelemetryInput,
} from "../../../../olt/scripts/src/workflow/agents/telemetry-merge.ts";

function withRun<T>(body: (runRoot: string) => T): T {
  const repo = mkdtempSync(join(tmpdir(), "telemetry-run-"));
  try {
    const runRoot = initRun(repo, "test-run", new TextEncoder().encode("task"), "file", true);
    return body(runRoot);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function createGrant(id: string, overrides?: Partial<AgentGrantRecord>): AgentGrantRecord {
  return {
    id,
    role: "implementer",
    parent_agent_id: null,
    parent_task_id: null,
    host: "local",
    granted_at: "2026-08-20T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

describe("telemetry merge advanced scenarios", () => {
  test("checkParentAgentConflict detects mismatches between declared and observed parent", () => {
    const conflicts: TelemetryFieldConflict[] = [];

    // undefined observed parent -> no conflict
    checkParentAgentConflict("p1", undefined, conflicts);
    checkParentAgentConflict("p1", { sourcePath: "a", tools: [] }, conflicts);
    expect(conflicts).toHaveLength(0);

    // matching observed parent -> no conflict
    checkParentAgentConflict("p1", { sourcePath: "a", parentAgentId: "p1", tools: [] }, conflicts);
    expect(conflicts).toHaveLength(0);

    // differing observed parent -> conflict recorded
    checkParentAgentConflict("p1", { sourcePath: "a", parentAgentId: "p2", tools: [] }, conflicts);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      field: "parent_agent_id",
      recorded_value: "p1",
      recorded_evidence_class: "agent_reported",
      probed_value: "p2",
      probed_evidence_class: "harness_observed",
    });
  });

  test("appendTelemetryConflicts de-duplicates incoming conflicts", () => {
    const c1: TelemetryFieldConflict = {
      field: "model",
      recorded_value: "m1",
      recorded_evidence_class: "agent_reported",
      probed_value: "m2",
      probed_evidence_class: "derived",
    };
    const c2: TelemetryFieldConflict = {
      field: "tokens_in",
      recorded_value: 10,
      recorded_evidence_class: "agent_reported",
      probed_value: 20,
      probed_evidence_class: "harness_observed",
    };

    // empty incoming
    expect(appendTelemetryConflicts(undefined, [])).toBeUndefined();
    expect(appendTelemetryConflicts([c1], [])).toEqual([c1]);

    // append new conflict
    expect(appendTelemetryConflicts([c1], [c2])).toEqual([c1, c2]);

    // append duplicate conflict
    expect(appendTelemetryConflicts([c1], [c1])).toEqual([c1]);
  });

  test("applyDerivedTelemetry combines base, transcript observations, and derived fields", () => {
    const conflicts: TelemetryFieldConflict[] = [];
    const base = {
      model: evidenced("base-model", "agent_reported"),
      thinking_level: evidenced("low" as const, "agent_reported"),
    };
    const derived: DerivedTelemetryInput = {
      provider: "anthropic",
      model: "derived-model",
      thinkingLevel: "high",
      contextWindow: 200000,
      transcript: {
        sourcePath: "t.jsonl",
        model: "transcript-model",
        thinkingLevel: "high",
        tokensIn: 500,
        tokensOut: 200,
        tokenExtras: { cache: 50 },
        tools: [{ name: "bash", calls: 1, failures: 0 }],
      },
    };

    const result = applyDerivedTelemetry(base, derived, conflicts, "2026-08-20T00:00:00.000Z");
    expect(result.provider).toEqual(evidenced("anthropic", "derived"));
    expect(result.context_window).toEqual(evidenced(200000, "derived"));
    expect(result.tokens_in).toEqual(evidenced(500, "harness_observed"));
    expect(result.tokens_out).toEqual(evidenced(200, "harness_observed"));
    expect(result.token_extras).toEqual({ cache: evidenced(50, "harness_observed") });
    expect(result.tools_used).toHaveLength(1);
    expect(conflicts.length).toBeGreaterThan(0);
  });

  test("refreshAgentDerivedTelemetry updates telemetry and records probe event", () => {
    withRun((runRoot) => {
      const initialGrant = createGrant("agent-1");
      transact(runRoot, "test", "init", {}, (draft) => {
        writeAgentLedger(draft, [initialGrant]);
      });

      // No derived values -> returns null
      expect(
        refreshAgentDerivedTelemetry({
          runRoot,
          agentId: "agent-1",
          actor: "worker",
          boundary: "step-1",
          derived: {},
        }),
      ).toBeNull();

      // Unknown agent -> returns null
      expect(
        refreshAgentDerivedTelemetry({
          runRoot,
          agentId: "unknown-agent",
          actor: "worker",
          boundary: "step-1",
          derived: { model: "claude-3-7-sonnet" },
        }),
      ).toBeNull();

      // Successful refresh with capabilities, hostTool, transcript, and custom now
      const result = refreshAgentDerivedTelemetry({
        runRoot,
        agentId: "agent-1",
        actor: "coordinator",
        boundary: "turn-1",
        derived: {
          provider: "anthropic",
          model: "claude-3-7-sonnet",
          capabilities: { tools: true },
          hostTool: "test-host",
          transcript: {
            sourcePath: "/subagents/agent-1.jsonl",
            tokensIn: 1000,
            tokensOut: 200,
            tools: [{ name: "view_file", calls: 2, failures: 0 }],
          },
        },
        now: new Date("2026-08-22T00:00:00.000Z"),
      });

      expect(result).not.toBeNull();
      expect(result!.grant.id).toBe("agent-1");
      expect(result!.grant.provider).toEqual(evidenced("anthropic", "derived"));
      expect(result!.grant.model).toEqual(evidenced("claude-3-7-sonnet", "derived"));
      expect(result!.grant.tokens_in).toEqual(evidenced(1000, "harness_observed"));

      // Refreshing again with identical information and no new transcript observations returns null
      const noop = refreshAgentDerivedTelemetry({
        runRoot,
        agentId: "agent-1",
        actor: "coordinator",
        boundary: "turn-2",
        derived: {
          provider: "anthropic",
          model: "claude-3-7-sonnet",
        },
      });
      expect(noop).toBeNull();

      // Released agent -> returns null
      transact(runRoot, "test", "release", {}, (draft) => {
        writeAgentLedger(draft, [createGrant("agent-1", { status: "released" })]);
      });
      expect(
        refreshAgentDerivedTelemetry({
          runRoot,
          agentId: "agent-1",
          actor: "coordinator",
          boundary: "turn-3",
          derived: { model: "claude-3-7-sonnet" },
        }),
      ).toBeNull();

      // Test transcriptHasObservation with only tokensOut, or only tokenExtras, or only tools
      transact(runRoot, "test", "reset-active", {}, (draft) => {
        writeAgentLedger(draft, [
          createGrant("agent-obs", { provider: evidenced("p", "agent_reported") }),
        ]);
      });

      const resTokensOut = refreshAgentDerivedTelemetry({
        runRoot,
        agentId: "agent-obs",
        actor: "coordinator",
        boundary: "b1",
        derived: {
          transcript: { sourcePath: "t1.jsonl", tokensOut: 50, tools: [] },
        },
      });
      expect(resTokensOut).not.toBeNull();

      const resExtras = refreshAgentDerivedTelemetry({
        runRoot,
        agentId: "agent-obs",
        actor: "coordinator",
        boundary: "b2",
        derived: {
          transcript: { sourcePath: "t2.jsonl", tokenExtras: { cache: 10 }, tools: [] },
        },
      });
      expect(resExtras).not.toBeNull();

      const resTools = refreshAgentDerivedTelemetry({
        runRoot,
        agentId: "agent-obs",
        actor: "coordinator",
        boundary: "b3",
        derived: {
          transcript: { sourcePath: "t3.jsonl", tools: [{ name: "t", calls: 1, failures: 0 }] },
        },
      });
      expect(resTools).not.toBeNull();

      // Grant becoming released concurrently during transact returns unchanged grant
      const activeThenReleased = createGrant("agent-race", { status: "active" });
      transact(runRoot, "test", "set-race", {}, (draft) => {
        writeAgentLedger(draft, [activeThenReleased]);
      });
      // We simulate release right as transact starts or call when status is released inside
      transact(runRoot, "test", "release-race", {}, (draft) => {
        writeAgentLedger(draft, [{ ...activeThenReleased, status: "released" }]);
      });
      const resReleased = refreshAgentDerivedTelemetry({
        runRoot,
        agentId: "agent-race",
        actor: "coordinator",
        boundary: "b4",
        derived: {
          transcript: { sourcePath: "t4.jsonl", tools: [{ name: "t", calls: 1, failures: 0 }] },
        },
      });
      expect(resReleased).toBeNull();
    });
  });
});
