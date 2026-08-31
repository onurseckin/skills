import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyPlan } from "../../../olt/scripts/src/graph/apply-plan.ts";
import { readPlanObject } from "../../../olt/scripts/src/graph/read-plan.ts";
import { PlanFixture, taskById } from "../validation/fixtures.ts";

describe("plan application", () => {
  let fixture: PlanFixture;
  beforeEach(async () => {
    fixture = new PlanFixture();
    await fixture.setup();
  });
  afterEach(async () => fixture.cleanup());

  test("plan application is audited and initializes scheduler projection", async () => {
    const state = await fixture.apply();
    expect(state.requirements).toEqual(fixture.requirements);
    expect(state.graph).toEqual(fixture.graph);
    expect(state.task_order).toEqual(["task-1", "task-2"]);
    expect(
      (state.tasks as Record<string, Record<string, unknown>>)["task-2"]!.dependencies,
    ).toEqual(["task-1"]);
    expect(state.plan_history).toEqual([]);
    expect(fixture.store.events.at(-1)).toMatchObject({
      actor: "planner",
      kind: "plan-applied",
      payload: { graph_revision: 1 },
    });
  });

  test("invalid apply does not advance state or events", async () => {
    const before = structuredClone(fixture.store.state);
    taskById(fixture.graph, "task-1").write_scope = ["../escape"];
    await fixture.write();
    await expect(fixture.apply()).rejects.toThrow();
    expect(fixture.store.state).toEqual(before);
    expect(fixture.store.events).toEqual([]);
  });

  test("graph revision guard ignores unrelated pre-plan events and rejects stale graph state", async () => {
    const unrelated = fixture.store.mutateRuntime((state) => {
      state.repository_inspections = { baseline: { digest: "a".repeat(64) } };
    });
    expect(unrelated).toBe(1);
    await expect(fixture.apply(0)).resolves.toBeDefined();

    fixture = new PlanFixture();
    await fixture.setup();
    await fixture.apply();
    fixture.graph.revision = 2;
    await fixture.write();
    const before = structuredClone(fixture.store.state);
    const events = structuredClone(fixture.store.events);
    await expect(fixture.apply(0)).rejects.toThrow();
    expect(fixture.store.state).toEqual(before);
    expect(fixture.store.events).toEqual(events);
  });

  test("plan files must be regular non-symlink bounded JSON objects", async () => {
    const link = join(fixture.root, "graph-link.json");
    await symlink(fixture.graphPath, link);
    await expect(
      applyPlan(fixture.store, "planner", fixture.requirementsPath, link, 0),
    ).rejects.toThrow();
    await writeFile(fixture.requirementsPath, "[]", "utf8");
    await expect(fixture.apply()).rejects.toThrow();
    await writeFile(fixture.requirementsPath, "{}", "utf8");
    await expect(
      readPlanObject(fixture.requirementsPath, "requirements", { maxBytes: 1 }),
    ).rejects.toThrow();
  });

  test("plan JSON is rejected when it exceeds the shared structural depth policy", async () => {
    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 140; depth += 1) nested = { child: nested };
    fixture.requirements.extra = nested;
    await fixture.write();
    await expect(fixture.apply()).rejects.toThrow(/depth/i);
  });

  test("plan symlink is rejected without O_NOFOLLOW support", async () => {
    const link = join(fixture.root, "graph-link-fallback.json");
    await symlink(fixture.graphPath, link);
    await expect(readPlanObject(link, "graph", { noFollowFlag: 0 })).rejects.toThrow();
  });

  test("apply rejects malformed nested values as harness errors", async () => {
    (fixture.requirements.dispositions as Record<string, unknown>[])[0]!.kind = ["requirement"];
    await fixture.write();
    await expect(fixture.apply()).rejects.toThrow();
    fixture = new PlanFixture();
    await fixture.setup();
    (fixture.graph.edges as Record<string, unknown>[])[0]!.source = [];
    await fixture.write();
    await expect(fixture.apply()).rejects.toThrow();
  });

  test("revision must increase by exactly one", async () => {
    const state = await fixture.apply();
    for (const revision of [1, 3]) {
      fixture.graph.revision = revision;
      await fixture.write();
      await expect(fixture.apply(state.revision as number)).rejects.toThrow();
    }
  });
});
