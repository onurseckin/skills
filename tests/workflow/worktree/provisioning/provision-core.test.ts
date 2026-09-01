import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  provisionWorktrees,
  type ProvisionWorktreesConfig,
} from "../../../../olt/scripts/src/workflow/worktree/provision.ts";
import type { AssignableTask } from "../../../../olt/scripts/src/workflow/worktree/assign.ts";
import type { TopologyRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { GitResult, GitRunner } from "../../../../olt/scripts/src/workflow/worktree/git.ts";
import { FakeRunStore, baseLedger, seedLedger } from "../fixtures/fake-transact.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

let vfsCleanup: (() => void) | undefined;
let dirCounter = 0;

beforeEach(() => {
  const setup = setupWorkflowVirtualFs();
  vfsCleanup = setup.cleanup;
});

afterEach(() => {
  vfsCleanup?.();
  vfsCleanup = undefined;
});

function trackedDir(prefix: string): string {
  const dir = `/virtual/tmp/harness-${prefix}-${++dirCounter}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

type Call = { cwd: string; argv: readonly string[] };

function scripted(script: (call: Call, index: number) => GitResult): {
  runner: GitRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const runner: GitRunner = (cwd, argv) => {
    const call = { cwd, argv };
    calls.push(call);
    return script(call, calls.length - 1);
  };
  return { runner, calls };
}

const ok = (stdout = ""): GitResult => ({ status: 0, stdout, stderr: "" });

function topology(waves: readonly (readonly string[])[]): TopologyRecord {
  return {
    revision: 1,
    max_parallel: 4,
    decisions: [],
    waves: waves.map((task_ids, index) => ({ wave: index + 1, task_ids: [...task_ids] })),
  };
}

function tasks(ids: readonly string[]): ReadonlyMap<string, AssignableTask> {
  return new Map(ids.map((id) => [id, { write_scope: [`src/${id}`] }]));
}

function config(
  worktreeRoot: string,
  overrides: Partial<ProvisionWorktreesConfig> = {},
): ProvisionWorktreesConfig {
  return {
    worktree_isolation: true,
    worktree_root: worktreeRoot,
    branch_prefix: "harness/",
    ...overrides,
  };
}

describe("provisionWorktrees", () => {
  test("is a no-op when worktree isolation is disabled", () => {
    const result = provisionWorktrees({
      runRoot: "unused",
      repoRoot: "unused",
      runId: "run-1",
      actor: "coordinator",
      topology: topology([["t1"]]),
      tasksById: tasks(["t1"]),
      config: { worktree_isolation: false, branch_prefix: "harness/" },
    });
    expect(result).toEqual({ enabled: false, ledger: null });
  });

  test("returns enabled with a null ledger when the topology has no tasks to place", () => {
    const store = new FakeRunStore();
    const repoRoot = trackedDir("provision-empty-repo");
    const wtRoot = trackedDir("provision-empty-wtroot");
    const { runner } = scripted(() => ok());
    const result = provisionWorktrees({
      runRoot: store.runRoot,
      repoRoot,
      runId: "run-1",
      actor: "coordinator",
      topology: topology([[]]),
      tasksById: tasks([]),
      config: config(wtRoot),
      runner,
      loadState: store.loadState,
      transact: store.transact,
    });
    expect(result).toEqual({ enabled: true, ledger: null });
  });

  test("throws PATH_SAFETY when the configured worktree root resolves inside the repo", () => {
    const store = new FakeRunStore();
    const repoRoot = trackedDir("provision-unsafe-repo");
    const { runner } = scripted(() => ok());
    expect(() =>
      provisionWorktrees({
        runRoot: store.runRoot,
        repoRoot,
        runId: "run-1",
        actor: "coordinator",
        topology: topology([["t1"]]),
        tasksById: tasks(["t1"]),
        config: config(join(repoRoot, "inside")),
        runner,
        loadState: store.loadState,
        transact: store.transact,
      }),
    ).toThrow(/resolves inside the repository/);
  });

  test("creates the harness branch and one worktree per task, persisting a new ledger", () => {
    const store = new FakeRunStore();
    const repoRoot = trackedDir("provision-happy-repo");
    const wtRoot = trackedDir("provision-happy-wtroot");
    const { runner, calls } = scripted((call) => {
      if (call.argv[0] === "rev-parse" && call.argv[1] === "HEAD") return ok("base-sha-000\n");
      if (call.argv[0] === "rev-parse" && call.argv.includes("--verify"))
        return { status: 1, stdout: "", stderr: "" };
      if (call.argv[0] === "symbolic-ref") return ok("main\n");
      return ok();
    });
    const result = provisionWorktrees({
      runRoot: store.runRoot,
      repoRoot,
      runId: "run-1",
      actor: "coordinator",
      topology: topology([["t1", "t2"]]),
      tasksById: tasks(["t1", "t2"]),
      config: config(wtRoot),
      now: new Date("2026-08-19T00:00:00.000Z"),
      runner,
      loadState: store.loadState,
      transact: store.transact,
    });
    expect(result.enabled).toBe(true);
    expect(result.ledger?.harness_branch).toBe("harness/run-1");
    expect(result.ledger?.base_sha).toBe("base-sha-000");
    expect(result.ledger?.base_branch).toBe("main");
    expect(result.ledger?.worktrees.map((w) => w.id)).toEqual(["wt-0", "wt-1"]);
    const branchCall = calls.find((c) => c.argv[0] === "branch" && c.argv[1] === "harness/run-1");
    expect(branchCall?.argv).toEqual(["branch", "harness/run-1", "base-sha-000"]);
    const addCalls = calls.filter((c) => c.argv[0] === "worktree" && c.argv[1] === "add");
    expect(addCalls).toHaveLength(2);
  });

  test("does not recreate the harness branch when it already exists", () => {
    const store = new FakeRunStore();
    const repoRoot = trackedDir("provision-branch-exists-repo");
    const wtRoot = trackedDir("provision-branch-exists-wtroot");
    const { runner, calls } = scripted((call) => {
      if (call.argv[0] === "rev-parse" && call.argv[1] === "HEAD") return ok("base-sha-000\n");
      if (call.argv[0] === "rev-parse" && call.argv.includes("--verify")) return ok(); // branch exists
      if (call.argv[0] === "symbolic-ref") return ok("main\n");
      return ok();
    });
    provisionWorktrees({
      runRoot: store.runRoot,
      repoRoot,
      runId: "run-1",
      actor: "coordinator",
      topology: topology([["t1"]]),
      tasksById: tasks(["t1"]),
      config: config(wtRoot),
      runner,
      loadState: store.loadState,
      transact: store.transact,
    });
    expect(calls.some((c) => c.argv[0] === "branch" && c.argv[1] === "harness/run-1")).toBe(false);
  });
});
