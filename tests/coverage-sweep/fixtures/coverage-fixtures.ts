import type { GitSpawn } from "../../../olt/scripts/src/workflow/worktree/git.ts";
import type { ProvisionWorktreesInput } from "../../../olt/scripts/src/workflow/worktree/provision.ts";

export function createMockGitSpawn(result: {
  status?: number | null;
  stdout?: string | undefined;
  stderr?: string | undefined;
  error?: Error | undefined;
}): GitSpawn {
  return () => ({
    status: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  });
}

export function createSampleCoverageTableRow(): string {
  return "  src/lib/index.ts | 95.50 | 97.20 | 1-5";
}

export function createSampleProvisionInput(overrides: Partial<ProvisionWorktreesInput> = {}): ProvisionWorktreesInput {
  return {
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
    ...overrides,
  };
}
