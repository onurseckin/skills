import { mkdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { TopologyRecord } from "../../contracts/topology.ts";
import type { WorktreeLedgerState, WorktreeRecord } from "../../contracts/worktree.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadRun, transact } from "../../store/index.ts";
import { assignWorktrees, type AssignableTask } from "./assign.ts";
import {
  addWorktree,
  branchExists,
  createBranch,
  currentBranch,
  headSha,
  runGit,
  type GitRunner,
} from "./git-ops.ts";
import { readWorktreeLedger, writeWorktreeLedger } from "./ledger.ts";

function resolveWorktreeRoot(repoRoot: string, configured: string | undefined): string {
  const parent = dirname(repoRoot);
  const root =
    configured === undefined ? join(parent, ".harness-worktrees") : resolve(parent, configured);
  const normalizedRepo = resolve(repoRoot);
  if (root === normalizedRepo || root.startsWith(normalizedRepo + sep)) {
    throw new HarnessError(
      "PATH_SAFETY",
      `worktree_root '${root}' resolves inside the repository; it must sit outside it`,
    );
  }
  return root;
}

export interface ProvisionWorktreesConfig {
  worktree_isolation: boolean;
  worktree_root?: string;
  branch_prefix: string;
}

export interface ProvisionWorktreesInput {
  runRoot: string;
  repoRoot: string;
  runId: string;
  actor: string;
  topology: TopologyRecord;
  tasksById: ReadonlyMap<string, AssignableTask>;
  config: ProvisionWorktreesConfig;
  now?: Date;
  runner?: GitRunner;
}

export interface ProvisionWorktreesResult {
  enabled: boolean;
  ledger: WorktreeLedgerState | null;
}

export function provisionWorktrees(input: ProvisionWorktreesInput): ProvisionWorktreesResult {
  if (!input.config.worktree_isolation) return { enabled: false, ledger: null };
  const runner = input.runner ?? runGit;
  const existing = readWorktreeLedger(loadRun(input.runRoot).state);
  const { assignments, worktreeCount } = assignWorktrees(input.topology, input.tasksById);
  if (worktreeCount === 0) return { enabled: true, ledger: existing };

  const root = resolveWorktreeRoot(input.repoRoot, input.config.worktree_root);
  const harnessBranch = `${input.config.branch_prefix}${input.runId}`;
  const baseSha = existing?.base_sha ?? headSha(input.repoRoot, runner);
  const baseBranch = existing?.base_branch ?? currentBranch(input.repoRoot, runner) ?? undefined;
  if (!branchExists(input.repoRoot, harnessBranch, runner))
    createBranch(input.repoRoot, harnessBranch, baseSha, runner);

  const already = existing?.worktrees.length ?? 0;
  const createdAt = (input.now ?? new Date()).toISOString();
  const newWorktrees: WorktreeRecord[] = [];
  if (already < worktreeCount) mkdirSync(join(root, input.runId), { recursive: true });
  for (let index = already; index < worktreeCount; index += 1) {
    const id = `wt-${index}`;
    const branch = `${harnessBranch}--${id}`;
    const worktreePath = join(root, input.runId, id);
    addWorktree(input.repoRoot, worktreePath, branch, baseSha, runner);
    newWorktrees.push({ id, path: worktreePath, branch, base_sha: baseSha, created_at: createdAt });
  }

  const assignmentsChanged =
    JSON.stringify(existing?.assignments ?? []) !== JSON.stringify(assignments);
  if (newWorktrees.length === 0 && !assignmentsChanged) return { enabled: true, ledger: existing };

  const ledger: WorktreeLedgerState = {
    harness_branch: harnessBranch,
    base_sha: baseSha,
    ...(baseBranch === undefined ? {} : { base_branch: baseBranch }),
    root,
    worktrees: [...(existing?.worktrees ?? []), ...newWorktrees],
    assignments,
    commits: existing?.commits ?? [],
    ...(existing?.consolidation === undefined ? {} : { consolidation: existing.consolidation }),
  };
  transact(
    input.runRoot,
    input.actor,
    "worktrees-provisioned",
    {
      harness_branch: harnessBranch,
      worktree_count: ledger.worktrees.length,
      new_worktree_count: newWorktrees.length,
    },
    (draft) => writeWorktreeLedger(draft, ledger),
  );
  return { enabled: true, ledger };
}
