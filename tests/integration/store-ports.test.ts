import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { workflowPort } from "../../orchestrating-long-tasks/scripts/src/integration/store-ports.ts";
import { proposeBatch } from "../../orchestrating-long-tasks/scripts/src/scheduler/propose-batch.ts";
import { loadRun, transact } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { claimTask } from "../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";

const roots: string[] = [];

// A real capsule, compiled through the same CLI path a coordinator drives (`plan:init`,
// `plan:add`, `plan:compile`), so the port is read against state a run actually produces.
async function initializedRun() {
  const repo = await mkdtemp(join(tmpdir(), "harness-ports-"));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "First\n\nThird");
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    "adapter-run",
    "--prompt-file",
    promptPath,
  ]);
  const runRoot = init.run_root as string;
  await execute([
    "plan:add",
    "--run",
    runRoot,
    "--id",
    "task-1",
    "--label",
    "Task 1",
    "--scope",
    "src/area-1",
    "--gate",
    "bun test tests/planning",
    "--actor",
    "planner",
  ]);
  await execute([
    "plan:compile",
    "--run",
    runRoot,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests",
  ]);
  return { runRoot };
}

async function uncompiledRun() {
  const repo = await mkdtemp(join(tmpdir(), "harness-ports-"));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "First\n\nThird");
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    "adapter-run-unplanned",
    "--prompt-file",
    promptPath,
  ]);
  return { runRoot: init.run_root as string };
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("durable integration ports", () => {
  test("compiles a plan into a real capsule and schedules its first task", async () => {
    const fixture = await initializedRun();
    const loaded = loadRun(fixture.runRoot);
    expect(proposeBatch(loaded.state, 2).map(({ id }) => id)).toEqual(["task-1"]);
    expect(loaded.events.at(-1)?.kind).toBe("topology-recorded");
  });

  test("normalizes workflow runtime fields inside the first audited mutation", async () => {
    const fixture = await initializedRun();
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
    const fixture = await uncompiledRun();
    const before = loadRun(fixture.runRoot).state;
    expect(() => workflowPort(fixture.runRoot).read()).toThrow("plan");
    expect(loadRun(fixture.runRoot).state).toEqual(before);
  });

  test("workflow mutations preserve authoritative completion evidence", async () => {
    const fixture = await initializedRun();
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
