import { describe, expect, test } from "bun:test";
import { proposeBatch } from "../../../../olt/scripts/src/engine/scheduler/index.ts";
import { makeAuthorityDecisionRecord } from "../../../../olt/scripts/src/workflow/authority/decision-record.ts";
import { schedulerState } from "../fixtures.ts";

function addTask(
  state: Record<string, unknown>,
  id: string,
  writeScope: string,
  resourceScope: string[],
  requirementIds = ["R-001"],
): void {
  const task = {
    id,
    type: "task",
    label: id,
    requirement_ids: requirementIds,
    write_scope: [writeScope],
    resource_scope: resourceScope,
    artifact_ids: ["artifact-all"],
    status: "ready",
    priority: 100,
    created_order: 0,
    effort: 1,
    dependencies: [],
  };
  (state.tasks as Record<string, unknown>)[id] = task;
  ((state.graph as Record<string, unknown>).nodes as unknown[]).push(task);
}

describe("scheduler active ownership and requirement authority", () => {
  test("excludes write and exclusive-resource conflicts with already-active work", () => {
    const state = schedulerState();
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    tasks.deep!.status = "running";
    tasks.deep!.write_scope = ["src/shared"];
    tasks.deep!.resource_scope = ["database:test"];
    addTask(state, "write-conflict", "src/shared/child", []);
    addTask(state, "resource-conflict", "src/elsewhere", ["database:test"]);
    addTask(state, "independent", "src/independent", ["database:other"]);

    const ids = proposeBatch(state).map(({ id }) => id);
    expect(ids).toContain("independent");
    expect(ids).not.toContain("write-conflict");
    expect(ids).not.toContain("resource-conflict");
  });

  test("does not dispatch tasks whose requirements lack authority", () => {
    const state = schedulerState();
    const requirements = (state.requirements as Record<string, unknown>).requirements as Record<
      string,
      unknown
    >[];
    requirements.push({ id: "R-002", disposition: "needs_authority" });
    addTask(state, "unauthorized", "authority/pending", [], ["R-002"]);
    addTask(state, "authorized", "authority/ready", [], ["R-001"]);

    const ids = proposeBatch(state).map(({ id }) => id);
    expect(ids).toContain("authorized");
    expect(ids).not.toContain("unauthorized");
  });

  test("dispatches a mixed task after its authority-gated obligation is declined", () => {
    const state = schedulerState();
    const requirements = (state.requirements as Record<string, unknown>).requirements as Record<
      string,
      unknown
    >[];
    const gated: Record<string, unknown> = {
      id: "R-002",
      disposition: "needs_authority",
      dependencies: [],
    };
    gated.authority_status = "declined";
    gated.authority_history = [
      makeAuthorityDecisionRecord(
        "R-002",
        "coordinator",
        { decision: "decline", rationale: "The user declined this optional authority." },
        "2026-08-13T12:00:00.000Z",
      ),
    ];
    requirements.push(gated);
    addTask(state, "mixed", "authority/mixed", [], ["R-001", "R-002"]);

    expect(proposeBatch(state).map(({ id }) => id)).toContain("mixed");
  });

  test("pauses a mixed task while any mapped authority decision is pending", () => {
    const state = schedulerState();
    const requirements = (state.requirements as Record<string, unknown>).requirements as Record<
      string,
      unknown
    >[];
    requirements.push({ id: "R-002", disposition: "needs_authority", dependencies: [] });
    addTask(state, "mixed-pending", "authority/mixed-pending", [], ["R-001", "R-002"]);

    expect(proposeBatch(state).map(({ id }) => id)).not.toContain("mixed-pending");
  });

  test("packs no two candidates with the same exclusive resource", () => {
    const state = schedulerState();
    addTask(state, "resource-first", "resource/first", ["browser:session"]);
    addTask(state, "resource-second", "resource/second", ["browser:session"]);
    const ids = proposeBatch(state).map(({ id }) => id);
    expect(ids).toContain("resource-first");
    expect(ids).not.toContain("resource-second");
  });

  test("blocks actionable work whose requirement depends on unauthorized scope", () => {
    const state = schedulerState();
    const requirements = (state.requirements as Record<string, unknown>).requirements as Record<
      string,
      unknown
    >[];
    requirements[0]!.dependencies = ["R-002"];
    requirements.push({ id: "R-002", disposition: "needs_authority", dependencies: [] });
    addTask(state, "blocked-by-authority", "authority/dependent", [], ["R-001"]);
    expect(proposeBatch(state).map(({ id }) => id)).not.toContain("blocked-by-authority");
  });
});
