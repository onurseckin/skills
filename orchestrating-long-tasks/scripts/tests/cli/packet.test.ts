import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execute } from "../../src/cli/execute.ts";
import { applyPlan } from "../../src/graph/apply-plan.ts";
import { planningPort, workflowPort } from "../../src/integration/store-ports.ts";
import { initRun, loadRun } from "../../src/store/index.ts";
import { claimTask } from "../../src/workflow/lease/claim.ts";
import { graphDocument } from "../graph/fixtures.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";
import { initializePlannerPacket } from "../../src/packets/planner-packet.ts";

const roots: string[] = [];
const scriptsRoot = fileURLToPath(new URL("../..", import.meta.url));

function makeWritable(dir: string): void {
  try {
    chmodSync(dir, 0o777);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        makeWritable(full);
      } else {
        try {
          chmodSync(full, 0o666);
        } catch {}
      }
    }
  } catch {}
}

afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => {
      makeWritable(root);
      return rm(root, { recursive: true, force: true });
    }),
  ),
);

describe("CLI role packets", () => {
  test("builds an immutable scoped packet from pinned assets", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-cli-packet-"));
    roots.push(repo);
    const prompt = "First\n\nThird";
    const run = initRun(repo, "packet-run", new TextEncoder().encode(prompt), "file", true, {
      runtimeSource: scriptsRoot,
    });
    await initializePlannerPacket(run, "planner");
    const requirements = requirementsDocument(prompt);
    const graph = graphDocument(requirements);
    const requirementPath = join(repo, "requirements.json");
    const graphPath = join(repo, "graph.json");
    await writeFile(requirementPath, JSON.stringify(requirements));
    await writeFile(graphPath, JSON.stringify(graph));
    await applyPlan(planningPort(run), "planner", requirementPath, graphPath, 0);
    const claim = claimTask(workflowPort(run), "task-1", "worker", "implementer");
    await expect(
      execute([
        "packet",
        "--run",
        run,
        "--task",
        "task-1",
        "--role",
        "implementer",
        "--agent",
        "worker",
        "--token",
        "invalid-token",
        "--id",
        "unauthorized-packet",
      ]),
    ).rejects.toThrow("authentication");
    expect(loadRun(run).state.current_repository_inspection_sha256).toBeUndefined();
    const result = await execute([
      "packet",
      "--run",
      run,
      "--task",
      "task-1",
      "--role",
      "implementer",
      "--agent",
      "worker",
      "--token",
      claim.token,
      "--id",
      "task-1-implementer-1",
    ]);
    expect(result.path).toBe(join(run, "packets", "task-1-implementer-1", "packet.md"));
    expect(result.metadata).toMatchObject({
      role: "implementer",
      task_id: "task-1",
      requirement_ids: ["R-001"],
    });
    expect(loadRun(run).state.packets).toMatchObject({
      "task-1-implementer-1": {
        role: "implementer",
        agent_id: "worker",
        task_id: "task-1",
      },
    });
    expect(await readFile(result.path as string, "utf8")).not.toContain(claim.token);
    expect(
      await readFile(join(run, "packets", "task-1-implementer-1", "metadata.json"), "utf8"),
    ).not.toContain(claim.token);
    workflowPort(run).transact("worker", "test-task-advanced", {}, (draft) => {
      draft.tasks["task-1"]!.status = "submitted";
      delete draft.tasks["task-1"]!.lease;
    });
    const retried = await execute([
      "packet",
      "--run",
      run,
      "--task",
      "task-1",
      "--role",
      "implementer",
      "--agent",
      "worker",
      "--token",
      claim.token,
      "--id",
      "task-1-implementer-1",
    ]);
    expect(retried).toEqual(result);
    expect(
      loadRun(run).events.filter(
        ({ kind, payload }) =>
          kind === "packet-published" && payload.packet_id === "task-1-implementer-1",
      ),
    ).toHaveLength(1);
  });

  test("recovers the pre-plan planner packet through the ordinary packet command", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-cli-planner-recovery-"));
    roots.push(repo);
    const run = initRun(
      repo,
      "planner-recovery",
      new TextEncoder().encode("Plan this"),
      "file",
      true,
      {
        runtimeSource: scriptsRoot,
      },
    );
    const result = await execute([
      "packet",
      "--run",
      run,
      "--role",
      "planner",
      "--agent",
      "planner",
      "--id",
      "planner-0",
    ]);
    expect(result.metadata).toMatchObject({ role: "planner", graph_revision: 0 });
    expect(loadRun(run).state).toMatchObject({
      baseline_repository_inspection_sha256: expect.any(String),
      packets: { "planner-0": { status: "published" } },
    });
  });

  test("initialization publishes planner-0 and the inspection command refreshes current state", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-cli-planner-init-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Plan this immediately");
    const result = await execute([
      "init",
      "--repo",
      repo,
      "--run-id",
      "planner-init",
      "--prompt-file",
      promptPath,
      "--capture-mode",
      "file",
      "--source-verified",
      "--runtime-source",
      scriptsRoot,
    ]);
    const run = result.run_root as string;
    expect(result.planner_packet).toBe(join(run, "packets", "planner-0", "packet.md"));
    expect(loadRun(run).state.packets).toMatchObject({
      "planner-0": { graph_revision: 0, status: "published" },
    });
    const refreshed = await execute([
      "inspect-repository",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--phase",
      "current",
    ]);
    expect(refreshed.inspection).toMatchObject({ phase: "current" });
    expect(loadRun(run).state.current_repository_inspection_sha256).toBeString();
  });
});
