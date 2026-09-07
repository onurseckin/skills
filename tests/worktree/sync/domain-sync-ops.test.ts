import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { GitResult, GitRunner } from "../../../olt/scripts/src/workflow/worktree/git.ts";
import {
  createDomainLedger,
  provisionDomainWorktree,
  syncDomainToGlobal,
  syncGlobalToDomain,
} from "../../../olt/scripts/src/engine/worktree/domain-sync.ts";
import {
  cleanupVirtualWorktreeFS,
  getVirtualWorktreeFS,
  setupVirtualWorktreeFS,
} from "../fixtures/index.ts";

beforeEach(() => {
  setupVirtualWorktreeFS();
});

afterEach(() => {
  cleanupVirtualWorktreeFS();
});

function trackedDir(prefix: string): string {
  const dir = join(
    "/virtual",
    `domain-sync-ops-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  getVirtualWorktreeFS().mkdirSync(dir, { recursive: true });
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

describe("Domain Sync: Operations & Synchronization", () => {
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
  });

  describe("syncGlobalToDomain", () => {
    test("merges global harness branch into domain worktree without conflict", () => {
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
});
