import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { evidenced, estimated } from "../../../olt/scripts/src/core/contracts/index.ts";
import type {
  AgentToolUse,
  TelemetryFieldConflict,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { registerAgentGrant } from "../../../olt/scripts/src/workflow/agents/grants.ts";
import {
  appendTelemetryConflicts,
  checkParentAgentConflict,
  mergeObservedCount,
  mergeObservedExtras,
  mergeObservedTools,
  refreshAgentDerivedTelemetry,
  transcriptAuditContext,
} from "../../../olt/scripts/src/workflow/agents/telemetry-merge.ts";
import type { AgentTranscriptTelemetry } from "../../../olt/scripts/src/workflow/agents/transcript-telemetry.ts";


describe("mergeObservedCount", () => {
  test("passes an undefined observation through unchanged", () => {
    const explicit = evidenced(10, "agent_reported");
    expect(mergeObservedCount(explicit, undefined, "tokens_in", [])).toBe(explicit);
  });

  test("adopts the observed count when nothing was recorded yet, or the record was only estimated", () => {
    expect(mergeObservedCount(undefined, 42, "tokens_in", [])).toEqual(
      evidenced(42, "harness_observed"),
    );
    expect(mergeObservedCount(estimated(10), 42, "tokens_in", [])).toEqual(
      evidenced(42, "harness_observed"),
    );
    expect(mergeObservedCount(evidenced(10, "harness_observed"), 42, "tokens_in", [])).toEqual(
      evidenced(42, "harness_observed"),
    );
  });

  test("keeps an agent-reported count but records a conflict when the observation disagrees", () => {
    const explicit = evidenced(10, "agent_reported");
    const conflicts: TelemetryFieldConflict[] = [];
    expect(mergeObservedCount(explicit, 42, "tokens_in", conflicts)).toBe(explicit);
    expect(conflicts).toEqual([
      {
        field: "tokens_in",
        recorded_value: 10,
        recorded_evidence_class: "agent_reported",
        probed_value: 42,
        probed_evidence_class: "harness_observed",
      },
    ]);
  });

  test("raises no conflict when the agent-reported count already agrees with the observation", () => {
    const explicit = evidenced(42, "agent_reported");
    const conflicts: TelemetryFieldConflict[] = [];
    expect(mergeObservedCount(explicit, 42, "tokens_in", conflicts)).toBe(explicit);
    expect(conflicts).toEqual([]);
  });
});

describe("mergeObservedExtras", () => {
  test("passes existing extras through when there is nothing new to observe", () => {
    const existing = { cache_read: evidenced(5, "agent_reported") };
    expect(mergeObservedExtras(existing, undefined)).toBe(existing);
    expect(mergeObservedExtras(existing, {})).toBe(existing);
  });

  test("adopts an observed extra when it is new, or replaces an estimated/harness-observed one", () => {
    const merged = mergeObservedExtras(
      {
        estimated_extra: estimated(1),
        observed_extra: evidenced(2, "harness_observed"),
      },
      { estimated_extra: 9, observed_extra: 9, brand_new: 3 },
    );
    expect(merged).toEqual({
      estimated_extra: evidenced(9, "harness_observed"),
      observed_extra: evidenced(9, "harness_observed"),
      brand_new: evidenced(3, "harness_observed"),
    });
  });

  test("leaves a firmly agent-reported extra alone even when a different count is observed", () => {
    const merged = mergeObservedExtras({ locked: evidenced(1, "agent_reported") }, { locked: 9 });
    expect(merged?.locked).toEqual(evidenced(1, "agent_reported"));
  });
});

describe("mergeObservedTools", () => {
  test("returns a shallow copy (or undefined) when there is nothing observed", () => {
    expect(mergeObservedTools(undefined, undefined, "2026-08-19T00:00:00.000Z")).toBeUndefined();
    expect(mergeObservedTools(undefined, [], "2026-08-19T00:00:00.000Z")).toBeUndefined();
    const existing: AgentToolUse[] = [
      { name: "Bash", evidence_class: "agent_reported", first_reported_at: "t0" },
    ];
    const copy = mergeObservedTools(existing, [], "2026-08-19T00:00:00.000Z");
    expect(copy).toEqual(existing);
    expect(copy).not.toBe(existing);
  });

  test("appends a newly observed tool as harness_observed evidence", () => {
    const merged = mergeObservedTools(
      undefined,
      [{ name: "Bash", calls: 3, failures: 1 }],
      "2026-08-19T00:00:00.000Z",
    );
    expect(merged).toEqual([
      {
        name: "Bash",
        extras: { calls: 3, failures: 1 },
        evidence_class: "harness_observed",
        first_reported_at: "2026-08-19T00:00:00.000Z",
      },
    ]);
  });

  test("merges into an existing harness_observed entry for the same tool instead of duplicating it", () => {
    const existing: AgentToolUse[] = [
      {
        name: "Bash",
        extras: { calls: 1, failures: 0 },
        evidence_class: "harness_observed",
        first_reported_at: "2026-08-19T00:00:00.000Z",
      },
    ];
    const merged = mergeObservedTools(
      existing,
      [{ name: "Bash", calls: 4, failures: 2 }],
      "2026-08-19T00:05:00.000Z",
    );
    expect(merged).toHaveLength(1);
    expect(merged?.[0]).toMatchObject({
      name: "Bash",
      extras: { calls: 4, failures: 2 },
      first_reported_at: "2026-08-19T00:00:00.000Z",
    });
  });

  test("does not merge into an agent_reported entry of the same name — it is a distinct kind of evidence", () => {
    const existing: AgentToolUse[] = [
      { name: "Bash", evidence_class: "agent_reported", first_reported_at: "t0" },
    ];
    const merged = mergeObservedTools(
      existing,
      [{ name: "Bash", calls: 1, failures: 0 }],
      "2026-08-19T00:00:00.000Z",
    );
    expect(merged).toHaveLength(2);
    expect(merged?.map((t) => t.evidence_class)).toEqual(["agent_reported", "harness_observed"]);
  });
});

function transcript(overrides: Partial<AgentTranscriptTelemetry> = {}): AgentTranscriptTelemetry {
  return { sourcePath: "/path/to/transcript.jsonl", tools: [], ...overrides };
}

