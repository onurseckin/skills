import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PlanFixture, taskById } from "../validation/fixtures.ts";

type StateTask = Record<string, unknown>;
function tasks(state: Record<string, unknown>): Record<string, StateTask> {
  return state.tasks as Record<string, StateTask>;
}

describe("plan revisions", () => {
  let fixture: PlanFixture;
  beforeEach(async () => {
    fixture = new PlanFixture();
    await fixture.setup();
  });
  afterEach(async () => fixture.cleanup());

  test("revision rejects requirement source changes and done task changes", async () => {
    await fixture.apply();
    fixture.store.mutateRuntime((state) => {
      tasks(state)["task-1"]!.status = "done";
    });
    fixture.graph.revision = 2;
    (fixture.requirements.requirements as Record<string, unknown>[])[0]!.implementation = "Changed";
    await fixture.write();
    await expect(fixture.apply(1)).rejects.toThrow();
    fixture = new PlanFixture();
    await fixture.setup();
    await fixture.apply();
    fixture.store.mutateRuntime((state) => {
      tasks(state)["task-1"]!.status = "done";
    });
    fixture.graph.revision = 2;
    taskById(fixture.graph, "task-1").write_scope = ["src/changed"];
    await fixture.write();
    await expect(fixture.apply(1)).rejects.toThrow();
  });

  test("valid revision preserves satisfied and done runtime history", async () => {
    await fixture.apply();
    fixture.store.mutateRuntime((state) => {
      const requirement = (
        (state.requirements as Record<string, unknown>).requirements as Record<string, unknown>[]
      )[0]!;
      requirement.status = "satisfied";
      requirement.evidence = ["evidence/r1.json"];
      tasks(state)["task-1"]!.status = "done";
      tasks(state)["task-1"]!.history = [{ status: "done" }];
    });
    fixture.graph.revision = 2;
    await fixture.write();
    const state = await fixture.apply(1);
    const requirement = (
      (state.requirements as Record<string, unknown>).requirements as Record<string, unknown>[]
    )[0]!;
    expect(requirement).toMatchObject({ status: "satisfied", evidence: ["evidence/r1.json"] });
    expect(tasks(state)["task-1"]).toMatchObject({ status: "done", history: [{ status: "done" }] });
  });

  test("valid revision preserves audited requirement authority decisions", async () => {
    await fixture.apply();
    const authority = {
      authority_status: "granted",
      authority_history: [
        {
          decision_id: "AD-R-001-1",
          requirement_id: "R-001",
          decision: "grant",
          actor: "coordinator",
          rationale: "user explicitly approved the operation",
          decided_at: "2026-08-13T12:00:00.000Z",
          prior_disposition: "needs_authority",
          resulting_disposition: "actionable",
          decision_sha256: "a".repeat(64),
        },
      ],
    };
    fixture.store.mutateRuntime((state) => {
      const requirement = (
        (state.requirements as Record<string, unknown>).requirements as Record<string, unknown>[]
      )[0]!;
      Object.assign(requirement, structuredClone(authority));
    });
    fixture.graph.revision = 2;
    await fixture.write();

    const state = await fixture.apply(1);
    const requirement = (
      (state.requirements as Record<string, unknown>).requirements as Record<string, unknown>[]
    )[0]!;
    expect(requirement).toMatchObject(authority);
  });

  test("revision archives exact prior documents as immutable history", async () => {
    await fixture.apply();
    const revision = fixture.store.mutateRuntime((state) => {
      tasks(state)["task-1"]!.history = [{ status: "validated" }];
    });
    const priorRequirements = structuredClone(fixture.store.state.requirements);
    const priorGraph = structuredClone(fixture.store.state.graph);
    fixture.graph.revision = 2;
    await fixture.write();
    const state = await fixture.apply(1);
    expect(state.plan_history).toEqual([
      {
        requirements: priorRequirements,
        graph: priorGraph,
        replaced_by_revision: 2,
        recorded_state_revision: revision,
      },
    ]);
    fixture.requirements.schema = "mutated";
    fixture.graph.schema = "mutated";
    expect((state.plan_history as unknown[])[0]).toEqual({
      requirements: priorRequirements,
      graph: priorGraph,
      replaced_by_revision: 2,
      recorded_state_revision: revision,
    });
  });

  async function prepareDependencyRevision(status: string): Promise<number> {
    fixture.graph.edges = (fixture.graph.edges as Record<string, unknown>[]).filter(
      ({ type }) => type !== "depends_on",
    );
    taskById(fixture.graph, "task-2").status = "ready";
    await fixture.write();
    await fixture.apply();
    const revision = fixture.store.mutateRuntime((state) => {
      tasks(state)["task-2"]!.status = status;
    });
    fixture.graph.revision = 2;
    taskById(fixture.graph, "task-2").status = "proposed";
    (fixture.graph.edges as unknown[]).push({
      source: "task-2",
      target: "task-1",
      type: "depends_on",
    });
    await fixture.write();
    return revision;
  }

  for (const [name, status] of [
    ["revision cannot downgrade ready task to hide unfinished dependency", "ready"],
    ["revision cannot change running task dependencies", "running"],
    ["revision cannot change done task dependencies", "done"],
  ] as const) {
    test(name, async () => {
      await prepareDependencyRevision(status);
      const before = structuredClone(fixture.store.state);
      await expect(fixture.apply(1)).rejects.toThrow();
      expect(fixture.store.state).toEqual(before);
    });
  }

  test("execution-active tasks preserve every contract field", async () => {
    const mutations: Record<string, (graph: Record<string, unknown>) => void> = {
      requirement_ids: (graph) => {
        taskById(graph, "task-2").requirement_ids = ["R-002"];
      },
      write_scope: (graph) => {
        taskById(graph, "task-2").write_scope = ["src/replanned"];
      },
      priority: (graph) => {
        taskById(graph, "task-2").priority = 99;
      },
      effort: (graph) => {
        taskById(graph, "task-2").effort = 20;
      },
      label: (graph) => {
        taskById(graph, "task-2").label = "Rewritten";
      },
      type: (graph) => {
        taskById(graph, "task-2").type = "topic";
      },
      dependencies: (graph) => {
        (graph.edges as unknown[]).push({ source: "task-2", target: "task-1", type: "depends_on" });
      },
      produces: (graph) => {
        (graph.nodes as unknown[]).push({
          id: "artifact-alt",
          type: "artifact",
          label: "Alternate",
        });
        (graph.edges as Record<string, unknown>[]).find(
          ({ source, type }) => source === "task-2" && type === "produces",
        )!.target = "artifact-alt";
      },
    };
    for (const status of ["leased", "running", "submitted", "done"])
      for (const mutate of Object.values(mutations)) {
        const current = new PlanFixture();
        await current.setup();
        try {
          for (const node of current.graph.nodes as Record<string, unknown>[])
            if (node.type === "task") node.requirement_ids = ["R-001", "R-002"];
          current.graph.edges = (current.graph.edges as Record<string, unknown>[]).filter(
            ({ type }) => type !== "depends_on",
          );
          taskById(current.graph, "task-2").status = "ready";
          await current.write();
          await current.apply();
          current.store.mutateRuntime((state) => {
            tasks(state)["task-2"]!.status = status;
          });
          current.graph.revision = 2;
          taskById(current.graph, "task-2").status = "proposed";
          mutate(current.graph);
          await current.write();
          await expect(current.apply(1)).rejects.toThrow();
        } finally {
          await current.cleanup();
        }
      }
  });
});
