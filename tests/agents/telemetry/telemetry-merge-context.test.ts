import { describe, expect, test } from "bun:test";
import type { TelemetryFieldConflict } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  appendTelemetryConflicts,
  checkParentAgentConflict,
  transcriptAuditContext,
} from "../../../olt/scripts/src/workflow/agents/telemetry-merge.ts";
import type { AgentTranscriptTelemetry } from "../../../olt/scripts/src/workflow/agents/transcript-telemetry.ts";

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
