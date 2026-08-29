import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  commitAndPushDomainSubphase,
  createDomainLedger,
  isDomainSyncEligible,
  provisionDomainWorktree,
  recordDomainCommit,
  recordDomainSync,
  recordGlobalSync,
  syncDomainToGlobal,
  syncGlobalToDomain,
  synchronizeAllDomains,
  type DomainCommitRecord,
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
  const dir = mkdtempSync(join(tmpdir(), `domain-sync-ledger-${prefix}-`));
  roots.push(dir);
  return dir;
}

const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });

describe("Domain Sync & Ledger State Verification", () => {
  describe("Ledger Creation and Worktree Provisioning", () => {
    test("initializes domain ledger with valid parameters and defaults", () => {
      const ledger = createDomainLedger("main", "base-sha-123", "/root/ledger", "upstream-main");
      expect(ledger.harnessBranch).toBe("main");
      expect(ledger.baseSha).toBe("base-sha-123");
      expect(ledger.root).toBe("/root/ledger");
      expect(ledger.baseBranch).toBe("upstream-main");
      expect(ledger.domains).toEqual({});
      expect(ledger.commits).toEqual([]);
      expect(ledger.syncHistory).toEqual([]);
    });

    test("throws INVALID_ARGUMENT on empty initialization arguments", () => {
      expect(() => createDomainLedger("", "sha", "/root")).toThrow(HarnessError);
      expect(() => createDomainLedger("main", "", "/root")).toThrow(HarnessError);
      expect(() => createDomainLedger("main", "sha", "")).toThrow(HarnessError);
    });

    test("provisions domain worktree and updates ledger state", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "base-sha-123", ledgerRoot);
      const runner: GitRunner = () => ok();
      const now = new Date("2026-08-29T12:00:00.000Z");

      const config = provisionDomainWorktree(repoRoot, ledger, "auth-engine", "run-101", runner, now);

      expect(config.domain).toBe("auth-engine");
      expect(config.worktreeId).toBe("domain-auth-engine");
      expect(config.branch).toBe("harness--auth-engine-run-101");
      expect(config.status).toBe("active");
      expect(config.createdAt).toBe("2026-08-29T12:00:00.000Z");
      expect(ledger.domains["auth-engine"]).toBe(config);
      expect(isDomainSyncEligible(config)).toBe(true);
    });
  });

  describe("Subphase Commit and Transaction Recording", () => {
    test("commits domain subphase and creates valid commit record", () => {
      const runner: GitRunner = (_cwd, argv) => {
        if (argv[0] === "add") return ok();
        if (argv[0] === "diff") return { status: 1, stdout: "", stderr: "" };
        if (argv[0] === "commit") return ok();
        if (argv[0] === "rev-parse") return ok("sha-subphase-999\n");
        if (argv[0] === "show") return ok(" 1 file changed, 25 insertions(+)\n");
        return ok();
      };

      const outcome = commitAndPushDomainSubphase({
        domain: "engine-core",
        taskId: "task-eng-10",
        worktreeId: "domain-engine-core",
        worktreePath: "/tmp/wt/core",
        writeScope: ["src/engine/**"],
        modifiedPaths: ["src/engine/sync.ts"],
        label: "implement ledger synchronization",
        commitType: "feat",
        pushOnCommit: false,
        runner,
      });

      expect(outcome.committed).toBe(true);
      expect(outcome.commit?.domain).toBe("engine-core");
      expect(outcome.commit?.taskId).toBe("task-eng-10");
      expect(outcome.commit?.sha).toBe("sha-subphase-999");
      expect(outcome.commit?.changedLines).toBe(25);
      expect(outcome.commit?.overLimit).toBe(false);
    });

    test("recordDomainCommit updates draft transaction state", () => {
      const draft: Record<string, unknown> = {
        domain_sync_ledger: {
          harnessBranch: "main",
          baseSha: "sha0",
          root: ".capsules",
          domains: {},
          commits: [],
          syncHistory: [],
        },
        tasks: { "task-1": {} },
      };

      const mockTransact = (
        _root: string,
        _actor: string,
        _event: string,
        _meta: unknown,
        updater: (d: unknown) => void,
      ) => updater(draft);

      const commit: DomainCommitRecord = {
        taskId: "task-1",
        domain: "billing",
        worktreeId: "domain-billing",
        sha: "commit-sha-55",
        subject: "feat(billing): add tax engine",
        changedLines: 12,
        overLimit: false,
        committedAt: new Date().toISOString(),
        pushed: true,
      };

      recordDomainCommit("/tmp/capsule", "agent-1", "billing", "task-1", commit, mockTransact);

      const ledger = draft.domain_sync_ledger as DomainLedgerState;
      expect(ledger.commits).toHaveLength(1);
      expect(ledger.commits[0]?.sha).toBe("commit-sha-55");
    });
  });

  describe("Synchronization and History Transitions", () => {
    test("syncDomainToGlobal merges commits into harness branch and logs history", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "base-sha", ledgerRoot);
      const domainConfig = provisionDomainWorktree(repoRoot, ledger, "data-lake", "run-55");

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

      const runner: GitRunner = (_cwd, argv) => {
        if (argv[0] === "worktree") return ok();
        if (argv[0] === "merge") return ok();
        if (argv[0] === "rev-parse") return ok("merged-head-sha-777\n");
        return ok();
      };

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
      const domainConfig = provisionDomainWorktree(repoRoot, ledger, "network-mesh", "run-99");

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

      const runner: GitRunner = (_cwd, argv) => {
        if (argv[0] === "merge") {
          return { status: 1, stdout: "CONFLICT (content): Merge conflict in routes.ts\n", stderr: "" };
        }
        if (argv[0] === "diff") {
          return ok("routes.ts\n");
        }
        return ok();
      };

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
      const domainConfig = provisionDomainWorktree(repoRoot, ledger, "ui-theme", "run-7");

      const runner: GitRunner = (_cwd, argv) => {
        if (argv[0] === "rebase") return ok();
        if (argv[0] === "merge") return ok();
        if (argv[0] === "rev-parse") return ok("ui-head-sha-888\n");
        return ok();
      };

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

      const d1 = provisionDomainWorktree(repoRoot, ledger, "domain-alpha", "run-all");
      const d2 = provisionDomainWorktree(repoRoot, ledger, "domain-beta", "run-all");

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

      const runner: GitRunner = (_cwd, argv) => {
        if (argv[0] === "diff" && argv[1] === "--stat") return ok("3 files changed, 20 insertions(+)\n");
        if (argv[0] === "rev-parse") return ok("consolidated-sha\n");
        return ok();
      };

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
