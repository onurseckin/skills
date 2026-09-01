import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import {
  extractLeaseAgentId,
  extractLeaseRole,
  extractLeaseAttempt,
} from "../../../../../olt/scripts/src/reporting/lease-agent-extractor.ts";
import type { UnifiedReport } from "../../../../../olt/scripts/src/reporting/index.ts";
import {
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../../commands/fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(() => {
  roots.length = 0;
  cleanupVirtualCliFS();
});

async function createBaseRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-unified-leases-${name}-`)));
  roots.push(repo);
  await mkdir(join(repo, ".git"), { recursive: true });
  await mkdir(join(repo, ".olt"), { recursive: true });
  const promptPath = join(repo, "prompt.txt");
  await writeFile(
    promptPath,
    "Build modular system with API backend, UI frontend, and automated testing.\nSecond requirement line for data storage.\n",
  );

  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  return { repo, run: init.run_root as string };
}

describe("Unified Reporting - Leases and Decisions Views", () => {
  test("report:leases and report:decisions format durable records cleanly", async () => {
    const { repo, run } = await createBaseRun("leases-decisions");
    await mkdir(join(repo, "src/core"), { recursive: true });
    await writeFile(join(repo, "gate.ts"), "console.log('gate');\n");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core",
      "--scope",
      "src/core",
      "--gate",
      "bun gate.ts",
      "--requirement-lines",
      "1",
      "--actor",
      "planner",
    ]);
    await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);
    await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "impl-core-1",
      "--role",
      "implementer",
      "--host",
      "cli",
    ]);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "impl-core-1",
      "--role",
      "implementer",
    ]);

    const leasesResult = (await execute(["report:leases", "--run", run])) as Record<
      string,
      unknown
    >;
    expect(leasesResult.matrix).toBeDefined();
    expect(leasesResult.markdown as string).toContain("`impl-core-1`");
    expect(leasesResult.markdown as string).not.toContain("undefined");

    const decisionsResult = (await execute(["report:decisions", "--run", run])) as Record<
      string,
      unknown
    >;
    expect(decisionsResult.decisions).toBeDefined();
  });

  test("robust lease agent extraction handles legacy agent field and prevents undefined in CLI outputs", async () => {
    const { repo, run } = await createBaseRun("legacy-lease-extraction");
    await mkdir(join(repo, "src/legacy"), { recursive: true });
    await writeFile(join(repo, "gate.ts"), "console.log('legacy');\n");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-legacy",
      "--label",
      "Legacy Task",
      "--scope",
      "src/legacy",
      "--gate",
      "bun gate.ts",
      "--requirement-lines",
      "1",
      "--actor",
      "planner",
    ]);
    await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);
    await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);

    transact(run, "coordinator", "task-updated", {}, (state) => {
      const task = state.tasks["task-legacy"];
      if (task) {
        task.status = "leased";
        task.lease = {
          agent: "legacy-worker-99",
          role: "implementer",
          attempt: 1,
          token_digest: "tok-leg",
          issued_at: "2026-08-22T08:00:00.000Z",
          expires_at: "2026-08-22T08:20:00.000Z",
          heartbeat_at: "2026-08-22T08:05:00.000Z",
          duration_seconds: 1200,
        };
      }
    });

    const statusResult = (await execute(["run:status", "--run", run])) as Record<string, unknown>;
    expect(statusResult.markdown as string).toContain("Leased (legacy-worker-99 [implementer])");
    expect(statusResult.markdown as string).not.toContain("Leased (undefined");

    const dagResult = (await execute(["dag", "--run", run])) as Record<string, unknown>;
    expect(dagResult.markdown as string).toContain("legacy-worker-99");
    expect(dagResult.markdown as string).not.toContain("undefined");

    const reportResult = (await execute([
      "report",
      "--run",
      run,
      "--detailed",
    ])) as unknown as UnifiedReport;
    expect(reportResult.lifecycle.implementers.active[0]?.agentId).toBe("legacy-worker-99");
    expect(reportResult.markdown).toContain("legacy-worker-99");
    expect(reportResult.markdown).not.toContain("`undefined`");
  });

  test("lease-agent-extractor exports extractLeaseAgentId, extractLeaseRole, and extractLeaseAttempt", () => {
    expect(extractLeaseAgentId({ agent_id: "agent-10" })).toBe("agent-10");
    expect(extractLeaseAgentId({ agent: "agent-20" })).toBe("agent-20");
    expect(extractLeaseRole({ role: "coordinator" })).toBe("coordinator");
    expect(extractLeaseRole({})).toBe("implementer");
    expect(extractLeaseAttempt({ attempt: 2 })).toBe(2);
    expect(extractLeaseAttempt({})).toBe(1);
  });
});
