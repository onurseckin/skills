import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  createDomainLedger,
  isDomainSyncEligible,
  provisionDomainWorktree,
  recordDomainSync,
  recordGlobalSync,
  syncDomainToGlobal,
  syncGlobalToDomain,
  synchronizeAllDomains,
  type DomainLedgerState,
  type DomainSyncResult,
  type GitRunner,
  type GlobalSyncSummary,
} from "../../../olt/scripts/src/engine/worktree/index.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function trackedDir(prefix: string): string {
  const dir = join(process.cwd(), "coverage", "scratch", `domain-sync-audit-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  roots.push(dir);
  return dir;
}

const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });

describe("Domain Sync & Ledger Audit and History", () => {
  describe("Synchronization and History Transitions", () => {
    test("syncDomainToGlobal merges commits into harness branch and logs history", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "base-sha", ledgerRoot);
      const runner: GitRunner = (_cwd, argv) => {
        if (argv[0] === "worktree" || argv[0] === "merge") return ok();
        if (argv[0] === "rev-parse") return ok("merged-head-sha-777\n");
        return ok();
      };
      const domainConfig = provisionDomainWorktree(repoRoot, ledger, "data-lake", "run-55", runner);

      ledger.commits.push({
        taskId: "task-dl-1",
        domain: "data-lake",
        worktreeId: domainConfig.worktreeId,
        sha: "sha-dl-1",
        subject: "feat(data-lake): ingest pipeline",
        changedLines: 80,
        overLimit: false,
        committedAt: new Date().toISOString(),
        pushed: true,
      });

      const result = syncDomainToGlobal({
        repoRoot,
        runId: "run-55",
        domain: "data-lake",
        ledger,
        runner,
      });
      expect(result.synced).toBe(true);
      expect(result.domain).toBe("data-lake");
      expect(result.commitsSynced).toBe(1);
      expect(result.syncedSha).toBe("merged-head-sha-777");
      expect(domainConfig.status).toBe("synced");
      expect(domainConfig.headSha).toBe("merged-head-sha-777");
      expect(ledger.syncHistory).toHaveLength(1);
      expect(ledger.syncHistory[0]?.syncedSha).toBe("merged-head-sha-777");
    });

    test("syncDomainToGlobal updates status to conflict on merge collision", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "base-sha", ledgerRoot);
      const runner: GitRunner = (_cwd, argv) => {
        if (argv[0] === "merge")
          return {
            status: 1,
            stdout: "CONFLICT (content): Merge conflict in routes.ts\n",
            stderr: "",
          };
        if (argv[0] === "diff") return ok("routes.ts\n");
        return ok();
      };
      const domainConfig = provisionDomainWorktree(
        repoRoot,
        ledger,
        "network-mesh",
        "run-99",
        runner,
      );

      ledger.commits.push({
        taskId: "task-net-1",
        domain: "network-mesh",
        worktreeId: domainConfig.worktreeId,
        sha: "sha-net-1",
        subject: "feat(network-mesh): routing table",
        changedLines: 40,
        overLimit: false,
        committedAt: new Date().toISOString(),
        pushed: false,
      });

      const result = syncDomainToGlobal({
        repoRoot,
        runId: "run-99",
        domain: "network-mesh",
        ledger,
        runner,
      });
      expect(result.synced).toBe(false);
      expect(result.conflict).toBeDefined();
      expect(result.conflict?.conflictingPaths).toContain("routes.ts");
      expect(domainConfig.status).toBe("conflict");
      expect(isDomainSyncEligible(domainConfig)).toBe(false);
    });

    test("syncGlobalToDomain rebase and merge updates domain worktree head", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "base-sha", ledgerRoot);
      const runner: GitRunner = (_cwd, argv) => {
        if (argv[0] === "rebase" || argv[0] === "merge") return ok();
        if (argv[0] === "rev-parse") return ok("ui-head-sha-888\n");
        return ok();
      };
      const domainConfig = provisionDomainWorktree(repoRoot, ledger, "ui-theme", "run-7", runner);

      const resultRebase = syncGlobalToDomain({
        repoRoot,
        domain: "ui-theme",
        ledger,
        rebase: true,
        runner,
      });
      expect(resultRebase.synced).toBe(true);
      expect(resultRebase.syncedSha).toBe("ui-head-sha-888");
      expect(domainConfig.status).toBe("active");

      const resultMerge = syncGlobalToDomain({
        repoRoot,
        domain: "ui-theme",
        ledger,
        rebase: false,
        runner,
      });
      expect(resultMerge.synced).toBe(true);
    });
  });

  describe("Global Synchronization and Summary Consolidation", () => {
    test("synchronizeAllDomains consolidates all active domains into global summary", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "base-sha", ledgerRoot, "origin/main");
      const runner: GitRunner = (_cwd, argv) => {
        if (argv[0] === "diff" && argv[1] === "--stat")
          return ok("3 files changed, 20 insertions(+)\n");
        if (argv[0] === "rev-parse") return ok("consolidated-sha\n");
        return ok();
      };

      const d1 = provisionDomainWorktree(repoRoot, ledger, "domain-alpha", "run-all", runner);
      const d2 = provisionDomainWorktree(repoRoot, ledger, "domain-beta", "run-all", runner);

      ledger.commits.push({
        taskId: "t1",
        domain: "domain-alpha",
        worktreeId: d1.worktreeId,
        sha: "sha-alpha",
        subject: "feat(domain-alpha): update",
        changedLines: 10,
        overLimit: false,
        committedAt: new Date().toISOString(),
        pushed: true,
      });

      const summary = synchronizeAllDomains({
        repoRoot,
        runId: "run-all",
        ledger,
        rebaseOnComplete: true,
        runner,
      });
      expect(summary.harnessBranch).toBe("main");
      expect(summary.syncedDomains).toContain("domain-alpha");
      expect(summary.syncedDomains).toContain("domain-beta");
      expect(summary.totalCommitsSynced).toBe(1);
      expect(summary.scopeIsolated).toBe(true);
      expect(ledger.globalSyncSummary).toBe(summary);
    });

    test("recordDomainSync and recordGlobalSync update transaction ledger", () => {
      const draft: Record<string, unknown> = {
        domain_sync_ledger: {
          harnessBranch: "main",
          baseSha: "sha0",
          root: ".capsules",
          domains: {},
          commits: [],
          syncHistory: [],
        },
      };

      const mockTransact = (
        _root: string,
        _actor: string,
        _event: string,
        _meta: unknown,
        updater: (d: unknown) => void,
      ) => updater(draft);
      const syncRes: DomainSyncResult = {
        domain: "payment",
        synced: true,
        targetBranch: "main",
        sourceBranch: "harness--payment-r1",
        commitsSynced: 2,
        syncedSha: "sha-synced",
        syncedAt: new Date().toISOString(),
      };

      recordDomainSync("/tmp", "agent", "payment", syncRes, mockTransact);

      const globalSummary: GlobalSyncSummary = {
        harnessBranch: "main",
        syncedDomains: ["payment"],
        failedDomains: [],
        totalCommitsSynced: 2,
        conflicts: [],
        diffstat: "1 file changed",
        rebased: true,
        consolidatedAt: new Date().toISOString(),
        scopeIsolated: true,
      };

      recordGlobalSync("/tmp", "agent", globalSummary, mockTransact);
      const ledger = draft.domain_sync_ledger as DomainLedgerState;
      expect(ledger.syncHistory).toHaveLength(1);
      expect(ledger.globalSyncSummary).toBe(globalSummary);
    });
  });
});
