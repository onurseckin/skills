import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyPlan } from "../../src/graph/apply-plan.ts";
import { planningPort, workflowPort } from "../../src/integration/store-ports.ts";
import { proposeBatch } from "../../src/scheduler/propose-batch.ts";
import { initRun, loadRun, transact } from "../../src/store/index.ts";
import { claimTask } from "../../src/workflow/lease/claim.ts";
import { graphDocument } from "../graph/fixtures.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";

const roots: string[] = [];

async function initializedRun() {
  const repo = await mkdtemp(join(tmpdir(), "harness-ports-"));
  roots.push(repo);
  const prompt = "First\n\nThird";
  const runRoot = initRun(repo, "adapter-run", new TextEncoder().encode(prompt), "file", true);
  const requirements = requirementsDocument(prompt);
  const graph = graphDocument(requirements);
  const requirementsPath = join(repo, "requirements.json");
  const graphPath = join(repo, "graph.json");
  await writeFile(requirementsPath, JSON.stringify(requirements));
  await writeFile(graphPath, JSON.stringify(graph));
  return { runRoot, requirementsPath, graphPath };
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("durable integration ports", () => {
  test("applies a plan to a real capsule and schedules its first task", async () => {
    const fixture = await initializedRun();
    await applyPlan(
      planningPort(fixture.runRoot),
      "planner",
      fixture.requirementsPath,
      fixture.graphPath,
      0,
    );
    const loaded = loadRun(fixture.runRoot);
    expect(proposeBatch(loaded.state, 2).map(({ id }) => id)).toEqual(["task-1"]);
    expect(loaded.events.at(-1)?.kind).toBe("plan-applied");
  });

  test("normalizes workflow runtime fields inside the first audited mutation", async () => {
    const fixture = await initializedRun();
    await applyPlan(
      planningPort(fixture.runRoot),
      "planner",
      fixture.requirementsPath,
      fixture.graphPath,
      0,
    );
    const result = claimTask(workflowPort(fixture.runRoot), "task-1", "implementer", "implementer");
    expect(result.token).toHaveLength(43);
    expect(result.state.tasks["task-1"]?.status).toBe("leased");
    const loaded = loadRun(fixture.runRoot);
    expect(loaded.events.at(-1)?.kind).toBe("task-claimed");
    expect(
      (loaded.state.tasks as Record<string, Record<string, unknown>>)["task-1"]?.attempts,
    ).toHaveLength(1);
  });

  test("workflow reads do not mutate an unplanned capsule", async () => {
    const fixture = await initializedRun();
    const before = loadRun(fixture.runRoot).state;
    expect(() => workflowPort(fixture.runRoot).read()).toThrow("plan");
    expect(loadRun(fixture.runRoot).state).toEqual(before);
  });

  test("workflow mutations preserve authoritative completion evidence", async () => {
    const fixture = await initializedRun();
    await applyPlan(
      planningPort(fixture.runRoot),
      "planner",
      fixture.requirementsPath,
      fixture.graphPath,
      0,
    );
    const completion = {
      integrity_issues: [],
      critic: { status: "clean", unresolved_finding_ids: [] },
      run_gates: [],
    };
    transact(fixture.runRoot, "critic", "completion-reviewed", {}, (draft) => {
      draft.completion = completion;
    });
    claimTask(workflowPort(fixture.runRoot), "task-1", "implementer", "implementer");
    expect(loadRun(fixture.runRoot).state.completion).toEqual(completion);
  });

  test("workflow mutations preserve packet and terminal lifecycle state", async () => {
    const fixture = await initializedRun();
    await applyPlan(
      planningPort(fixture.runRoot),
      "planner",
      fixture.requirementsPath,
      fixture.graphPath,
      0,
    );
    const packet = {
      id: "critic-1",
      role: "completeness-critic",
      agent_id: "critic",
      task_id: null,
      attempt: 1,
      graph_revision: 1,
      markdown_path: "packets/critic-1/packet.md",
      metadata_path: "packets/critic-1/metadata.json",
      packet_sha256: "a".repeat(64),
      published_at: "2026-08-13T00:00:00.000Z",
    };
    const critic = {
      critic_id: "critic",
      token_digest: "b".repeat(64),
      attempt: 1,
      status: "packet_published",
      started_at: "2026-08-13T00:00:00.000Z",
      packet_id: "critic-1",
    };
    transact(fixture.runRoot, "coordinator", "lifecycle-seeded", {}, (draft) => {
      draft.packets = { "critic-1": packet };
      draft.completion_critic = critic;
      draft.orphan_evidence_dispositions = [{ orphan_sha256: "c".repeat(64) }];
    });

    claimTask(workflowPort(fixture.runRoot), "task-1", "implementer", "implementer");
    const state = workflowPort(fixture.runRoot).read();
    expect(state.graph_revision).toBe(1);
    expect(state.packets).toEqual({ "critic-1": packet });
    expect(state.completion_critic).toEqual(critic);
    expect(state.orphan_evidence_dispositions).toEqual([{ orphan_sha256: "c".repeat(64) }]);
    const persisted = loadRun(fixture.runRoot).state;
    expect(persisted.packets).toEqual({ "critic-1": packet });
    expect(persisted.completion_critic).toEqual(critic);
  });
});
