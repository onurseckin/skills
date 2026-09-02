import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import {
  setupCompiledRun,
  setupCompiledRunUncompiled,
  markCoreImplemented,
} from "../../fixtures/task-ops-fixture.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../../olt/scripts/src/runtime/session.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
  enableInMemoryAgentMetadata();
});
afterEach(async () => {
  disableInMemoryAgentMetadata();
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
  roots.length = 0;
});

describe("plan:replan", () => {
  test("raises the graph revision, generates a repair task inheriting its parent's gate, and stamps repair_round", async () => {
    const { repo, run } = await setupCompiledRun("replan-basic", roots);
    await markCoreImplemented(repo);

    const replanned = await execute([
      "plan:replan",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--findings",
      JSON.stringify([
        {
          observation: "task-core left a null check out",
          severity: "critical",
          remediation: "add the null check",
          file_paths: ["tests/core/impl.ts"],
        },
      ]),
    ]);
    expect(replanned.revision).toBe(2);
    expect(replanned.repair_round).toBe(1);
    const repairTasks = replanned.repair_tasks as { id: string; gateCommand: string[] }[];
    expect(repairTasks.length).toBeGreaterThan(0);
    expect(String(replanned.markdown)).toContain("Graph Revision 2");
  });

  test("refuses when the findings source is entirely empty", async () => {
    const { run } = await setupCompiledRun("replan-no-findings", roots);
    await expect(
      execute([
        "plan:replan",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--gate",
        "bun run typecheck",
      ]),
    ).rejects.toThrow(/no findings available for replanning/);
  });

  test("an explicit --gate flag overrides any inherited or declared gate", async () => {
    const { repo, run } = await setupCompiledRun("replan-flag-gate", roots);
    await markCoreImplemented(repo);
    const replanned = await execute([
      "plan:replan",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--gate",
      "bun run typecheck",
      "--findings",
      JSON.stringify([
        {
          observation: "x",
          severity: "minor",
          file_paths: ["tests/core/impl.ts"],
        },
      ]),
    ]);
    const repairTasks = replanned.repair_tasks as { gate_source: string; gateCommand: string[] }[];
    expect(repairTasks[0]!.gate_source).toBe("flag");
    expect(repairTasks[0]!.gateCommand).toEqual(["bun", "run", "typecheck"]);
  });

  test("refuses plan:replan against an uncompiled plan (no requirement to bind the finding to)", async () => {
    const { run } = await setupCompiledRunUncompiled("replan-uncompiled", roots);
    await expect(
      execute([
        "plan:replan",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--gate",
        "bun run typecheck",
        "--findings",
        JSON.stringify([{ observation: "x", severity: "minor" }]),
      ]),
    ).rejects.toThrow();
  });

  test("expires a live completion_critic attempt and clears completion_review when replanning", async () => {
    const { repo, run } = await setupCompiledRun("replan-expires-critic", roots);
    await markCoreImplemented(repo);
    transact(run, "critic-1", "seed-completion-critic-for-test", {}, (state) => {
      state.completion_critic = { attempt: 1, status: "pending" };
      state.completion_critic_history = [{ attempt: 1, status: "pending" }];
      state.completion_review = {
        findings: [
          {
            observation: "recorded review finding",
            severity: "minor",
            file_paths: ["tests/core/impl.ts"],
          },
        ],
      };
    });

    const replanned = await execute([
      "plan:replan",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--gate",
      "bun run typecheck",
    ]);
    expect(replanned.revision).toBe(2);
  });
});
