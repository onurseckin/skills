import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  commitAndPushDomainSubphase,
  createDomainLedger,
  isDomainSyncEligible,
  provisionDomainWorktree,
  recordDomainCommit,
  type DomainCommitRecord,
  type DomainLedgerState,
  type GitRunner,
} from "../../../olt/scripts/src/engine/worktree/index.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function trackedDir(prefix: string): string {
  const dir = join(process.cwd(), "coverage", "scratch", `domain-sync-ledger-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
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

      const config = provisionDomainWorktree(
        repoRoot,
        ledger,
        "auth-engine",
        "run-101",
        runner,
        now,
      );
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

    test("sync index and fixture exports are valid", async () => {
      const { createTestDomainCommit, createTestDomainLedger, createTestProgressSnapshot, SYNC_SUITES } = await import("./index.ts");
      const commit = createTestDomainCommit("test-dom");
      expect(commit.domain).toBe("test-dom");
      const ledger = createTestDomainLedger("dev");
      expect(ledger.harnessBranch).toBe("dev");
      const snapshot = createTestProgressSnapshot({ totalTasks: 5 });
      expect(snapshot.totalTasks).toBe(5);
      expect(SYNC_SUITES.length).toBeGreaterThan(0);
    });
  });
});
