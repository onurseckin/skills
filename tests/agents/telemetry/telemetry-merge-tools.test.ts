import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TelemetryFieldConflict } from "../../../olt/scripts/src/core/contracts/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  registerAgentGrant,
  releaseAgentGrant,
} from "../../../olt/scripts/src/workflow/agents/grants.ts";
import {
  appendTelemetryConflicts,
  checkParentAgentConflict,
  refreshAgentDerivedTelemetry,
  transcriptAuditContext,
} from "../../../olt/scripts/src/workflow/agents/telemetry-merge.ts";
import type { AgentTranscriptTelemetry } from "../../../olt/scripts/src/workflow/agents/transcript-telemetry.ts";
import { cleanupVirtualAgentsFS, scratchRoot, setupVirtualAgentsFS } from "../fixture.ts";

beforeEach(() => {
  setupVirtualAgentsFS();
});

afterEach(() => {
  cleanupVirtualAgentsFS();
});

function transcript(overrides: Partial<AgentTranscriptTelemetry> = {}): AgentTranscriptTelemetry {
  return { sourcePath: "/path/to/transcript.jsonl", tools: [], ...overrides };
}

describe("transcriptAuditContext", () => {
  test("is undefined when there is no transcript at all", () => {
    expect(transcriptAuditContext(undefined)).toBeUndefined();
  });

  test("carries only the source path when nothing else was observed", () => {
    expect(transcriptAuditContext(transcript())).toEqual({
      source_path: "/path/to/transcript.jsonl",
    });
  });

  test("carries agentType, spawnDepth, parentAgentId and runContext through when present", () => {
    const context = transcriptAuditContext(
      transcript({
        agentType: "general-purpose",
        spawnDepth: 2,
        parentAgentId: "agent-parent",
        runContext: { runId: "wf_1" },
      }),
    );
    expect(context).toEqual({
      source_path: "/path/to/transcript.jsonl",
      agent_type: "general-purpose",
      spawn_depth: 2,
      observed_parent_agent_id: "agent-parent",
      run_context: { runId: "wf_1" },
    });
  });
});

describe("checkParentAgentConflict", () => {
  test("is silent when the transcript observed no parent, or agrees with the declared one", () => {
    const conflicts: TelemetryFieldConflict[] = [];
    checkParentAgentConflict("agent-parent", transcript(), conflicts);
    checkParentAgentConflict(
      "agent-parent",
      transcript({ parentAgentId: "agent-parent" }),
      conflicts,
    );
    expect(conflicts).toEqual([]);
  });

  test("records a conflict when the transcript observed a different parent than declared", () => {
    const conflicts: TelemetryFieldConflict[] = [];
    checkParentAgentConflict(
      "agent-declared",
      transcript({ parentAgentId: "agent-observed" }),
      conflicts,
    );
    expect(conflicts).toEqual([
      {
        field: "parent_agent_id",
        recorded_value: "agent-declared",
        recorded_evidence_class: "agent_reported",
        probed_value: "agent-observed",
        probed_evidence_class: "harness_observed",
      },
    ]);
  });
});

describe("appendTelemetryConflicts", () => {
  const conflictA: TelemetryFieldConflict = {
    field: "model",
    recorded_value: "a",
    recorded_evidence_class: "agent_reported",
    probed_value: "b",
    probed_evidence_class: "harness_observed",
  };

  test("returns a shallow copy (or undefined) when there is nothing new", () => {
    expect(appendTelemetryConflicts(undefined, [])).toBeUndefined();
    const copy = appendTelemetryConflicts([conflictA], []);
    expect(copy).toEqual([conflictA]);
  });

  test("appends a genuinely new conflict but never records the identical one twice", () => {
    const once = appendTelemetryConflicts(undefined, [conflictA]);
    expect(once).toEqual([conflictA]);
    const twice = appendTelemetryConflicts(once, [conflictA]);
    expect(twice).toEqual([conflictA]);
  });
});

function freshRun(label: string): string {
  const root = scratchRoot("agent-telemetry-run", label);
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
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
});
