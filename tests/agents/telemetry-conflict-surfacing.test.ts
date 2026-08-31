import { describe, expect, test } from "bun:test";
import {
  isAgentGrantRecord,
  isTelemetryFieldConflict,
  type TelemetryFieldConflict,
} from "../../olt/scripts/src/core/contracts/index.ts";
import {
  refreshAgentDerivedTelemetry,
  registerAgentGrant,
} from "../../olt/scripts/src/workflow/agents/grants.ts";
import { appendTelemetryConflicts } from "../../olt/scripts/src/workflow/agents/telemetry-merge.ts";
import { ledgerOf, registerCoordinator, seededRun } from "./fixture.ts";

function worker(run: string) {
  return ledgerOf(run).find((grant) => grant.id === "worker-1")!;
}

/**
 * B32.1/B39: a probe that disagrees with an explicit report must never resolve the disagreement by
 * picking a winner and hiding the other value — the ledger field keeps the explicit report, and the
 * disagreement itself has to reach the grant record, not just an in-memory return value the caller
 * happens to log. Before this, `TelemetryFieldConflict` was computed and handed to the event payload
 * but never attached to `AgentGrantRecord` itself, so nothing downstream of the ledger (graph.json,
 * summary.md) could ever see it.
 */
describe("telemetry conflicts persist on the grant record, not just the transaction result", () => {
  test("registerAgentGrant attaches conflicts to the minted grant, both evidence classes intact", () => {
    const run = seededRun(import.meta.path, "conflict-on-mint");
    registerCoordinator(run);
    registerAgentGrant({
      runRoot: run,
      agentId: "worker-1",
      role: "implementer",
      parentAgentId: "coordinator-1",
      parentTaskId: "task-1",
      host: "some-host",
      authority: { kind: "verified_parent", actorId: "coordinator-1" },
      maxAgents: 20,
      telemetry: { model: "explicit-model" },
      derivedTelemetry: { model: "derived-model" },
    });

    const grant = worker(run);
    expect(grant.model).toEqual({ value: "explicit-model", evidence_class: "agent_reported" });
    expect(grant.telemetry_conflicts).toEqual([
      {
        field: "model",
        recorded_value: "explicit-model",
        recorded_evidence_class: "agent_reported",
        probed_value: "derived-model",
        probed_evidence_class: "derived",
      },
    ]);
  });

  test("a grant with no disagreement carries no telemetry_conflicts field at all", () => {
    const run = seededRun(import.meta.path, "conflict-none");
    registerCoordinator(run);
    registerAgentGrant({
      runRoot: run,
      agentId: "worker-1",
      role: "implementer",
      parentAgentId: "coordinator-1",
      parentTaskId: "task-1",
      host: "some-host",
      authority: { kind: "verified_parent", actorId: "coordinator-1" },
      maxAgents: 20,
      telemetry: { model: "agreed-model" },
      derivedTelemetry: { model: "agreed-model" },
    });

    expect(worker(run).telemetry_conflicts).toBeUndefined();
  });

  test("conflicts found at different boundaries accumulate on the same grant", () => {
    const run = seededRun(import.meta.path, "conflict-accumulate");
    registerCoordinator(run);
    // context_window is reported explicitly up front so every later probe that disagrees with it
    // is a genuine conflict, not just a probe filling a field nobody had reported yet.
    registerAgentGrant({
      runRoot: run,
      agentId: "worker-1",
      role: "implementer",
      parentAgentId: "coordinator-1",
      parentTaskId: "task-1",
      host: "some-host",
      authority: { kind: "verified_parent", actorId: "coordinator-1" },
      maxAgents: 20,
      telemetry: { model: "explicit-model", contextWindow: 4096 },
      derivedTelemetry: { model: "derived-model" },
    });

    // A later boundary (task:claim, task:submit, agent:release) disagrees on a different field, and
    // then disagrees again with a different probed value — every disagreement is real, from a
    // different moment, and none of them displaces another.
    refreshAgentDerivedTelemetry({
      runRoot: run,
      agentId: "worker-1",
      actor: "worker-1",
      boundary: "task:claim",
      derived: { contextWindow: 5000 },
    });
    refreshAgentDerivedTelemetry({
      runRoot: run,
      agentId: "worker-1",
      actor: "worker-1",
      boundary: "task:submit",
      derived: { contextWindow: 9000 },
    });

    const conflicts = worker(run).telemetry_conflicts ?? [];
    expect(conflicts).toHaveLength(3);
    expect(conflicts.map((entry) => entry.field).sort()).toEqual([
      "context_window",
      "context_window",
      "model",
    ]);
    const contextConflicts = conflicts.filter((entry) => entry.field === "context_window");
    expect(contextConflicts.every((entry) => entry.recorded_value === 4096)).toBe(true);
    expect(contextConflicts.map((entry) => entry.probed_value).sort()).toEqual([5000, 9000]);
  });

  test("re-probing the identical disagreement never duplicates the conflict entry", () => {
    const run = seededRun(import.meta.path, "conflict-dedupe");
    registerCoordinator(run);
    registerAgentGrant({
      runRoot: run,
      agentId: "worker-1",
      role: "implementer",
      parentAgentId: "coordinator-1",
      parentTaskId: "task-1",
      host: "some-host",
      authority: { kind: "verified_parent", actorId: "coordinator-1" },
      maxAgents: 20,
      telemetry: { model: "explicit-model" },
    });

    // The same config-file probe result, read again at two different task boundaries: a host's own
    // config does not change between task:claim and task:submit, so this is the common case.
    for (const boundary of ["task:claim", "task:submit"]) {
      refreshAgentDerivedTelemetry({
        runRoot: run,
        agentId: "worker-1",
        actor: "worker-1",
        boundary,
        derived: { model: "derived-model" },
      });
    }

    expect(worker(run).telemetry_conflicts).toEqual([
      {
        field: "model",
        recorded_value: "explicit-model",
        recorded_evidence_class: "agent_reported",
        probed_value: "derived-model",
        probed_evidence_class: "derived",
      },
    ]);
  });
});

describe("appendTelemetryConflicts", () => {
  const conflictA: TelemetryFieldConflict = {
    field: "model",
    recorded_value: "explicit-model",
    recorded_evidence_class: "agent_reported",
    probed_value: "derived-model",
    probed_evidence_class: "derived",
  };
  const conflictB: TelemetryFieldConflict = {
    field: "tokens_in",
    recorded_value: 100,
    recorded_evidence_class: "agent_reported",
    probed_value: 200,
    probed_evidence_class: "harness_observed",
  };

  test("returns undefined rather than an empty array when nothing ever disagreed", () => {
    expect(appendTelemetryConflicts(undefined, [])).toBeUndefined();
  });

  test("appends a new conflict beside an existing one instead of replacing it", () => {
    expect(appendTelemetryConflicts([conflictA], [conflictB])).toEqual([conflictA, conflictB]);
  });

  test("a conflict identical on every field, value and evidence class is not re-added", () => {
    expect(appendTelemetryConflicts([conflictA], [{ ...conflictA }])).toEqual([conflictA]);
  });

  test("two evidence-class pairs on the same field are both kept as distinct findings", () => {
    // The host's config said one thing at task:claim (`derived`) and the transcript said something
    // else by agent:release (`harness_observed`) — two different sources, two different findings.
    const laterProbe: TelemetryFieldConflict = {
      ...conflictA,
      probed_evidence_class: "harness_observed",
    };
    expect(appendTelemetryConflicts([conflictA], [laterProbe])).toEqual([conflictA, laterProbe]);
  });
});

describe("the contract accepts a grant carrying telemetry_conflicts and rejects a malformed one", () => {
  const validGrant = {
    id: "worker-1",
    role: "implementer",
    parent_agent_id: "coordinator-1",
    parent_task_id: "task-1",
    host: "claude-code",
    granted_at: "2026-08-20T00:00:00.000Z",
    status: "active",
    telemetry_conflicts: [
      {
        field: "model",
        recorded_value: "explicit-model",
        recorded_evidence_class: "agent_reported",
        probed_value: "derived-model",
        probed_evidence_class: "derived",
      },
    ],
  };

  test("isTelemetryFieldConflict accepts a well-formed conflict", () => {
    expect(isTelemetryFieldConflict(validGrant.telemetry_conflicts[0])).toBe(true);
  });

  test("isTelemetryFieldConflict rejects a conflict missing the probed side's evidence class", () => {
    const { probed_evidence_class: _drop, ...malformed } = validGrant.telemetry_conflicts[0]!;
    expect(isTelemetryFieldConflict(malformed)).toBe(false);
  });

  test("isAgentGrantRecord accepts a grant whose telemetry_conflicts are all well-formed", () => {
    expect(isAgentGrantRecord(validGrant)).toBe(true);
  });

  test("isAgentGrantRecord rejects a grant carrying a malformed conflict entry", () => {
    const malformed = {
      ...validGrant,
      telemetry_conflicts: [{ field: "model", recorded_value: "x" }],
    };
    expect(isAgentGrantRecord(malformed)).toBe(false);
  });
});
