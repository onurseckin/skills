import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertDomainIsolation,
  assertNonDestructiveWriteScope,
  assertZeroDestructiveGit,
  createDomainLedger,
  filterPathsToScope,
  isDestructiveGitCommand,
  isDomainSyncEligible,
  isPathInWriteScope,
  partitionObservedChanges,
  provisionDomainWorktree,
  syncDomainToGlobal,
  syncGlobalToDomain,
  synchronizeAllDomains,
  validateDomainIsolation,
  type DomainScopeEntry,
  type GitRunner,
} from "../../../olt/scripts/src/engine/worktree/index.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function trackedDir(prefix: string): string {
  const dir = join(process.cwd(), "coverage", "scratch", `domain-sync-conflicts-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  roots.push(dir);
  return dir;
}

const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });

describe("Domain Sync Conflicts, Isolation & Zero-Destructive Invariant", () => {
  describe("Domain Scope Isolation & Overlap Detection", () => {
    it("validates mutually disjoint domain scopes as isolated", () => {
      const domains: DomainScopeEntry[] = [
        { domain: "auth", writeScope: ["src/auth/**", "tests/engine/sync/auth/**"] },
        { domain: "billing", writeScope: ["src/billing/**", "tests/engine/sync/billing/**"] },
      ];
      const result = validateDomainIsolation(domains);
      expect(result.isolated).toBe(true);
      expect(result.conflicts).toHaveLength(0);
      expect(() => assertDomainIsolation(domains)).not.toThrow();
    });

    it("detects overlapping write scopes and throws ROLE_CONFINEMENT_VIOLATION", () => {
      const domains: DomainScopeEntry[] = [
        { domain: "engine-core", writeScope: ["src/engine/**"] },
        { domain: "engine-sync", writeScope: ["src/engine/worktree/sync.ts"] },
      ];
      const result = validateDomainIsolation(domains);
      expect(result.isolated).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.domainA).toBe("engine-core");
      expect(result.conflicts[0]?.domainB).toBe("engine-sync");

      expect(() => assertDomainIsolation(domains)).toThrow(HarnessError);
      try {
        assertDomainIsolation(domains);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).code).toBe("ROLE_CONFINEMENT_VIOLATION");
      }
    });
  });

  describe("Collision Rollback & Merge/Rebase Conflict Handling", () => {
    it("handles merge conflict in syncDomainToGlobal with automatic cleanup", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "base-sha-1", ledgerRoot);
      const runner: GitRunner = (_cwd, argv) => {
        if (argv[0] === "merge") {
          return {
            status: 1,
            stdout: "CONFLICT (content): Merge conflict in state.ts\n",
            stderr: "",
          };
        }
        if (argv[0] === "diff") return ok("state.ts\n");
        return ok();
      };

      const config = provisionDomainWorktree(repoRoot, ledger, "auth", "run-1", runner);
      ledger.commits.push({
        taskId: "task-auth-1",
        domain: "auth",
        worktreeId: config.worktreeId,
        sha: "sha-auth-1",
        subject: "feat(auth): add login",
        changedLines: 20,
        overLimit: false,
        committedAt: new Date().toISOString(),
        pushed: true,
      });

      const res = syncDomainToGlobal({ repoRoot, runId: "run-1", domain: "auth", ledger, runner });
      expect(res.synced).toBe(false);
      expect(res.conflict).toBeDefined();
      expect(res.conflict?.conflictingPaths).toEqual(["state.ts"]);
      expect(config.status).toBe("conflict");
      expect(isDomainSyncEligible(config)).toBe(false);
    });

    it("handles rebase conflict in syncGlobalToDomain", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "base-sha-2", ledgerRoot);
      const runner: GitRunner = (_cwd, argv) => {
        if (argv[0] === "rebase") {
          return {
            status: 1,
            stdout: "CONFLICT (content): Rebase collision in config.json\n",
            stderr: "",
          };
        }
        if (argv[0] === "diff") return ok("config.json\n");
        return ok();
      };

      const config = provisionDomainWorktree(repoRoot, ledger, "billing", "run-2", runner);
      const res = syncGlobalToDomain({ repoRoot, domain: "billing", ledger, rebase: true, runner });
      expect(res.synced).toBe(false);
      expect(res.conflict).toBeDefined();
      expect(res.conflict?.conflictingPaths).toEqual(["config.json"]);
      expect(config.status).toBe("conflict");
    });

    it("synchronizeAllDomains aggregates failed domains and collisions", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "base-sha-3", ledgerRoot);
      const runner: GitRunner = (_cwd, argv) => {
        if (argv[0] === "merge")
          return { status: 1, stdout: "CONFLICT (content): conflict\n", stderr: "" };
        if (argv[0] === "diff") return ok("file.ts\n");
        return ok();
      };

      const d1 = provisionDomainWorktree(repoRoot, ledger, "d1", "run-all", runner);
      ledger.commits.push({
        taskId: "t1",
        domain: "d1",
        worktreeId: d1.worktreeId,
        sha: "sha-1",
        subject: "feat(d1): update",
        changedLines: 5,
        overLimit: false,
        committedAt: new Date().toISOString(),
        pushed: true,
      });

      const summary = synchronizeAllDomains({ repoRoot, runId: "run-all", ledger, runner });
      expect(summary.syncedDomains).toHaveLength(0);
      expect(summary.failedDomains).toContain("d1");
      expect(summary.conflicts).toHaveLength(1);
      expect(summary.scopeIsolated).toBe(false);
    });
  });

  describe("Zero-Destructive Git Policy & Dirty Working Tree Invariant", () => {
    it("identifies destructive git commands and enforces rejection", () => {
      expect(isDestructiveGitCommand(["clean", "-fd"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["reset", "--hard", "HEAD"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["checkout", "--", "file.ts"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["checkout", "."]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["checkout", "-f"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["restore", "src/main.ts"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["stash", "drop"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["stash", "clear"]).destructive).toBe(true);
      expect(isDestructiveGitCommand(["status"]).destructive).toBe(false);
      expect(isDestructiveGitCommand(["diff"]).destructive).toBe(false);
      expect(isDestructiveGitCommand(["commit", "-m", "msg"]).destructive).toBe(false);

      expect(() => assertZeroDestructiveGit(["clean", "-fd"])).toThrow(HarnessError);
      expect(() => assertZeroDestructiveGit(["reset", "--hard"])).toThrow(HarnessError);
      expect(() => assertZeroDestructiveGit(["status"])).not.toThrow();
    });

    it("assertNonDestructiveWriteScope rejects out-of-scope modifications", () => {
      const writeScope = ["src/core/**", "src/utils/math.ts"];
      expect(() =>
        assertNonDestructiveWriteScope(["src/core/runner.ts", "src/utils/math.ts"], writeScope),
      ).not.toThrow();

      expect(() =>
        assertNonDestructiveWriteScope(["src/engine/sync.ts", "src/core/runner.ts"], writeScope),
      ).toThrow(HarnessError);
    });

    it("partitionObservedChanges separates scoped changes from unfamiliar changes", () => {
      const scope = ["src/auth/**"];
      const observed = ["src/auth/jwt.ts", "package.json", "src/auth/session.ts", "README.md"];
      const partition = partitionObservedChanges(observed, scope);

      expect(partition.scopedPaths).toEqual(["src/auth/jwt.ts", "src/auth/session.ts"]);
      expect(partition.unfamiliarUserPaths).toEqual(["package.json", "README.md"]);
    });

    it("validates path in write scope with wildcards and glob expressions", () => {
      expect(isPathInWriteScope("src/auth/login.ts", ["src/auth/**"])).toBe(true);
      expect(isPathInWriteScope("src/auth/sub/deep/token.ts", ["src/auth/**"])).toBe(true);
      expect(isPathInWriteScope("src/billing/invoice.ts", ["src/auth/**"])).toBe(false);
      expect(isPathInWriteScope("src/core/math.ts", ["src/core/*.ts"])).toBe(true);

      const filtered = filterPathsToScope(
        ["src/auth/token.ts", "src/other.ts", "src/auth/user.ts"],
        ["src/auth/**"],
      );
      expect(filtered).toEqual(["src/auth/token.ts", "src/auth/user.ts"]);
    });
  });
});
