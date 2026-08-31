import { describe, expect, test } from "bun:test";
import {
  assertDomainIsolation,
  isDomainSyncEligible,
  recordDomainCommit,
  recordDomainSync,
  recordGlobalSync,
  validateDomainIsolation,
  type DomainCommitRecord,
  type DomainLedgerState,
  type DomainSyncResult,
  type GlobalSyncSummary,
} from "../../../olt/scripts/src/engine/worktree/domain-sync.ts";
import {
  FakeRunStore,
  baseLedger,
  seedLedger,
  seedTask,
} from "../../workflow/worktree/fixtures/fake-transact.ts";

describe("Domain Sync: Isolation, Eligibility & Store Records", () => {
  describe("domain isolation validation", () => {
    test("validates disjoint write scopes across domains as isolated", () => {
      const domains = [
        { domain: "frontend-ui", writeScope: ["src/ui/**", "tests/ui/**"] },
        { domain: "backend-system", writeScope: ["src/api/**", "tests/api/**"] },
        { domain: "security-auth", writeScope: ["src/auth/**", "tests/auth/**"] },
      ];

      const result = validateDomainIsolation(domains);
      expect(result.isolated).toBe(true);
      expect(result.conflicts).toEqual([]);
      expect(() => assertDomainIsolation(domains)).not.toThrow();
    });

    test("detects overlapping write scopes and throws ROLE_CONFINEMENT_VIOLATION on assert", () => {
      const domains = [
        { domain: "frontend-ui", writeScope: ["src/ui/**", "src/shared/utils.ts"] },
        { domain: "backend-system", writeScope: ["src/api/**", "src/shared/utils.ts"] },
      ];

      const result = validateDomainIsolation(domains);
      expect(result.isolated).toBe(false);
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(() => assertDomainIsolation(domains)).toThrow(
        /Multi-domain write scope collision detected/,
      );
    });
  });

  describe("isDomainSyncEligible", () => {
    test("returns true for active and synced status, false for conflict/reclaimed", () => {
      const baseConfig = {
        domain: "frontend-ui",
        worktreeId: "domain-frontend-ui",
        worktreePath: "/wt/ui",
        branch: "b",
        baseSha: "s",
        headSha: "h",
        createdAt: "t",
        assignedTaskIds: [],
      };

      expect(isDomainSyncEligible({ ...baseConfig, status: "active" })).toBe(true);
      expect(isDomainSyncEligible({ ...baseConfig, status: "synced" })).toBe(true);
      expect(isDomainSyncEligible({ ...baseConfig, status: "conflict" })).toBe(false);
      expect(isDomainSyncEligible({ ...baseConfig, status: "reclaimed" })).toBe(false);
    });
  });

  describe("store transactions", () => {
    test("records domain commit in store and associates with task", () => {
      const store = new FakeRunStore();
      seedLedger(store, baseLedger());
      seedTask(store, "task-ui-1");

      const commit: DomainCommitRecord = {
        taskId: "task-ui-1",
        domain: "frontend-ui",
        worktreeId: "domain-frontend-ui",
        sha: "sha_abc123",
        subject: "feat(frontend-ui): header component",
        changedLines: 42,
        overLimit: false,
        committedAt: "2026-08-22T14:00:00.000Z",
        pushed: true,
      };

      recordDomainCommit(
        store.runRoot,
        "tester",
        "frontend-ui",
        "task-ui-1",
        commit,
        store.transact,
      );

      const state = store.read();
      const domainLedger = (state as unknown as { domain_sync_ledger: DomainLedgerState })
        .domain_sync_ledger;
      expect(domainLedger.commits).toEqual([commit]);
      expect(
        (state as unknown as { tasks: Record<string, { domain_commit: unknown }> }).tasks[
          "task-ui-1"
        ]!.domain_commit,
      ).toEqual(commit);
    });

    test("records domain sync result in store", () => {
      const store = new FakeRunStore();
      seedLedger(store, baseLedger());
      seedTask(store, "task-ui-1");

      const commit: DomainCommitRecord = {
        taskId: "task-ui-1",
        domain: "frontend-ui",
        worktreeId: "domain-frontend-ui",
        sha: "sha_abc123",
        subject: "feat(frontend-ui): header component",
        changedLines: 42,
        overLimit: false,
        committedAt: "2026-08-22T14:00:00.000Z",
        pushed: true,
      };
      recordDomainCommit(
        store.runRoot,
        "tester",
        "frontend-ui",
        "task-ui-1",
        commit,
        store.transact,
      );

      const syncResult: DomainSyncResult = {
        domain: "frontend-ui",
        synced: true,
        targetBranch: "main",
        sourceBranch: "harness--frontend-ui-run-1",
        commitsSynced: 1,
        syncedSha: "sha_sync_999",
        syncedAt: "2026-08-22T14:05:00.000Z",
      };

      recordDomainSync(store.runRoot, "tester", "frontend-ui", syncResult, store.transact);

      const state = store.read();
      const domainLedger = (state as unknown as { domain_sync_ledger: DomainLedgerState })
        .domain_sync_ledger;
      expect(domainLedger.syncHistory).toEqual([syncResult]);
    });

    test("records global sync summary in store", () => {
      const store = new FakeRunStore();
      seedLedger(store, baseLedger());
      seedTask(store, "task-ui-1");

      const commit: DomainCommitRecord = {
        taskId: "task-ui-1",
        domain: "frontend-ui",
        worktreeId: "domain-frontend-ui",
        sha: "sha_abc123",
        subject: "feat(frontend-ui): header component",
        changedLines: 42,
        overLimit: false,
        committedAt: "2026-08-22T14:00:00.000Z",
        pushed: true,
      };
      recordDomainCommit(
        store.runRoot,
        "tester",
        "frontend-ui",
        "task-ui-1",
        commit,
        store.transact,
      );

      const summary: GlobalSyncSummary = {
        harnessBranch: "main",
        syncedDomains: ["frontend-ui"],
        failedDomains: [],
        totalCommitsSynced: 1,
        conflicts: [],
        diffstat: "1 file changed",
        rebased: false,
        consolidatedAt: "2026-08-22T14:10:00.000Z",
        scopeIsolated: true,
      };

      recordGlobalSync(store.runRoot, "tester", summary, store.transact);

      const state = store.read();
      const domainLedger = (state as unknown as { domain_sync_ledger: DomainLedgerState })
        .domain_sync_ledger;
      expect(domainLedger.globalSyncSummary).toEqual(summary);
    });
  });
});
