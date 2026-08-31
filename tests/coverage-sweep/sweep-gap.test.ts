import { describe, expect, test } from "bun:test";
import {
  createGitRunner,
  git,
  worktreeGitEnvironment,
  type GitSpawn,
} from "../../olt/scripts/src/workflow/worktree/git.ts";
import {
  provisionWorktrees,
  type ProvisionWorktreesInput,
} from "../../olt/scripts/src/workflow/worktree/provision.ts";
import { parseCoverageTable } from "../../olt/scripts/src/cli/commands/coverage-check.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";

describe("coverage sweep gap tests: git runner edge cases", () => {
  test("worktreeGitEnvironment filters undefined and empty string keys and preserves passthrough", () => {
    const sourceEnv = {
      LANG: "en_US.UTF-8",
      PATH: "/usr/bin",
      TMPDIR: "",
      EXTRA_IGNORED: "secret",
    };
    const env = worktreeGitEnvironment(sourceEnv);
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_PAGER).toBe("cat");
    expect(env.TMPDIR).toBeUndefined();
    expect(env.EXTRA_IGNORED).toBeUndefined();
  });

  test("createGitRunner throws INTEGRITY error when spawn result includes error", () => {
    const errorSpawn: GitSpawn = () => ({
      status: null,
      stdout: undefined,
      stderr: undefined,
      error: new Error("ENOENT spawn failed"),
    });

    const runner = createGitRunner(errorSpawn);
    expect(() => runner("/tmp", ["status"])).toThrow(HarnessError);
    expect(() => runner("/tmp", ["status"])).toThrow(/failed to start: ENOENT spawn failed/);
  });

  test("createGitRunner returns fallback values when status or outputs are undefined", () => {
    const nullSpawn: GitSpawn = () => ({
      status: null,
      stdout: undefined,
      stderr: undefined,
    });

    const runner = createGitRunner(nullSpawn);
    const result = runner("/tmp", ["status"]);
    expect(result.status).toBe(-1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("git helper throws INTEGRITY with stderr detail when command fails", () => {
    const failingRunner = () => ({
      status: 128,
      stdout: "",
      stderr: "fatal: not a git repository",
    });

    expect(() => git("/tmp", ["rev-parse", "HEAD"], failingRunner)).toThrow(HarnessError);
    expect(() => git("/tmp", ["rev-parse", "HEAD"], failingRunner)).toThrow(
      /fatal: not a git repository/,
    );
  });

  test("git helper throws with exit status when stderr is empty", () => {
    const failingRunnerEmptyStderr = () => ({
      status: 1,
      stdout: "",
      stderr: "   ",
    });

    expect(() => git("/tmp", ["status"], failingRunnerEmptyStderr)).toThrow(/exit status 1/);
  });
});

describe("coverage sweep gap tests: worktree provisioning edge cases", () => {
  test("provisionWorktrees returns disabled immediately when worktree_isolation is false", () => {
    const input: ProvisionWorktreesInput = {
      runRoot: "/tmp/run-root",
      repoRoot: "/tmp/repo-root",
      runId: "run-123",
      actor: "coordinator",
      topology: { waves: [], decisions: [], max_parallel: 1, revision: 1 },
      tasksById: new Map(),
      config: {
        worktree_isolation: false,
        branch_prefix: "harness/",
      },
    };

    const result = provisionWorktrees(input);
    expect(result.enabled).toBeFalse();
    expect(result.ledger).toBeNull();
  });

  test("provisionWorktrees refuses worktree_root inside repo with PATH_SAFETY error", () => {
    const input: ProvisionWorktreesInput = {
      runRoot: "/tmp/repo-root/.capsules/run-123",
      repoRoot: "/tmp/repo-root",
      runId: "run-123",
      actor: "coordinator",
      topology: {
        waves: [{ wave: 1, task_ids: ["task-1"] }],
        decisions: [],
        max_parallel: 1,
        revision: 1,
      },
      tasksById: new Map([
        [
          "task-1",
          {
            id: "task-1",
            priority: 50,
            effort: 1,
            created_order: 1,
            write_scope: ["a.ts"],
            resource_scope: [],
          },
        ],
      ]),
      config: {
        worktree_isolation: true,
        worktree_root: ".harness-worktrees",
        branch_prefix: "harness/",
      },
      loadState: () => ({
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_head: "0".repeat(64),
        event_sequence: 1,
        tasks: {},
        task_order: [],
        graph: {
          version: 1,
          schema: "harness.graph",
          revision: 1,
          nodes: [],
          edges: [],
          gates: [],
        },
        topology: { revision: 1, max_parallel: 1, waves: [], decisions: [] },
        requirements: {
          version: 1,
          schema: "harness.requirements",
          prompt_sha256: "0".repeat(64),
          requirements: [],
          dispositions: [],
        },
      }),
    };

    expect(() =>
      provisionWorktrees({
        ...input,
        config: {
          ...input.config,
          worktree_root: "/tmp/repo-root/nested-worktrees",
        },
      }),
    ).toThrow(/worktree_root.*resolves inside the repository/);
  });
});

describe("coverage sweep gap tests: coverage check table parser edge cases", () => {
  test("parseCoverageTable handles various row formats and empty inputs", () => {
    expect(parseCoverageTable("")).toEqual([]);
    expect(parseCoverageTable("random non matching text")).toEqual([]);

    const singleRow = "  src/lib/index.ts | 95.50 | 97.20 | 1-5";
    const parsed = parseCoverageTable(singleRow);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.file).toBe("src/lib/index.ts");
    expect(parsed[0]?.lines).toBe(0.955);
    expect(parsed[0]?.statements).toBe(0.972);
  });

  test("git runner returns stdout on exit code 0", () => {
    const successRunner = () => ({
      status: 0,
      stdout: "commit-hash-abc123\n",
      stderr: "",
    });
    expect(git("/tmp", ["rev-parse", "HEAD"], successRunner)).toBe("commit-hash-abc123\n");
  });

  test("provisionWorktrees returns existing ledger when worktree count is 0", () => {
    const input: ProvisionWorktreesInput = {
      runRoot: "/tmp/run-root",
      repoRoot: "/tmp/repo-root",
      runId: "run-zero",
      actor: "coordinator",
      topology: { waves: [], decisions: [], max_parallel: 1, revision: 1 },
      tasksById: new Map(),
      config: {
        worktree_isolation: true,
        branch_prefix: "harness/",
      },
      loadState: () => ({
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_head: "0".repeat(64),
        event_sequence: 1,
        tasks: {},
        task_order: [],
        graph: {
          version: 1,
          schema: "harness.graph",
          revision: 1,
          nodes: [],
          edges: [],
          gates: [],
        },
        topology: { revision: 1, max_parallel: 1, waves: [], decisions: [] },
        requirements: {
          version: 1,
          schema: "harness.requirements",
          prompt_sha256: "0".repeat(64),
          requirements: [],
          dispositions: [],
        },
      }),
    };
    const result = provisionWorktrees(input);
    expect(result.enabled).toBeTrue();
    expect(result.ledger).toBeNull();
  });
});
