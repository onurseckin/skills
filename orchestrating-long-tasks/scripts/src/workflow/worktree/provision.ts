import { mkdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { TopologyRecord } from "../../contracts/topology.ts";
import type { WorktreeLedgerState, WorktreeRecord } from "../../contracts/worktree.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadRun, transact } from "../../store/index.ts";
import { assignWorktrees, type AssignableTask } from "./assign.ts";
import { addWorktree, branchExists, createBranch, currentBranch, headSha } from "./git-ops.ts";
import { readWorktreeLedger, writeWorktreeLedger } from "./ledger.ts";

/**
 * `worktree_root` is a caller-supplied path resolved relative to the repo's PARENT, never the repo
 * itself — a relative value like `.harness-worktrees` is meant to sit beside the repo, not inside
 * it. B22.1: worktrees "must never appear inside the repo the user is working in", so a resolved
 * root that lands inside `repoRoot` is refused outright rather than silently redirected.
 */
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
}

export interface ProvisionWorktreesResult {
  enabled: boolean;
  ledger: WorktreeLedgerState | null;
}

/**
 * B22.1/B22.2: creates the run's `harness/<run-id>` branch (a plain ref, never checked out — the
 * repo's own HEAD and working tree are never touched) and enough worktrees to give every task in
 * the topology's widest wave its own isolated directory, reusing them round-robin across waves.
 * Idempotent: a second call against the same topology provisions nothing new and skips the write.
 */
export function provisionWorktrees(input: ProvisionWorktreesInput): ProvisionWorktreesResult {
  if (!input.config.worktree_isolation) return { enabled: false, ledger: null };
  const existing = readWorktreeLedger(loadRun(input.runRoot).state);
  const { assignments, worktreeCount } = assignWorktrees(input.topology, input.tasksById);
  if (worktreeCount === 0) return { enabled: true, ledger: existing };

  const root = resolveWorktreeRoot(input.repoRoot, input.config.worktree_root);
  const harnessBranch = `${input.config.branch_prefix}${input.runId}`;
  const baseSha = existing?.base_sha ?? headSha(input.repoRoot);
  // Read once, at first provisioning, alongside baseSha — a later call reusing the pool must not
  // re-read HEAD's current branch, which could have moved since (the user keeps working; B22.1).
  const baseBranch = existing?.base_branch ?? currentBranch(input.repoRoot) ?? undefined;
  if (!branchExists(input.repoRoot, harnessBranch))
    createBranch(input.repoRoot, harnessBranch, baseSha);

  const already = existing?.worktrees.length ?? 0;
  const createdAt = (input.now ?? new Date()).toISOString();
  const newWorktrees: WorktreeRecord[] = [];
  if (already < worktreeCount) mkdirSync(join(root, input.runId), { recursive: true });
  for (let index = already; index < worktreeCount; index += 1) {
    const id = `wt-${index}`;
    // Git refs are a path hierarchy: `refs/heads/<harnessBranch>` and `refs/heads/<harnessBranch>/x`
    // cannot coexist (one is a leaf, the other wants that leaf as a directory). `--` keeps every
    // worktree's own branch a sibling of the anchor ref rather than nesting under it.
    const branch = `${harnessBranch}--${id}`;
    const worktreePath = join(root, input.runId, id);
    addWorktree(input.repoRoot, worktreePath, branch, baseSha);
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
