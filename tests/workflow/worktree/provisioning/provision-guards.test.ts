import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import * as storeModule from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  provisionWorktrees,
  type ProvisionWorktreesConfig,
} from "../../../../olt/scripts/src/workflow/worktree/provision.ts";
import type { AssignableTask } from "../../../../olt/scripts/src/workflow/worktree/assign.ts";
import type { TopologyRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { GitResult, GitRunner } from "../../../../olt/scripts/src/workflow/worktree/git.ts";
import { FakeRunStore, baseLedger, seedLedger } from "../fixtures/fake-transact.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

function trackedDir(prefix: string): string {
  return `/virtual/harness-${prefix}`;
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

describe("provisionWorktrees guards and errors (in-memory virtualization)", () => {
  let vfsCleanup: (() => void) | undefined;

  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfsCleanup = setup.cleanup;
  });

  afterEach(() => {
    vfsCleanup?.();
    vfsCleanup = undefined;
  });

  test("extends an existing ledger with only the additional worktrees a wider wave needs", () => {
    const store = new FakeRunStore();
    const repoRoot = trackedDir("provision-extend-repo");
    const wtRoot = trackedDir("provision-extend-wtroot");
    seedLedger(
      store,
      baseLedger({
        harness_branch: "harness/run-1",
        base_sha: "base-sha-000",
        worktrees: [
          {
            id: "wt-0",
            path: join(wtRoot, "run-1", "wt-0"),
            branch: "harness/run-1--wt-0",
            base_sha: "base-sha-000",
            created_at: "t",
          },
        ],
        assignments: [{ task_id: "t1", worktree_id: "wt-0", wave: 1 }],
      }),
    );
    const { runner, calls } = scripted((call) => {
      if (call.argv[0] === "rev-parse" && call.argv.includes("--verify")) return ok();
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
      runner,
      loadState: store.loadState,
      transact: store.transact,
    });
    expect(result.ledger?.worktrees.map((w) => w.id)).toEqual(["wt-0", "wt-1"]);
    const addCalls = calls.filter((c) => c.argv[0] === "worktree" && c.argv[1] === "add");
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0]!.argv).toContain("harness/run-1--wt-1");
  });

  test("skips re-persisting and issues no git worktree calls when every task already has a slot", () => {
    const store = new FakeRunStore();
    const repoRoot = trackedDir("provision-noop-repo");
    const wtRoot = trackedDir("provision-noop-wtroot");
    const existing = baseLedger({
      harness_branch: "harness/run-1",
      base_sha: "base-sha-000",
      worktrees: [
        {
          id: "wt-0",
          path: join(wtRoot, "run-1", "wt-0"),
          branch: "harness/run-1--wt-0",
          base_sha: "base-sha-000",
          created_at: "t",
        },
      ],
      assignments: [{ task_id: "t1", worktree_id: "wt-0", wave: 1 }],
    });
    seedLedger(store, existing);
    const eventsBefore = store.events.length;
    const { runner, calls } = scripted((call) => {
      if (call.argv[0] === "rev-parse" && call.argv.includes("--verify")) return ok();
      return ok();
    });
    const result = provisionWorktrees({
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
    expect(result.ledger).toEqual(existing);
    expect(calls.filter((c) => c.argv[0] === "worktree" && c.argv[1] === "add")).toHaveLength(0);
    expect(store.events).toHaveLength(eventsBefore);
  });

  test("re-persists when the topology widens even though every existing task keeps its slot", () => {
    const store = new FakeRunStore();
    const repoRoot = trackedDir("provision-widen-repo");
    const wtRoot = trackedDir("provision-widen-wtroot");
    const existing = baseLedger({
      harness_branch: "harness/run-1",
      base_sha: "base-sha-000",
      worktrees: [
        {
          id: "wt-0",
          path: join(wtRoot, "run-1", "wt-0"),
          branch: "harness/run-1--wt-0",
          base_sha: "base-sha-000",
          created_at: "t",
        },
      ],
      assignments: [{ task_id: "t1", worktree_id: "wt-0", wave: 1 }],
    });
    seedLedger(store, existing);
    const eventsBefore = store.events.length;
    const { runner } = scripted((call) => {
      if (call.argv[0] === "rev-parse" && call.argv.includes("--verify")) return ok();
      return ok();
    });
    provisionWorktrees({
      runRoot: store.runRoot,
      repoRoot,
      runId: "run-1",
      actor: "coordinator",
      topology: topology([["t1", "t2"]]),
      tasksById: tasks(["t1", "t2"]),
      config: config(wtRoot),
      runner,
      loadState: store.loadState,
      transact: store.transact,
    });
    expect(store.events.length).toBeGreaterThan(eventsBefore);
  });

  test("provisionWorktrees works with default loadState and transact functions", () => {
    const store = new FakeRunStore();
    const loadSpy = spyOn(storeModule, "loadRun").mockImplementation(
      () =>
        ({
          state: store.read(),
          events: store.events,
        }) as unknown as ReturnType<typeof storeModule.loadRun>,
    );
    const transactSpy = spyOn(storeModule, "transact").mockImplementation(store.transact);

    const wtRoot = "/virtual/provision-defaults-wtroot";
    const repo = "/virtual/provision-defaults-repo";

    const { runner } = scripted((call) => {
      if (call.argv[0] === "rev-parse" && call.argv.includes("--verify")) return ok();
      if (call.argv[0] === "rev-parse" && call.argv.includes("HEAD")) return ok("deadbeef000\n");
      if (call.argv[0] === "branch" && call.argv.includes("--show-current")) return ok("main\n");
      return ok();
    });

    try {
      const result = provisionWorktrees({
        runRoot: store.runRoot,
        repoRoot: repo,
        runId: "default-run",
        actor: "coordinator",
        topology: topology([["task-core"]]),
        tasksById: tasks(["task-core"]),
        config: config(wtRoot),
        runner,
      });

      expect(result.enabled).toBe(true);
      expect(result.ledger).toBeDefined();
      expect(result.ledger?.worktrees).toHaveLength(1);
    } finally {
      loadSpy.mockRestore();
      transactSpy.mockRestore();
    }
  });
});
