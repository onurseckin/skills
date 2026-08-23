import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  GitResult,
  GitRunner,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/worktree/git.ts";
import {
  assertDomainIsolation,
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
  validateDomainIsolation,
  type DomainCommitRecord,
  type DomainLedgerState,
  type DomainSyncResult,
  type GlobalSyncSummary,
} from "../../../orchestrating-long-tasks/scripts/src/worktree/domain-sync.ts";
import {
  FakeRunStore,
  baseLedger,
  seedLedger,
  seedTask,
} from "../workflow/worktree/fake-transact.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function trackedDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `domain-sync-${prefix}-`));
  roots.push(dir);
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
const fail = (stderr = "", status = 1): GitResult => ({ status, stdout: "", stderr });

describe("Continuous Per-Domain Commit Push & Global Sync Pipeline (p36)", () => {
  describe("createDomainLedger", () => {
    test("initializes domain ledger with valid parameters", () => {
      const ledger = createDomainLedger("main", "base123", "/root/path", "base-branch");
      expect(ledger.harnessBranch).toBe("main");
      expect(ledger.baseSha).toBe("base123");
      expect(ledger.root).toBe("/root/path");
      expect(ledger.baseBranch).toBe("base-branch");
      expect(ledger.domains).toEqual({});
      expect(ledger.commits).toEqual([]);
      expect(ledger.syncHistory).toEqual([]);
    });

    test("throws INVALID_ARGUMENT on empty harnessBranch, baseSha, or root", () => {
      expect(() => createDomainLedger("", "base123", "/root")).toThrow(
        /harnessBranch cannot be empty/,
      );
      expect(() => createDomainLedger("main", "", "/root")).toThrow(/baseSha cannot be empty/);
      expect(() => createDomainLedger("main", "base123", "")).toThrow(
        /root directory cannot be empty/,
      );
    });
  });

  describe("provisionDomainWorktree", () => {
    test("provisions an isolated domain worktree and registers it in the ledger", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "sha001", ledgerRoot);
      const { runner, calls } = scripted(() => ok());
      const now = new Date("2026-08-22T14:00:00.000Z");

      const config = provisionDomainWorktree(repoRoot, ledger, "frontend-ui", "run-1", runner, now);

      expect(config.domain).toBe("frontend-ui");
      expect(config.worktreeId).toBe("domain-frontend-ui");
      expect(config.branch).toBe("harness--frontend-ui-run-1");
      expect(config.baseSha).toBe("sha001");
      expect(config.headSha).toBe("sha001");
      expect(config.status).toBe("active");
      expect(config.createdAt).toBe("2026-08-22T14:00:00.000Z");
      expect(ledger.domains["frontend-ui"]).toBe(config);

      const worktreeCall = calls.find((c) => c.argv[0] === "worktree" && c.argv[1] === "add");
      expect(worktreeCall).toBeDefined();
      expect(worktreeCall?.argv).toContain("harness--frontend-ui-run-1");
    });

    test("throws INVALID_ARGUMENT on empty domain name", () => {
      const repoRoot = trackedDir("repo");
      const ledger = createDomainLedger("main", "sha001", "/root");
      expect(() => provisionDomainWorktree(repoRoot, ledger, "", "run-1")).toThrow(
        /domain name cannot be empty/,
      );
    });
  });

  describe("commitAndPushDomainSubphase", () => {
    test("rejects unrecognised commit tags", () => {
      const { runner } = scripted(() => ok());
      expect(() =>
        commitAndPushDomainSubphase({
          domain: "backend-system",
          taskId: "task-1",
          worktreeId: "domain-backend-system",
          worktreePath: "/wt/backend",
          writeScope: ["src/backend/**"],
          label: "some change",
          commitType: "invalid-type",
          runner,
        }),
      ).toThrow(/not a recognised conventional-commit tag/);
    });

    test("rejects empty write scope", () => {
      const { runner } = scripted(() => ok());
      expect(() =>
        commitAndPushDomainSubphase({
          domain: "backend-system",
          taskId: "task-1",
          worktreeId: "domain-backend-system",
          worktreePath: "/wt/backend",
          writeScope: [],
          label: "some change",
          runner,
        }),
      ).toThrow(/has no write scope to commit for domain/);
    });

    test("throws ROLE_CONFINEMENT_VIOLATION if modifiedPaths violate write scope", () => {
      const { runner } = scripted(() => ok());
      expect(() =>
        commitAndPushDomainSubphase({
          domain: "frontend-ui",
          taskId: "task-ui-1",
          worktreeId: "domain-frontend-ui",
          worktreePath: "/wt/frontend",
          writeScope: ["src/ui/**"],
          modifiedPaths: ["src/ui/Button.tsx", "src/server/auth.ts"],
          label: "add button",
          runner,
        }),
      ).toThrow(/modified files outside its assigned write scope/);
    });

    test("creates domain-tagged commit with conventional commit subject", () => {
      const { runner, calls } = scripted((call) => {
        if (call.argv[0] === "add") return ok();
        if (call.argv[0] === "diff") return fail("", 1);
        if (call.argv[0] === "commit") return ok();
        if (call.argv[0] === "rev-parse") return ok("sha1234567890\n");
        if (call.argv[0] === "show") return ok(" 1 file changed, 50 insertions(+)\n");
        return ok();
      });

      const now = new Date("2026-08-22T14:10:00.000Z");
      const outcome = commitAndPushDomainSubphase({
        domain: "frontend-ui",
        taskId: "task-ui-1",
        worktreeId: "domain-frontend-ui",
        worktreePath: "/wt/frontend",
        writeScope: ["src/ui/**"],
        modifiedPaths: ["src/ui/Button.tsx"],
        label: "create shiny primary button component",
        commitType: "feat",
        pushOnCommit: true,
        maxCommitLines: 400,
        now,
        runner,
      });

      expect(outcome.committed).toBe(true);
      expect(outcome.pushed).toBe(true);
      expect(outcome.commit?.subject).toBe(
        "feat(frontend-ui): create shiny primary button component",
      );
      expect(outcome.commit?.sha).toBe("sha1234567890");
      expect(outcome.commit?.changedLines).toBe(50);
      expect(outcome.commit?.overLimit).toBe(false);
      expect(outcome.commit?.committedAt).toBe("2026-08-22T14:10:00.000Z");

      const commitCall = calls.find((c) => c.argv[0] === "commit");
      expect(commitCall?.argv).toContain(
        "feat(frontend-ui): create shiny primary button component",
      );
    });

    test("truncates overly long commit label to stay within 70 characters", () => {
      const { runner } = scripted((call) => {
        if (call.argv[0] === "add") return ok();
        if (call.argv[0] === "diff") return fail("", 1);
        if (call.argv[0] === "commit") return ok();
        if (call.argv[0] === "rev-parse") return ok("sha1234567890\n");
        if (call.argv[0] === "show") return ok(" 1 file changed, 10 insertions(+)\n");
        return ok();
      });

      const longLabel = "x".repeat(100);
      const outcome = commitAndPushDomainSubphase({
        domain: "backend-system",
        taskId: "task-be-1",
        worktreeId: "domain-backend-system",
        worktreePath: "/wt/backend",
        writeScope: ["src/api/**"],
        label: longLabel,
        runner,
      });

      expect(outcome.committed).toBe(true);
      expect(outcome.commit?.subject.length).toBeLessThanOrEqual(70);
      expect(outcome.commit?.subject.startsWith("feat(backend-system): ")).toBe(true);
      expect(outcome.commit?.subject.endsWith("…")).toBe(true);
    });

    test("warns when commit changed lines exceed maxCommitLines", () => {
      const { runner } = scripted((call) => {
        if (call.argv[0] === "add") return ok();
        if (call.argv[0] === "diff") return fail("", 1);
        if (call.argv[0] === "commit") return ok();
        if (call.argv[0] === "rev-parse") return ok("sha1234567890\n");
        if (call.argv[0] === "show") return ok(" 1 file changed, 450 insertions(+)\n");
        return ok();
      });

      const outcome = commitAndPushDomainSubphase({
        domain: "security-auth",
        taskId: "task-sec-1",
        worktreeId: "domain-security-auth",
        worktreePath: "/wt/sec",
        writeScope: ["src/auth/**"],
        label: "large auth overhaul",
        maxCommitLines: 400,
        runner,
      });

      expect(outcome.committed).toBe(true);
      expect(outcome.commit?.overLimit).toBe(true);
      expect(outcome.warning).toMatch(/over the 400-line target \(B22\.3\)/);
    });

    test("returns committed: false when no changes staged", () => {
      const { runner } = scripted((call) => {
        if (call.argv[0] === "add") return ok();
        if (call.argv[0] === "diff") return ok(); // diff --cached --quiet exits 0 => nothing staged
        return ok();
      });

      const outcome = commitAndPushDomainSubphase({
        domain: "core-engine",
        taskId: "task-ce-1",
        worktreeId: "domain-core-engine",
        worktreePath: "/wt/core",
        writeScope: ["src/core/**"],
        label: "no-op change",
        runner,
      });

      expect(outcome.committed).toBe(false);
      expect(outcome.pushed).toBe(false);
    });
  });

  describe("syncDomainToGlobal", () => {
    test("merges domain branch into global harness branch without conflict", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "sha001", ledgerRoot);
      const { runner, calls } = scripted((call) => {
        if (call.argv[0] === "rev-parse" && call.argv[1] === "HEAD") return ok("sha_merged_999\n");
        return ok();
      });

      provisionDomainWorktree(repoRoot, ledger, "frontend-ui", "run-1", runner);
      ledger.commits.push({
        taskId: "task-ui-1",
        domain: "frontend-ui",
        worktreeId: "domain-frontend-ui",
        sha: "sha_ui_001",
        subject: "feat(frontend-ui): add button",
        changedLines: 20,
        overLimit: false,
        committedAt: "2026-08-22T14:00:00.000Z",
        pushed: true,
      });

      const result = syncDomainToGlobal({
        repoRoot,
        runId: "run-1",
        domain: "frontend-ui",
        ledger,
        runner,
      });

      expect(result.synced).toBe(true);
      expect(result.commitsSynced).toBe(1);
      expect(result.syncedSha).toBe("sha_merged_999");
      expect(result.conflict).toBeUndefined();
      expect(ledger.domains["frontend-ui"]?.status).toBe("synced");

      const mergeCall = calls.find((c) => c.argv[0] === "merge" && c.argv.includes("--no-ff"));
      expect(mergeCall?.argv).toContain("harness--frontend-ui-run-1");

      const removeCall = calls.find(
        (c) =>
          c.argv[0] === "worktree" &&
          c.argv[1] === "remove" &&
          c.argv.at(-1)?.includes("domain-sync"),
      );
      expect(removeCall).toBeDefined();
    });

    test("detects merge conflicts safely without destroying worktrees and flags domain status as conflict", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "sha001", ledgerRoot);

      const { runner } = scripted((call) => {
        if (call.argv[0] === "merge" && call.argv.includes("--no-ff")) return fail("CONFLICT", 1);
        if (call.argv[0] === "diff" && call.argv.includes("--name-only"))
          return ok("conflict-file.ts\n");
        return ok();
      });

      provisionDomainWorktree(repoRoot, ledger, "backend-system", "run-1", runner);
      ledger.commits.push({
        taskId: "task-be-1",
        domain: "backend-system",
        worktreeId: "domain-backend-system",
        sha: "sha_be_001",
        subject: "feat(backend-system): update schema",
        changedLines: 50,
        overLimit: false,
        committedAt: "2026-08-22T14:00:00.000Z",
        pushed: true,
      });

      const result = syncDomainToGlobal({
        repoRoot,
        runId: "run-1",
        domain: "backend-system",
        ledger,
        runner,
      });

      expect(result.synced).toBe(false);
      expect(result.commitsSynced).toBe(0);
      expect(result.conflict).toBeDefined();
      expect(result.conflict?.conflictingPaths).toEqual(["conflict-file.ts"]);
      expect(ledger.domains["backend-system"]?.status).toBe("conflict");
    });

    test("returns synced: true with 0 commits when domain has no pending commits", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "sha001", ledgerRoot);
      const { runner } = scripted(() => ok());

      provisionDomainWorktree(repoRoot, ledger, "product-experience", "run-1", runner);

      const result = syncDomainToGlobal({
        repoRoot,
        runId: "run-1",
        domain: "product-experience",
        ledger,
        runner,
      });

      expect(result.synced).toBe(true);
      expect(result.commitsSynced).toBe(0);
    });
  });

  describe("syncGlobalToDomain", () => {
    test("syncs global harness branch into domain worktree", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "sha001", ledgerRoot);
      const { runner, calls } = scripted((call) => {
        if (call.argv[0] === "rev-parse" && call.argv[1] === "HEAD")
          return ok("sha_domain_updated\n");
        return ok();
      });

      provisionDomainWorktree(repoRoot, ledger, "frontend-ui", "run-1", runner);

      const result = syncGlobalToDomain({
        repoRoot,
        domain: "frontend-ui",
        ledger,
        rebase: false,
        runner,
      });

      expect(result.synced).toBe(true);
      expect(result.syncedSha).toBe("sha_domain_updated");
      expect(ledger.domains["frontend-ui"]?.headSha).toBe("sha_domain_updated");

      const mergeCall = calls.find((c) => c.argv[0] === "merge");
      expect(mergeCall?.argv).toContain("main");
    });

    test("rebases domain worktree onto global harness branch when rebase: true", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "sha001", ledgerRoot);
      const { runner, calls } = scripted((call) => {
        if (call.argv[0] === "rev-parse" && call.argv[1] === "HEAD")
          return ok("sha_domain_rebased\n");
        return ok();
      });

      provisionDomainWorktree(repoRoot, ledger, "frontend-ui", "run-1", runner);

      const result = syncGlobalToDomain({
        repoRoot,
        domain: "frontend-ui",
        ledger,
        rebase: true,
        runner,
      });

      expect(result.synced).toBe(true);
      const rebaseCall = calls.find((c) => c.argv[0] === "rebase");
      expect(rebaseCall?.argv).toContain("main");
    });
  });

  describe("synchronizeAllDomains", () => {
    test("syncs all active domains and produces a global sync summary", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "sha001", ledgerRoot, "origin/main");
      const { runner } = scripted((call) => {
        if (call.argv[0] === "diff" && call.argv[1] === "--stat")
          return ok("3 files changed, 100 insertions(+)\n");
        if (call.argv[0] === "rev-parse" && call.argv[1] === "HEAD") return ok("sha_global_head\n");
        return ok();
      });

      provisionDomainWorktree(repoRoot, ledger, "frontend-ui", "run-1", runner);
      provisionDomainWorktree(repoRoot, ledger, "backend-system", "run-1", runner);

      ledger.commits.push({
        taskId: "task-ui-1",
        domain: "frontend-ui",
        worktreeId: "domain-frontend-ui",
        sha: "sha_ui_1",
        subject: "feat(frontend-ui): buttons",
        changedLines: 30,
        overLimit: false,
        committedAt: "2026-08-22T14:00:00.000Z",
        pushed: true,
      });

      ledger.commits.push({
        taskId: "task-be-1",
        domain: "backend-system",
        worktreeId: "domain-backend-system",
        sha: "sha_be_1",
        subject: "feat(backend-system): endpoints",
        changedLines: 70,
        overLimit: false,
        committedAt: "2026-08-22T14:00:00.000Z",
        pushed: true,
      });

      const summary = synchronizeAllDomains({
        repoRoot,
        runId: "run-1",
        ledger,
        rebaseOnComplete: true,
        runner,
      });

      expect(summary.syncedDomains).toEqual(["frontend-ui", "backend-system"]);
      expect(summary.failedDomains).toEqual([]);
      expect(summary.totalCommitsSynced).toBe(2);
      expect(summary.conflicts).toEqual([]);
      expect(summary.rebased).toBe(true);
      expect(summary.rebaseTarget).toBe("origin/main");
      expect(summary.scopeIsolated).toBe(true);
      expect(ledger.globalSyncSummary).toBe(summary);
    });
  });

  describe("domain isolation validation", () => {
    test("validates disjoint write scopes across domains as isolated", () => {
      const domains = [
        { domain: "frontend-ui", writeScope: ["src/ui/**", "tests/unit/ui/**"] },
        { domain: "backend-system", writeScope: ["src/api/**", "tests/unit/api/**"] },
        { domain: "security-auth", writeScope: ["src/auth/**", "tests/unit/auth/**"] },
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
