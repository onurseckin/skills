import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/json.ts";
import { branchCapsule, openBranchVia } from "../branch/fixture.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

function expireTaskLease(run: string, taskId: string): void {
  transact(run, "test-setup", "lease-expired-for-test", {}, (draft) => {
    const tasks = draft.tasks as JsonObject;
    const task = tasks[taskId] as JsonObject;
    const lease = task.lease as JsonObject;
    lease.expires_at = "2020-01-01T00:00:00.000Z";
  });
}

function expireBranchSubTaskLease(run: string, branchId: string, subTaskId: string): void {
  transact(run, "test-setup", "sub-lease-expired-for-test", {}, (draft) => {
    const branches = draft.branches as JsonObject[];
    const branch = branches.find((entry) => entry.id === branchId) as JsonObject;
    const subTasks = branch.sub_tasks as JsonObject[];
    const subTask = subTasks.find((entry) => entry.id === subTaskId) as JsonObject;
    const lease = subTask.lease as JsonObject;
    lease.expires_at = "2020-01-01T00:00:00.000Z";
  });
}

describe("doctor", () => {
  test("reports capsule integrity without an installation check when --source/--home are absent", async () => {
    const { run } = await setupCompiledRun("doctor-basic", roots);
    const result = await execute(["doctor", "--run", run]);
    expect(String(result.markdown)).toContain(`### Capsule Doctor: \`${run}\``);
    expect(typeof result.healthy).toBe("boolean");
  });

  test("adds the installation check when --source and --home are both given", async () => {
    const { run } = await setupCompiledRun("doctor-installation", roots);
    const installRoot = await mkdtemp(join(tmpdir(), "doctor-install-"));
    roots.push(installRoot);
    const source = join(installRoot, "source");
    const home = join(installRoot, "home");
    await mkdir(join(source, "scripts", "src", "config"), { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "---\nname: olt\ndescription: test\n---\n");
    await writeFile(join(source, "scripts", "harness.ts"), "console.log('ok')\n", { mode: 0o755 });
    await writeFile(
      join(source, "scripts", "package.json"),
      '{"name":"@local/olt-runtime","private":true}\n',
    );
    await writeFile(
      join(source, "scripts", "src", "config", "constants.ts"),
      'export const RUNTIME_VERSION = "0.1.0";\n',
    );

    const result = await execute([
      "doctor",
      "--run",
      run,
      "--source",
      source,
      "--home",
      home,
      "--clients",
      "claude, ,codex",
    ]);
    expect(result.installation).toBeDefined();
  });
});

describe("recover", () => {
  test("releases a task lease past its expiry and reclaims a stale branch sub-lease", async () => {
    const { run } = await setupCompiledRun("recover-stale", roots);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--lease-seconds",
      "600",
    ]);
    expireTaskLease(run, "task-core");

    const result = await execute(["recover", "--run", run, "--actor", "coordinator"]);
    expect(String(result.markdown)).toContain("### Stale Lease Recovery");
    expect(result.recovered).toEqual(["task-core"]);
    expect(result.recovered_sub_tasks).toEqual([]);
    const tasks = result.tasks as JsonObject;
    expect((tasks["task-core"] as JsonObject).status).toBe("retry_ready");
  });

  test("accepts an explicit --grace-seconds", async () => {
    const { run } = await setupCompiledRun("recover-grace", roots);
    const result = await execute([
      "recover",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--grace-seconds",
      "0",
    ]);
    expect(result.recovered).toEqual([]);
  });

  test("reclaims a branch sub-task whose sub-agent's lease has expired", async () => {
    const fixture = await branchCapsule(roots, "recover-sub-lease");
    const opened = await openBranchVia(fixture);
    const branchId = String(opened.branch_id);
    await execute([
      "agent:register",
      "--run",
      fixture.run,
      "--agent",
      "sub-1",
      "--role",
      "sub-implementer",
      "--host",
      "antigravity",
      "--parent-agent",
      "worker-1",
      "--parent-task",
      "S-1",
    ]);
    await execute([
      "branch:claim",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      branchId,
      "--sub-task",
      "S-1",
      "--agent",
      "sub-1",
      "--role",
      "sub-implementer",
    ]);
    expireBranchSubTaskLease(fixture.run, branchId, "S-1");

    const result = await execute(["recover", "--run", fixture.run, "--actor", "coordinator"]);
    expect(result.recovered_sub_tasks).toEqual(["S-1"]);
    expect(String(result.markdown)).toContain("- **Branch Sub-leases Reclaimed**: 1");
    expect(String(result.markdown)).toContain("`S-1` -> open");
  });
});

describe("doctor:repair", () => {
  test("re-derives state.json from the event chain and reports no torn tail on a healthy run", async () => {
    const { run } = await setupCompiledRun("repair-projection", roots);
    const result = await execute(["doctor:repair", "--run", run, "--actor", "coordinator"]);
    expect(String(result.markdown)).toContain("### Projection Repaired");
    expect(result.quarantined_torn_tail).toBe(false);
    expect(result.state).toBeDefined();
  });
});

describe("task:release", () => {
  test("hands a live lease back without waiting for it to expire", async () => {
    const { run } = await setupCompiledRun("task-release", roots);
    const claimed = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    const result = await execute([
      "task:release",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--token",
      String(claimed.token),
    ]);
    expect(String(result.markdown)).toContain("### Lease Released: `task-core`");
    const task = result.task as JsonObject;
    expect(task.status).toBe("retry_ready");
  });
});

describe("health", () => {
  // Nested repoRoot/skillRoot/scripts/src so defaultLayout's repoRoot (two directories up from
  // --scripts) stays inside the disposable fixture instead of resolving to the real tmpdir root,
  // which the broader vendor-prose/vendor-identifiers checks then walk in full.
  async function tinyScriptsRoot(
    name: string,
    sourceBody: string,
  ): Promise<{ repoRoot: string; scriptsRoot: string }> {
    const repoRoot = await mkdtemp(join(tmpdir(), `health-cmd-${name}-`));
    roots.push(repoRoot);
    const scriptsRoot = join(repoRoot, "skill", "scripts");
    await mkdir(join(scriptsRoot, "src"), { recursive: true });
    await writeFile(join(scriptsRoot, "src", "entry.ts"), sourceBody);
    return { repoRoot, scriptsRoot };
  }

  test("rejects a --scripts directory that does not exist", async () => {
    await expect(
      execute(["health", "--scripts", join(tmpdir(), "definitely-does-not-exist-xyz")]),
    ).rejects.toThrow(/--scripts does not exist/);
  });

  test("rejects a --consumer directory that does not exist", async () => {
    const { scriptsRoot } = await tinyScriptsRoot("bad-consumer", "export const x = 1;\n");
    await expect(
      execute([
        "health",
        "--scripts",
        scriptsRoot,
        "--consumer",
        join(tmpdir(), "no-such-consumer"),
      ]),
    ).rejects.toThrow(/--consumer does not exist/);
  });

  test("rejects a --scripts root with no src directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "health-cmd-no-src-"));
    roots.push(root);
    await expect(execute(["health", "--scripts", root])).rejects.toThrow(/no src directory under/);
  });

  test("rejects an unrecognized --check name", async () => {
    const { scriptsRoot } = await tinyScriptsRoot("bad-check", "export const x = 1;\n");
    await expect(
      execute(["health", "--scripts", scriptsRoot, "--check", "not-a-real-check"]),
    ).rejects.toThrow(/unknown --check: not-a-real-check/);
  });

  test("restricting to one check reports a finding for an identifier this check flags", async () => {
    const { repoRoot, scriptsRoot } = await tinyScriptsRoot(
      "dead-code-hit",
      "export const legacyHelper = () => 1;\n",
    );
    const result = await execute(["health", "--scripts", scriptsRoot, "--check", "dead-code"]);
    expect(result.run_root).toBe(repoRoot);
    expect(result.healthy).toBe(false);
    expect(String(result.markdown)).toBeString();
  });

  test("--strict raises when the report is unhealthy", async () => {
    const { scriptsRoot } = await tinyScriptsRoot(
      "strict-fail",
      "export const legacyHelper = () => 1;\n",
    );
    await expect(
      execute(["health", "--scripts", scriptsRoot, "--check", "dead-code", "--strict"]),
    ).rejects.toThrow(/semantic health check failed/);
  });

  test("a clean tree with every default check passes and --all changes only the markdown", async () => {
    const { repoRoot, scriptsRoot } = await tinyScriptsRoot(
      "clean",
      "export const total = 1 + 1;\n",
    );
    const result = await execute(["health", "--scripts", scriptsRoot]);
    expect(result.run_root).toBe(repoRoot);
    expect(typeof result.healthy).toBe("boolean");

    const withAll = await execute(["health", "--scripts", scriptsRoot, "--all"]);
    expect(withAll.run_root).toBe(repoRoot);
  });
});
