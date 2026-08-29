import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentGrantRecord,
  AgentToolUse,
  TelemetryFieldConflict,
} from "../../../../olt/scripts/src/core/contracts/index.ts";
import { estimated, evidenced } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { writeAgentLedger } from "../../../../olt/scripts/src/workflow/agents/ledger.ts";
import {
  appendTelemetryConflicts,
  applyDerivedTelemetry,
  checkParentAgentConflict,
  mergeDerivedField,
  mergeObservedCount,
  mergeObservedExtras,
  mergeObservedTools,
  refreshAgentDerivedTelemetry,
  transcriptAuditContext,
  type DerivedTelemetryInput,
} from "../../../../olt/scripts/src/workflow/agents/telemetry-merge.ts";
import type { AgentTranscriptTelemetry } from "../../../../olt/scripts/src/workflow/agents/transcript-telemetry.ts";

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

describe("workflow/agents/telemetry-merge", () => {
  test("mergeDerivedField handles undefined, matching, and conflicting values", () => {
    const conflicts: TelemetryFieldConflict[] = [];

    // probed undefined -> explicit
    expect(
      mergeDerivedField(evidenced("claude", "agent_reported"), undefined, "model", conflicts),
    ).toEqual(evidenced("claude", "agent_reported"));

    // explicit undefined -> probed with default "derived" class
    expect(mergeDerivedField(undefined, "claude", "model", conflicts)).toEqual(
      evidenced("claude", "derived"),
    );

    // explicit undefined -> probed with custom evidence class
    expect(mergeDerivedField(undefined, "claude", "model", conflicts, "harness_observed")).toEqual(
      evidenced("claude", "harness_observed"),
    );

    // matching values -> returns explicit without conflict
    expect(
      mergeDerivedField(evidenced("claude", "agent_reported"), "claude", "model", conflicts),
    ).toEqual(evidenced("claude", "agent_reported"));
    expect(conflicts).toHaveLength(0);

    // conflicting values -> returns explicit and appends conflict
    expect(
      mergeDerivedField(
        evidenced("claude-2", "agent_reported"),
        "claude-3",
        "model",
        conflicts,
        "harness_observed",
      ),
    ).toEqual(evidenced("claude-2", "agent_reported"));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      field: "model",
      recorded_value: "claude-2",
      recorded_evidence_class: "agent_reported",
      probed_value: "claude-3",
      probed_evidence_class: "harness_observed",
    });
  });

  test("mergeObservedCount handles estimates, harness_observed overrides, and conflicts", () => {
    const conflicts: TelemetryFieldConflict[] = [];

    // observed undefined -> explicit
    expect(
      mergeObservedCount(evidenced(100, "agent_reported"), undefined, "tokens_in", conflicts),
    ).toEqual(evidenced(100, "agent_reported"));

    // explicit undefined -> evidenced observed
    expect(mergeObservedCount(undefined, 200, "tokens_in", conflicts)).toEqual(
      evidenced(200, "harness_observed"),
    );

    // explicit estimated -> overridden by observed
    expect(mergeObservedCount(estimated(150), 200, "tokens_in", conflicts)).toEqual(
      evidenced(200, "harness_observed"),
    );

    // explicit already harness_observed -> updated to latest observed
    expect(
      mergeObservedCount(evidenced(180, "harness_observed"), 200, "tokens_in", conflicts),
    ).toEqual(evidenced(200, "harness_observed"));

    // explicit agent_reported matching observed -> no conflict
    expect(
      mergeObservedCount(evidenced(200, "agent_reported"), 200, "tokens_in", conflicts),
    ).toEqual(evidenced(200, "agent_reported"));
    expect(conflicts).toHaveLength(0);

    // explicit agent_reported differing from observed -> conflict
    expect(
      mergeObservedCount(evidenced(100, "agent_reported"), 200, "tokens_in", conflicts),
    ).toEqual(evidenced(100, "agent_reported"));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      field: "tokens_in",
      recorded_value: 100,
      recorded_evidence_class: "agent_reported",
      probed_value: 200,
      probed_evidence_class: "harness_observed",
    });
  });

  test("mergeObservedExtras handles undefined, empty, estimated, and existing fields", () => {
    const existing = {
      cache: evidenced(50, "agent_reported"),
      temp: estimated(10),
    };

    // observed undefined or empty -> returns existing
    expect(mergeObservedExtras(existing, undefined)).toBe(existing);
    expect(mergeObservedExtras(existing, {})).toBe(existing);

    // observed merged with existing
    const merged = mergeObservedExtras(existing, {
      temp: 20,
      new_metric: 100,
    });
    expect(merged).toEqual({
      cache: evidenced(50, "agent_reported"),
      temp: evidenced(20, "harness_observed"),
      new_metric: evidenced(100, "harness_observed"),
    });

    // undefined existing starts new map
    const fromScratch = mergeObservedExtras(undefined, { foo: 42 });
    expect(fromScratch).toEqual({ foo: evidenced(42, "harness_observed") });
  });

  test("mergeObservedTools merges and updates tool calls and failure counts", () => {
    const at = "2026-08-20T12:00:00.000Z";

    // observed undefined or empty
    const existing: AgentToolUse[] = [
      { name: "tool-a", evidence_class: "agent_reported", first_reported_at: at },
    ];
    expect(mergeObservedTools(undefined, undefined, at)).toBeUndefined();
    expect(mergeObservedTools(existing, [], at)).toEqual(existing);

    // merge new and existing harness_observed tools
    const existingHarness: AgentToolUse[] = [
      {
        name: "tool-b",
        evidence_class: "harness_observed",
        first_reported_at: at,
        extras: { calls: 1, failures: 0 },
      },
    ];
    const observed = [
      { name: "tool-b", calls: 3, failures: 1 },
      { name: "tool-c", calls: 2, failures: 0 },
    ];
    const result = mergeObservedTools(existingHarness, observed, at);
    expect(result).toEqual([
      {
        name: "tool-b",
        evidence_class: "harness_observed",
        first_reported_at: at,
        extras: { calls: 3, failures: 1 },
      },
      {
        name: "tool-c",
        evidence_class: "harness_observed",
        first_reported_at: at,
        extras: { calls: 2, failures: 0 },
      },
    ]);
  });

  test("transcriptAuditContext returns structured audit context and handles undefined", () => {
    expect(transcriptAuditContext(undefined)).toBeUndefined();

    const fullTranscript: AgentTranscriptTelemetry = {
      sourcePath: "/path/to/transcript.jsonl",
      agentType: "worker",
      spawnDepth: 1,
      parentAgentId: "parent-123",
      runContext: { runId: "r-1", status: "completed" },
      tools: [],
    };
    expect(transcriptAuditContext(fullTranscript)).toEqual({
      source_path: "/path/to/transcript.jsonl",
      agent_type: "worker",
      spawn_depth: 1,
      observed_parent_agent_id: "parent-123",
      run_context: { runId: "r-1", status: "completed" },
    });

    const minimalTranscript: AgentTranscriptTelemetry = {
      sourcePath: "/path/to/min.jsonl",
      tools: [],
    };
    expect(transcriptAuditContext(minimalTranscript)).toEqual({
      source_path: "/path/to/min.jsonl",
    });
  });

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
    });
  });
});
