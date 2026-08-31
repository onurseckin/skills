import { describe, expect, test } from "bun:test";
import {
  provisionWorktrees,
  type ProvisionWorktreesInput,
} from "../../../olt/scripts/src/workflow/worktree/provision.ts";

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
